import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { startGatewayTransport } from "./gateway-transport.mjs";
import { createSubagents, serveSubagents } from "./subagents.mjs";

// The sandbox recipe pins the CLI via @openai/codex-sdk. Use that installation,
// not a global CLI, and keep the task sandbox's existing Codex home and credentials.
export function launchCodexAppServer(workdir) {
  const sdkRequire = createRequire(import.meta.resolve("@openai/codex-sdk"));
  const cliPackage = sdkRequire.resolve("@openai/codex/package.json");
  const cli = path.join(path.dirname(cliPackage), sdkRequire(cliPackage).bin.codex);
  return spawn(process.execPath, [cli, "app-server"], {
    cwd: workdir,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
}

function threadSettings(start, workdir) {
  const gatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL;
  const gateway = Boolean(process.env.AI_GATEWAY_API_KEY || gatewayBaseUrl);
  if (gateway && !gatewayBaseUrl) throw new Error("AI Gateway base URL is missing.");
  const baseUrl = gateway ? gatewayBaseUrl : process.env.OPENAI_BASE_URL;
  const model = gateway && start.model && !start.model.includes("/")
    ? `openai/${start.model}` : start.model;
  const config = {
    ...start.codexConfig,
    web_search: start.webSearch ? "live" : "disabled",
    ...(start.reasoningEffort ? { model_reasoning_effort: start.reasoningEffort } : {}),
    model_reasoning_summary: "detailed",
    // Hive owns bounded delegation so native children cannot bypass its limits.
    features: { ...start.codexConfig?.features, multi_agent: false, multi_agent_v2: false },
  };
  if (gateway && model?.startsWith("openai/")) config.model_supports_reasoning_summaries = true;
  if (baseUrl) {
    config.preferred_auth_method = "apikey";
    config.model_provider = "agent_bridge_openai";
    config.model_providers = {
      agent_bridge_openai: {
        name: process.env.CODEX_MODEL_PROVIDER_NAME || "Agent Bridge OpenAI",
        base_url: baseUrl,
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
        supports_websockets: false,
        ...(gateway && process.env.AI_SDK_HARNESS_CLIENT_APP ? {
          http_headers: {
            "User-Agent": process.env.AI_SDK_HARNESS_CLIENT_APP,
            "x-client-app": process.env.AI_SDK_HARNESS_CLIENT_APP,
          },
        } : {}),
      },
    };
  }
  if (start.mcpServers) config.mcp_servers = start.mcpServers;
  return {
    model,
    cwd: workdir,
    // The existing Vercel Sandbox remains the execution/security boundary.
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    config,
    developerInstructions: [
      start.instructions,
      "Only respond with your `final` message once you have fully addressed the user request.",
    ].filter(Boolean).join("\n\n"),
  };
}

/** Native stdio JSON-RPC -> the public harness event contract. No simulated deltas. */
export async function runCodexAppServerTurn(options) {
  const { start, turn, workdir } = options;
  if (start.tools?.length) throw new Error("Hive's Codex bridge does not accept host-executed tools.");
  turn.abortSignal.throwIfAborted();
  const settings = threadSettings(start, workdir);
  let gateway;
  try {
    if (process.env.AI_GATEWAY_BASE_URL) {
      gateway = await startGatewayTransport({
        baseUrl: process.env.AI_GATEWAY_BASE_URL,
        authorization: process.env.CODEX_API_KEY ? `Bearer ${process.env.CODEX_API_KEY}` : undefined,
        signal: turn.abortSignal,
        onDiagnostic(attrs) {
          turn.bridgeLog?.({
            level: attrs.outcome === "recovered" ? "info" : "warn",
            subsystem: "hive.gateway", message: "Gateway request recovery",
            attrs: { ...attrs, model: settings.model },
          });
        },
      });
      Object.assign(settings.config.model_providers.agent_bridge_openai, {
        base_url: gateway.baseUrl,
        // The transport retries only rejected 429s. Do not layer native retries
        // on top, especially after an ambiguous connection/stream failure.
        request_max_retries: 0,
        stream_max_retries: 0,
      });
    }
    turn.abortSignal.throwIfAborted();
    return await runNativeTurn({ ...options, settings });
  } finally {
    await gateway?.close();
  }
}

async function runNativeTurn({
  start, turn, workdir, settings, threadId: resumedThreadId, onThread,
  launch = launchCodexAppServer,
}) {
  const child = launch(workdir);
  const lines = createInterface({ input: child.stdout });
  const messages = lines[Symbol.asyncIterator]();
  const textByItem = new Map();
  const commands = new Map();
  const completedItems = new Set();
  let threadId;
  let turnId;
  let result;
  let failure;
  let processError;
  let stderr = "";
  let closed = false;
  let abortTimer;
  let tokenUsage;
  let processExit;
  let subagents;
  let closeSubagentServer;
  let rpcSequence = 0;
  const pendingRequests = new Map();
  const exited = new Promise((resolve) => child.once("close", (code, signal) => {
    closed = true;
    resolve({ code, signal });
  }));
  child.once("error", (error) => { processError = error; lines.close(); });
  child.stdin.on("error", (error) => { processError ??= error; });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  const send = (message) => {
    if (!closed && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error("Codex is no longer running.")); return; }
    const id = `hive-subagent:${++rpcSequence}`;
    const timer = setTimeout(() => { pendingRequests.delete(id); reject(new Error("Codex request timed out.")); }, 12_000);
    pendingRequests.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
  // Keep processing child replies while the main loop drains at turn end.
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const pending = pendingRequests.get(message.id);
    if (pending && !message.method) {
      pendingRequests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
    if (message.method) subagents?.notification(message);
  });
  const startThread = () => send({ id: 1, method: resumedThreadId ? "thread/resume" : "thread/start", params: {
    ...settings, ...(resumedThreadId ? { threadId: resumedThreadId } : {}),
  } });
  const kill = () => {
    if (!closed) {
      // Terminate only the process group created by this turn, including the CLI child.
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  };
  const abort = () => {
    if (threadId && turnId) send({ id: 3, method: "turn/interrupt", params: { threadId, turnId } });
    else child.stdin.end();
    abortTimer ??= setTimeout(kill, 4000);
  };
  turn.abortSignal.addEventListener("abort", abort, { once: true });
  const emit = (event) => turn.emit(event);
  const appendText = (id, delta) => {
    if (!delta || completedItems.has(id)) return;
    if (!textByItem.has(id)) { textByItem.set(id, ""); emit({ type: "text-start", id }); }
    textByItem.set(id, textByItem.get(id) + delta);
    emit({ type: "text-delta", id, delta });
  };
  const completeCommand = (item) => {
    const command = commands.get(item.id);
    if (!command || completedItems.has(item.id)) return;
    emit({ type: "tool-result", toolCallId: item.id, toolName: "bash", result: {
      exitCode: Number.isInteger(item.exitCode) ? item.exitCode : null,
      output: item.aggregatedOutput ?? command.output,
      status: item.status,
    } });
    completedItems.add(item.id);
  };

  emit({ type: "stream-start" });
  send({ id: 0, method: "initialize", params: {
    clientInfo: { name: "hive", title: "Hive", version: "0.1.0" },
  } });
  try {
    for await (const line of messages) {
      const message = JSON.parse(line);
      if (message.method && message.id != null) {
        // Approval/input requests are not silently granted or left hanging.
        send({ id: message.id, error: { code: -32601, message: "Interactive requests are not supported by Hive." } });
        if (subagents?.ownsThread(message.params?.threadId)) continue;
        throw new Error(`Codex requested unsupported interaction: ${message.method}`);
      }
      if (!message.method) {
        if (String(message.id).startsWith("hive-subagent:")) continue;
        if (message.error) throw new Error(message.error.message || "Codex request failed.");
        if (message.id === 0) {
          send({ method: "initialized", params: {} });
          if (start.mcpServers?.hive) {
            // Native skill input only loads discovered skills. Register the
            // bundled root for this process, without editing repository files.
            send({ id: 4, method: "skills/extraRoots/set", params: { extraRoots: [fileURLToPath(new URL(".", import.meta.url))] } });
          } else startThread();
        } else if (message.id === 4) {
          startThread();
        } else if (message.id === 1) {
          threadId = message.result?.thread?.id;
          if (!threadId || (resumedThreadId && threadId !== resumedThreadId)) {
            throw new Error("Codex did not resume the expected thread.");
          }
          onThread(threadId);
          emit({ type: "bridge-thread", threadId });
          const headers = start.mcpServers?.hive?.http_headers;
          if (headers?.["X-Hive-Control"] && headers?.["X-Hive-Run-Id"]) {
            subagents = createSubagents({ request, settings, runId: headers["X-Hive-Run-Id"], onChange(attrs) {
              turn.bridgeLog?.({ level: "info", subsystem: "hive.subagent", message: "Subagent progress", attrs });
            } });
            closeSubagentServer = await serveSubagents(subagents, headers["X-Hive-Control"]);
          }
          send({ id: 2, method: "turn/start", params: {
            threadId,
            input: [
              { type: "text", text: start.prompt, text_elements: [] },
              // Explicit native skill input preserves an existing thread. The
              // generic adapter's skills replacement would request a restart.
              ...(start.mcpServers?.hive ? [{ type: "skill", name: "hive-collaboration", path: fileURLToPath(new URL("./hive-collaboration/SKILL.md", import.meta.url)) }] : []),
            ],
            ...(start.reasoningEffort ? { effort: start.reasoningEffort } : {}),
            ...(start.responseFormat?.type === "json" && start.responseFormat.schema
              ? { outputSchema: start.responseFormat.schema } : {}),
          } });
        } else if (message.id === 2) {
          turnId = message.result?.turn?.id;
          if (!turnId) throw new Error("Codex did not start a turn.");
          if (turn.abortSignal.aborted) abort();
        }
        continue;
      }
      const params = message.params ?? {};
      // Never mix child-agent or other-thread events into this shared reply.
      if (!threadId || params.threadId !== threadId) continue;
      if (turnId && params.turnId && params.turnId !== turnId) continue;
      if (message.method === "turn/started") turnId = params.turn.id;
      if (message.method === "item/agentMessage/delta") appendText(params.itemId, params.delta);
      if (message.method === "thread/tokenUsage/updated") tokenUsage = params.tokenUsage;
      if (message.method === "error" && !params.willRetry) failure = params.error;
      if (message.method === "item/commandExecution/outputDelta") {
        const command = commands.get(params.itemId);
        if (command) command.output = (command.output + params.delta).slice(0, 20_000);
      }
      if (message.method === "item/started" || message.method === "item/completed") {
        const item = params.item;
        const done = message.method === "item/completed";
        if (completedItems.has(item.id)) continue;
        if (item.type === "agentMessage") {
          const previous = textByItem.get(item.id) ?? "";
          if (done) {
            if (!item.text.startsWith(previous)) throw new Error("Codex's completed reply differs from its streamed text.");
            appendText(item.id, item.text.slice(previous.length));
            if (textByItem.has(item.id)) emit({ type: "text-end", id: item.id });
            completedItems.add(item.id);
          }
        } else if (item.type === "commandExecution") {
          if (!commands.has(item.id)) {
            commands.set(item.id, { output: "" });
            emit({ type: "tool-call", toolCallId: item.id, toolName: "bash", nativeName: "shell",
              input: JSON.stringify({ command: item.command }), providerExecuted: true });
          }
          if (done) completeCommand(item);
        } else if (item.type === "fileChange" && done && item.status === "completed") {
          for (const change of item.changes) emit({ type: "file-change", path: change.path,
            event: change.kind.type === "add" ? "create" : change.kind.type === "delete" ? "delete" : "modify" });
          completedItems.add(item.id);
        } else if (item.type === "mcpToolCall") {
          if (!done) emit({ type: "tool-call", toolCallId: item.id, toolName: item.tool,
            input: JSON.stringify(item.arguments), providerExecuted: true, dynamic: true });
          else {
            emit({ type: "tool-result", toolCallId: item.id, toolName: item.tool,
              result: item.error ?? item.result, dynamic: true });
            completedItems.add(item.id);
          }
        }
        // Reasoning is deliberately not translated into public text.
      }
      if (message.method === "turn/completed") { result = params.turn; break; }
    }
    if (processError) throw processError;
    turn.abortSignal.throwIfAborted();
    if (!result) throw new Error(`Codex exited before completing its turn.${stderr ? ` ${stderr}` : ""}`);
    if (result.status !== "completed") {
      throw new Error(result.error?.message || failure?.message || `Codex turn ${result.status}.`);
    }
    if ([...commands.keys()].some((id) => !completedItems.has(id))) {
      throw new Error("Codex finished without a command's exit status.");
    }
  } finally {
    // Stop outstanding children before flushing native history/snapshotting the VM.
    await subagents?.close();
    await closeSubagentServer?.();
    for (const id of commands.keys()) completeCommand({ id, status: "interrupted" });
    turn.abortSignal.removeEventListener("abort", abort);
    clearTimeout(abortTimer);
    // EOF lets app-server flush the native rollout before the sandbox snapshots.
    child.stdin.end();
    const timer = setTimeout(kill, 4000);
    processExit = await exited;
    clearTimeout(timer);
    lines.close();
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex has stopped."));
    }
    pendingRequests.clear();
  }
  if (processExit.code !== 0 || processExit.signal) {
    throw new Error("Codex did not shut down cleanly; its history checkpoint could not be confirmed.");
  }
  // Native tokenUsage.total includes previous turns and last is one model call,
  // not this whole turn. Keep raw counters without inventing per-turn totals.
  const usage = { inputTokens: {}, outputTokens: {}, ...(tokenUsage ? { raw: { codex: tokenUsage } } : {}) };
  emit({ type: "finish-step", finishReason: { unified: "stop", raw: "stop" }, usage });
  emit({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, totalUsage: usage });
}
