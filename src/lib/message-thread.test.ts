import assert from "node:assert/strict";
import test from "node:test";
import { buildHiveRunInput } from "./hive-prompt.ts";
import { appendHiveReply, createInitialTaskSessionState, isHiveRunActive, reduceTaskSession, resolveMember, type TaskSessionState } from "./task-session.ts";

function discussion(busy = false) {
  let session = reduceTaskSession(createInitialTaskSessionState(1), { type: "send-message", actor: "spencer", body: "Review the navigation" }, 2);
  if (!busy) session = appendHiveReply(session, "Keep the keyboard focus indicator.", 3);
  const parent = session.messages.at(-1)!;
  session = reduceTaskSession(session, { type: "annotate-message", actor: "maya", messageId: parent.id, body: "Make the menu compact", clientId: "reply-one" }, 4);
  session = reduceTaskSession(session, { type: "annotate-message", actor: "spencer", messageId: parent.id, body: "Keep enough space for the labels", clientId: "reply-two" }, 5);
  return { session, messageId: parent.id, throughReplyId: session.messages.at(-1)!.annotations!.at(-1)!.id };
}

test("people can reply to a completed agent message without waking Hive or losing earlier replies", () => {
  const { session, messageId } = discussion();
  const parent = session.messages.find((message) => message.id === messageId)!;
  assert.equal(parent.role, "agent");
  assert.deepEqual(parent.annotations!.map((reply) => [reply.authorId, reply.body]), [["maya", "Make the menu compact"], ["spencer", "Keep enough space for the labels"]]);
  assert.equal(isHiveRunActive(session), false);
  assert.equal(session.steeringQueue.length, 0);
  const retry = reduceTaskSession(session, { type: "annotate-message", actor: "maya", messageId, body: "Make the menu compact", clientId: "reply-one" }, 6);
  assert.equal(retry, session);
  assert.equal(reduceTaskSession(session, { type: "annotate-message", actor: "maya", messageId, body: "x".repeat(4001) }, 7), session);
});

for (const busy of [false, true]) {
  test(`${busy ? "queued" : "immediate"} whole-thread steering preserves all authors and freezes the clicked reply boundary`, () => {
    const fixture = discussion(busy);
    const { messageId, throughReplyId } = fixture;
    let session = fixture.session;
    // Another member's reply reaches the server before this click does.
    session = reduceTaskSession(session, { type: "annotate-message", actor: "maya", messageId, body: "LATER: also change the footer" }, 6);
    const action = { type: "steer-thread" as const, actor: "maya", messageId, throughReplyId };
    let steered = reduceTaskSession(session, action, 7);
    assert.equal(reduceTaskSession(steered, action, 8), steered, "Duplicate clicks never add a second steer");
    assert.equal(steered.messages.find((message) => message.id === messageId)!.threadSteer!.replyCount, 2);
    if (busy) {
      assert.equal(steered.workspace.startedAt, session.workspace.startedAt, "The active run is not interrupted");
      assert.equal(steered.steeringQueue.length, 1);
      steered = appendHiveReply(steered, "Previous run finished", 9);
      steered = reduceTaskSession(steered, { type: "apply-next-steer", actor: "spencer" }, 10);
    }
    const input = buildHiveRunInput(steered, busy ? { type: "apply-next-steer", actor: "spencer" } : action, []);
    assert.match(input.steer!, /Make the menu compact/);
    assert.match(input.steer!, /Keep enough space for the labels/);
    assert.match(input.steer!, /Maya Chen/);
    assert.match(input.steer!, /Spencer Zhao/);
    assert.match(input.steer!, /If requirements conflict, ask for clarification/);
    assert.match(input.steer!, /handing this discussion back to the main conversation/);
    assert.doesNotMatch(input.steer!, /LATER|also change the footer/);
    assert.equal(isHiveRunActive(steered), true);
  });
}

