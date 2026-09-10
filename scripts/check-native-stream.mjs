// Same public seam as check-harness-stream: real HarnessAgent -> Hive writer.
// Only the external Codex stdio process is controlled. No model or credentials.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { harnessV1BridgeOutboundMessageSchema } from "@ai-sdk/harness";
import { runCodexAppServerTurn } from "../src/lib/codex-bridge/app-server.mjs";
import { consumeAgentText, createReplyWriter } from "../src/lib/agent-stream.ts";

for (const failure of [false, true]) {
  const checkpoints = [];
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const commands = [];
  let nativeFinished = false;
  let savedThread;
  let launched = 0;
  let serverFailure;
  function launch() {
    launched++;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const response = (message) => child.stdout.write(JSON.stringify(message) + "\n");
    const event = (method, params) => response({ method, params: { threadId: "native-thread", turnId: "native-turn", ...params } });
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(chunk.toString());
        void (async () => {
          if (request.method === "initialize") response({ id: request.id, result: {} });
          if (request.method === "thread/start" || request.method === "thread/resume") {
            assert.equal(request.params.cwd, "/controlled-native-stream");
            assert.equal(request.params.approvalPolicy, "never");
            assert.equal(request.params.sandbox, "danger-full-access");
            assert.equal(request.params.config.web_search, "disabled");
            assert.equal(request.params.config.model_reasoning_effort, "low", "Store turn reasoning in thread config so delegated tasks inherit it");
            if (launched === 2) {
              assert.equal(request.method, "thread/resume", "A fresh process must resume the saved native thread");
              assert.equal(request.params.threadId, "native-thread");
            }
            response({ id: request.id, result: { thread: { id: "native-thread" } } });
          }
          if (request.method === "turn/start") {
            assert.equal(request.params.threadId, "native-thread");
            assert.deepEqual(request.params.input[0], { type: "text", text: "Controlled native stream", text_elements: [] });
            response({ id: request.id, result: { turn: { id: "native-turn" } } });
            event("item/reasoning/textDelta", { itemId: "private", delta: "DO NOT DISPLAY" });
            response({ method: "item/agentMessage/delta", params: { threadId: "other-thread", itemId: "other", delta: "WRONG THREAD" } });
            event("item/agentMessage/delta", { itemId: "reply", delta: "第一段" });
            await first.promise;
            event("item/agentMessage/delta", { itemId: "reply", delta: "，继续" });
            await second.promise;
            event("item/completed", { item: { type: "agentMessage", id: "reply", text: "第一段，继续。", phase: "commentary" } });
            event("item/started", { item: { type: "commandExecution", id: "check", command: "pnpm test", status: "inProgress" } });
            event("item/commandExecution/outputDelta", { itemId: "check", delta: "checking..." });
            if (!failure) event("item/completed", { item: { type: "commandExecution", id: "check", command: "pnpm test", aggregatedOutput: "1 passed", exitCode: 0, status: "completed" } });
            // A retry warning must not terminate a later successful turn.
            event("error", { willRetry: true, error: { message: "transient stream error" } });
            nativeFinished = true;
            event("turn/completed", { turn: { id: "native-turn", status: failure ? "failed" : "completed", error: failure ? { message: "429 fixture" } : null } });
          }
        })().catch((error) => { serverFailure = error; child.stdout.destroy(error); });
        callback();
      },
      final(callback) {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0, null);
        callback();
      },
    });
    return child;
  }
  const agent = new HarnessAgent({
    model: "controlled-no-model",
    harness: {
      specificationVersion: "harness-v1", harnessId: "native-stream-check", builtinTools: {},
      async doStart({ sessionId }) { return {
        sessionId, isResume: Boolean(savedThread),
        async doPromptTurn({ emit }) {
          const done = runCodexAppServerTurn({
            start: { prompt: "Controlled native stream", webSearch: false, reasoningEffort: "low" },
            workdir: "/controlled-native-stream", threadId: savedThread,
            onThread(id) { savedThread = id; }, launch,
            turn: { abortSignal: new AbortController().signal, emit(event) {
              harnessV1BridgeOutboundMessageSchema.parse(event);
              if (event.type !== "bridge-thread") emit(event);
            } },
          }).catch((error) => emit({ type: "error", error }));
          return { done, submitToolResult: async () => {} };
        },
        async doStop() { return { type: "resume-session", specificationVersion: "harness-v1", harnessId: "native-stream-check", data: { threadId: savedThread } }; },
        async doDestroy() {},
      }; },
    },
  });
  const sandboxSession = {
    defaultWorkingDirectory: "/controlled-native-stream",
    async run({ command }) {
      assert.match(command, /^mkdir /, "No repository commands may run in this check");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const writer = createReplyWriter(async (body, sequence) => {
      checkpoints.push({ body, sequence, nativeFinished });
      if (sequence === 1) first.resolve();
      if (sequence === 2) second.resolve();
    }, 1);
    const session = await agent.createSession({ sandboxSession });
    let caught;
    try {
      const result = await agent.stream({ session, prompt: "Controlled native stream" });
      await consumeAgentText(result.fullStream, writer.push, (part) => {
        if (part.type === "tool-result") commands.push(part.output);
      });
    } catch (error) { caught = error; }
    finally { await writer.close(); await session.stop(); }
    assert.equal(serverFailure, undefined);
    assert.equal(Boolean(caught), failure);
    if (failure) assert.match(caught.message, /429 fixture/);
  }
  assert.deepEqual(checkpoints.slice(0, 2), [
    { body: "第一段", sequence: 1, nativeFinished: false },
    { body: "第一段，继续", sequence: 2, nativeFinished: false },
  ], "Native deltas must be visible before completion, without reasoning or other-thread text");
  assert.equal(checkpoints.at(-1).body, "第一段，继续。", "Completion must not duplicate the streamed prefix");
  assert.deepEqual(commands, Array(2).fill(failure
    ? { exitCode: null, output: "checking...", status: "interrupted" }
    : { exitCode: 0, output: "1 passed", status: "completed" }));
  assert.equal(savedThread, "native-thread");
  console.log(`PASS: native deltas, fresh-process resume, and ${failure ? "partial commands on failure" : "actual command results"}`);
}
