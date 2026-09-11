// Real restore routes + state transitions + SDK orchestration; only the external
// auth, database transport and sandbox provider are deterministic doubles.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock } from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const { beginWorkspaceRestore, completeWorkspaceRestore, failWorkspaceRestore, WorkspaceRestoreError } = await import("../src/lib/workspace-restore-state.ts");
const { applyHiveRunResult, createInitialTaskSessionState } = await import("../src/lib/task-session.ts");
let member = { id: "github-101", name: "QA Member", shortName: "QA", initials: "QA" };
let admitted = true, session, status, currentSnapshotId, sourceSnapshotId, pointerFailure = false, retentionFailure = false, foreign = false;
const calls = [];
const snapshot = () => ({ session, members: [member], activeMembers: [], typingMembers: [] });
mock.module(new URL("../src/lib/auth-session.ts", import.meta.url).href, { namedExports: { HIVE_SESSION_COOKIE: "hive_session", getSessionMember: async () => member } });
mock.module(new URL("../src/lib/task-session-store.ts", import.meta.url).href, { namedExports: {
  isTaskSessionMember: async () => admitted,
  getTaskSessionSnapshot: async () => snapshot(),
  getPublicTaskSessionSnapshot: async () => snapshot(),
  withTaskWorkspaceRead: async (_id, read) => { if (session.workspace.restore) throw new WorkspaceRestoreError(409, "Workspace is being restored."); return read(session); },
  startTaskWorkspaceRestore: async (_id, request, author) => {
    const previous = session; session = beginWorkspaceRestore(session, request, author);
    return { session, started: previous !== session };
  },
  finishTaskWorkspaceRestore: async (_id, id, confirmed) => { session = confirmed ? completeWorkspaceRestore(session, id) : failWorkspaceRestore(session, id); return snapshot(); },
} });
const sandbox = {
  name: "hive-session-test-agent", get status() { return status; }, get tags() { return { session: foreign ? "other-task" : "restore-qa" }; },
  get currentSnapshotId() { return currentSnapshotId; }, keepLastSnapshots: { count: 3 },
  currentSession: () => ({ sourceSnapshotId }),
  listSnapshots: async () => ({ snapshots: [{ id: "snap-old", status: "created", createdAt: 1 }, { id: "snap-new", status: "created", createdAt: 2 }] }),
  stop: async () => { calls.push("stop"); status = "stopped"; currentSnapshotId = "snap-safety"; return { snapshot: { id: "snap-safety", status: "created", createdAt: 3 } }; },
  update: async (update) => {
    calls.push(update);
    if (update.keepLastSnapshots?.count === 3 && retentionFailure) throw new Error("Retention housekeeping failed");
    if (update.currentSnapshotId) { currentSnapshotId = update.currentSnapshotId; if (pointerFailure) throw new Error("PRIVATE PROVIDER ERROR after pointer update"); }
  },
};
mock.module("@vercel/sandbox", { namedExports: { Sandbox: { get: async ({ resume }) => { calls.push(resume ? "resume" : "metadata"); if (resume) { status = "running"; sourceSnapshotId = currentSnapshotId; } return sandbox; } } } });

