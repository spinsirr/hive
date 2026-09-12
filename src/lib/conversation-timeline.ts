import type { ChatMessage } from "./task-session.ts";
import { peerRequestKey } from "./peer-collaboration.ts";

/** Suppress only redundant, empty question cards, never discussion or evidence.
 * This is a timeline projection: the source messages and their IDs stay intact
 * for the Thread, queued work, and agent context.
 */
export function conversationTimelineMessages(messages: ChatMessage[]): ChatMessage[] {
  const questions = new Set<string>();
  return messages.filter((message) => {
    const question = message.interaction;
    const key = peerRequestKey(message);
    if (message.role !== "agent" || question?.kind !== "question" || !key) return true;
    const identity = JSON.stringify([key, message.body, question.targetMemberId, question.options]);
    const duplicate = questions.has(identity);
    questions.add(identity);
    return !duplicate || Boolean(message.annotations?.length || question.answer || message.threadSteer || message.subagents?.length || message.status || message.codeReference);
  });
}
