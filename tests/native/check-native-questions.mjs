// Purpose: prove the pinned native Codex actually exposes Hive questions to
// the model, then saves one inline card on cold and resumed turns. The real
// process, MCP transport and question reducer run; only inference/persistence
// use isolated fixtures. Production UX is verified separately.
// node tests/native/check-native-questions.mjs /isolated/sdk-install
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCodexAppServerTurn } from "../../src/server/agents/codex/bridge/app-server.mjs";
import { handleHiveMcp } from "../../src/server/agents/tools/hive-mcp.ts";
import { createHiveMemory } from "../../src/server/agents/memory/hive-memory.ts";
import { requestPeerInput } from "../../src/lib/conversation/peer-collaboration.ts";
import {
  createInitialTaskSessionState,
  memberDirectory,
} from "../../src/lib/session/task-session.ts";
import { withHiveCodexTools } from "../../src/server/agents/tools/hive-codex-tools.ts";

const require = createRequire(
  await realpath(
    path.join(process.argv[2], "node_modules/@openai/codex-sdk/package.json")
  )
);
const cliPackage = require.resolve("@openai/codex/package.json");
assert.equal(require(cliPackage).version, "0.149.1");
const cli = path.join(path.dirname(cliPackage), require(cliPackage).bin.codex);
const directory = await mkdtemp(
  path.join(os.tmpdir(), "hive-native-questions-")
);
const codexHome = path.join(directory, "codex-home");
await mkdir(codexHome);
const members = [memberDirectory.spencer];
let scope = {
  sessionId: "native-question-fixture",
  memberId: "spencer",
  runId: "run-0",
};
let state = {
  ...createInitialTaskSessionState(1, scope.sessionId),
  workspace: { startedAt: 1, liveReply: { id: scope.runId } },
};
let turnNumber = 0,
  step = 0,
  failure,
  threadId;
