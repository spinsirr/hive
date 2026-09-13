// Opt-in: pinned native Codex + loopback Responses fixture, no account/model spend.
// node scripts/diagnostics/check-codex-subagent-process.mjs /path/to/isolated/sdk-install
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, access, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createSubagents,
  serveSubagents,
  subagentSocket,
} from "../../src/lib/codex-bridge/subagents.mjs";
import { handleHiveMcp } from "../../src/lib/hive-mcp.ts";
import { createHiveMemory } from "../../src/lib/hive-memory.ts";
import { memberDirectory } from "../../src/lib/task-session.ts";

const installation = process.argv[2];
assert.ok(
  installation,
  "Pass an isolated @openai/codex-sdk@0.149.1 installation"
);
const require = createRequire(
  await realpath(
    path.join(installation, "node_modules/@openai/codex-sdk/package.json")
  )
);
const cliPackage = require.resolve("@openai/codex/package.json");
assert.equal(require(cliPackage).version, "0.149.1");
const cli = path.join(path.dirname(cliPackage), require(cliPackage).bin.codex);
const fixture = await mkdtemp(path.join(os.tmpdir(), "hive-subagents-native-"));
const codexHome = path.join(fixture, "isolated-home"),
  repo = path.join(fixture, "repo");
await mkdir(codexHome);
await mkdir(repo);
await writeFile(path.join(repo, "evidence.txt"), "HIVE_READ_ONLY_EVIDENCE\n");
const model = "openai/gpt-5.1-codex-mini";
const requests = [],
  counts = new Map(),
  progress = [];
const stopping = Promise.withResolvers();
const mcpCalls = [],
  inheritedMcpRequests = [];
