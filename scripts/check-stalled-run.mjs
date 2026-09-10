// Actual auth, session routes and row-locked Postgres transitions; only the
// execution engines are blocked. No .env.local, Neon, Sandbox, model or Mem0.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

const configured = process.env.HIVE_RECOVERY_TEST_DATABASE_URL;
if (!configured) throw new Error("Set HIVE_RECOVERY_TEST_DATABASE_URL to disposable loopback Postgres.");
const url = new URL(configured);
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search) {
  throw new Error("Only loopback Postgres without query overrides is allowed, never Neon.");
}
globalThis.fetch = async () => { throw new Error("External HTTP is forbidden in this fixture."); };
const databaseName = `hive_recovery_test_${randomUUID().replaceAll("-", "")}`;
assert.match(databaseName, /^hive_recovery_test_[a-f0-9]{32}$/);
const admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
url.pathname = `/${databaseName}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_URL_DIRECT = url.toString();
const pool = new Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 5000 });
globalThis.__hiveDatabasePool = pool;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next("next/dist/compiled/server-only/empty.js", context);
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier === "@/db") return next(new URL("../src/db/index.ts", import.meta.url).href, context);
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
let executionAttempts = 0;
const forbiddenExecution = async () => { executionAttempts += 1; throw new Error("Recovery must never execute an agent."); };
mock.module(new URL("../src/lib/hive-runner.ts", import.meta.url).href, { namedExports: { runHiveCodingTask: forbiddenExecution } });
mock.module(new URL("../src/lib/hive-conversation.ts", import.meta.url).href, { namedExports: { runHiveConversation: forbiddenExecution } });
mock.module("@vercel/functions", { namedExports: { attachDatabasePool() {} } });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const { db } = await import("../src/db/index.ts");
  const { taskSessions } = await import("../src/db/schema.ts");
  const { createUserSession, HIVE_SESSION_COOKIE } = await import("../src/lib/auth-session.ts");
  const store = await import("../src/lib/task-session-store.ts");
  const { STALLED_RUN_AFTER_MS, STALLED_RUN_ERROR, isHiveRunActive, canApplyNextSteer } = await import("../src/lib/task-session.ts");
  const { POST, GET } = await import("../src/app/api/sessions/[sessionId]/route.ts");
  const { NextRequest } = await import("next/server.js");
  const identities = await Promise.all([901, 902, 903].map((id) => createUserSession({ id, login: `recovery-${id}`, name: `Reviewer ${id}` })));
  const [owner, teammate, outsider] = identities;
  const initial = await store.createTaskSession("Lost-run regression fixture", owner.member);
  const id = initial.sessionId;
  await store.joinTaskSession(id, teammate.member.id);
  const context = { params: Promise.resolve({ sessionId: id }) };
  const request = (identity, body) => new NextRequest(`https://hive.test/api/sessions/${id}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Origin: "https://hive.test", ...(identity ? { Cookie: `${HIVE_SESSION_COOKIE}=${identity.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const post = (identity, body) => POST(request(identity, body), context);
  const read = async () => (await store.getTaskSessionSnapshot(id)).session;
  const checkpoint = { type: "resume-session", harnessId: "codex", specificationVersion: "harness-v1", data: { threadId: "private-recovery-fixture" } };

  await store.applyTaskSessionAction(id, {
    type: "connect-repository", actor: owner.member.id, installationId: 1, repositoryId: 2,
    repositoryUrl: "https://github.com/fixture/recovery.git", repositoryName: "fixture/recovery",
    repositoryBranch: "main", visibility: "private", githubUserId: 901, githubLogin: owner.member.githubLogin,
  }, owner.member);
  const started = await store.applyTaskSessionAction(id, { type: "send-message", actor: owner.member.id, body: "Inspect the fixture", clientId: randomUUID() }, owner.member);
  assert.equal(started.startedRun, true);
  const oldReplyId = started.snapshot.session.workspace.liveReply.id;
  const child = { id: randomUUID(), runId: oldReplyId, kind: "research", task: "Inspect this disposable fixture", status: "running", startedAt: 1, result: "" };
  await Promise.all([
    store.checkpointAgentReply(id, oldReplyId, "Partial retained output", 1),
    store.checkpointSubagents(id, oldReplyId, { runId: oldReplyId, sequence: 1, tasks: [child] }),
  ]);
  assert.equal((await read()).workspace.liveReply.subagents[0].id, child.id);
  assert.equal((await read()).workspace.liveReply.body, "Partial retained output");
  await assert.rejects(store.checkpointSubagents(id, oldReplyId, { runId: "wrong-run", sequence: 2, tasks: [child] }), /mismatch/);
  await store.applyTaskSessionAction(id, { type: "send-message", actor: teammate.member.id, body: "Queued by the other reviewer", clientId: randomUUID() }, teammate.member);
  const before = await read();
  assert.equal((await post(undefined, { type: "recover-stalled-run" })).status, 401);
  assert.equal((await post(outsider, { type: "recover-stalled-run" })).status, 401);
  assert.equal((await post(owner, { type: "recover-stalled-run", actor: outsider.member.id, now: Date.now() + STALLED_RUN_AFTER_MS })).status, 200);
  assert.deepEqual(await read(), before, "client time and author cannot make a young run recoverable");
  assert.equal((await post(owner, { type: "reset" })).status, 200);
  assert.deepEqual(await read(), before, "reset remains a no-op while the run/queue is active");
  assert.equal((await post(owner, { type: "send-message", clientId: randomUUID(), body: "x".repeat(8001) })).status, 400);
  assert.deepEqual(await read(), before);
  console.log("PASS: real auth/route reject outsiders, premature recovery, active reset and oversized messages without changing stored state.");

  // Age only this disposable database fixture. No worker or production state is killed.
  const oldWorkspace = {
    ...before.workspace, startedAt: Date.now() - STALLED_RUN_AFTER_MS - 1000,
    sandboxName: "hive-session-recovery-fixture",
    agentSession: { ...before.workspace.agentSession, resumeFrom: checkpoint },
    diff: "+ retained fixture change", files: [{ path: "fixture.txt", content: "retained" }],
    commands: [{ command: "fixture check", output: { exitCode: 0, output: "fixture result", status: "completed" } }],
    changedFiles: ["fixture.txt"],
  };
  await db.update(taskSessions).set({ workspace: oldWorkspace }).where(eq(taskSessions.id, id));
  const aged = await read();
  await store.withTaskSubagentControl(id, async (state) => {
    assert.equal(state.workspace.agentSession.id, aged.workspace.agentSession.id);
    assert.doesNotMatch(JSON.stringify(state), /private-recovery-fixture|resumeFrom|retained fixture change|Partial retained output/);
  });
  const responses = await Promise.all([
    post(owner, { type: "recover-stalled-run", actor: outsider.member.id }),
    post(teammate, { type: "recover-stalled-run", actor: outsider.member.id }),
  ]);
  for (const response of responses) assert.equal(response.status, 200);
  const recovered = await read();
  assert.equal(recovered.version, aged.version + 1, "two concurrent recoveries record one transition");
  assert.equal(isHiveRunActive(recovered), false);
  assert.equal(canApplyNextSteer(recovered), true);
  assert.deepEqual(recovered.steeringQueue, aged.steeringQueue);
  assert.deepEqual(recovered.messages.slice(0, aged.messages.length), aged.messages);
  assert.equal(recovered.messages.filter((message) => message.id === oldReplyId).length, 1);
  assert.equal(recovered.messages.at(-2).body, "Partial retained output");
  assert.equal(recovered.messages.at(-2).subagents[0].status, "unconfirmed", "Lost parent cannot invent a child completion");
  assert.match(recovered.messages.at(-1).body, /Reviewer marked the run as lost/);
  assert.ok(recovered.messages.at(-1).body.includes(STALLED_RUN_ERROR));
  for (const field of ["agentSession", "sandboxName", "diff", "files", "commands", "changedFiles"]) assert.deepEqual(recovered.workspace[field], aged.workspace[field], `${field} must survive recovery`);
  const publicResponse = await GET(request(owner), context);
  assert.equal(publicResponse.status, 200);
  assert.doesNotMatch(await publicResponse.text(), /private-recovery-fixture|resumeFrom/);
  console.log("PASS: two real-Postgres concurrent recoveries preserve discussion, queued authors, partial output, artifacts and private native context exactly once.");

  await store.checkpointAgentReply(id, oldReplyId, "STALE TEXT", 99);
  await store.checkpointSubagents(id, oldReplyId, { runId: oldReplyId, sequence: 99, tasks: [{ ...child, status: "completed", result: "STALE CHILD RESULT" }] });
  await store.appendHiveReply(id, "STALE RESULT", { forReplyId: oldReplyId, runError: "stale worker" });
  assert.deepEqual(await read(), recovered, "old worker callbacks cannot overwrite recovered state");
  await post(owner, { type: "recover-stalled-run" });
  assert.deepEqual(await read(), recovered, "repeating recovery does not append another error");
  const applied = await Promise.all([
    store.applyTaskSessionAction(id, { type: "apply-next-steer", actor: owner.member.id }, owner.member),
    store.applyTaskSessionAction(id, { type: "apply-next-steer", actor: teammate.member.id }, teammate.member),
  ]);
  assert.equal(applied.filter((result) => result.startedRun).length, 1);
  const continuing = await read();
  assert.equal(isHiveRunActive(continuing), true);
  assert.equal(continuing.activeSteer.body, "Queued by the other reviewer");
  assert.equal(continuing.workspace.agentSession.id, aged.workspace.agentSession.id);
  assert.notEqual(continuing.workspace.liveReply.id, oldReplyId);
  await store.checkpointAgentReply(id, oldReplyId, "STALE TEXT AFTER APPLY", 100);
  await store.checkpointSubagents(id, oldReplyId, { runId: oldReplyId, sequence: 100, tasks: [{ ...child, status: "completed", result: "STALE CHILD RESULT AFTER APPLY" }] });
  await store.appendHiveReply(id, "STALE RESULT AFTER APPLY", { forReplyId: oldReplyId, runError: "stale worker" });
  await post(owner, { type: "recover-stalled-run" });
  assert.deepEqual(await read(), continuing, "old callbacks/recovery retry cannot end or corrupt the new run");
  assert.equal(executionAttempts, 0);
  console.log("PASS: late callbacks are fenced; concurrent Apply grants one next run; recovery itself makes zero execution attempts.");
  console.log("PASS: concurrent text/subagent JSON patches preserve both; stale child results cannot overwrite a recovered or newer run.");
} finally {
  await pool.end();
  if (created) {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName])).rowCount, 0);
    console.log("CLEANUP: removed only this run's disposable local fixture database.");
  }
  await admin.end();
}
