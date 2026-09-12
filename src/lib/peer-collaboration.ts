import { z } from "zod";
import type { ChatMessage, TaskSessionState, TeamMember } from "./task-session.ts";
import type { HiveToolScope } from "./hive-tool-token.ts";

export const peerRequestSchema = z.object({
  kind: z.enum(["question", "review"]).optional(),
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  prompt: z.string().trim().min(1).max(4000),
  targetMemberId: z.string().min(1).max(80).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(4).optional(),
}).strict();
export type PeerRequest = z.infer<typeof peerRequestSchema>;
type PeerRequestIdentity = {
  runId: string;
  targetMemberId?: string;
  options: string[];
};
export type PeerInteraction = PeerRequestIdentity & ({
  kind: "question";
  answer?: { replyId: string; by: string; at: number };
  revision?: never;
  resolved?: never;
  status?: never;
} | {
  kind: "review";
  status: "preparing" | "open" | "unavailable";
  revision?: string;
  coveredThroughReplyId?: string;
  resolved?: { by: string; at: number };
  answer?: never;
});

/** Called under the task/membership lock; the key belongs to this run, not to the transport. */
export function requestPeerInput(state: TaskSessionState, scope: HiveToolScope, input: PeerRequest, members: TeamMember[], now: number) {
  const request = peerRequestSchema.parse(input);
  const kind = request.kind ?? "question";
  if (state.archived || state.sessionId !== scope.sessionId || state.workspace.liveReply?.id !== scope.runId || state.stage !== "running" || state.workspace.restore || !members.some((m) => m.id === scope.memberId)) throw new Error("Run no longer active.");
  if (request.targetMemberId && !members.some((m) => m.id === request.targetMemberId)) throw new Error("Choose a task member.");
  const messageId = `peer-${scope.runId}-${request.key}`;
  const previous = state.messages.find((message) => message.id === messageId);
  if (previous) {
    if (previous.body !== request.prompt || previous.interaction?.kind !== kind || previous.interaction?.targetMemberId !== request.targetMemberId || JSON.stringify(previous.interaction?.options) !== JSON.stringify(request.options ?? [])) throw new Error("Request key already used. Read the existing thread.");
    return { session: state, messageId };
  }
  if (state.messages.filter((message) => message.interaction?.runId === scope.runId).length >= 4) throw new Error("At most four requests per turn.");
  const message: ChatMessage = {
    id: messageId, role: "agent", name: "Hive", initials: "H", body: request.prompt,
    time: new Date(now).toISOString(), createdAt: now,
    interaction: kind === "review"
      ? { kind, runId: scope.runId, targetMemberId: request.targetMemberId, options: [], status: "preparing" }
      : { kind, runId: scope.runId, targetMemberId: request.targetMemberId, options: request.options ?? [] },
  };
  return { session: { ...state, messages: [...state.messages, message], version: state.version + 1, updatedAt: now }, messageId };
}

export function canResolvePeerReview(state: TaskSessionState, message: ChatMessage, actor: string, revision: string) {
  const review = message.interaction;
  if (state.archived || review?.kind !== "review" || review.status !== "open" || review.resolved || !revision || review.revision !== revision || state.workspace.reviewRevision !== revision ||
    state.workspace.restore || state.workspace.status === "error" || state.activeSteer || state.steeringQueue.length ||
    (state.stage === "running" && state.workspace.completedAt === undefined) ||
    (review.targetMemberId && review.targetMemberId !== actor)) return false;
  const replies = message.annotations ?? [];
  const covered = replies.findIndex((reply) => reply.id === review.coveredThroughReplyId);
  return !replies.some((reply, index) => reply.role !== "agent" && index > covered && reply.status !== "steered");
}

/** Bind the review only after actual workspace evidence was collected. */
export function finishPeerReviews(state: TaskSessionState, messages: ChatMessage[], succeeded: boolean): ChatMessage[] {
  const run = state.workspace.liveReply;
  if (!run) return messages;
  return messages.map((message) => {
    const review = message.interaction;
    if (review?.kind !== "review" || !((review.runId === run.id && review.status === "preparing") || message.id === run.threadId)) return message;
    const source = state.activeSteer?.source;
    return { ...message, interaction: { ...review, status: succeeded ? "open" : "unavailable", revision: succeeded ? run.id : undefined, resolved: undefined,
      coveredThroughReplyId: succeeded && source?.kind === "message-thread" && source.messageId === message.id ? source.throughReplyId : review.coveredThroughReplyId,
    } };
  });
}
