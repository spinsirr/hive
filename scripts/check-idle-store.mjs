import { createTestDatabase } from "./test-database.mjs";
import { registerTestModules } from "./test-modules.mjs";
// Purpose: real persisted task transitions, not an in-memory timer. Ordinary
// discussion renews a VM without running Hive; idle snapshots pair exactly once.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { mock } from "node:test";

const database = createTestDatabase(
  process.env.HIVE_ONBOARDING_TEST_DATABASE_URL,
  "hive_idle_test"
);
registerTestModules();
const vmId = "vm-1";
let taskId,
  deadline = 1_800_000,
  status = "running",
  reads = 0,
  snapshots = [];
let pauseProvider;
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
        const pause = pauseProvider;
        pauseProvider = undefined;
        await pause?.();
        return sandbox;
      },
    },
  },
});

try {
  await database.start();
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

  const holdProvider = () => {
    let enter, release;
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    const released = new Promise((resolve) => {
      release = resolve;
    });
    pauseProvider = () => {
      enter();
      return released;
    };
    return { entered, release };
  };
  // A provider renewal is deliberately stalled. The accepted discussion,
  // another task mutation and streaming progress must still reach Postgres.
  status = "running";
  const renewal = holdProvider();
  const slowDiscussion = act(
    {
      type: "annotate-message",
      messageId: parent.id,
      body: "Provider is slow",
      clientId: randomUUID(),
    },
    3_010_000
  );
  await renewal.entered;
  let timer;
  try {
    await Promise.race([
      Promise.all([
        store.checkpointAgentReply(
          taskId,
          next.snapshot.session.workspace.liveReply.id,
          "Progress during renewal",
          1
        ),
        act(
          { type: "rename-task", title: "Messages are not blocked" },
          3_010_001
        ),
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Provider I/O blocked task writes")),
          1000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    renewal.release();
    await slowDiscussion;
  }
  const progressed = (await store.getTaskSessionSnapshot(taskId)).session;
  assert.equal(progressed.title, "Messages are not blocked");
  assert.equal(progressed.workspace.liveReply.body, "Progress during renewal");
  assert.equal(
    progressed.messages
      .find((message) => message.id === parent.id)
      .annotations.at(-1).body,
    "Provider is slow"
  );

  await store.appendHiveReply(
    taskId,
    result.summary,
    { forReplyId: progressed.workspace.liveReply.id, runResult: result },
    3_020_000
  );
  status = "stopped";
  snapshots = [
    {
      id: "new-idle",
      status: "created",
      sourceSessionId: vmId,
      createdAt: 5_000_000,
    },
  ];
  const checkpoint = holdProvider();
  const staleSync = store.syncTaskIdleCheckpoint(taskId);
  await checkpoint.entered;
  let restarted;
  try {
    restarted = await act(
      {
        type: "send-message",
        body: "Next exact VM turn",
        clientId: randomUUID(),
      },
      5_000_001
    );
    assert.equal(restarted.startedRun, true);
  } finally {
    checkpoint.release();
    await staleSync;
  }
  const final = (await store.getTaskSessionSnapshot(taskId)).session;
  assert.equal(final.version, restarted.snapshot.session.version);
  assert.equal(
    final.workspace.liveReply.id,
    restarted.snapshot.session.workspace.liveReply.id
  );
  assert.equal(final.workspace.idleCheckpoint, undefined);
  assert.equal(
    final.workspace.checkpoints.filter((saved) => saved.id === "new-idle")
      .length,
    1
  );
  console.log(
    "PASS: delayed provider renewal never blocks row mutations or streams; stale idle reads cannot overwrite an admitted run."
  );
  console.log(
    "PASS: real Postgres preserves discussion, exactly-once idle checkpoint pairing, native recovery, privacy, and concurrent 30-minute renewal without agent wake."
  );
} finally {
  await database.close();
}
