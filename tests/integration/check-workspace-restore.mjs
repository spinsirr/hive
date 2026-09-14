import { registerTestModules } from "../helpers/test-modules.mjs";
// Real restore routes + state transitions + SDK orchestration; only the external
// auth, database transport and sandbox provider are deterministic doubles.
import assert from "node:assert/strict";

import { mock } from "node:test";
registerTestModules();
const {
  assertWorkspaceRestoreAttempt,
  beginWorkspaceRestore,
  completeWorkspaceRestore,
  failWorkspaceRestore,
  recordWorkspaceRestoreSource,
  WorkspaceRestoreError,
} = await import("../../src/lib/workspace/workspace-restore-state.ts");
const { applyHiveRunResult, createInitialTaskSessionState } =
  await import("../../src/lib/session/task-session.ts");
const member = {
  id: "github-101",
  name: "QA Member",
  shortName: "QA",
  initials: "QA",
};
let admitted = true,
  session,
  status,
  currentSnapshotId,
  sourceSnapshotId,
  pointerFailure = false,
  retentionFailure = false,
  foreign = false;
let providerSessionId,
  providerSnapshots,
  lostResumeResponse = false;
const calls = [];
const snapshot = () => ({
  session,
  members: [member],
  activeMembers: [],
  typingMembers: [],
});
mock.module(
  new URL("../../src/server/auth/auth-session.ts", import.meta.url).href,
  {
    namedExports: {
      HIVE_SESSION_COOKIE: "hive_session",
      getSessionMember: async () => member,
    },
  }
);
mock.module(
  new URL("../../src/server/sessions/task-session-store.ts", import.meta.url)
    .href,
  {
    namedExports: {
      TaskSessionAccessError: class extends Error {},
      isTaskSessionMember: async () => admitted,
      getTaskSessionSnapshot: async () => snapshot(),
      getPublicTaskSessionSnapshot: async () => snapshot(),
      syncTaskIdleCheckpoint: async () => {},
      withTaskWorkspaceRead: async (_id, read) => {
        if (session.workspace.restore)
          throw new WorkspaceRestoreError(409, "Workspace is being restored.");
        return read(session);
      },
      startTaskWorkspaceRestore: async (_id, request, author) => {
        const previous = session;
        session = beginWorkspaceRestore(session, request, author);
        return { session, started: previous !== session };
      },
      recordTaskWorkspaceRestoreSource: async (_id, id, startedAt, source) => {
        session = recordWorkspaceRestoreSource(session, id, startedAt, source);
        return session;
      },
      finishTaskWorkspaceRestore: async (_id, id, confirmed, startedAt) => {
        assertWorkspaceRestoreAttempt(session, id, startedAt);
        session = confirmed
          ? completeWorkspaceRestore(session, id)
          : failWorkspaceRestore(session, id);
        return snapshot();
      },
    },
  }
);
const sandbox = {
  name: "hive-session-test-agent",
  get status() {
    return status;
  },
  get tags() {
    return { session: foreign ? "other-task" : "restore-qa" };
  },
  get currentSnapshotId() {
    return currentSnapshotId;
  },
  keepLastSnapshots: { count: 3 },
  currentSession: () => ({ sessionId: providerSessionId, sourceSnapshotId }),
  listSnapshots: async () => ({ snapshots: providerSnapshots }),
  stop: async () => {
    calls.push("stop");
    status = "stopped";
    currentSnapshotId = "snap-safety";
    return { snapshot: { id: "snap-safety", status: "created", createdAt: 3 } };
  },
  update: async (update) => {
    calls.push(update);
    if (update.keepLastSnapshots?.count === 3 && retentionFailure)
      throw new Error("Retention housekeeping failed");
    if (update.currentSnapshotId) {
      currentSnapshotId = update.currentSnapshotId;
      if (pointerFailure)
        throw new Error("PRIVATE PROVIDER ERROR after pointer update");
    }
  },
};
mock.module("@vercel/sandbox", {
  namedExports: {
    Sandbox: {
      get: async ({ resume }) => {
        calls.push(resume ? "resume" : "metadata");
        if (resume) {
          status = "running";
          sourceSnapshotId = currentSnapshotId;
          providerSessionId = "resumed-session";
          if (lostResumeResponse)
            throw new DOMException(
              "Provider resumed, but response timed out",
              "TimeoutError"
            );
        }
        return sandbox;
      },
    },
  },
});

