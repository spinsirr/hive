import type { ChatMessage } from "./task-session.ts";
import { peerRequestKey } from "./peer-collaboration.ts";

/** Suppress only redundant, empty question cards, never discussion or evidence.
 * This is a timeline projection: the source messages and their IDs stay intact
 * for the Thread, queued work, and agent context.
 */
export function conversationTimelineMessages(messages: ChatMessage[]): ChatMessage[] {
  const questions = new Set<string>();
  const messageIds = new Set(messages.map((message) => message.id));
  return messages.filter((message) => {
    if (message.threadId && messageIds.has(message.threadId)) return false;
    const question = message.interaction;
    const key = peerRequestKey(message);
    if (message.role !== "agent" || question?.kind !== "question" || !key) return true;
    const identity = JSON.stringify([key, message.body, question.targetMemberId, question.options]);
    const duplicate = questions.has(identity);
    questions.add(identity);
    return !duplicate || Boolean(message.annotations?.length || question.answer || message.threadSteer || message.subagents?.length || message.status || message.codeReference);
  });
}

export type ConversationTurn = { message: ChatMessage; requests: ChatMessage[] };

/** Group only adjacent records from the same native run. The agent's text can
 * arrive after its tool-created card; its stored ID is the ordering anchor,
 * never a timestamp or an inferred similarity between two messages.
 */
export function conversationTimelineTurns(messages: ChatMessage[]): ConversationTurn[] {
  const timeline = conversationTimelineMessages(messages);
  const turns: ConversationTurn[] = [];
  const runId = (message: ChatMessage) => message.role === "agent" && message.status !== "error"
    ? message.interaction?.runId ?? message.id : undefined;
  for (let index = 0; index < timeline.length;) {
    const start = index;
    const key = runId(timeline[index]);
    index += 1;
    while (key && index < timeline.length && runId(timeline[index]) === key) index += 1;
    const adjacent = timeline.slice(start, index);
    const root = adjacent.find((message) => !message.interaction && message.id === key);
    if (root) turns.push({ message: root, requests: adjacent.filter((message) => message !== root) });
    else turns.push(...adjacent.map((message) => ({ message, requests: [] })));
  }
  return turns;
}