const calls = [];
const mcpMethods = [];
const server = createServer(async (incoming, response) => {
  try {
    assert.equal(incoming.method, "POST");
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const rpc = JSON.parse(body);
    if (incoming.url === "/agent-tools") {
      mcpMethods.push(rpc.method);
      assert.equal(
        incoming.headers.authorization,
        `Bearer question-fixture-${turnNumber}`
      );
      if (rpc.method === "tools/call") calls.push(rpc.params.name);
      const result = await handleHiveMcp(
        new Request(`http://127.0.0.1:${server.address().port}/agent-tools`, {
          method: "POST",
          headers: incoming.headers,
          body,
        }),
        scope,
        {
          read: async () => ({ ...state, members }),
          reply: async () => {
            throw new Error("A question must not create a Thread");
          },
          request: async (receivedScope, input) => {
            const result = requestPeerInput(
              state,
              receivedScope,
              input,
              members,
              2 + turnNumber
            );
            const created = result.session !== state;
            state = result.session;
            return {
              created,
              messageId: result.messageId,
              status: "awaiting_answer",
            };
          },
        },
        createHiveMemory(undefined)
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    assert.equal(incoming.url, "/v1/responses");
    const definitions = JSON.stringify(rpc.input);
    assert.ok(
      definitions.includes("mcp__hive__request_input"),
      "The adapter must identify the shared question tool even when Codex defers its schema"
    );
    const tools = (rpc.tools ?? []).flatMap((tool) =>
      tool.type === "namespace"
        ? tool.tools.map((nested) => ({ ...nested, namespace: tool.name }))
        : [tool]
    );
    const questionTool = tools.find(
      (tool) =>
        tool.name === "request_input" || tool.name?.endsWith("__request_input")
    );
    const codeModeQuestion = definitions.includes("ALL_TOOLS");
    assert.ok(
      questionTool || codeModeQuestion,
      "Native Codex must expose its tool discovery surface"
    );
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event) =>
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
      );
    send({
      type: "response.created",
      response: { id: `question-${turnNumber}-${step}` },
    });
    if (step++ === 0 && codeModeQuestion) {
      send({
        type: "response.output_item.done",
        item: {
          type: "custom_tool_call",
          call_id: `discover-${turnNumber}`,
          name: "exec",
          namespace: "functions",
          input:
            'text(ALL_TOOLS.filter(tool => tool.name.includes("hive")).map(tool => ({name: tool.name})));',
        },
      });
    } else if (step === (codeModeQuestion ? 2 : 1)) {
      if (codeModeQuestion) {
        assert.ok(
          JSON.stringify(rpc.input.at(-1)).includes("mcp__hive__request_input"),
          "Question must be discoverable in the real native tool registry, not just mentioned by the prompt"
        );
      }
      const args = {
        key: `label-${turnNumber}`,
        prompt: "Lantern or Beacon?",
        options: ["Lantern", "Beacon"],
      };
      send({
        type: "response.output_item.done",
        item: questionTool
          ? {
              type: "function_call",
              call_id: `question-${turnNumber}`,
              name: questionTool.name,
              ...(questionTool.namespace
                ? { namespace: questionTool.namespace }
                : {}),
              arguments: JSON.stringify(args),
            }
          : {
              type: "custom_tool_call",
              call_id: `question-${turnNumber}`,
              name: "exec",
              namespace: "functions",
              input: `text(await tools.mcp__hive__request_input(${JSON.stringify(args)}));`,
            },
      });
    } else {
      assert.match(
        definitions,
        /awaiting_answer/,
        "The real question receipt must reach the native continuation"
      );
      send({
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          id: `done-${turnNumber}`,
          content: [{ type: "output_text", text: "" }],
        },
      });
    }
    send({
      type: "response.completed",
      response: {
        id: `question-${turnNumber}-${step}`,
        usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
      },
    });
    response.end();
  } catch (error) {
    failure ??= error;
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: error.message } }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
delete process.env.AI_GATEWAY_BASE_URL;
delete process.env.AI_GATEWAY_API_KEY;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.CODEX_API_KEY = "loopback-question-fixture";
try {
  for (turnNumber = 0; turnNumber < 2; turnNumber++) {
    step = 0;
    scope = { ...scope, runId: `run-${turnNumber}` };
    state = {
      ...state,
      workspace: { ...state.workspace, liveReply: { id: scope.runId } },
    };
    let caught;
    try {
      await runCodexAppServerTurn({
        start: {
          model: "gpt-5.6-luna",
          reasoningEffort: "low",
          webSearch: false,
          prompt: withHiveCodexTools(
            "Ask me one inline question, Lantern or Beacon."
          ),
          mcpServers: {
            hive: {
              url: `http://127.0.0.1:${server.address().port}/agent-tools`,
              http_headers: {
                Authorization: `Bearer question-fixture-${turnNumber}`,
              },
              startup_timeout_sec: 10,
            },
          },
        },
        workdir: directory,
        threadId,
        onThread(id) {
          if (threadId) assert.equal(id, threadId);
          threadId = id;
        },
        launch(workdir) {
          return spawn(process.execPath, [cli, "app-server"], {
            cwd: workdir,
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
            env: {
              PATH: process.env.PATH,
              CODEX_HOME: codexHome,
              CODEX_API_KEY: "loopback-question-fixture",
            },
          });
        },
        turn: { abortSignal: AbortSignal.timeout(15_000), emit() {} },
      });
    } catch (error) {
      caught = error;
    }
    if (failure) throw failure;
    if (caught) throw caught;
    const question = state.messages.at(-1);
    assert.equal(question.interaction.kind, "question");
    assert.deepEqual(question.interaction.options, ["Lantern", "Beacon"]);
    assert.equal(question.threadId, undefined);
    assert.equal(question.annotations, undefined);
    assert.equal(
      state.messages.filter((message) => message.interaction).length,
      turnNumber + 1
    );
    console.log(
      `PASS: ${turnNumber ? "resumed" : "cold"} native Codex exposes and creates a shared inline question`
    );
  }
  assert.deepEqual(calls, ["request_input", "request_input"]);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log(`Isolated test data: ${directory}`);
}