function fresh() {
  session = createInitialTaskSessionState(1, "restore-qa");
  session.repository = { url: "https://github.com/spinsirr/hive.git" };
  for (const version of ["old", "new"]) session = applyHiveRunResult(session, {
    snapshot: { id: `snap-${version}`, createdAt: version === "old" ? 1 : 2 }, sandboxName: sandbox.name,
    agentSession: { id: "test-agent", runtime: "codex", resumeFrom: { type: "resume-session", harnessId: "codex", specificationVersion: "harness-v1", data: { thread: version, private: "NATIVE SECRET" } } },
    summary: version, diff: `+ ${version}`, files: [{ path: "nav.ts", content: version }], commands: [], changedFiles: ["nav.ts"],
  });
  // The VM can contain changes made since resuming the target. Matching only
  // sourceSnapshotId is not proof of restoration: it still has to stop/repoint.
  status = "running"; currentSnapshotId = "snap-new"; sourceSnapshotId = "snap-old";
  calls.length = 0; pointerFailure = false; retentionFailure = false; foreign = false;
}
try {
  const { NextRequest } = await import("next/server.js");
  const { POST } = await import("../src/app/api/sessions/[sessionId]/checkpoints/route.ts");
  const { GET: files } = await import("../src/app/api/sessions/[sessionId]/files/route.ts");
  const post = (body, origin = "https://hive.example") => POST(new NextRequest("https://hive.example/api/sessions/restore-qa/checkpoints", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }), { params: Promise.resolve({ sessionId: "restore-qa" }) });
  fresh();
  session.workspace.codingModel = "gpt-5.6-luna";
  session.workspace.codingEffort = "xhigh";
  const input = { id: "8d723141-b7ab-46fc-b6b8-2ff1e1a8ba4f", snapshotId: "snap-old", version: session.version };
  admitted = false; assert.equal((await post(input)).status, 401); admitted = true;
  assert.equal((await post(input, "https://attacker.example")).status, 403);
  assert.equal((await post({ snapshotId: "snap-old" })).status, 400);
  assert.equal((await post({ ...input, snapshotId: "foreign" })).status, 409);
  assert.equal((await post({ ...input, version: 0 })).status, 409);
  assert.equal(calls.length, 0, "Denied requests never touch the provider");
  const response = await post({ ...input, by: { id: "forged-author" } });
  assert.equal(response.status, 200);
  assert.equal(session.workspace.files[0].content, "old");
  assert.equal(session.workspace.codingModel, "gpt-5.6-luna");
  assert.equal(session.workspace.codingEffort, "xhigh", "Restoring files/history must not undo the team's current model preferences");
  assert.deepEqual(session.workspace.agentSession.resumeFrom.data, { thread: "old", private: "NATIVE SECRET" });
  assert.equal(session.workspace.lastRestore.by, "github-101");
  assert.equal(sourceSnapshotId, "snap-old");
  assert.ok(calls.indexOf("stop") < calls.findIndex((call) => call.currentSnapshotId === "snap-old"));
  assert.ok(calls.some((call) => call.keepLastSnapshots?.count === 10), "The safety save must not evict the selected target");
  assert.doesNotMatch(await response.text(), /NATIVE SECRET|resumeFrom|forged-author/);
  const previousCalls = calls.length;
  assert.equal((await post(input)).status, 200);
  assert.equal(calls.length, previousCalls, "Retrying a completed request never restores twice");
  console.log("PASS: restore enforces membership/origin/version, preserves author and native state, and waits for confirmed sandbox resume before publishing");

  fresh(); pointerFailure = true;
  const failed = await post({ ...input, version: session.version });
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE/);
  assert.equal(currentSnapshotId, "snap-old", "Simulate an ambiguous provider success");
  assert.equal(session.workspace.files[0].content, "new", "Unconfirmed restore is not reported as complete");
  assert.equal(session.workspace.restore.status, "unconfirmed");
  assert.equal((await files(new NextRequest("https://hive.example/api/sessions/restore-qa/files"), { params: Promise.resolve({ sessionId: "restore-qa" }) })).status, 409);
  assert.equal((await post(input)).status, 409, "The still-live worker cannot be retried concurrently");
  session.workspace.restore.retryAfter = 0; // Advance the durable worker-expiry boundary, without sleeping.
  pointerFailure = false;
  assert.equal((await post(input)).status, 200);
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  console.log("PASS: ambiguous provider failure fences file reads and agent work; the same operation safely retries after the worker expiry");

  fresh(); retentionFailure = true;
  assert.equal((await post({ ...input, version: session.version })).status, 200);
  assert.equal(session.workspace.restore, undefined);
  assert.equal(session.workspace.files[0].content, "old");
  console.log("PASS: retention housekeeping cannot misreport a confirmed restore as a failure");
} finally { mock.restoreAll(); }
