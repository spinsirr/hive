import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialTaskSessionState,
  reduceTaskSession,
} from "../../lib/session/task-session.ts";
import { taskExecution } from "../../lib/session/task-execution.ts";
import { sessionState, sessionValues } from "./task-session-row.ts";

function oldRow() {
  return {
    ...sessionValues(createInitialTaskSessionState(1, "historical-task")),
    lifecycle: "completed" as const,
    completedAt: new Date(2),
    revision: 2,
    stage: "approved",
    annotation: { status: "steered", text: "Historical Preview note" },
  };
}

test("retired prototype fields cannot override execution evidence or enter new snapshots", () => {
  const row = oldRow();
  const state = sessionState({
    ...row,
    workspace: {
      ...row.workspace,
      status: "running",
      startedAt: 10,
      completedAt: 20,
    },
  });
  assert.deepEqual(taskExecution(state), {
    kind: "completed",
    completedAt: 20,
  });
  for (const field of ["stage", "revision", "annotation", "lifecycle"]) {
    assert.equal(Object.hasOwn(state, field), false);
    assert.equal(Object.hasOwn(sessionValues(state), field), false);
  }
  assert.equal(Object.hasOwn(state.workspace, "status"), false);
  assert.equal(row.annotation.text, "Historical Preview note");
});

test("old failures retain their execution fence after display status is removed", () => {
  const row = oldRow();
  const state = sessionState({
    ...row,
    workspace: { ...row.workspace, status: "error", completedAt: 20 },
  });
  assert.deepEqual(taskExecution(state), { kind: "failed", error: "" });
  const saved = sessionValues(state);
  assert.equal(Object.hasOwn(saved.workspace, "status"), false);
  assert.deepEqual(sessionState({ ...row, ...saved }), state);
});

test("historically accepted Preview input still executes with its frozen body and author", () => {
  const state = sessionState({
    ...oldRow(),
    steeringQueue: [
      {
        id: "old-steer",
        body: "Keep the selected child highlighted",
        authorId: "maya",
        queuedAt: 10,
        source: { kind: "workspace-annotation" },
        sourceLabel: "Preview annotation",
      },
    ],
  });
  const next = reduceTaskSession(
    state,
    { type: "apply-next-steer", actor: "spencer" },
    30
  );
  assert.deepEqual(next.activeSteer, {
    ...state.steeringQueue[0],
    appliedAt: 30,
  });
  assert.equal(next.steeringQueue.length, 0);
  assert.deepEqual(taskExecution(next), { kind: "running", startedAt: 30 });
});
