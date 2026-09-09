import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleHiveMcp } from "./hive-mcp.ts";
import { createHiveMemory } from "./hive-memory.ts";
import { assertHiveToolRun, describeHiveContext, hiveThreadReply, memoryContribution, type HiveToolContext } from "./hive-tool-context.ts";
import { createInitialTaskSessionState, memberDirectory, reduceTaskSession } from "./task-session.ts";

const scope = { sessionId: "tool-test", memberId: "spencer", runId: "run-one" };
function fixture(): HiveToolContext {
  const initial = createInitialTaskSessionState(1, scope.sessionId);
  return { ...initial, stage: "running", repository: {
    id: 20, installationId: 10, url: "https://github.com/example/repo", name: "example/repo", branch: "main", provider: "github-app",
    connectedAt: 1, connectedBy: "spencer", visibility: "private", authorizedByGitHub: { id: 1, login: "spencer" },
  }, messages: [{ id: "human-one", memberId: "spencer", name: "Spencer Zhao", initials: "SZ", body: "Use pnpm for this repository.", time: "now", role: "human" }],
  workspace: { status: "running", liveReply: { id: scope.runId } }, members: [memberDirectory.spencer, memberDirectory.maya] };
}

test("tools reject stale runs, restores, completed tasks and revoked members", () => {
  const context = fixture();
  assert.doesNotThrow(() => assertHiveToolRun(context, scope));
  for (const changed of [
    { ...context, sessionId: "other-task" }, { ...context, stage: "waiting" as const },
    { ...context, lifecycle: "completed" as const }, { ...context, members: [] },
    { ...context, workspace: { ...context.workspace, liveReply: { id: "another-run" } } },
    { ...context, workspace: { ...context.workspace, restore: { id: "restore", snapshotId: "checkpoint", by: memberDirectory.spencer, startedAt: 1, retryAfter: 2, status: "restoring" as const } } },
  ]) assert.throws(() => assertHiveToolRun(changed, scope));
});

test("context is bounded, attributed and does not equate membership with presence", () => {
  const context = fixture();
  context.messages[0].annotations = [hiveThreadReply("Can you clarify?", "reply-one")];
  assert.equal(describeHiveContext(context).discussion[0].replies[0].author, "Hive");
  assert.match(describeHiveContext(context).presence, /do not infer/);
  assert.equal(memoryContribution(context, "human-one").source.authorId, "spencer");
  assert.throws(() => memoryContribution(context, "human-one", "reply-one"));
  assert.throws(() => memoryContribution(context, "foreign"));
  assert.throws(() => memoryContribution(context, "human-one", "missing"));
  const full = { ...createInitialTaskSessionState(1), ...context, workspace: { ...createInitialTaskSessionState(1).workspace, ...context.workspace, liveReply: { id: scope.runId, body: "", sequence: 0, startedAt: 1 } } };
  assert.equal(reduceTaskSession(full, { type: "steer-message-annotation", actor: "spencer", messageId: "human-one", annotationId: "reply-one" }), full, "Hive cannot promote its own words into a human steer");
});

test("real MCP client can read, remember, recall and reply without starting another run", async () => {
  let context = fixture();
  const providerBodies: unknown[] = [];
  let saved: { text: string; metadata: Record<string, unknown> } | undefined;
  const memory = createHiveMemory("mem0-fixture-not-real", async (url, options) => {
    const body = JSON.parse(String(options?.body));
    providerBodies.push(body);
    if (String(url).endsWith("/add/")) {
      saved = { text: body.messages[0].content, metadata: body.metadata };
      return Response.json({ results: [{ id: "stored-one" }] });
    }
    return Response.json({ results: saved ? [{ id: "stored-one", memory: saved.text, metadata: saved.metadata }] : [] });
  });
  const replies: unknown[] = [];
  const client = new Client({ name: "fixture", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("https://hive.test/agent-tools"), { fetch: async (input, options) => {
    const request = new Request(input, options);
    if (request.method !== "POST") return new Response(null, { status: 405 });
    return handleHiveMcp(request, scope, {
      read: async () => context,
      reply: async (_scope, messageId, body, requestId) => { replies.push(hiveThreadReply(body, requestId)); return { messageId, replyId: requestId }; },
    }, memory);
  } });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["get_context", "remember_memory", "reply_to_thread", "search_memory"]);
    const description = await client.callTool({ name: "get_context", arguments: {} });
    assert.match(JSON.stringify(description), /Spencer Zhao/);
    assert.doesNotMatch(JSON.stringify(description), /mem0-fixture-not-real/);
    const invalid = await client.callTool({ name: "remember_memory", arguments: { messageId: "human-one", user_id: "other-scope", text: "invented" } });
    assert.equal(invalid.isError, true);
    assert.equal(providerBodies.length, 0);
    const save = await client.callTool({ name: "remember_memory", arguments: { messageId: "human-one" } });
    assert.equal(save.isError, undefined);
    assert.match(JSON.stringify(save), /saved/);
    const recalled = await client.callTool({ name: "search_memory", arguments: { query: "package manager" } });
    assert.match(JSON.stringify(recalled), /Use pnpm/);
    assert.equal(providerBodies.length, 2);
    const version = context.version;
    await client.callTool({ name: "reply_to_thread", arguments: { messageId: "human-one", body: "Should this apply to CI too?" } });
    assert.equal(replies.length, 1);
    assert.equal(context.version, version);
    assert.equal(context.steeringQueue.length, 0);
    context = { ...context, members: [] };
    assert.equal((await client.callTool({ name: "search_memory", arguments: { query: "conventions" } })).isError, true);
    assert.equal(providerBodies.length, 2);
  } finally { await client.close(); }
});
