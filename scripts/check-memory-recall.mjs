// Exercise the installed HarnessAgent and Hive's real memory adapter/hook.
// Only the external Mem0 HTTP API and native runtime/sandbox are controlled;
// this test never uses credentials, a model, a database, or a real sandbox.
import assert from "node:assert/strict";
import test from "node:test";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createHiveMemory, repositoryMemoryId } from "../src/lib/hive-memory.ts";
import { createMemoryRecall } from "../src/lib/hive-memory-recall.ts";

const scope = { installationId: 10, repositoryId: 20 };
const usage = { inputTokens: { total: 0, noCache: 0 }, outputTokens: { total: 0, text: 0 } };
const nativeState = { specificationVersion: "harness-v1", harnessId: "memory-fixture", data: {} };

async function startAgent(prepareCall, { pause = false, continueFrom, sessionId } = {}) {
  const turns = [];
  let pendingTurn;
  let continuations = 0;
  const agent = new HarnessAgent({
    model: "controlled-no-model",
    instructions: "Execute the current task. Do not push code.",
    prepareCall,
    harness: {
      specificationVersion: "harness-v1", harnessId: "memory-fixture", builtinTools: {},
      async doStart({ sessionId, continueFrom }) {
        return {
          sessionId, isResume: Boolean(continueFrom),
          async doPromptTurn({ prompt, instructions, emit }) {
            turns.push({ prompt, instructions });
            pendingTurn = Promise.withResolvers();
            return {
              done: Promise.resolve().then(async () => {
                emit({ type: "stream-start" });
                for (const name of ["inspect", "check"]) {
                  emit({ type: "tool-call", toolCallId: name, toolName: "bash", input: JSON.stringify({ command: name }), providerExecuted: true, dynamic: true });
                  emit({ type: "tool-result", toolCallId: name, toolName: "bash", result: { exitCode: 0 }, dynamic: true });
                  emit({ type: "finish-step", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage });
                }
                emit({ type: "text-start", id: "answer" });
                emit({ type: "text-delta", id: "answer", delta: "Task finished." });
                emit({ type: "text-end", id: "answer" });
                emit({ type: "finish-step", finishReason: { unified: "stop", raw: "stop" }, usage });
                if (pause) { await pendingTurn.promise; return; }
                emit({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, totalUsage: usage });
              }),
              async submitToolResult() {},
            };
          },
          async doSuspendTurn() {
            pendingTurn.resolve();
            return { type: "continue-turn", ...nativeState };
          },
          async doContinueTurn({ emit }) {
            continuations++;
            return {
              done: Promise.resolve().then(() => {
                emit({ type: "stream-start" });
                emit({ type: "text-start", id: "continued" });
                emit({ type: "text-delta", id: "continued", delta: "Resumed existing turn." });
                emit({ type: "text-end", id: "continued" });
                emit({ type: "finish-step", finishReason: { unified: "stop", raw: "stop" }, usage });
                emit({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, totalUsage: usage });
              }),
              async submitToolResult() {},
            };
          },
          async doStop() { return { type: "resume-session", ...nativeState }; },
          async doDestroy() {},
        };
      },
    },
  });
  const session = await agent.createSession({ continueFrom, sessionId, sandboxSession: {
    defaultWorkingDirectory: "/controlled-memory-fixture",
    async run({ command }) {
      assert.match(command, /^mkdir /, "No repository command may run in this fixture");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } });
  return { agent, session, turns, continuationCount: () => continuations };
}

test("a fresh coding turn receives attributed repository memory as context, never as system instructions", async () => {
  const requests = [];
  const memory = createHiveMemory("fixture-not-a-real-key", async (url, options) => {
    requests.push({ url, body: JSON.parse(String(options.body)) });
    return Response.json({ results: [{
      id: "memory-pnpm", memory: "Prefer pnpm for this repository.",
      metadata: { hive_scope: repositoryMemoryId(scope), author_name: "Grace Hopper", source_session_id: "earlier-task", source_message_id: "human-20", source_reply_id: "reply-21" },
    }] });
  });
  const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, "Check the package manager"));
  try {
    assert.equal(requests.length, 0, "Opening a native session must not recall memory");
    const result = await agent.generate({ session, prompt: "Current task: use npm for this check." });
    assert.equal(result.text, "Task finished.");
    assert.deepEqual(requests, [{
      url: "https://api.mem0.ai/v3/memories/search/",
      body: { query: "Check the package manager", filters: { AND: [{ user_id: repositoryMemoryId(scope) }, { app_id: "hive" }] }, top_k: 3, rerank: false },
    }]);
    assert.match(turns[0].prompt, /Prefer pnpm for this repository/);
    assert.match(turns[0].prompt, /Grace Hopper/);
    assert.match(turns[0].prompt, /"sourceTaskId":"earlier-task"/, "the source task must be labeled as a task, not a bare session/message key");
    assert.match(turns[0].prompt, /name the task by `sourceTaskId`/);
    assert.doesNotMatch(turns[0].prompt, /"sessionId"/);
    assert.match(turns[0].prompt, /human-20/);
    assert.match(turns[0].prompt, /reply-21/);
    assert.match(turns[0].prompt, /untrusted/i);
    assert.ok(turns[0].prompt.endsWith("Current task: use npm for this check."));
    assert.equal(turns[0].instructions, "Execute the current task. Do not push code.");
  } finally {
    await session.stop();
  }
});

