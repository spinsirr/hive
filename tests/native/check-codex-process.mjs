// Opt-in integration: the pinned real Codex process against a loopback-only
// Responses fixture. No account credentials or paid model are used.
// node tests/native/check-codex-process.mjs /path/to/isolated/sdk-install [openai/gpt-5.1-codex-mini]
// Omitting the model retains the original Luna model-switch regression.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCodexAppServerTurn } from "../../src/server/agents/codex/bridge/app-server.mjs";

const installation = process.argv[2];
const resumeModel = process.argv[3] ?? "openai/gpt-5.6-luna";
assert.ok(
  installation,
  "Pass an isolated installation of @openai/codex-sdk@0.149.1"
);
const sdkEntry = await realpath(
  path.join(installation, "node_modules/@openai/codex-sdk/package.json")
);
const require = createRequire(sdkEntry);
const cliPackage = require.resolve("@openai/codex/package.json");
assert.equal(require(cliPackage).version, "0.149.1");
const cli = path.join(path.dirname(cliPackage), require(cliPackage).bin.codex);
const fixtureDirectory = await mkdtemp(
  path.join(os.tmpdir(), "hive-native-process-")
);
const codexHome = path.join(fixtureDirectory, "codex-home");
await mkdir(codexHome);
let requestNumber = 0;
let requestFailure;
const requests = [];
const requestTimes = [];
const diagnostics = [];
let launches = 0;
const firstDelta = Promise.withResolvers();
const secondDelta = Promise.withResolvers();
let responseFinished = false;
const provider = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/responses");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push(body);
    requestTimes.push(Date.now());
    requestNumber++;
    if (requestNumber === 3 || (requestNumber >= 5 && requestNumber <= 7)) {
      response.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "1",
        "x-request-id": "hive-controlled-429",
      });
      response.end(
        JSON.stringify({
          error: {
            type: "rate_limit_exceeded",
            message: "Controlled temporary rate limit",
          },
        })
      );
      return;
    }
    if (requestNumber >= 8) {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "Controlled server failure" } })
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const send = (data) =>
      response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({
      type: "response.created",
      response: { id: `fixture-${requestNumber}` },
    });
    if (requestNumber === 2) {
      assert.match(
        JSON.stringify(body.input),
        /HIVE-NATIVE-MEMORY-27/,
        "The resumed native history must contain the first turn"
      );
      if (resumeModel === "openai/gpt-5.6-luna") {
        // Luna's pinned native tools are embedded in the prompt, in code mode.
        assert.match(
          JSON.stringify(body.input),
          /declare const tools: \{ exec_command/
        );
        send({
          type: "response.output_item.done",
          item: {
            type: "custom_tool_call",
            call_id: "native-command",
            name: "exec",
            namespace: "functions",
            input:
              'text(await tools.exec_command({ cmd: "printf native-check", yield_time_ms: 1000 }));',
          },
        });
      } else {
        assert.equal(resumeModel, "openai/gpt-5.1-codex-mini");
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
          `No shell tool in ${tools.map((tool) => tool.name).join(", ")}`
        );
        const args =
          shell.name === "exec_command"
            ? { cmd: "printf native-check", yield_time_ms: 1000 }
            : shell.name === "shell"
              ? { command: ["/bin/sh", "-c", "printf native-check"] }
              : { command: "printf native-check" };
        send({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "native-command",
            name: shell.name,
            ...(shell.namespace ? { namespace: shell.namespace } : {}),
            arguments: JSON.stringify(args),
          },
        });
      }
    } else {
      if (requestNumber === 4) {
        assert.deepEqual(
          body,
          requests[2],
          "Only the rejected model request may be retried, not a new turn"
        );
        assert.match(
          JSON.stringify(body.input),
          /native-check/,
          "Real command output must reach the next model call"
        );
      }
      const item = {
        type: "message",
        role: "assistant",
        id: `reply-${requestNumber}`,
        content: [],
      };
      send({ type: "response.output_item.added", item });
      send({ type: "response.output_text.delta", delta: "第一段" });
      if (requestNumber === 1) await firstDelta.promise;
      send({ type: "response.output_text.delta", delta: "，继续" });
      if (requestNumber === 1) await secondDelta.promise;
      send({
        type: "response.output_item.done",
        item: {
          ...item,
          content: [{ type: "output_text", text: "第一段，继续。" }],
        },
      });
    }
    responseFinished = true;
    send({
      type: "response.completed",
      response: {
        id: `fixture-${requestNumber}`,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      },
    });
    response.end();
  } catch (error) {
    requestFailure = error;
    response.destroy(error);
  }
});
await new Promise((resolve, reject) => {
  provider.once("error", reject);
  provider.listen(0, "127.0.0.1", resolve);
});
// Process-local routing to a controlled loopback fixture, never a real provider.
process.env.AI_GATEWAY_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
delete process.env.OPENAI_BASE_URL;
delete process.env.AI_GATEWAY_API_KEY;
process.env.CODEX_API_KEY = "controlled-loopback-fixture";
let threadId;
const allEvents = [];
try {
  for (let turnNumber = 0; turnNumber < 4; turnNumber++) {
    const events = [];
    const started = Date.now();
    let caught;
    try {
      await runCodexAppServerTurn({
        start: {
          model: turnNumber === 0 ? "gpt-5-mini" : resumeModel,
          reasoningEffort: "low",
          prompt:
            turnNumber === 0
              ? "Remember HIVE-NATIVE-MEMORY-27."
              : "Run the check.",
          webSearch: false,
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
          abortSignal: AbortSignal.timeout(25_000),
          bridgeLog(event) {
            diagnostics.push(event);
          },
          emit(event) {
            events.push(event);
            if (event.type === "text-delta") {
              if (
                turnNumber === 0 &&
                event.delta !== "." &&
                event.delta !== "。"
              )
                assert.equal(
                  responseFinished,
                  false,
                  "Codex must emit text before the provider finishes"
                );
              if (event.delta === "第一段") firstDelta.resolve();
              if (event.delta === "，继续") secondDelta.resolve();
            }
          },
        },
      });
    } catch (error) {
      caught = error;
    }
    if (requestFailure) throw requestFailure;
    allEvents.push(...events);
    if (turnNumber < 2) {
      assert.equal(caught, undefined);
      assert.equal(
        events
          .filter((event) => event.type === "text-delta")
          .map((event) => event.delta)
          .join(""),
        "第一段，继续。"
      );
      console.log(
        `PASS: real Codex ${turnNumber ? "fresh-process resume and command" : "native public deltas"} (${Date.now() - started} ms)`
      );
    } else {
      assert.match(caught?.message ?? "", turnNumber === 2 ? /429/ : /502/);
      assert.equal(
        events.some((event) => event.type === "finish"),
        false
      );
      assert.equal(
        events.some((event) => event.type === "tool-call"),
        false
      );
      console.log(
        `PASS: real Codex stops on ${turnNumber === 2 ? "exhausted 429 retries" : "502 without native layered retries"}`
      );
    }
  }
  assert.equal(requestFailure, undefined);
  assert.equal(requestNumber, 8);
  assert.equal(requests[0].model, "openai/gpt-5-mini");
  for (const request of requests.slice(1)) {
    assert.equal(
      request.model,
      resumeModel,
      "A resumed native thread must use the newly selected coding model"
    );
    assert.equal(
      request.reasoning.effort,
      "low",
      "Changing models must preserve the explicit reasoning level"
    );
  }
  assert.equal(
    launches,
    4,
    "One native process per requested turn, with no restart on failure"
  );
  assert.ok(
    requestTimes[3] - requestTimes[2] >= 900,
    "Do not retry before Retry-After"
  );
  assert.deepEqual(requests[4], requests[5]);
  assert.deepEqual(requests[5], requests[6]);
  assert.equal(
    allEvents.filter((event) => event.type === "tool-result").length,
    1,
    "The completed command must not execute twice after rate limiting"
  );
  const command = allEvents.find(
    (event) => event.type === "tool-result" && event.toolName === "bash"
  );
  assert.equal(command.result.exitCode, 0);
  assert.match(command.result.output, /native-check/);
  assert.equal(
    diagnostics.filter((event) => event.attrs.outcome === "recovered").length,
    1
  );
  assert.equal(
    diagnostics.filter((event) => event.attrs.stopReason === "attempt-limit")
      .length,
    1
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /HIVE-NATIVE-MEMORY-27|controlled-loopback-fixture/
  );
  console.log(
    "PASS: native history resumes across the model change; a rejected request recovers from 429 without repeating the command or restarting the turn"
  );
} finally {
  firstDelta.resolve();
  secondDelta.resolve();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  console.log(`Isolated test data: ${fixtureDirectory}`);
}
