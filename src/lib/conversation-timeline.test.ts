import assert from "node:assert/strict";
import test from "node:test";
import { conversationTimelineMessages } from "./conversation-timeline.ts";
import type { ChatMessage } from "./task-session.ts";

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
