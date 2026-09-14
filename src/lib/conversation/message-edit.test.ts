import { taskExecution } from "../session/task-execution.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  appendHiveReply,
  createInitialTaskSessionState,
  didStartHiveRun,
  MessageEditError,
  reduceTaskSession,
  type MessageEdit,
} from "../session/task-session.ts";
import {
  buildHivePrompt,
  buildHiveRunInput,
} from "../../server/agents/hive-prompt.ts";

function fixture() {
  const running = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect navigation",
    },
    2
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Check keyboard focus",
    },
    3
  );
  const message = queued.messages.at(-1)!;
  const edit: MessageEdit = {
    messageId: message.id,
    expectedRevision: 0,
    queuedSteerId: queued.steeringQueue[0].id,
    body: "Check keyboard focus and Escape",
  };
  return { running, queued, message, edit };
}

test("an author edits queued input without moving it, interrupting a run, or changing another author's message", () => {
  const { queued, message, edit } = fixture();
  const next = reduceTaskSession(
    queued,
    { type: "edit-message", actor: "maya", ...edit },
    4
  );
  assert.equal(next.messages.at(-1)!.body, "Check keyboard focus and Escape");
  assert.equal(next.messages.at(-1)!.memberId, "maya");
  assert.equal(next.messages.at(-1)!.createdAt, message.createdAt);
  assert.deepEqual(next.messages.at(-1)!.edits, [
    { body: "Check keyboard focus", replacedAt: 4 },
  ]);
  assert.deepEqual(next.steeringQueue[0], {
    ...queued.steeringQueue[0],
    body: "Check keyboard focus and Escape",
  });
  assert.equal(
    next.messages.find((entry) => entry.memberId === "spencer"),
    queued.messages.find((entry) => entry.memberId === "spencer")
  );
  assert.equal(next.workspace, queued.workspace);
  assert.equal(taskExecution(next).kind, taskExecution(queued).kind);
  assert.equal(didStartHiveRun(queued, next), false);
  const finished = appendHiveReply(next, "Inspection finished", 5);
  const applied = reduceTaskSession(
    finished,
    { type: "apply-next-steer", actor: "spencer" },
    6
  );
  const input = buildHiveRunInput(
    applied,
    { type: "apply-next-steer", actor: "spencer" },
    []
  );
  assert.match(input.steer!, /Message author: Maya Chen/);
  assert.match(
    input.steer!,
    /Message to execute:\nCheck keyboard focus and Escape/
  );
});

test("editing completed discussion preserves execution evidence and marks subsequent context as an edit", () => {
  const { running } = fixture();
  const finished = appendHiveReply(running, "Inspection finished", 3);
  const next = reduceTaskSession(
    finished,
    {
      type: "edit-message",
      actor: "spencer",
      messageId: finished.messages.find(
        (entry) => entry.memberId === "spencer"
      )!.id,
      expectedRevision: 0,
      body: "Inspect the navigation only",
    },
    4
  );
  assert.equal(next.workspace, finished.workspace);
  assert.equal(taskExecution(next).kind, taskExecution(finished).kind);
  assert.equal(
    next.title,
    finished.title,
    "editing the first message does not rename the task"
  );
  assert.deepEqual(
    next.messages.map((entry) => [entry.id, entry.createdAt]),
    finished.messages.map((entry) => [entry.id, entry.createdAt]),
    "edits preserve message identity, order and original timestamps"
  );
  assert.equal(next.messages.at(-1), finished.messages.at(-1));
  assert.equal(didStartHiveRun(finished, next), false);
  const later = reduceTaskSession(
    next,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Summarize the changes",
    },
    5
  );
  assert.match(
    buildHivePrompt(later, "maya"),
    /Spencer Zhao · edited; discussion update, not a request to replay earlier work/
  );
});