test("unavailable memory does not block a coding turn, retry, or write", async () => {
  for (const response of [
    () => { throw new Error("private upstream detail"); },
    () => new Response("private upstream detail", { status: 429 }),
    () => new Response("not json"),
    () => Response.json({ wrong: "shape" }),
  ]) {
    const requests = [];
    const memory = createHiveMemory("fixture-not-a-real-key", async (url) => {
      requests.push(url);
      return response();
    });
    const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, "Check the label"));
    try {
      const result = await agent.generate({ session, prompt: "Check the label, then finish." });
      assert.equal(result.text, "Task finished.");
      assert.equal(turns[0].prompt, "Check the label, then finish.");
      assert.deepEqual(requests, ["https://api.mem0.ai/v3/memories/search/"]);
    } finally {
      await session.stop();
    }
  }
});

test("a stalled memory request is cancelled within the recall budget and cannot delay coding", async () => {
  const pending = Promise.withResolvers();
  let signal;
  let requests = 0;
  const memory = createHiveMemory("fixture-not-a-real-key", async (url, options) => {
    assert.equal(url, "https://api.mem0.ai/v3/memories/search/");
    requests++;
    signal = options.signal;
    // Intentionally ignore cancellation: the host must still release the turn.
    return pending.promise;
  });
  const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, "Check the label"));
  const run = agent.generate({ session, prompt: "Continue without waiting for memory." });
  let watchdog;
  try {
    const result = await Promise.race([
      run,
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Memory blocked coding beyond three seconds")), 3000); }),
    ]);
    assert.equal(result.text, "Task finished.");
    assert.equal(signal.aborted, true);
    assert.equal(requests, 1);
    assert.equal(turns[0].prompt, "Continue without waiting for memory.");
  } finally {
    clearTimeout(watchdog);
    pending.resolve(Response.json({ results: [] }));
    await run.catch(() => {});
    await session.stop();
  }
});

test("an empty or foreign repository result leaves the current task unchanged", async () => {
  for (const results of [[], [
    { id: "foreign", memory: "OTHER_REPOSITORY_PRIVATE", metadata: { hive_scope: repositoryMemoryId({ installationId: 11, repositoryId: 20 }) } },
    { id: "unscoped", memory: "UNSCOPED_PRIVATE" },
  ]]) {
    const memory = createHiveMemory("fixture", async () => Response.json({ results }));
    const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, "Check the label"));
    try {
      await agent.generate({ session, prompt: "Only work on this repository." });
      assert.equal(turns[0].prompt, "Only work on this repository.");
    } finally { await session.stop(); }
  }
});

