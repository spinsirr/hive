// Real Postgres + task commands + MCP. Only a uniquely named disposable local DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { Client as PostgresClient, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.HIVE_PEER_TEST_DATABASE_URL ?? "");
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search) throw new Error("Use a disposable loopback Postgres, never production.");
const databaseName = `hive_peer_test_${randomUUID().replaceAll("-", "")}`;
const admin = new PostgresClient({ connectionString: url.toString() });
url.pathname = `/${databaseName}`;
process.env.DATABASE_URL = url.toString();
delete process.env.VERCEL;
delete process.env.MEM0_API_KEY;
const pool = new Pool({ connectionString: url.toString(), max: 5 });
globalThis.__hiveDatabasePool = pool;
globalThis.fetch = async () => { throw new Error("No external services in this acceptance check"); };
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next("next/dist/compiled/server-only/empty.js", context);
  if (specifier === "@/db") return next(new URL("../src/db/index.ts", import.meta.url).href, context);
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
let created = false;
let client;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const store = await import("../src/lib/task-session-store.ts");
  const { db } = await import("../src/db/index.ts");
  const { users } = await import("../src/db/schema.ts");
  const { memberDirectory } = await import("../src/lib/task-session.ts");
  const { handleHiveMcp } = await import("../src/lib/hive-mcp.ts");
  const members = Object.values(memberDirectory);
  await db.insert(users).values(members.map((member, index) => ({ ...member, githubUserId: 100 + index, githubLogin: member.id, updatedAt: new Date() })));
  const task = await store.createTaskSession("Peer collaboration acceptance", members[0]);
  await store.joinTaskSession(task.sessionId, members[1].id);
  const start = await store.applyTaskSessionAction(task.sessionId, { type: "send-message", actor: members[0].id, body: "Ask the team about draft access", clientId: randomUUID() }, members[0]);
  assert.equal(start.startedRun, true);
  const scope = { sessionId: task.sessionId, memberId: members[0].id, runId: start.snapshot.session.workspace.liveReply.id };
  client = new Client({ name: "acceptance", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
    fetch: (input, init) => handleHiveMcp(new Request(input, init), scope, { read: store.readHiveToolContext, reply: store.appendHiveToolReply, request: store.createHivePeerRequest }),
  }));
  const ask = await client.callTool({ name: "request_input", arguments: { key: "drafts", prompt: "Who can see drafts?", options: ["Author", "Team"] } });
  assert.notEqual(ask.isError, true);
  const messageId = JSON.parse(ask.content[0].text).messageId;
  const answers = await Promise.all(members.map((actor) => store.applyTaskSessionAction(task.sessionId, { type: "answer-question", actor: actor.id, messageId, body: actor.id === "maya" ? "Author only" : "Team", clientId: randomUUID() }, actor)));
  assert.ok(answers.every((answer) => !answer.startedRun));
  let snapshot = await store.getPublicTaskSessionSnapshot(task.sessionId);
  assert.equal(snapshot.session.steeringQueue.length, 1);
  assert.equal(snapshot.session.messages.find((m) => m.id === messageId).annotations.length, 1);
  const queueId = snapshot.session.steeringQueue[0].id;
  const runResult = { sandboxName: "fixture", agentSession: { id: "native-fixture", runtime: "codex" }, summary: "Ready to continue", diff: "", files: [], commands: [], changedFiles: [] };
  await store.appendHiveReply(task.sessionId, runResult.summary, { forReplyId: scope.runId, runResult });
  const continuations = await Promise.all(members.map((actor) => store.applyTaskSessionAction(task.sessionId, { type: "continue-peer-response", actor: actor.id, steerId: queueId }, actor)));
  assert.equal(continuations.filter((item) => item.startedRun).length, 1, "two clients receive only one execution grant");
  snapshot = await store.getPublicTaskSessionSnapshot(task.sessionId);
  const continuationId = snapshot.session.workspace.liveReply.id;
  assert.equal(snapshot.session.workspace.liveReply.threadId, messageId);
  assert.equal(snapshot.session.workspace.agentSession.id, "native-fixture");
  await store.checkpointAgentReply(task.sessionId, continuationId, "Checking the answer", 1);
  assert.equal((await store.getPublicTaskSessionSnapshot(task.sessionId)).session.workspace.liveReply.body, "Checking the answer");
  await store.appendHiveReply(task.sessionId, "Applied the team answer", { forReplyId: continuationId, runResult: { ...runResult, summary: "Applied the team answer" } });
  const finished = await store.getPublicTaskSessionSnapshot(task.sessionId);
  assert.equal(finished.session.messages.find((m) => m.id === messageId).annotations.at(-1).body, "Applied the team answer");
  assert.equal(finished.session.steeringQueue.length, 0);
  await assert.rejects(store.createHivePeerRequest(scope, { key: "late", prompt: "Stale run" }));
  const reviewRun = await store.applyTaskSessionAction(task.sessionId, { type: "send-message", actor: members[0].id, body: "Prepare a review", clientId: randomUUID() }, members[0]);
  const reviewScope = { ...scope, runId: reviewRun.snapshot.session.workspace.liveReply.id };
  await client.close();
  client = new Client({ name: "review-acceptance", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
    fetch: (input, init) => handleHiveMcp(new Request(input, init), reviewScope, { read: store.readHiveToolContext, reply: store.appendHiveToolReply, request: store.createHivePeerRequest }),
  }));
  const reviewReceipt = await client.callTool({ name: "request_review", arguments: { key: "access", prompt: "Review access checks", targetMemberId: members[0].id } });
  assert.notEqual(reviewReceipt.isError, true);
  const reviewId = JSON.parse(reviewReceipt.content[0].text).messageId;
  await store.appendHiveReply(task.sessionId, "Access checks ready", { forReplyId: reviewScope.runId, runResult: { ...runResult, summary: "Access checks ready", diff: "+ require access", changedFiles: ["access.ts"] } });
  const beforeReview = await store.getPublicTaskSessionSnapshot(task.sessionId);
  const resolveReview = { type: "resolve-peer-review", actor: members[0].id, messageId: reviewId, revision: reviewScope.runId };
  await store.applyTaskSessionAction(task.sessionId, { ...resolveReview, actor: members[1].id }, members[1]);
  await store.applyTaskSessionAction(task.sessionId, { ...resolveReview, revision: "stale" }, members[0]);
  assert.equal((await store.getPublicTaskSessionSnapshot(task.sessionId)).session.version, beforeReview.session.version);
  await Promise.all([1, 2].map(() => store.applyTaskSessionAction(task.sessionId, resolveReview, members[0])));
  const resolved = await store.getPublicTaskSessionSnapshot(task.sessionId);
  assert.equal(resolved.session.version, beforeReview.session.version + 1);
  assert.equal(resolved.session.messages.find((m) => m.id === reviewId).interaction.resolved.by, members[0].id);
  const foreign = await store.createTaskSession("Private other task", members[0]);
  await assert.rejects(store.applyTaskSessionAction(foreign.sessionId, { type: "answer-question", actor: members[1].id, messageId, body: "Foreign", clientId: randomUUID() }, members[1]), store.TaskSessionAccessError);
  const before = (await store.getPublicTaskSessionSnapshot(foreign.sessionId)).session.version;
  await store.applyTaskSessionAction(foreign.sessionId, { type: "answer-question", actor: members[0].id, messageId, body: "Cross-task ID", clientId: randomUUID() }, members[0]);
  assert.equal((await store.getPublicTaskSessionSnapshot(foreign.sessionId)).session.version, before);
  console.log("PASS: real MCP → Postgres question → concurrent answers → one continuation → thread stream/result; reconnect read, stale run and cross-task denial.");
  console.log("PASS: real MCP review request → completed evidence → assigned reviewer; stale version and duplicate resolution are no-ops.");
} finally {
  await client?.close();
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
