import {
  connectAppServer,
  prepareNativeThread,
} from "./app-server-connection.mjs";
import { createTurnCollector } from "./turn-collector.mjs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { startGatewayTransport } from "./gateway-transport.mjs";
import { createSubagents, serveSubagents } from "./subagents.mjs";
import {
  SubscriptionUnavailable,
  NativeHistoryMismatch,
  isEncryptedHistoryRejection,
  portableNativeHistory,
  subscriptionPreferred,
  readSubscriptionTokens,
  subscriptionFailureReason,
  codexProcessEnvironment,
} from "./auth.mjs";

// The sandbox recipe pins the CLI via @openai/codex-sdk. Use that installation,
// not a global CLI, and keep the task sandbox's existing Codex home and credentials.
export function launchCodexAppServer(workdir, subscription = false) {
  const sdkRequire = createRequire(import.meta.resolve("@openai/codex-sdk"));
  const cliPackage = sdkRequire.resolve("@openai/codex/package.json");
  const cli = path.join(
    path.dirname(cliPackage),
    sdkRequire(cliPackage).bin.codex
  );
  return spawn(
    process.execPath,
    [
      cli,
      "app-server",
      ...(subscription ? ["-c", 'cli_auth_credentials_store="ephemeral"'] : []),
    ],
    {
      cwd: workdir,
      env: codexProcessEnvironment(subscription),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    }
  );
}