test("teammates and spoofed authors cannot edit someone else's message or an agent reply", () => {
  const { queued, edit } = fixture();
  const finished = appendHiveReply(queued, "Agent evidence", 5);
  for (const action of [
    { type: "edit-message" as const, actor: "spencer", ...edit },
    {
      type: "edit-message" as const,
      actor: "maya",
      ...edit,
      messageId: finished.messages.find((entry) => entry.role === "agent")!.id,
    },
  ])
    assert.throws(
      () => reduceTaskSession(finished, action, 6),
      (error) => error instanceof MessageEditError && error.status === 403
    );
});

test("stale edits do not overwrite newer text, while retrying an acknowledged edit adds no revision", () => {
  const { queued, edit } = fixture();
  const action = { type: "edit-message" as const, actor: "maya", ...edit };
  const next = reduceTaskSession(queued, action, 4);
  assert.equal(reduceTaskSession(next, action, 5), next);
  assert.throws(
    () =>
      reduceTaskSession(
        next,
        { ...action, body: "An older browser overwrote this" },
        5
      ),
    (error) => error instanceof MessageEditError && error.status === 409
  );
});

test("a queued edit is rejected after application or cancellation instead of silently changing already-dispatched input", () => {
  const { queued, edit } = fixture();
  const finished = appendHiveReply(queued, "Inspection finished", 4);
  const applied = reduceTaskSession(
    finished,
    { type: "apply-next-steer", actor: "spencer" },
    5
  );
  const cancelled = reduceTaskSession(
    queued,
    {
      type: "remove-queued-steer",
      actor: "maya",
      steerId: edit.queuedSteerId!,
    },
    5
  );
  for (const state of [applied, cancelled])
    assert.throws(
      () =>
        reduceTaskSession(
          state,
          { type: "edit-message", actor: "maya", ...edit },
          6
        ),
      (error) => error instanceof MessageEditError && error.status === 409
    );
  assert.equal(applied.activeSteer!.body, "Check keyboard focus");
});

test("editing a parent never rewrites the frozen whole-thread steer", () => {
  const { running } = fixture();
  const parent = running.messages.find(
    (entry) => entry.memberId === "spencer"
  )!;
  let state = reduceTaskSession(
    running,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      messageId: parent.id,
      body: "Keep it small",
    },
    3
  );
  state = reduceTaskSession(
    state,
    {
      type: "steer-thread",
      actor: "maya",
      messageId: parent.id,
      throughReplyId: state.messages.find((entry) => entry.id === parent.id)!
        .annotations![0].id,
    },
    4
  );
  const frozen = state.steeringQueue[0];
  const edited = reduceTaskSession(
    state,
    {
      type: "edit-message",
      actor: "spencer",
      messageId: parent.id,
      expectedRevision: 0,
      body: "Changed discussion",
    },
    5
  );
  assert.deepEqual(edited.steeringQueue[0], frozen);
  assert.match(frozen.body, /Inspect navigation/);
  assert.doesNotMatch(frozen.body, /Changed discussion/);
});

test("empty and oversized edits are rejected without losing the saved original", () => {
  const { queued, edit } = fixture();
  for (const body of ["  ", "x".repeat(8_001)])
    assert.throws(
      () =>
        reduceTaskSession(
          queued,
          { type: "edit-message", actor: "maya", ...edit, body },
          4
        ),
      (error) => error instanceof MessageEditError && error.status === 400
    );
  assert.equal(queued.messages.at(-1)!.body, "Check keyboard focus");
});

test("restore receipts remain immutable even for their attributed member", () => {
  const { running } = fixture();
  const receipt = {
    ...running.messages[0],
    id: "restore-attempt-1",
    body: "Restored workspace and agent context",
  };
  const state = { ...running, messages: [...running.messages, receipt] };
  assert.throws(
    () =>
      reduceTaskSession(state, {
        type: "edit-message",
        actor: "spencer",
        messageId: receipt.id,
        expectedRevision: 0,
        body: "Changed receipt",
      }),
    (error) => error instanceof MessageEditError && error.status === 400
  );
});
