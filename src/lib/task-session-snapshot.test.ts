import assert from "node:assert/strict";
import test from "node:test";

import { createInitialTaskSessionState, reduceTaskSession } from "./task-session.ts";
import { publicTaskSessionSnapshot, receiveTaskSessionSnapshot } from "./task-session-snapshot.ts";
import type { TaskSessionSnapshot } from "./task-session-store.ts";

function snapshot(sessionId = "shared-task"): TaskSessionSnapshot {
  return {
    session: createInitialTaskSessionState(1, sessionId),
    members: [],
    activeMembers: [],
    typingMembers: [],
  };
}

test("late polling, action, and broadcast responses cannot roll back team messages", async () => {
  const before = snapshot();
  const after = {
    ...before,
    session: reduceTaskSession(before.session, { type: "send-message", actor: "spencer", body: "Fix the navigation" }, 2),
  };

  for (const source of ["poll", "action", "broadcast"]) {
    let current = before;
    let deliverOld!: (value: TaskSessionSnapshot) => void;
    const pendingOldResponse = new Promise<TaskSessionSnapshot>((resolve) => { deliverOld = resolve; })
      .then((incoming) => { current = receiveTaskSessionSnapshot(current, incoming); });
    current = receiveTaskSessionSnapshot(current, after);
    deliverOld(before);
    await pendingOldResponse;
    assert.deepEqual(current.session.messages, after.session.messages, source);
    assert.equal(current.session.stage, "running", source);
  }
});

test("same-version presence updates still refresh without changing the transcript", () => {
  const before = snapshot();
  const incoming = { ...before, activeMembers: ["spencer"], typingMembers: ["spencer"] };
  assert.deepEqual(receiveTaskSessionSnapshot(before, incoming), incoming);
});

test("a late response from another task never replaces the current task", () => {
  const current = snapshot("current-task");
  const other = snapshot("other-task");
  other.session.version = 100;
  assert.equal(receiveTaskSessionSnapshot(current, other), current);
});

test("reset advances the synchronization version even without an attached repository", () => {
  const before = snapshot();
  const changed = reduceTaskSession(before.session, { type: "send-message", actor: "spencer", body: "Discuss the task" }, 2);
  const reset = reduceTaskSession(changed, { type: "reset", actor: "spencer" }, 3);
  assert.equal(reset.version, changed.version + 1);
  assert.equal(receiveTaskSessionSnapshot({ ...before, session: changed }, { ...before, session: reset }).session, reset);
});

test("page and API snapshots preserve history but never serialize the Codex checkpoint", () => {
  const stored = snapshot();
  stored.session.workspace.agentSession = {
    id: "hive-codex-session",
    runtime: "codex",
    resumeFrom: {
      type: "resume-session",
      specificationVersion: "harness-v1",
      harnessId: "codex",
      data: { privateCheckpoint: "server-only-checkpoint-fixture" },
    },
  };
  const projected = publicTaskSessionSnapshot(stored);
  assert.deepEqual(projected.session.messages, stored.session.messages);
  assert.deepEqual(projected.session.workspace.agentSession, { id: "hive-codex-session", runtime: "codex" });
  assert.equal(JSON.stringify(projected).includes("server-only-checkpoint-fixture"), false);
  assert.ok(stored.session.workspace.agentSession.resumeFrom, "projection must not mutate stored recovery state");
});