function threadSettings(start, workdir, subscription = false) {
  const nativeConfig = { ...start.codexConfig };
  delete nativeConfig.hive_subscription_tokens;
  const gatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL;
  const gateway =
    !subscription && Boolean(process.env.AI_GATEWAY_API_KEY || gatewayBaseUrl);
  if (gateway && !gatewayBaseUrl)
    throw new Error("AI Gateway base URL is missing.");
  const baseUrl = subscription
    ? undefined
    : gateway
      ? gatewayBaseUrl
      : process.env.OPENAI_BASE_URL;
  const model =
    gateway && start.model && !start.model.includes("/")
      ? `openai/${start.model}`
      : start.model;
  const config = {
    ...nativeConfig,
    web_search: start.webSearch ? "live" : "disabled",
    ...(start.reasoningEffort
      ? { model_reasoning_effort: start.reasoningEffort }
      : {}),
    model_reasoning_summary: "detailed",
    // Hive owns bounded delegation so native children cannot bypass its limits.
    features: {
      ...start.codexConfig?.features,
      multi_agent: false,
      multi_agent_v2: false,
    },
    ...(subscription
      ? {
          model_provider: "hive_chatgpt",
          cli_auth_credentials_store: "ephemeral",
          // Sandbox credential transformations support HTTP, not WebSocket
          // upgrades. Keep native ChatGPT auth without paying failed WS retries.
          model_providers: {
            hive_chatgpt: {
              base_url: "https://chatgpt.com/backend-api/codex",
              ...nativeConfig.model_providers?.hive_chatgpt,
              name: "OpenAI",
              requires_openai_auth: true,
              supports_websockets: false,
            },
          },
        }
      : {}),
  };
  if (gateway && model?.startsWith("openai/"))
    config.model_supports_reasoning_summaries = true;
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
        ...(gateway && process.env.AI_SDK_HARNESS_CLIENT_APP
          ? {
              http_headers: {
                "User-Agent": process.env.AI_SDK_HARNESS_CLIENT_APP,
                "x-client-app": process.env.AI_SDK_HARNESS_CLIENT_APP,
              },
            }
          : {}),
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
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** Native stdio JSON-RPC -> the public harness event contract. No simulated deltas. */
export async function runCodexAppServerTurn(options) {
  const { start, turn, workdir } = options;
  if (start.tools?.length)
    throw new Error("Hive's Codex bridge does not accept host-executed tools.");
  turn.abortSignal.throwIfAborted();
  turn.emit({ type: "stream-start" });
  if (subscriptionPreferred(start)) {
    const tokens = readSubscriptionTokens(start);
    return runWithCompatibleHistory({
      ...options,
      subscription: true,
      tokens,
      settings: threadSettings(start, workdir, true),
    });
  }
  const settings = threadSettings(start, workdir);
  let gateway;
  try {
    if (process.env.AI_GATEWAY_BASE_URL) {
      gateway = await startGatewayTransport({
        baseUrl: process.env.AI_GATEWAY_BASE_URL,
        authorization: process.env.CODEX_API_KEY
          ? `Bearer ${process.env.CODEX_API_KEY}`
          : undefined,
        signal: turn.abortSignal,
        onDiagnostic(attrs) {
          turn.bridgeLog?.({
            level: attrs.outcome === "recovered" ? "info" : "warn",
            subsystem: "hive.gateway",
            message: "Gateway request recovery",
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
    return await runWithCompatibleHistory({ ...options, settings });
  } finally {
    await gateway?.close();
  }
}

async function runWithCompatibleHistory(options) {
  try {
    return await runNativeTurn(options);
  } catch (error) {
    if (!(error instanceof NativeHistoryMismatch)) throw error;
    options.turn.abortSignal.throwIfAborted();
    const start = {
      ...options.start,
      prompt: error.context + options.start.prompt,
    };
    options.turn.bridgeLog?.({
      level: "info",
      subsystem: "hive.auth",
      message: "Native context carried forward",
      attrs: {
        source: options.subscription ? "chatgpt" : "ai-gateway",
        model: options.settings.model,
        reason: "incompatible_native_history",
      },
    });
    // One recovery only, after confirmed rejection and clean shutdown. Never
    // edit/delete rollout files or re-run tools from a completed/partial turn.
    return runNativeTurn({ ...options, start, threadId: undefined });
  }
}

async function runNativeTurn({
  start,
  turn,
  workdir,
  settings,
  threadId: resumedThreadId,
  onThread,
  launch = launchCodexAppServer,
  subscription = false,
  tokens,
}) {
  let subagents, closeSubagentServer, threadId, turnId, collector, abortTimer;
  let result, turnFailure, processExit;
  const connection = connectAppServer(launch(workdir, subscription), {
    onNotification(message) {
      subagents?.notification(message);
    },
    onRequest(message, send) {
      if (
        subscription &&
        message.method === "account/chatgptAuthTokens/refresh"
      ) {
        // Host refresh owns real credentials. Optional background refresh is refused.
        send({
          id: message.id,
          error: { code: -32000, message: "Reconnect the Codex subscription." },
        });
        return;
      }
      send({
        id: message.id,
        error: {
          code: -32601,
          message: "Interactive requests are not supported by Hive.",
        },
      });
      if (!subagents?.ownsThread(message.params?.threadId))
        throw new Error(
          `Codex requested unsupported interaction: ${message.method}`
        );
    },
  });
  const abort = () => {
    if (threadId && turnId)
      connection.send({
        id: "hive-interrupt",
        method: "turn/interrupt",
        params: { threadId, turnId },
      });
    abortTimer ??= setTimeout(connection.kill, 4000);
  };
  turn.abortSignal.addEventListener("abort", abort, { once: true });
  try {
    turn.abortSignal.throwIfAborted();
    threadId = await prepareNativeThread(connection, {
      start,
      settings,
      resumedThreadId,
      subscription,
      tokens,
      turn,
    });
    onThread(threadId);
    turn.emit({ type: "bridge-thread", threadId });
    const headers = start.mcpServers?.hive?.http_headers;
    if (headers?.["X-Hive-Control"] && headers?.["X-Hive-Run-Id"]) {
      subagents = createSubagents({
        request: connection.request,
        settings,
        runId: headers["X-Hive-Run-Id"],
        onChange(attrs) {
          turn.bridgeLog?.({
            level: "info",
            subsystem: "hive.subagent",
            message: "Subagent progress",
            attrs,
          });
        },
      });
      closeSubagentServer = await serveSubagents(
        subagents,
        headers["X-Hive-Control"]
      );
    }
    const started = await connection.request(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: start.prompt, text_elements: [] }],
        ...(start.reasoningEffort ? { effort: start.reasoningEffort } : {}),
        ...(start.responseFormat?.type === "json" && start.responseFormat.schema
          ? { outputSchema: start.responseFormat.schema }
          : {}),
      },
      120_000
    );
    turnId = started?.turn?.id;
    if (!turnId) throw new Error("Codex did not start a turn.");
    if (turn.abortSignal.aborted) abort();
    collector = createTurnCollector(turn.emit, threadId, turnId);
    for await (const message of connection.notifications) {
      result = collector.notification(message);
      if (result) break;
    }
    if (connection.error) throw connection.error;
    turn.abortSignal.throwIfAborted();
    if (!result)
      throw new Error(
        `Codex exited before completing its turn.${connection.stderr ? ` ${connection.stderr}` : ""}`
      );
    if (result.status !== "completed") {
      const failure = result.error ?? collector.failure;
      if (
        !collector.observedActivity &&
        result.status === "failed" &&
        isEncryptedHistoryRejection(failure)
      ) {
        const read = await connection.request("thread/read", {
          threadId,
          includeTurns: true,
        });
        throw new NativeHistoryMismatch(
          portableNativeHistory(read?.thread, turnId)
        );
      }
      const reason = subscription ? subscriptionFailureReason(failure) : null;
      if (reason) throw new SubscriptionUnavailable(reason);
      throw new Error(failure?.message || `Codex turn ${result.status}.`);
    }
    collector.assertComplete();
  } catch (error) {
    turnFailure = { error };
  } finally {
    // Cleanup failure must still close the process and prohibit history replay.
    const cleanupErrors = [];
    for (const close of [
      () => subagents?.close(),
      () => closeSubagentServer?.(),
      () => collector?.interruptCommands(),
    ]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length)
      turnFailure = {
        error: new AggregateError(
          [...(turnFailure ? [turnFailure.error] : []), ...cleanupErrors],
          "Codex cleanup failed."
        ),
      };
    turn.abortSignal.removeEventListener("abort", abort);
    clearTimeout(abortTimer);
    processExit = await connection.shutdown();
  }
  if (processExit.code !== 0 || processExit.signal || connection.error)
    throw new Error(
      "Codex did not shut down cleanly; its history checkpoint could not be confirmed.",
      {
        cause:
          connection.error && turnFailure
            ? new AggregateError([turnFailure.error, connection.error])
            : (connection.error ?? turnFailure?.error),
      }
    );
  if (turnFailure) throw turnFailure.error;
  const usage = {
    inputTokens: {},
    outputTokens: {},
    ...(collector.tokenUsage ? { raw: { codex: collector.tokenUsage } } : {}),
  };
  turn.emit({
    type: "finish-step",
    finishReason: { unified: "stop", raw: "stop" },
    usage,
  });
  turn.emit({
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    totalUsage: usage,
  });
}