test("removing a queued thread makes it steerable again without deleting discussion", () => {
  const { session, messageId, throughReplyId } = discussion(true);
  const action = { type: "steer-thread" as const, actor: "maya", messageId, throughReplyId };
  const queued = reduceTaskSession(session, action, 6);
  const removed = reduceTaskSession(queued, { type: "remove-queued-steer", actor: "spencer", steerId: queued.steeringQueue[0].id }, 7);
  assert.equal(removed.messages.at(-1)!.threadSteer, undefined);
  assert.deepEqual(removed.messages.at(-1)!.annotations, session.messages.at(-1)!.annotations);
  assert.equal(reduceTaskSession(removed, action, 8).steeringQueue.length, 1);
});

test("unknown reply boundaries and restoring tasks cannot trigger whole-thread execution", () => {
  const { session, messageId, throughReplyId } = discussion();
  assert.equal(reduceTaskSession(session, { type: "steer-thread", actor: "maya", messageId, throughReplyId: "not-a-reply" }, 6), session);
  const restoring: TaskSessionState = { ...session, workspace: { ...session.workspace, restore: { id: "restore-one", snapshotId: "snapshot-one", by: resolveMember("spencer"), startedAt: 5, retryAfter: 90_005, status: "restoring" } } };
  assert.equal(reduceTaskSession(restoring, { type: "steer-thread", actor: "maya", messageId, throughReplyId }, 6), restoring);
});

test("an agent acknowledgement alone cannot re-steer the same discussion", () => {
  const { session, messageId, throughReplyId } = discussion();
  const steered = reduceTaskSession(session, { type: "steer-thread", actor: "maya", messageId, throughReplyId }, 6);
  steered.workspace.liveReply = { id: "thread-run", threadId: messageId, body: "", startedAt: 6, sequence: 0 };
  const finished = appendHiveReply(steered, "I will keep labels readable.", 7);
  const agentReply = finished.messages.find((message) => message.id === messageId)!.annotations!.at(-1)!;
  assert.equal(reduceTaskSession(finished, { type: "steer-thread", actor: "maya", messageId, throughReplyId: agentReply.id }, 8), finished);
  const feedback = reduceTaskSession(finished, { type: "annotate-message", actor: "maya", messageId, body: "Also keep focus visible" }, 9);
  const lastReply = feedback.messages.find((message) => message.id === messageId)!.annotations!.at(-1)!;
  const next = reduceTaskSession(feedback, { type: "steer-thread", actor: "maya", messageId, throughReplyId: lastReply.id }, 10);
  assert.match(next.activeSteer!.body, /Also keep focus visible/);
  assert.match(next.activeSteer!.body, /Previously shared discussion is context/);
});

test("whole-thread handoff rejects partial streaming content and freezes inline question context", () => {
  const { session, messageId, throughReplyId } = discussion();
  const partial = structuredClone(session);
  partial.messages.find((message) => message.id === messageId)!.annotations![0].deliveryStatus = "streaming";
  assert.equal(reduceTaskSession(partial, { type: "steer-thread", actor: "maya", messageId, throughReplyId }, 6), partial);
  session.messages.push({ id: "child-question", threadId: messageId, role: "agent", initials: "H", name: "Hive", body: "Which density?", time: "12:00", createdAt: 4,
    interaction: { kind: "question", runId: "prior-run", options: [], answer: { replyId: "answer", by: "maya", at: 4 } },
    annotations: [{ id: "answer", authorId: "maya", body: "Compact", createdAt: 4, status: "steered" }] });
  session.messages.push({ ...session.messages.at(-1)!, id: "later-question", body: "LATER-QUESTION", createdAt: 9 });
  const steered = reduceTaskSession(session, { type: "steer-thread", actor: "maya", messageId, throughReplyId }, 10);
  assert.match(steered.activeSteer!.body, /Which density\?/);
  assert.match(steered.activeSteer!.body, /Compact/);
  assert.doesNotMatch(steered.activeSteer!.body, /LATER-QUESTION/);
});