const scope = {
  sessionId: "native-subagent-task",
  memberId: "spencer",
  runId: "native-fixture",
};
const context = {
  sessionId: scope.sessionId,
  stage: "running",
  repository: null,
  messages: [
    {
      id: "human-one",
      memberId: "spencer",
      name: "Spencer Zhao",
      initials: "SZ",
      body: "Inspect evidence.txt without changing files.",
      time: "now",
      role: "human",
    },
  ],
  workspace: { status: "running", liveReply: { id: scope.runId } },
  members: [memberDirectory.spencer],
  steeringQueue: [],
};
let fixtureFailure;
const provider = createServer(async (request, response) => {
  try {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(rawBody);
    if (request.url === "/agent-tools") {
      assert.equal(
        request.headers.authorization,
        "Bearer private-parent-fixture"
      );
      if (request.headers["x-fixture-inherited"])
        inheritedMcpRequests.push(body.method);
      if (body.method === "tools/call") mcpCalls.push(body.params.name);
      const output = await handleHiveMcp(
        new Request(`http://127.0.0.1:${provider.address().port}/agent-tools`, {
          method: "POST",
          headers: request.headers,
          body: rawBody,
        }),
        scope,
        {
          read: async () => context,
          reply: async () =>
            assert.fail("A research fixture must not post to the team"),
        },
        createHiveMemory(undefined)
      );
      response.writeHead(output.status, Object.fromEntries(output.headers));
      response.end(Buffer.from(await output.arrayBuffer()));
      return;
    }
    assert.equal(request.url, "/v1/responses");
    assert.equal(
      body.model,
      model,
      "Native review must not silently switch to a more expensive model"
    );
    assert.equal(
      body.reasoning.effort,
      "low",
      "Children must inherit the task's configured reasoning effort"
    );
    requests.push(body);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(
      serialized,
      /private-parent-fixture/,
      "Runtime credentials must not become model context"
    );
    const kind = serialized.includes("STOP_FIXTURE")
      ? "stop"
      : serialized.includes("REVIEW_FIXTURE")
        ? "review"
        : "research";
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const send = (data) =>
      response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({ type: "response.created", response: { id: `${kind}-${count}` } });
    if (kind === "stop") {
      stopping.resolve();
      return;
    }
    if (kind === "research" && count === 1) {
      const tools = body.tools.flatMap((tool) =>
        tool.type === "namespace"
          ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name }))
          : [tool]
      );
      const contextTool = tools.find(
        (tool) =>
          tool.name === "get_context" || tool.name.endsWith("__get_context")
      );
      assert.ok(
        contextTool,
        "Children must receive the inherited task-scoped context tool"
      );
      send({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "inherited-task-context",
          name: contextTool.name,
          ...(contextTool.namespace
            ? { namespace: contextTool.namespace }
            : {}),
          arguments: "{}",
        },
      });
    } else if (count === (kind === "research" ? 2 : 1)) {
      if (kind === "research")
        assert.match(
          serialized,
          /Spencer Zhao/,
          "Inherited tools must return the same task's attributed context"
        );
      const tools = body.tools.flatMap((tool) =>
        tool.type === "namespace"
          ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name }))
          : [tool]
      );
      const shell = tools.find((tool) =>
        ["exec_command", "shell_command", "shell"].includes(tool.name)
      );
      assert.ok(
        shell,
        "A real native shell tool is required for the readonly boundary check"
      );
      const command = `cat evidence.txt; printf forbidden > ${kind}-must-not-exist.txt`;
      const args =
        shell.name === "exec_command"
          ? { cmd: command, yield_time_ms: 1000 }
          : shell.name === "shell"
            ? { command: ["/bin/sh", "-c", command] }
            : { command };
      send({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: `cmd-${kind}`,
          name: shell.name,
          ...(shell.namespace ? { namespace: shell.namespace } : {}),
          arguments: JSON.stringify(args),
        },
      });
    } else {
      assert.ok(
        count <= (kind === "research" ? 3 : 2),
        "A fixture must not loop model requests"
      );
      assert.match(
        serialized,
        /HIVE_READ_ONLY_EVIDENCE/,
        "The subagent must be able to read the actual repository"
      );
      const text =
        kind === "review"
          ? JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation:
                "REVIEW_FIXTURE: evidence.txt was read; the write was denied.",
              overall_confidence_score: 0.9,
            })
          : "RESEARCH_FIXTURE: evidence.txt contains HIVE_READ_ONLY_EVIDENCE; the write was denied.";
      send({
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          id: `${kind}-reply`,
          content: [{ type: "output_text", text }],
        },
      });
    }
    send({
      type: "response.completed",
      response: {
        id: `${kind}-${count}`,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    response.end();
  } catch (error) {
    fixtureFailure = error;
    response.destroy();
  }
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
await writeFile(
  path.join(codexHome, "config.toml"),
  `[mcp_servers.inherited]\nurl = "http://127.0.0.1:${provider.address().port}/agent-tools"\nenabled = true\nstartup_timeout_sec = 5\n[mcp_servers.inherited.http_headers]\nAuthorization = "Bearer private-parent-fixture"\nX-Fixture-Inherited = "true"\n`
);
const app = spawn(process.execPath, [cli, "app-server"], {
  cwd: repo,
  env: {
    PATH: process.env.PATH,
    CODEX_HOME: codexHome,
    CODEX_API_KEY: "controlled-loopback-fixture",
  },
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,
});
let stderr = "",
  sequence = 0,
  controller,
  closeControl;
const capability = randomUUID();
function control(input, suppliedCapability = capability) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(subagentSocket(capability));
    let body = "";
    socket.setEncoding("utf8");
    socket.setTimeout(15_000, () => socket.destroy(new Error("IPC timed out")));
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({ ...input, capability: suppliedCapability }) + "\n"
      )
    );
    socket.on("data", (data) => {
      body += data;
    });
    socket.on("error", reject);
    socket.on("end", () => {
      const response = JSON.parse(body);
      if (response.error) reject(new Error(response.error));
      else resolve(response.result);
    });
  });
}
const pending = new Map();
app.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-2000);
});
const lines = createInterface({ input: app.stdout });
const exited = new Promise((resolve) =>
  app.once("close", (code) => resolve(code))
);
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 20_000);
    pending.set(id, { resolve, reject, timer });
    app.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method) {
    if (
      process.env.HIVE_FIXTURE_TRACE &&
      ["item/completed", "turn/completed"].includes(message.method)
    )
      console.log(JSON.stringify(message));
    if (message.id != null)
      app.stdin.write(
        JSON.stringify({
          id: message.id,
          error: {
            code: -32601,
            message: "No interactive approvals in the fixture",
          },
        }) + "\n"
      );
    controller?.notification(message);
  } else {
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) {
        console.error(message.error.message);
        entry.reject(new Error(message.error.message));
      } else entry.resolve(message.result);
    }
  }
});
const settings = {
  model,
  cwd: repo,
  sandbox: "read-only",
  approvalPolicy: "never",
  developerInstructions:
    "Stay in this repository and preserve task member attribution.",
  config: {
    preferred_auth_method: "apikey",
    model_provider: "fixture",
    model_reasoning_effort: "low",
    web_search: "disabled",
    features: { multi_agent: false, multi_agent_v2: false },
    model_providers: {
      fixture: {
        name: "Loopback fixture",
        base_url: `http://127.0.0.1:${provider.address().port}/v1`,
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
        supports_websockets: false,
        request_max_retries: 0,
        stream_max_retries: 0,
      },
    },
    mcp_servers: {
      hive: {
        url: `http://127.0.0.1:${provider.address().port}/agent-tools`,
        http_headers: { Authorization: "Bearer private-parent-fixture" },
      },
    },
  },
};
async function done(id) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const task = await control({ action: "read", id, waitMs: 5000 });
    if (!["starting", "running", "stopping"].includes(task.status)) return task;
  }
  throw new Error("Native subagent did not finish");
}
try {
  await rpc("initialize", {
    clientInfo: { name: "hive-subagent-fixture", version: "1" },
  });
  app.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  controller = createSubagents({
    request: rpc,
    settings,
    runId: "native-fixture",
    onChange: (value) => progress.push(value),
  });
  closeControl = await serveSubagents(controller, capability);
  await assert.rejects(
    control(
      {
        action: "spawn",
        kind: "research",
        task: "Not authorized",
        requestId: "forbidden",
      },
      "wrong-capability"
    ),
    /Unauthorized/
  );
  const tasks = await Promise.all([
    control({
      action: "spawn",
      kind: "research",
      task: "RESEARCH_FIXTURE: inspect evidence.txt and report what it contains. 只读调研。",
      requestId: "research-one",
    }),
    control({
      action: "spawn",
      kind: "review",
      task: "REVIEW_FIXTURE: review evidence.txt without changing files.",
      requestId: "review-one",
    }),
  ]);
  const results = await Promise.all(tasks.map((task) => done(task.id)));
  if (process.env.HIVE_FIXTURE_TRACE)
    console.log(JSON.stringify({ tasks, results }));
  if (fixtureFailure) throw fixtureFailure;
  assert.ok(
    inheritedMcpRequests.includes("tools/list"),
    "Codex configuration inheritance must not be suppressed by Hive"
  );
  assert.deepEqual(
    mcpCalls,
    ["get_context"],
    "A child can use the inherited authenticated tool without a team write"
  );
  assert.deepEqual(
    results.map((task) => task.status),
    ["completed", "completed"],
    JSON.stringify(results)
  );
  assert.match(results[0].result, /HIVE_READ_ONLY_EVIDENCE/);
  assert.match(results[1].result, /REVIEW_FIXTURE/);
  for (const kind of ["research", "review"])
    await assert.rejects(access(path.join(repo, `${kind}-must-not-exist.txt`)));
  await controller.close();
  await closeControl();
  controller = createSubagents({
    request: rpc,
    settings,
    runId: "native-stop-fixture",
    onChange: (value) => progress.push(value),
  });
  closeControl = await serveSubagents(controller, capability);
  const task = await control({
    action: "spawn",
    kind: "research",
    task: "STOP_FIXTURE",
    requestId: "stop-one",
  });
  await Promise.race([
    stopping.promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Stop fixture not reached")),
        10_000
      ).unref()
    ),
  ]);
  await control({ action: "stop", id: task.id });
  assert.equal((await done(task.id)).status, "stopped");
  assert.equal(
    requests.length,
    6,
    "Two bounded tasks, one inherited context call and one interrupted request"
  );
  assert.doesNotMatch(
    JSON.stringify(progress),
    /private-parent-fixture/,
    "Inherited runtime credentials must not reach shared progress"
  );
  console.log(
    "PASS: pinned Codex 0.149.1 inherits authenticated task tools and parent read-only permissions, preserves gpt-5.1-codex-mini/low, runs parallel research + native review, and confirms a real turn/interrupt."
  );
  console.log(`Fixture evidence retained at ${fixture}`);
} finally {
  await controller?.close();
  await closeControl?.();
  app.stdin.end();
  const timer = setTimeout(() => {
    try {
      process.kill(-app.pid, "SIGKILL");
    } catch {
      app.kill("SIGKILL");
    }
  }, 4000);
  const code = await exited;
  clearTimeout(timer);
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Fixture ended"));
  }
  lines.close();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  if (code !== 0) console.error(`Native exit ${code}: ${stderr}`);
}
