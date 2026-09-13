// Purpose: real persisted task transitions, not an in-memory timer. Ordinary
// discussion renews a VM without running Hive; idle snapshots pair exactly once.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createFixturePool } from "./fixture-pool.mjs";
const url = new URL(process.env.HIVE_ONBOARDING_TEST_DATABASE_URL ?? "");
assert.ok(
  ["postgres:", "postgresql:"].includes(url.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !url.search
);
const name = `hive_idle_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url.toString() });
url.pathname = `/${name}`;
process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT = url.toString();
const { pool, closePool } = createFixturePool({
  connectionString: url.toString(),
  max: 5,
});
globalThis.__hiveDatabasePool = pool;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return next("next/dist/compiled/server-only/empty.js", context);
    if (specifier === "@/db")
      return next(new URL("../src/db/index.ts", import.meta.url).href, context);
    if (specifier.startsWith("@/"))
      return next(
        new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        context
      );
    return next(specifier, context);
  },
});
const vmId = "vm-1";
let taskId,
  deadline = 1_800_000,
  status = "running",
  reads = 0,
  snapshots = [];
const sandbox = {
  get tags() {
    return { session: taskId };
  },
  get status() {
    return status;
  },
  get expiresAt() {
    return new Date(deadline);
  },
  currentSession: () => ({
    sessionId: vmId,
    async extendTimeout(ms) {
      deadline += ms;
    },
  }),
  async listSnapshots() {
    return { snapshots };
  },
};
mock.module("@vercel/sandbox", {
  namedExports: {
    Sandbox: {
      async get({ resume }) {
        assert.equal(resume, false);
        reads++;
        return sandbox;
      },
    },
  },
});
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const { db } = await import("../src/db/index.ts");
  const { users } = await import("../src/db/schema.ts");
  const store = await import("../src/lib/task-session-store.ts");
  const { publicTaskSessionSnapshot } =
    await import("../src/lib/task-session-snapshot.ts");
  const members = [101, 102].map((id) => ({
    id: `github-${id}`,
    name: `Person ${id}`,
    shortName: `Person${id}`,
    initials: "QA",
    githubLogin: `person-${id}`,
  }));
  for (const [i, member] of members.entries())
    await db
      .insert(users)
      .values({ ...member, githubUserId: 101 + i, updatedAt: new Date() });
  const task = await store.createTaskSession("Idle test", members[0]);
  taskId = task.sessionId;
  await store.joinTaskSession(taskId, members[1].id);
  const act = (action, at) =>
    store.applyTaskSessionAction(
      taskId,
      { ...action, actor: members[0].id },
      members[0],
      at
    );
  await act(
    {
      type: "connect-repository",
      repositoryUrl: "https://github.com/example/repo",
      repositoryId: 1,
      repositoryName: "example/repo",
      repositoryBranch: "main",
      installationId: 1,
      visibility: "private",
      githubUserId: 101,
      githubLogin: "person-101",
    },
    1
  );
  const running = await act(
    { type: "send-message", body: "Inspect only", clientId: randomUUID() },
    100
  );
  const nativeId = running.snapshot.session.workspace.agentSession.id;
  const result = {
    sandboxName: `hive-session-${nativeId}`,
    environment: { vmId, idleUntil: deadline },
    agentSession: {
      id: nativeId,
      runtime: "codex",
      resumeFrom: {
        type: "resume-session",
        specificationVersion: "harness-v1",
        harnessId: "codex",
        data: {
          threadId: "PRIVATE_HISTORY",
          bridge: { token: "PRIVATE_BRIDGE" },
        },
      },
    },
    summary: "Ready",
    files: [{ path: "qa.txt", content: "kept" }],
    diff: "+kept",
    changedFiles: ["qa.txt"],
    commands: [],
  };
  await store.appendHiveReply(
    taskId,
    result.summary,
    {
      forReplyId: running.snapshot.session.workspace.liveReply.id,
      runResult: result,
    },
    1_000
  );
  const parent = (
    await store.getPublicTaskSessionSnapshot(taskId)
  ).session.messages.find((message) => message.role === "human");
  const first = await act(
    {
      type: "annotate-message",
      messageId: parent.id,
      body: "Human discussion",
      clientId: randomUUID(),
    },
    600_000
  );
  assert.equal(first.startedRun, false);
  assert.equal(deadline, 2_400_000);
  const beforeRead = deadline;
  for (let i = 0; i < 3; i++) await store.getPublicTaskSessionSnapshot(taskId);
  assert.equal(deadline, beforeRead, "polling is not a message");
  // Serialize concurrent input against the real row lock, not an additive race.
  await Promise.all(
    ["A", "B"].map((body) =>
      act(
        {
          type: "annotate-message",
          messageId: parent.id,
          body,
          clientId: randomUUID(),
        },
        700_000
      )
    )
  );
  assert.equal(deadline, 2_500_000);
  const readsBeforeEdit = reads;
  await act(
    {
      type: "edit-message",
      messageId: parent.id,
      body: "Inspect carefully",
      expectedRevision: 0,
    },
    800_000
  );
  assert.equal(reads, readsBeforeEdit, "edits do not renew the environment");
  const client = publicTaskSessionSnapshot(
    await store.getPublicTaskSessionSnapshot(taskId)
  );
  assert.doesNotMatch(
    JSON.stringify(client),
    /PRIVATE_HISTORY|PRIVATE_BRIDGE|idleCheckpoint/
  );
  assert.ok(
    (await store.getTaskSessionSnapshot(taskId)).session.workspace
      .idleCheckpoint
  );
  status = "stopped";
  snapshots = [
    {
      id: "snap-idle",
      status: "created",
      sourceSessionId: vmId,
      createdAt: 2_500_000,
    },
  ];
  await store.syncTaskIdleCheckpoint(taskId);
  await store.syncTaskIdleCheckpoint(taskId);
  const saved = (await store.getTaskSessionSnapshot(taskId)).session.workspace;
  assert.equal(saved.checkpoints.length, 1);
  assert.equal(saved.checkpoints[0].result.files[0].content, "kept");
  assert.equal(
    saved.checkpoints[0].result.agentSession.resumeFrom.data.threadId,
    "PRIVATE_HISTORY"
  );
  assert.equal(
    saved.checkpoints[0].result.agentSession.resumeFrom.data.bridge,
    undefined
  );
  const discussion = await act(
    {
      type: "annotate-message",
      messageId: parent.id,
      body: "After expiry",
      clientId: randomUUID(),
    },
    3_000_000
  );
  assert.equal(discussion.startedRun, false);
  assert.equal(status, "stopped");
  const next = await act(
    { type: "send-message", body: "Continue", clientId: randomUUID() },
    3_000_001
  );
  assert.equal(next.startedRun, true);
  assert.equal(next.snapshot.session.workspace.idleCheckpoint, undefined);
  assert.equal(next.snapshot.session.workspace.checkpoints.length, 1);
  console.log(
    "PASS: real Postgres preserves discussion, exactly-once idle checkpoint pairing, native recovery, privacy, and concurrent 30-minute renewal without agent wake."
  );
} finally {
  await closePool();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
