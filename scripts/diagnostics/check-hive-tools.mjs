// Opt-in: the pinned real Codex process + real MCP transport, with loopback
// model and Mem0 fixtures. Never reads account credentials or calls a provider.
// node scripts/diagnostics/check-hive-tools.mjs /path/to/isolated/sdk-install
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCodexAppServerTurn } from "../../src/lib/codex-bridge/app-server.mjs";
import { handleHiveMcp } from "../../src/lib/hive-mcp.ts";
import { createHiveMemory } from "../../src/lib/hive-memory.ts";
import { hiveThreadReply } from "../../src/lib/hive-tool-context.ts";
import {
  createInitialTaskSessionState,
  memberDirectory,
} from "../../src/lib/task-session.ts";

const installation = process.argv[2];
assert.ok(
  installation,
  "Pass an isolated installation of @openai/codex-sdk@0.149.1"
);
const require = createRequire(
  await realpath(
    path.join(installation, "node_modules/@openai/codex-sdk/package.json")
  )
);
const cliPackage = require.resolve("@openai/codex/package.json");
assert.equal(require(cliPackage).version, "0.149.1");
const cli = path.join(path.dirname(cliPackage), require(cliPackage).bin.codex);
const fixtureDirectory = await mkdtemp(
  path.join(os.tmpdir(), "hive-native-tools-")
);
const codexHome = path.join(fixtureDirectory, "codex-home");
await mkdir(codexHome);
let scope = {
  sessionId: "native-tools-first",
  memberId: "spencer",
  runId: "native-run-one",
};
const initial = createInitialTaskSessionState(1, scope.sessionId);
let context = {
  ...initial,
  stage: "running",
  repository: {
    id: 20,
    installationId: 10,
    url: "https://github.com/example/repo",
    name: "example/repo",
    branch: "main",
    provider: "github-app",
    connectedAt: 1,
    connectedBy: "spencer",
    visibility: "private",
    authorizedByGitHub: { id: 1, login: "spencer" },
  },
  messages: [
    {
      id: "human-one",
      memberId: "spencer",
      name: "Spencer Zhao",
      initials: "SZ",
      body: "Use pnpm for this repository.",
      time: "now",
      role: "human",
    },
  ],
  workspace: { status: "running", liveReply: { id: scope.runId } },
  members: [memberDirectory.spencer, memberDirectory.maya],
};
let saved;
const memoryRequests = [];
const memory = createHiveMemory(
  "controlled-mem0-fixture",
  async (url, options) => {
    const body = JSON.parse(options.body);
    memoryRequests.push(body);
    assert.equal(new URL(url).origin, "https://api.mem0.ai");
    if (url.endsWith("/add/")) {
      saved = {
        id: "memory-one",
        memory: body.messages[0].content,
        metadata: body.metadata,
      };
      return Response.json({ results: [{ id: saved.id }] });
    }
    assert.equal(url, "https://api.mem0.ai/v3/memories/search/");
    return Response.json({ results: saved ? [saved] : [] });
  }
);
const replies = [];
const mcpCalls = [];
const modelRequests = [];
const allEvents = [];
const diagnostics = [];
let turnNumber = 0;
let step = 0;
let serverFailure;
let launches = 0;
const server = createServer(async (incoming, response) => {
  try {
    if (incoming.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (incoming.url === "/agent-tools") {
      assert.equal(
        incoming.headers.authorization,
        "Bearer controlled-task-capability"
      );
      const rpc = JSON.parse(body);
      if (rpc.method === "tools/call") mcpCalls.push(rpc.params.name);
      const output = await handleHiveMcp(
        new Request(`http://127.0.0.1:${server.address().port}/agent-tools`, {
          method: "POST",
          headers: incoming.headers,
          body,
        }),
        scope,
        {
          read: async () => context,
          reply: async (_scope, messageId, text, requestId) => {
            const reply = hiveThreadReply(text, requestId);
            replies.push(reply);
            context.messages[0].annotations = [reply];
            return { messageId, replyId: requestId };
          },
        },
        memory
      );
      response.writeHead(output.status, Object.fromEntries(output.headers));
      response.end(Buffer.from(await output.arrayBuffer()));
      return;
    }
    assert.equal(incoming.url, "/v1/responses");
    const input = JSON.parse(body);
    modelRequests.push(input);
    const serialized = JSON.stringify(input.input);
    assert.doesNotMatch(
      serialized,
      /controlled-mem0-fixture|controlled-task-capability/
    );
    if (turnNumber === 1) {
      assert.match(
        serialized,
        /HIVE-NATIVE-TOOLS-HISTORY-27/,
        "Adding MCP and a skill must retain native history"
      );
      assert.ok(
        /Memories are shared across tasks/.test(serialized),
        "The explicit native skill must reach the model"
      );
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const send = (event) =>
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
      );
    send({
      type: "response.created",
      response: { id: `fixture-${turnNumber}-${step}` },
    });
    const calls =
      turnNumber === 1
        ? [
            ["get_context", {}],
            ["remember_memory", { messageId: "human-one" }],
            [
              "reply_to_thread",
              {
                key: "ci-policy",
                messageId: "human-one",
                body: "Should pnpm also be used in CI?",
              },
            ],
          ]
        : turnNumber === 2
          ? [["search_memory", { query: "package manager convention" }]]
          : [];
    const call = calls[step];
    if (call) {
      const tools = input.tools.flatMap((tool) =>
        tool.type === "namespace"
          ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name }))
          : [tool]
      );
      const tool = tools.find(
        (item) => item.name === call[0] || item.name.endsWith(`__${call[0]}`)
      );
      assert.ok(
        tool,
        `No ${call[0]} tool among ${tools.map((item) => item.name).join(", ")}`
      );
      send({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: `call-${turnNumber}-${step}`,
          name: tool.name,
          ...(tool.namespace ? { namespace: tool.namespace } : {}),
          arguments: JSON.stringify(call[1]),
        },
      });
    } else {
      if (turnNumber === 1) {
        assert.match(serialized, /Spencer Zhao/);
        assert.match(serialized, /saved/);
      }
      if (turnNumber === 2) {
        assert.match(serialized, /Use pnpm for this repository/);
        assert.match(
          serialized,
          /native-tools-first/,
          "Recall must identify the source task"
        );
      }
      const text = `Completed fixture turn ${turnNumber}.`;
      const item = {
        id: `reply-${turnNumber}`,
        type: "message",
        role: "assistant",
        content: [],
      };
      send({ type: "response.output_item.added", item });
      send({ type: "response.output_text.delta", delta: text });
      send({
        type: "response.output_item.done",
        item: { ...item, content: [{ type: "output_text", text }] },
      });
    }
    step++;
    send({
      type: "response.completed",
      response: {
        id: `fixture-${turnNumber}-${step}`,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    response.end();
  } catch (error) {
    serverFailure = error;
    response.destroy(error);
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
process.env.AI_GATEWAY_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
delete process.env.OPENAI_BASE_URL;
delete process.env.AI_GATEWAY_API_KEY;
process.env.CODEX_API_KEY = "controlled-loopback-fixture";
let threadId;
let firstThreadId;
try {
  for (turnNumber = 0; turnNumber < 3; turnNumber++) {
    step = 0;
    if (turnNumber === 2) {
      firstThreadId = threadId;
      threadId = undefined;
      scope = {
        ...scope,
        sessionId: "native-tools-second",
        runId: "native-run-two",
      };
      context = {
        ...context,
        sessionId: scope.sessionId,
        messages: [],
        workspace: { ...context.workspace, liveReply: { id: scope.runId } },
      };
    }
    const events = [];
    const started = Date.now();
    let caught;
    try {
      await runCodexAppServerTurn({
        start: {
          model: "openai/gpt-5.1-codex-mini",
          reasoningEffort: "low",
          webSearch: false,
          prompt:
            turnNumber === 0
              ? "Remember HIVE-NATIVE-TOOLS-HISTORY-27."
              : turnNumber === 1
                ? "Remember human-one as this repository's package-manager convention and ask in its thread whether it also applies to CI."
                : "Recall the repository's package-manager convention.",
          ...(turnNumber
            ? {
                mcpServers: {
                  hive: {
                    url: `http://127.0.0.1:${server.address().port}/agent-tools`,
                    http_headers: {
                      Authorization: "Bearer controlled-task-capability",
                    },
                    startup_timeout_sec: 10,
                    tool_timeout_sec: 15,
                  },
                },
              }
            : {}),
        },
        workdir: fixtureDirectory,
        threadId,
        onThread(id) {
          if (threadId) assert.equal(id, threadId);
          threadId = id;
        },
        launch(workdir) {
          launches++;
          return spawn(process.execPath, [cli, "app-server"], {
            cwd: workdir,
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
            env: {
              PATH: process.env.PATH,
              CODEX_HOME: codexHome,
              CODEX_API_KEY: "controlled-loopback-fixture",
            },
          });
        },
        turn: {
          abortSignal: AbortSignal.timeout(30_000),
          bridgeLog(event) {
            diagnostics.push(event);
          },
          emit(event) {
            events.push(event);
          },
        },
      });
    } catch (error) {
      caught = error;
    }
    if (serverFailure) throw serverFailure;
    if (caught) throw caught;
    assert.equal(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
      `Completed fixture turn ${turnNumber}.`,
      "Tool results are not public assistant text"
    );
    allEvents.push(...events);
    console.log(
      `PASS: real Codex ${["history seed", "same-thread skill + context, remember and reply tools", "new-task repository memory recall"][turnNumber]} (${Date.now() - started} ms)`
    );
  }
  assert.notEqual(threadId, firstThreadId);
  assert.equal(launches, 3);
  assert.deepEqual(mcpCalls, [
    "get_context",
    "remember_memory",
    "reply_to_thread",
    "search_memory",
  ]);
  assert.equal(memoryRequests.length, 2);
  assert.equal(memoryRequests[0].infer, false);
  assert.equal(memoryRequests[0].messages.length, 1);
  assert.equal(
    memoryRequests[1].filters.AND[0].user_id,
    memoryRequests[0].user_id
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0].role, "agent");
  assert.equal(context.steeringQueue.length, 0);
  assert.equal(
    allEvents.filter((event) => event.type === "tool-result").length,
    4
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /controlled-mem0-fixture|controlled-task-capability/
  );
  assert.equal(
    modelRequests.length,
    7,
    "Only the controlled model fixture was called"
  );
  console.log(
    "PASS: no native history restart, cross-task scoped recall, fixed Hive authorship, no automatic steer and no tool-output leak."
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log(`Isolated test data: ${fixtureDirectory}`);
}
