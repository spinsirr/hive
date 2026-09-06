// Isolate the installed Codex event adapter -> real HarnessAgent -> Hive writer.
// No model, credentials, database, browser, or sandbox is used. This does not
// establish which events the real Codex SDK emits; those are the controlled seam.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import ts from "typescript";
import { consumeAgentText, createReplyWriter } from "../../src/lib/agent-stream.ts";

// Node deliberately does not strip TypeScript inside node_modules. Compile the
// installed adapter source in memory rather than copying or modifying it.
async function loadBridgeModule(filename) {
  const source = readFileSync(new URL(
    `../../node_modules/@ai-sdk/harness-codex/src/bridge/${filename}`, import.meta.url,
  ), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { createEmitStreamEvent } = await loadBridgeModule("create-emit-stream-event.ts");
const { createCodexStepTracker } = await loadBridgeModule("codex-step-tracker.ts");

const firstCheckpoint = Promise.withResolvers();
const secondCheckpoint = Promise.withResolvers();
// The counterexample intentionally fails the same incremental-delivery assertion.
const completedOnly = process.argv.includes("--completed-only");
const saved = [];
let finished = false;
const usage = {
  inputTokens: { total: 0, noCache: 0 },
  outputTokens: { total: 0, text: 0 },
};
const agent = new HarnessAgent({
  model: "controlled-events-no-model",
  harness: {
    specificationVersion: "harness-v1",
    harnessId: "stream-diagnostic",
    builtinTools: {},
    doStart: async ({ sessionId }) => ({
      sessionId,
      isResume: false,
      doPromptTurn: async ({ emit }) => {
        const send = createEmitStreamEvent({
          send: emit,
          stepTracker: createCodexStepTracker({ send: emit }),
          setTurnUsage() {},
          setThreadId() {},
          emitWarning() {},
          emitError(error) { throw new Error(JSON.stringify(error)); },
        });
        const done = Promise.resolve().then(async () => {
          emit({ type: "stream-start" });
          if (!completedOnly) {
            send({ type: "item.updated", item: { id: "reply", type: "agent_message", text: "第一段" } });
            await firstCheckpoint.promise;
            send({ type: "item.updated", item: { id: "reply", type: "agent_message", text: "第一段，继续" } });
            await secondCheckpoint.promise;
          }
          send({ type: "item.completed", item: { id: "reply", type: "agent_message", text: "第一段，继续。" } });
          finished = true;
          send({ type: "turn.completed" });
          emit({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, totalUsage: usage });
        });
        return { done, submitToolResult: async () => {} };
      },
      doStop: async () => ({
        type: "resume-session", specificationVersion: "harness-v1",
        harnessId: "stream-diagnostic", data: {},
      }),
      doDestroy: async () => {},
    }),
  },
});

const writer = createReplyWriter(async (body, sequence) => {
  saved.push({ body, sequence, finished });
  if (sequence === 1) firstCheckpoint.resolve();
  if (sequence === 2) secondCheckpoint.resolve();
}, 1);
const session = await agent.createSession({ sandboxSession: {
  defaultWorkingDirectory: "/controlled-stream-diagnostic",
  run: async ({ command }) => {
    assert.match(command, /^mkdir /, "the diagnostic must not execute repository commands");
    return { exitCode: 0, stdout: "", stderr: "" };
  },
} });
let timer;
try {
  await Promise.race([
    (async () => {
      const result = await agent.stream({ session, prompt: "Controlled stream diagnostic" });
      await consumeAgentText(result.fullStream, writer.push);
      await writer.close();
    })(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Streaming was buffered until completion")), 2000);
    }),
  ]);
  assert.deepEqual(saved, [
    { body: "第一段", sequence: 1, finished: false },
    { body: "第一段，继续", sequence: 2, finished: false },
    { body: "第一段，继续。", sequence: 3, finished: true },
  ], "Public text must grow before the message completes; completed-only events cannot satisfy this");
  console.log("PASS: the installed Codex adapter, HarnessAgent, and Hive writer deliver updates before completion");
} finally {
  clearTimeout(timer);
  firstCheckpoint.resolve();
  secondCheckpoint.resolve();
  await session.stop();
}
