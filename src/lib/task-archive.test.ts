import assert from "node:assert/strict";
import test from "node:test";
import { canApplyNextSteer, canArchiveTask, canSelectHarness, canSetCodingEffort, createInitialTaskSessionState, didStartHiveRun, memberDirectory, reduceTaskSession, taskActionBlockReason, type TaskSessionAction } from "./task-session.ts";
import { beginWorkspaceRestore } from "./workspace-restore-state.ts";
import { createDemoWorkspace, demoMembers } from "./demo-workspace.ts";
import { demoTasks, demoTaskHref } from "./ui-demo.ts";

const members = Object.values(memberDirectory);
const actor = members[0].id;
const other = members[1].id;
const initial = createInitialTaskSessionState(1);

test("team archive and restore preserve work, are idempotent and never grant execution", () => {
  const archived = reduceTaskSession(initial, { type: "archive-task", actor }, 2, members);
  assert.deepEqual(archived.archived, { by: actor, at: 2 });
  assert.equal(archived.version, initial.version + 1);
  assert.equal(archived.messages, initial.messages);
  assert.equal(archived.workspace, initial.workspace);
  assert.equal(didStartHiveRun(initial, archived), false);
  assert.equal(reduceTaskSession(archived, { type: "archive-task", actor: other }, 3, members), archived);
  assert.equal(reduceTaskSession(archived, { type: "restore-task", actor: "outsider" }, 3, members), archived);
  assert.equal(reduceTaskSession(initial, { type: "archive-task", actor: "outsider" }, 3, members), initial);
  const restored = reduceTaskSession(archived, { type: "restore-task", actor: other }, 4, members);
  assert.equal(restored.archived, undefined);
  assert.equal(restored.version, archived.version + 1);
  assert.equal(restored.workspace, initial.workspace);
  assert.equal(restored.messages, initial.messages);
  assert.equal(restored.stage, initial.stage);
  assert.equal(didStartHiveRun(archived, restored), false);
  assert.equal(reduceTaskSession(restored, { type: "restore-task", actor }, 5, members), restored);
});

test("archives reject every task mutation and checkpoint rollback until restored", () => {
  const archived = reduceTaskSession(initial, { type: "archive-task", actor }, 2, members);
  // Exhaustive union: adding a new action must explicitly classify its archive behavior.
  const actions: Record<TaskSessionAction["type"], boolean> = {
    "archive-task": true, "restore-task": true,
    "select-harness": false, "set-coding-effort": false, "recover-stalled-run": false,
    reset: false, "connect-repository": false, "send-message": false, "annotate-code": false,
    "annotate-message": false, "answer-question": false, "resolve-peer-review": false,
    "steer-thread": false, "steer-message-annotation": false, "steer-agent": false,
    "apply-next-steer": false, "continue-peer-response": false, "remove-queued-steer": false,
    "reorder-queued-steer": false,
  };
  for (const [type, allowed] of Object.entries(actions)) {
    // Blocked actions are rejected before their payload is inspected.
    const action = { type, actor: other } as TaskSessionAction;
    assert.equal(Boolean(taskActionBlockReason(archived, action)), !allowed, type);
    if (!allowed) assert.equal(reduceTaskSession(archived, action, 3, members), archived, type);
  }
  for (const allowed of [canApplyNextSteer, canArchiveTask, canSelectHarness, canSetCodingEffort]) assert.equal(allowed(archived), false);
  assert.throws(() => beginWorkspaceRestore(archived, { id: crypto.randomUUID(), snapshotId: "old", version: archived.version }, members[0]), /archived/);
});

test("active work, pending instructions and uncertain recovery must finish before archiving", () => {
  const running = reduceTaskSession(initial, { type: "send-message", actor, body: "Inspect the project" }, 3, members);
  const queued = reduceTaskSession(running, { type: "send-message", actor: other, body: "Check tests" }, 4, members);
  const recovery = { ...initial, workspace: { ...initial.workspace, restore: { id: "restore", snapshotId: "old", by: members[0], startedAt: 1, retryAfter: 5, status: "unconfirmed" as const } } };
  for (const state of [running, queued, { ...initial, steeringQueue: queued.steeringQueue }, recovery]) {
    assert.equal(canArchiveTask(state), false);
    assert.equal(reduceTaskSession(state, { type: "archive-task", actor }, 10, members), state);
  }
});

test("archived demo uses production read-only rules, keeps files visible and supports teammate restore", async () => {
  const task = { ...demoTasks[0], archivedAt: 123 };
  assert.equal(demoTaskHref(task), "/demo/tasks/demo-menu?archived=1");
  const demo = createDemoWorkspace(task);
  const initial = demo.getSnapshot();
  assert.ok(initial.session.archived);
  const base = `/api/sessions/${initial.session.sessionId}`;
  assert.equal((await demo.client.request(`${base}/files?kind=file&path=src/components/settings-nav.tsx`)).status, 200);
  assert.equal((await demo.client.request(`${base}/checkpoints`)).status, 200);
  assert.equal((await demo.client.request(`${base}/checkpoints`, { method: "POST" })).status, 409);
  assert.equal((await demo.client.request(`/api/github/repositories?session_id=${initial.session.sessionId}`, { method: "POST", body: '{"repositoryId":1}' })).status, 409);
  await demo.dispatch({ type: "send-message", body: "Should not run" });
  assert.equal(demo.getSnapshot(), initial);
  demo.setMember(demoMembers[1].id);
  await demo.dispatch({ type: "restore-task" });
  assert.equal(demo.getSnapshot().session.archived, undefined);
  assert.equal(demo.getSnapshot().session.workspace.liveReply, undefined);
  assert.equal(demo.getSnapshot().session.messages, initial.session.messages);
});
