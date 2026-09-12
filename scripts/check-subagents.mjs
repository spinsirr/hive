import assert from "node:assert/strict";
import test from "node:test";
import { createSubagents, subagentSettings } from "../src/lib/codex-bridge/subagents.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleHiveMcp } from "../src/lib/hive-mcp.ts";
import { createInitialTaskSessionState, memberDirectory } from "../src/lib/task-session.ts";
import { createHiveMemory } from "../src/lib/hive-memory.ts";

const settings = {
  model: "openai/gpt-5.1-codex-mini", cwd: "/fixture/repo", sandbox: "danger-full-access", approvalPolicy: "never",
  developerInstructions: "Preserve authorship and stay in the attached repository.",
  config: {
    model_reasoning_effort: "medium", web_search: "live",
    mcp_servers: { hive: { url: "https://parent.invalid", http_headers: { Authorization: "PARENT_SECRET" } } },
    features: { multi_agent: false, plugins: true },
    skills: { config: [{ path: "/fixture/repo/skills/review/SKILL.md", enabled: true }] },
    shell_environment_policy: { inherit: "core" },
  },
};
function fixture(options = {}) {
  const calls = [], updates = [];
  let nextId = 0;
  const controller = createSubagents({ settings, runId: "run-one", onChange: (value) => updates.push(value), request: async (method, params) => {
    calls.push({ method, params });
    if (options.request) return options.request(method, params);
    if (method === "thread/start") return { thread: { id: `thread-${++nextId}` } };
    if (method === "turn/start" || method === "review/start") return { turn: { id: `turn-${params.threadId}` } };
    return {};
  }, ...options });
  const spawn = (kind = "research", requestId = kind) => controller.control({ action: "spawn", kind, task: `Inspect the ${kind} evidence`, requestId });
  function event(task, method, value = {}) { controller.notification({ method, params: { threadId: task.threadId, turnId: task.turnId, ...value } }); }
  function complete(task, status = "completed") { event(task, "turn/completed", { turn: { id: task.turnId, status } }); }
  return { controller, spawn, calls, updates, event, complete };
}

test("children inherit the task's configuration and instructions without upgrading the review model", () => {
  const child = subagentSettings(settings);
  assert.equal(child.sandbox, settings.sandbox);
  assert.equal(child.approvalPolicy, settings.approvalPolicy);
  assert.equal(child.cwd, settings.cwd);
  assert.equal(child.model, settings.model);
  assert.deepEqual(child.config, { ...settings.config, review_model: settings.model });
  assert.ok(child.developerInstructions.startsWith(settings.developerInstructions));
  assert.match(child.developerInstructions, /do not edit files/);
  assert.equal(subagentSettings({ ...settings, sandbox: "read-only" }).sandbox, "read-only");
  assert.equal(settings.config.review_model, undefined, "Creating a child must not mutate parent configuration");
});

test("two independent native threads, bounded to two starts total; same-call retry is idempotent", async () => {
  const f = fixture();
  const [research, review] = await Promise.all([f.spawn(), f.spawn("review")]);
  assert.notEqual(research.threadId, review.threadId);
  assert.equal((await f.spawn()).id, research.id);
  assert.deepEqual(f.calls.map((call) => call.method).sort(), ["review/start", "thread/start", "thread/start", "turn/start"].sort());
  for (const call of f.calls.filter((call) => call.method === "thread/start")) assert.deepEqual(call.params.config.mcp_servers, settings.config.mcp_servers);
  const turn = f.calls.find((call) => call.method === "turn/start");
  assert.equal(turn.params.sandboxPolicy, undefined, "A child turn must use the inherited thread permissions");
  assert.equal(turn.params.effort, undefined, "A child turn must use the inherited reasoning effort");
  const nativeReview = f.calls.find((call) => call.method === "review/start");
  assert.equal(nativeReview.params.delivery, "inline", "The review runs on its new thread, not on the parent");
  assert.ok(!JSON.stringify(f.updates).includes("PARENT_SECRET"), "Inherited credentials remain private runtime configuration, not shared progress");
  assert.equal(nativeReview.params.threadId, review.threadId);
  f.complete(research); f.complete(review);
  await assert.rejects(f.spawn("research", "third"), /At most two/);
  await f.controller.close();
  await assert.rejects(f.spawn(), /ended/);
});

