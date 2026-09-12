import assert from "node:assert/strict";
import test from "node:test";
import { conversationTimelineMessages, conversationTimelineTurns } from "./conversation-timeline.ts";
import type { ChatMessage } from "./task-session.ts";

test("workspace receipts stay in stored context without masquerading as chat replies", () => {
  const connected: ChatMessage = { id: "connected", event: "repository-connected", role: "agent", name: "Hive", initials: "H", time: "", body: "Ada connected the repository." };
  const restored: ChatMessage = { ...connected, id: "restore-operation", event: "workspace-restored", role: "human", memberId: "ada" };
  const human: ChatMessage = { ...connected, id: "human", event: undefined, role: "human", body: "Please restore the workspace." };
  const messages = [connected, restored, human];
  assert.deepEqual(conversationTimelineMessages(messages), [human]);
  assert.equal(messages.length, 3, "audit/context records are retained");
});

function question(runId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `peer-${runId}-close_tab`, role: "agent", name: "Hive", initials: "H", time: "", body: "Should we close the tab?",
    interaction: { kind: "question", runId, targetMemberId: "casey", options: ["Yes", "No"] }, ...extra };
}

test("an exact repeated empty question has one timeline entry without changing stored history", () => {
  const original = question("one", { annotations: [{ id: "reply", authorId: "alex", body: "Let's discuss", createdAt: 1, status: "open" }] });
  const duplicate = question("two");
  const messages = [original, duplicate];
  const before = structuredClone(messages);
  assert.deepEqual(conversationTimelineMessages(messages), [original]);
  assert.deepEqual(messages, before);
});

test("never hide replies, answers, steers, live work, or different decisions", () => {
  const original = question("one");
  const reply = { id: "reply", authorId: "casey", body: "Yes", createdAt: 1, status: "open" as const };
  const variants = [
    question("two", { annotations: [reply] }),
    question("two", { interaction: { kind: "question", runId: "two", options: ["Yes", "No"], targetMemberId: "casey", answer: { by: "casey", replyId: "reply", at: 1 } } }),
    question("two", { threadSteer: { id: "steer", throughReplyId: "reply", replyCount: 1, requestedBy: "alex", requestedAt: 1, status: "steered" } }),
    question("two", { status: "streaming" }),
    question("two", { body: "A different question" }),
    question("two", { interaction: { kind: "question", runId: "two", targetMemberId: "alex", options: ["Yes", "No"] } }),
    question("two", { interaction: { kind: "question", runId: "two", targetMemberId: "casey", options: ["Yes", "Later"] } }),
    question("two", { id: "peer-two-another_decision" }),
    question("two", { id: "unknown-identity" }),
    question("two", { interaction: { kind: "review", runId: "two", options: [], status: "open", revision: "two" } }),
  ];
  for (const different of variants) assert.deepEqual(conversationTimelineMessages([original, different]), [original, different]);
});

const turn = (id: string): ChatMessage => ({ id, role: "agent", name: "Hive", initials: "H", time: "", body: "Let's agree on the behavior." });

test("a tool-created question stays with its run even when the final text arrives later", () => {
  const card = question("run", { annotations: [{ id: "reply", authorId: "casey", body: "Yes", createdAt: 1, status: "open" }] });
  const root = turn("run");
  for (const messages of [[card, root], [root, card], [card, { ...root, status: "streaming" as const }]]) {
    const before = structuredClone(messages);
    const [group] = conversationTimelineTurns(messages);
    assert.equal(group.message.id, "run");
    assert.deepEqual(group.requests, [card]);
    assert.deepEqual(messages, before, "presentation never rewrites history or reply IDs");
  }
});

test("grouping never crosses human contributions or combines unrelated agent runs", () => {
  const card = question("run");
  const root = turn("run");
  const human: ChatMessage = { id: "human", role: "human", name: "Casey", initials: "CA", time: "", body: "Keep focus visible." };
  for (const messages of [[card], [card, human, root], [card, turn("other")], [card, { ...root, status: "error" as const }]]) {
    assert.deepEqual(conversationTimelineTurns(messages), messages.map((message) => ({ message, requests: [] })));
  }
});

test("multiple requests retain their individual Thread identities inside one turn", () => {
  const root = turn("run");
  const first = question("run");
  const second = question("run", { id: "peer-run-other", body: "What about focus?" });
  assert.deepEqual(conversationTimelineTurns([first, second, root]), [{ message: root, requests: [first, second] }]);
});