function fresh() {
  session = createInitialTaskSessionState(1, "restore-qa");
  session.repository = { url: "https://github.com/spinsirr/hive.git" };
  for (const version of ["old", "new"])
    session = applyHiveRunResult(session, {
      snapshot: { id: `snap-${version}`, createdAt: version === "old" ? 1 : 2 },
      sandboxName: sandbox.name,
      agentSession: {
        id: "test-agent",
        runtime: "codex",
        resumeFrom: {
          type: "resume-session",
          harnessId: "codex",
          specificationVersion: "harness-v1",
          data: { thread: version, private: "NATIVE SECRET" },
        },
      },
      summary: version,
      diff: `+ ${version}`,
      files: [{ path: "nav.ts", content: version }],
      commands: [],
      changedFiles: ["nav.ts"],
    });
  // The VM can contain changes made since resuming the target. Matching only
  // sourceSnapshotId is not proof of restoration: it still has to stop/repoint.
  status = "running";
  currentSnapshotId = "snap-new";
  sourceSnapshotId = "snap-old";
  calls.length = 0;
  pointerFailure = false;
  retentionFailure = false;
  foreign = false;
  providerSessionId = "original-session";
  lostResumeResponse = false;
  providerSnapshots = [
    { id: "snap-old", status: "created", createdAt: 1 },
    { id: "snap-new", status: "created", createdAt: 2 },
  ];
}
try {
  const { NextRequest } = await import("next/server.js");
  const { POST } =
    await import("../../src/app/api/sessions/[sessionId]/checkpoints/route.ts");
  const { GET: files } =
    await import("../../src/app/api/sessions/[sessionId]/files/route.ts");
  const post = (body, origin = "https://hive.example") =>
    POST(
      new NextRequest(
        "https://hive.example/api/sessions/restore-qa/checkpoints",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", origin },
          body: JSON.stringify(body),
        }
      ),
      { params: Promise.resolve({ sessionId: "restore-qa" }) }
    );
  fresh();
  session.workspace.codingModel = "gpt-5.6-luna";
  session.workspace.codingEffort = "xhigh";
  const input = {
    id: "8d723141-b7ab-46fc-b6b8-2ff1e1a8ba4f",
    snapshotId: "snap-old",
    version: session.version,
  };
  admitted = false;
  assert.equal((await post(input)).status, 401);
  admitted = true;
  assert.equal((await post(input, "https://attacker.example")).status, 403);
  assert.equal((await post({ snapshotId: "snap-old" })).status, 400);
  assert.equal((await post({ ...input, snapshotId: "foreign" })).status, 409);
  assert.equal((await post({ ...input, version: 0 })).status, 409);
  assert.equal(calls.length, 0, "Denied requests never touch the provider");
  const response = await post({ ...input, by: { id: "forged-author" } });
  assert.equal(response.status, 200);
  assert.equal(session.workspace.files[0].content, "old");
  assert.equal(session.workspace.codingModel, "gpt-5.6-luna");
  assert.equal(
    session.workspace.codingEffort,
    "xhigh",
    "Restoring files/history must not undo the team's current model preferences"
  );
  assert.deepEqual(session.workspace.agentSession.resumeFrom.data, {
    thread: "old",
    private: "NATIVE SECRET",
  });
  assert.equal(session.workspace.lastRestore.by, "github-101");
  assert.equal(sourceSnapshotId, "snap-old");
  assert.ok(
    calls.indexOf("stop") <
      calls.findIndex((call) => call.currentSnapshotId === "snap-old")
  );
  assert.ok(
    calls.some((call) => call.keepLastSnapshots?.count === 10),
    "The safety save must not evict the selected target"
  );
  assert.doesNotMatch(
    await response.text(),
    /NATIVE SECRET|resumeFrom|forged-author/
  );
  const previousCalls = calls.length;
  assert.equal((await post(input)).status, 200);
  assert.equal(
    calls.length,
    previousCalls,
    "Retrying a completed request never restores twice"
  );
  console.log(
    "PASS: restore enforces membership/origin/version, preserves author and native state, and waits for confirmed sandbox resume before publishing"
  );

  fresh();
  pointerFailure = true;
  const failed = await post({ ...input, version: session.version });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /PRIVATE/);
  assert.equal(
    currentSnapshotId,
    "snap-old",
    "Simulate an ambiguous provider success"
  );
  assert.equal(
    session.workspace.files[0].content,
    "new",
    "Unconfirmed restore is not reported as complete"
  );
  assert.equal(session.workspace.restore.status, "unconfirmed");
  assert.equal(
    (
      await files(
        new NextRequest("https://hive.example/api/sessions/restore-qa/files"),
        { params: Promise.resolve({ sessionId: "restore-qa" }) }
      )
    ).status,
    409
  );
  assert.equal(
    (await post(input)).status,
    409,
    "The still-live worker cannot be retried concurrently"
  );
  session.workspace.restore.retryAfter = 0; // Advance the durable worker-expiry boundary, without sleeping.
  pointerFailure = false;
  assert.equal((await post(input)).status, 200);
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  console.log(
    "PASS: ambiguous provider failure fences file reads and agent work; the same operation safely retries after the worker expiry"
  );

  fresh();
  retentionFailure = true;
  assert.equal(
    (await post({ ...input, version: session.version })).status,
    200
  );
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  console.log(
    "PASS: retention housekeeping cannot misreport a confirmed restore as a failure"
  );

  fresh();
  lostResumeResponse = true;
  const recovered = await post({ ...input, version: session.version });
  assert.equal(
    recovered.status,
    200,
    "a lost resume response must be reconciled against the actual new session, not leave the task locked"
  );
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  assert.equal(
    calls.filter((call) => call === "stop").length,
    1,
    "reconciliation never repeats the destructive operation"
  );
  console.log(
    "PASS: a timeout after provider success is confirmed with metadata only, without a second stop or restore"
  );

  fresh();
  pointerFailure = true;
  assert.equal(
    (await post({ ...input, version: session.version })).status,
    503
  );
  assert.equal(session.workspace.restore.sourceSessionId, "original-session");
  const checkRequest = { ...input, mode: "check" };
  // UX regression: a completed VM must not leave the composer disabled merely
  // because the 90-second *write retry* fence has not expired. Checking is read-only.
  status = "running";
  sourceSnapshotId = "snap-old";
  providerSessionId = "late-resumed-session";
  const writesBeforeEarlyCheck = calls.filter(
    (call) => call !== "metadata"
  ).length;
  assert.ok(session.workspace.restore.retryAfter > Date.now());
  assert.equal(
    (await post(checkRequest)).status,
    200,
    "confirm a completed restore before the write-retry delay expires"
  );
  assert.equal(
    session.workspace.restore,
    undefined,
    "confirmation releases the composer"
  );
  assert.equal(
    calls.filter((call) => call !== "metadata").length,
    writesBeforeEarlyCheck
  );
  console.log(
    "PASS: early read-only confirmation releases the composer without repeating a restore"
  );

  fresh();
  pointerFailure = true;
  assert.equal(
    (await post({ ...input, version: session.version })).status,
    503
  );
  const beforeCheck = calls.length;
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "an unfinished restore remains paused during an early status check"
  );
  assert.deepEqual(
    calls.slice(beforeCheck),
    ["metadata"],
    "an early check never repeats stop, repoint or resume"
  );
  assert.equal(
    (
      await post({
        ...checkRequest,
        id: "e8a7d291-c9db-44cb-9d1c-2e974dc92671",
      })
    ).status,
    409
  );
  session.workspace.restore.retryAfter = 0;
  status = "running";
  sourceSnapshotId = "snap-old"; // Original VM, possibly edited after startup.
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "matching source snapshot on the original VM is not proof of restore"
  );
  assert.ok(session.workspace.restore);
  providerSessionId = "late-resumed-session";
  sourceSnapshotId = "snap-new";
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "a new VM from the wrong snapshot is not proof either"
  );
  sourceSnapshotId = "snap-old";
  foreign = true;
  assert.equal((await post(checkRequest)).status, 403);
  foreign = false;
  const changesBeforeConfirm = calls.filter(
    (call) => call !== "metadata"
  ).length;
  const confirmed = await post(checkRequest);
  assert.equal(confirmed.status, 200);
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  assert.equal(
    calls.filter((call) => call !== "metadata").length,
    changesBeforeConfirm,
    "recovery checks are provider metadata-only"
  );
  assert.equal(
    (await post(checkRequest)).status,
    200,
    "completed checks are idempotent"
  );
  assert.doesNotMatch(await confirmed.text(), /NATIVE SECRET|resumeFrom/);
  console.log(
    "PASS: late completion is reconciled after worker expiry, without writes or trusting an old/foreign/wrong-snapshot VM"
  );

  fresh();
  pointerFailure = true;
  assert.equal(
    (await post({ ...input, version: session.version })).status,
    503
  );
  session.workspace.restore.retryAfter = 0;
  status = "stopped";
  currentSnapshotId = "snap-after-sleep";
  sourceSnapshotId = "snap-old";
  const sleepSnapshot = {
    id: currentSnapshotId,
    sourceSessionId: "late-resumed-session",
    parentId: "snap-old",
    status: "created",
    createdAt: Date.now(),
  };
  providerSnapshots.push(sleepSnapshot);
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "the original VM cannot prove restoration even after stopping"
  );
  providerSessionId = "late-resumed-session";
  sleepSnapshot.sourceSessionId = "foreign-vm";
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "the saved snapshot must come from the restored VM"
  );
  sleepSnapshot.sourceSessionId = providerSessionId;
  sleepSnapshot.parentId = "snap-new";
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "the saved snapshot must descend directly from the restore target"
  );
  sleepSnapshot.parentId = "snap-old";
  sleepSnapshot.status = "failed";
  assert.equal((await post(checkRequest)).status, 202);
  sleepSnapshot.status = "created";
  sleepSnapshot.expiresAt = Date.now() - 1;
  assert.equal((await post(checkRequest)).status, 202);
  delete sleepSnapshot.expiresAt;
  currentSnapshotId = "unknown-snapshot";
  assert.equal((await post(checkRequest)).status, 202);
  currentSnapshotId = sleepSnapshot.id;
  status = "snapshotting";
  assert.equal(
    (await post(checkRequest)).status,
    202,
    "incomplete snapshotting cannot unlock the workspace"
  );
  status = "stopped";
  const writesBeforeSleepConfirm = calls.filter(
    (call) => call !== "metadata"
  ).length;
  assert.equal(
    (await post(checkRequest)).status,
    200,
    "a successfully restored VM can sleep before a viewer reconnects"
  );
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  assert.equal(
    calls.filter((call) => call !== "metadata").length,
    writesBeforeSleepConfirm,
    "sleep confirmation must not resume or rewind the sandbox"
  );
  assert.equal((await post(checkRequest)).status, 200);
  console.log(
    "PASS: a restored sandbox that has slept is confirmed only through the new VM and its valid target-derived snapshot, without waking or restoring it again"
  );

  fresh();
  pointerFailure = true;
  assert.equal(
    (await post({ ...input, version: session.version })).status,
    503
  );
  session.workspace.restore.retryAfter = 0;
  status = "running";
  sourceSnapshotId = "snap-old";
  providerSessionId = "late-resumed-session";
  const stopsBeforeRetry = calls.filter((call) => call === "stop").length;
  pointerFailure = false;
  assert.equal(
    (await post(input)).status,
    200,
    "even explicit retry first checks for completed work"
  );
  assert.equal(
    calls.filter((call) => call === "stop").length,
    stopsBeforeRetry
  );
  console.log(
    "PASS: explicit retry also acknowledges a completed restore without repeating it"
  );
} finally {
  mock.restoreAll();
}