test("MCP retries of one delegation reuse its child despite different transport request IDs", async () => {
  const f = fixture();
  const scope = { sessionId: "delegation-replay", memberId: "spencer", runId: "run-one" };
  const initial = createInitialTaskSessionState(1, scope.sessionId);
  const context = { ...initial, stage: "running", members: [memberDirectory.spencer], workspace: { ...initial.workspace, liveReply: { id: scope.runId } } };
  const client = new Client({ name: "replayed-delegation", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
    fetch: (input, init) => handleHiveMcp(new Request(input, init), scope, {
      read: async () => context, reply: async () => { throw new Error("Not a reply"); },
      control: async (_scope, input) => f.controller.control(input),
    }, createHiveMemory(undefined)),
  }));
  try {
    const call = () => client.callTool({ name: "spawn_subagent", arguments: { key: "inspect-queue", kind: "research", task: "Inspect queue.ts" } });
    const [first, retry] = await Promise.all([call(), call()]);
    assert.notEqual(first.isError, true); assert.notEqual(retry.isError, true);
    assert.equal(JSON.parse(retry.content[0].text).id, JSON.parse(first.content[0].text).id);
    assert.equal(f.calls.filter((call) => call.method === "thread/start").length, 1);
    const task = f.controller.snapshot()[0];
    f.complete(task);
    assert.equal(JSON.parse((await call()).content[0].text).status, "completed", "a retry cannot relaunch completed work");
    assert.equal((await client.callTool({ name: "spawn_subagent", arguments: { key: "inspect-queue", kind: "review", task: "Different work" } })).isError, true);
    assert.equal((await client.callTool({ name: "spawn_subagent", arguments: { key: "review-queue", kind: "review", task: "Review queue.ts" } })).isError, undefined);
    assert.equal(f.calls.filter((call) => call.method === "thread/start").length, 2, "distinct work still starts its own child");
  } finally {
    for (const task of f.controller.snapshot()) f.complete(task);
    await client.close(); await f.controller.close();
  }
});

test("review's internal turn never steals the outer turn or its exitedReviewMode result", async () => {
  const f = fixture(); const task = await f.spawn("review");
  f.controller.notification({ method: "turn/started", params: { threadId: task.threadId, turn: { id: "internal-review-turn" } } });
  f.controller.notification({ method: "turn/completed", params: { threadId: task.threadId, turn: { id: "internal-review-turn", status: "completed" } } });
  assert.equal(f.controller.snapshot()[0].status, "running");
  f.event(task, "item/completed", { item: { id: "reasoning", type: "reasoning", text: "PRIVATE REASONING" } });
  f.event(task, "item/completed", { item: { id: "cmd", type: "commandExecution", aggregatedOutput: "TOOL OUTPUT" } });
  f.event(task, "item/completed", { item: { id: "review", type: "exitedReviewMode", review: "One actionable finding in src/main.ts:12" } });
  f.event(task, "item/completed", { item: { id: "mirror", type: "agentMessage", text: "One actionable finding in src/main.ts:12" } });
  f.complete(task);
  const result = await f.controller.control({ action: "read", id: task.id });
  assert.equal(result.result, "One actionable finding in src/main.ts:12");
  assert.equal(result.status, "completed");
  assert.equal(result.turnId, task.turnId);
  await f.controller.close();
});

test("interrupt acknowledgement is stopping, not stopped; foreign IDs cannot interrupt the parent", async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.spawn(), f.spawn("review")]);
  assert.equal((await f.controller.control({ action: "stop", id: a.id })).status, "stopping");
  assert.equal(f.controller.snapshot()[1].status, "running");
  await f.controller.control({ action: "stop", id: a.id });
  assert.equal(f.calls.filter((call) => call.method === "turn/interrupt").length, 1);
  await assert.rejects(f.controller.control({ action: "stop", id: "other-run-task" }), /does not belong/);
  f.complete(a, "interrupted"); f.complete(b);
  assert.equal((await f.controller.control({ action: "read", id: a.id })).status, "stopped");
  await f.controller.close();
});

test("a stop while a thread is starting never starts a model turn", async () => {
  const ready = Promise.withResolvers(); const calls = [];
  const f = fixture({ request: async (method) => { calls.push(method); return ready.promise; } });
  const spawn = f.spawn(); const initial = f.controller.snapshot()[0];
  assert.equal((await f.controller.control({ action: "stop", id: initial.id })).status, "stopping");
  ready.resolve({ thread: { id: "not-started" } });
  assert.equal((await spawn).status, "stopped");
  assert.deepEqual(calls, ["thread/start"]);
  await f.controller.close();
});

test("parent drain interrupts unfinished children and waits for a native terminal event", async () => {
  let controller;
  const f = fixture({ request: async (method, params) => {
    if (method === "thread/start") return { thread: { id: "thread" } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    if (method === "turn/interrupt") setImmediate(() => controller.notification({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } }));
    return {};
  } }); controller = f.controller;
  await f.spawn(); await f.controller.close();
  assert.equal(f.controller.snapshot()[0].status, "stopped");
});

test("native start failures are honest and cannot leak provider errors into shared chat", async () => {
  const f = fixture({ request: async () => { throw new Error("PRIVATE TOKEN IN PROVIDER ERROR"); } });
  const task = await f.spawn();
  assert.equal(task.status, "failed");
  assert.equal(task.result, "");
  assert.ok(!JSON.stringify(f.updates).includes("PRIVATE TOKEN"));
  await f.controller.close();
});