test("recalled context is bounded and cannot inject arbitrary provenance objects", async () => {
  const results = [
    { id: "foreign", memory: "FOREIGN_SECRET", metadata: { hive_scope: "other-repo" } },
    { id: "m1", memory: "A".repeat(4000), metadata: { hive_scope: repositoryMemoryId(scope), author_name: { injected: "UNTRUSTED_AUTHOR_OBJECT" }, source_session_id: "s".repeat(20_000) } },
    { id: "m2", memory: "B".repeat(4000), metadata: { hive_scope: repositoryMemoryId(scope), author_name: "Grace Hopper" } },
    { id: "m3", memory: "C".repeat(4000), metadata: { hive_scope: repositoryMemoryId(scope) } },
    { id: "m4", memory: "FOURTH_RESULT", metadata: { hive_scope: repositoryMemoryId(scope) } },
  ];
  const memory = createHiveMemory("fixture", async () => Response.json({ results }));
  const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, "Repository conventions"));
  try {
    await agent.generate({ session, prompt: "Current task stays intact." });
    assert.doesNotMatch(turns[0].prompt, /FOREIGN_SECRET|FOURTH_RESULT|UNTRUSTED_AUTHOR_OBJECT/);
    assert.match(turns[0].prompt, /Grace Hopper/);
    assert.ok(turns[0].prompt.length < 6500, "Three memories and bounded provenance must fit in a small context block");
    assert.ok(turns[0].prompt.endsWith("Current task stays intact."));
  } finally { await session.stop(); }
});

test("tool steps do not repeat recall; a later fresh turn recalls current memory again", async () => {
  let requests = 0;
  const memory = createHiveMemory("fixture", async () => {
    requests++;
    return Response.json({ results: [{ id: `m${requests}`, memory: `RECALLED_VERSION_${requests}`, metadata: { hive_scope: repositoryMemoryId(scope) } }] });
  });
  const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, "Package manager"));
  try {
    const first = await agent.generate({ session, prompt: "Check the package manager." });
    assert.equal(first.toolCalls.length, 2);
    assert.equal(requests, 1);
    await agent.generate({ session, prompt: "Check the CI package manager too." });
    assert.equal(requests, 2);
    assert.match(turns[0].prompt, /RECALLED_VERSION_1/);
    assert.match(turns[1].prompt, /RECALLED_VERSION_2/);
    assert.doesNotMatch(turns[1].prompt, /RECALLED_VERSION_1/);
  } finally { await session.stop(); }
});

test("resuming a suspended native turn does not query memory or start a new prompt", async () => {
  let requests = 0;
  const memory = createHiveMemory("fixture", async () => { requests++; return Response.json({ results: [] }); });
  const hook = createMemoryRecall(memory, scope, "Check conventions");
  const first = await startAgent(hook, { pause: true });
  const stream = await first.agent.stream({ session: first.session, prompt: "Do the task." });
  const draining = stream.consumeStream();
  const state = await first.session.suspendTurn();
  await draining;
  assert.equal(requests, 1);
  const resumed = await startAgent(hook, { continueFrom: state, sessionId: first.session.sessionId });
  try {
    const result = await resumed.agent.continueGenerate({ session: resumed.session });
    assert.equal(result.text, "Resumed existing turn.");
    assert.equal(requests, 1);
    assert.equal(resumed.turns.length, 0);
    assert.equal(resumed.continuationCount(), 1);
  } finally { await resumed.session.stop(); }
});

test("disabled memory or unsafe query input never leaves the host", async () => {
  for (const { key, query } of [
    { key: undefined, query: "conventions" },
    ...[undefined, "", "x".repeat(1001), "```ts\nconst privateSource = 1;\n```", "api_key=private-value", "postgresql://private-db"].map((query) => ({ key: "fixture", query })),
  ]) {
    let requests = 0;
    const memory = createHiveMemory(key, async () => { requests++; throw new Error("Unexpected external call"); });
    const { agent, session, turns } = await startAgent(createMemoryRecall(memory, scope, query));
    try {
      await agent.generate({ session, prompt: "Current request stays local to the coding runtime." });
      assert.equal(requests, 0);
      assert.equal(turns[0].prompt, "Current request stays local to the coding runtime.");
    } finally { await session.stop(); }
  }
});
