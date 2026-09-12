"use client";

import { ArrowUp, LoaderCircle, MessageSquare, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { AgentResponse } from "@/components/hive/agent-response";
import { MentionInput } from "@/components/hive/mention-input";
import { MessageTime } from "@/components/hive/message-time";
import { ThreadReply } from "@/components/hive/thread-reply";
import { PeerRequestSummary } from "@/components/hive/peer-request-summary";
import { QuestionAnswer } from "@/components/hive/question-answer";
import { ConversationMessage } from "@/components/hive/conversation-message";
import { Button } from "@/components/ui/button";
import { useMessageDraft } from "@/hooks/use-message-draft";
import { codeReferenceLabel } from "@/lib/code-reference";
import type { MessageSubmission } from "@/lib/message-draft";
import { resolveMember, type ChatMessage, type SteeringQueueItem, type TeamMember } from "@/lib/task-session";

export function MessageThread({ sessionId, message, requests = [], members, currentMember, disabled, runActive, replying = false, queue, onClose, onReply, onAnswerQuestion, onSteerThread, reviewReady = false, reviewCurrent = false, onViewChanges, onResolveReview }: {
  sessionId: string;
  message: ChatMessage;
  requests?: ChatMessage[];
  members: TeamMember[];
  currentMember: string;
  disabled: boolean;
  runActive: boolean;
  replying?: boolean;
  queue: SteeringQueueItem[];
  onClose: () => void;
  onReply: (messageId: string, submission: MessageSubmission) => Promise<boolean>;
  onAnswerQuestion?: (messageId: string, submission: MessageSubmission, replyThreadId?: string) => Promise<boolean>;
  reviewReady?: boolean;
  reviewCurrent?: boolean;
  onViewChanges?: () => void;
  onResolveReview?: (messageId: string, revision: string) => Promise<boolean>;
  onSteerThread: (messageId: string, throughReplyId: string) => Promise<boolean>;
}) {
  const replies = message.annotations;
  const question = message.interaction?.kind === "question" ? message.interaction : undefined;
  const review = message.interaction?.kind === "review" ? message.interaction : undefined;
  const waitingFor = question && !question.answer && question.targetMemberId && question.targetMemberId !== currentMember ? resolveMember(question.targetMemberId, members).shortName : null;
  const deliveredIds = useMemo(() => new Set((replies ?? []).filter((reply) => reply.authorId === currentMember && reply.clientId).map((reply) => reply.clientId!)), [currentMember, replies]);
  const send = useCallback((submission: MessageSubmission) => onReply(message.id, submission), [message.id, onReply]);
  // Keep existing annotation drafts when upgrading the presentation to threads.
  const { draft, edit, submit } = useMessageDraft(`hive-draft:v1:${sessionId}:${currentMember}:annotation:${message.id}`, deliveredIds, send);
  const [steering, setSteering] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const sending = draft?.status === "sending";
  const lastReply = replies?.at(-1);
  const previous = message.threadSteer;
  const previousIndex = replies?.findIndex((reply) => reply.id === previous?.throughReplyId) ?? -1;
  const alreadySteered = Boolean(previous && !(replies ?? []).slice(previousIndex + 1).some((reply) => reply.role !== "agent"));
  const responseInProgress = replies?.some((reply) => reply.deliveryStatus === "streaming");
  const hasQuestionFollowUp = !question || (replies ?? []).some((reply, index, all) => reply.role !== "agent" && index > all.findIndex((entry) => entry.id === question.answer?.replyId));
  const queueing = runActive || queue.length > 0;
  const steerAll = async () => {
    if (!lastReply || disabled || steering || alreadySteered || responseInProgress) return;
    setSteering(true);
    setError("");
    try {
      if (!await onSteerThread(message.id, lastReply.id)) setError("The thread could not be steered. Reconnect and retry. If the discussion is too long, start a new thread with a summary.");
    } finally { setSteering(false); }
  };
  const resolveReview = async () => {
    if (!review?.revision || !reviewReady || !onResolveReview || resolving) return;
    setResolving(true);
    setError("");
    try {
      if (!await onResolveReview(message.id, review.revision)) setError("The review changed. Check the latest changes and replies before verifying again.");
    } finally { setResolving(false); }
  };

  return (
    <section aria-label="Message thread" className="flex h-full min-h-0 flex-col bg-white" onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault();
        onClose();
      }
    }}>
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#ebebeb] px-4">
        <h2 className="flex items-center gap-2 text-xs font-semibold"><MessageSquare className="size-3.5 text-[#737373]" /> Thread</h2>
        <Button aria-label="Close thread" className="size-7" onClick={onClose} size="icon" variant="ghost"><X className="size-3.5" /></Button>
      </header>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-5 px-3 py-5 sm:px-5">
          <article className="border-b border-[#ebebeb] pb-5">
            <PeerRequestSummary message={message} members={members} />
            <div className="mb-2 flex items-center gap-2 text-xs"><span className="grid size-6 shrink-0 place-items-center rounded-full border border-[#dedede] bg-[#fafafa] text-xs font-medium">{message.initials}</span><span className="font-medium">{message.name}</span><MessageTime className="text-[#999]" message={message} /></div>
            <div className="min-w-0 break-words text-sm leading-6">
              {message.role === "agent" ? <AgentResponse>{message.body}</AgentResponse> : message.codeReference ? <><p className="break-all text-xs text-[#737373]">{codeReferenceLabel(message.codeReference)}</p><pre className="mt-2 max-h-52 overflow-auto font-mono text-xs leading-5">{message.codeReference.quote}</pre></> : <p className="whitespace-pre-wrap">{message.body}</p>}
            </div>
            {question && onAnswerQuestion ? <div className="mt-3"><QuestionAnswer currentMember={currentMember} disabled={disabled} members={members} message={message} onAnswer={onAnswerQuestion} replyThreadId={message.id} sessionId={sessionId} /></div> : null}
            {review ? <div className="mt-4 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
              <p className="text-xs leading-5 text-[#737373]">{review.resolved ? "This revision was verified by a teammate. This does not approve or merge a pull request." : review.status === "preparing" ? "The review will open when Hive saves this turn’s real workspace changes." : review.status === "unavailable" ? "No completed review evidence. Continue the task and ask Hive to request review again." : !reviewCurrent ? "The workspace has moved on. Ask Hive to refresh this review against the current changes." : "Review the current diff, share feedback with Hive, then verify the returned revision. New discussion must be addressed first."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {onViewChanges ? <Button size="sm" variant="outline" onClick={onViewChanges}>View changes</Button> : null}
                {onResolveReview && !review.resolved ? <Button size="sm" disabled={disabled || !reviewReady || resolving} onClick={() => void resolveReview()}>{resolving ? "Verifying…" : "Verify & resolve"}</Button> : null}
              </div>
            </div> : null}
          </article>
          {!(replies?.length || requests.length) ? <p className="text-xs text-[#737373]">Start a discussion about this message.</p> : null}
          {[
            ...(replies ?? []).filter((reply) => reply.id !== question?.answer?.replyId).map((reply) => ({ id: reply.id, at: reply.createdAt, content: <ThreadReply members={members} reply={reply} showTimestamp /> })),
            ...requests.map((request) => ({ id: request.id, at: request.createdAt ?? 0, content: <ConversationMessage currentMember={currentMember} disabled={disabled} members={members} message={request} onAnswerQuestion={onAnswerQuestion} onOpenThread={() => {}} runActive={runActive} selected={false} sessionId={sessionId} /> })),
          ].sort((a, b) => a.at - b.at).map((entry) => <div key={entry.id}>{entry.content}</div>)}
          {replying && !responseInProgress ? <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> Hive is replying in this thread…</p> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <footer className="shrink-0 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
        {lastReply ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#737373]">{previous ? `${previous.replyCount} ${previous.replyCount === 1 ? "reply" : "replies"} ${previous.status === "queued" ? "queued" : "steered"} by ${resolveMember(previous.requestedBy, members).shortName}` : `${replies!.length} ${replies!.length === 1 ? "reply" : "replies"}`}</p>
          {hasQuestionFollowUp ? <Button aria-label={`${queueing ? "Queue" : "Steer"} entire thread with ${replies!.length} ${replies!.length === 1 ? "reply" : "replies"}`} className="h-8 text-xs" disabled={disabled || alreadySteered || steering || responseInProgress} onClick={() => void steerAll()} size="sm" variant="outline">{steering ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{alreadySteered ? previous?.status === "queued" ? "Thread queued" : "Thread steered" : queueing ? "Queue thread" : "Steer thread"}</Button> : null}
        </div> : null}
        {error ? <p className="mb-2 text-xs text-[#737373]" role="status">{error}</p> : null}
        <div className="rounded-[22px] border border-[#e4e4e4] bg-[#fafafa] p-2 focus-within:border-[#c7c7c7]">
          <MentionInput autoFocus className="block min-h-[3.75rem] w-full px-3 pb-3 pt-2.5" currentMember={currentMember} disabled={disabled || !draft} label="Reply in thread" maxLength={4000} members={members} onChange={edit} onSubmit={() => { if (!disabled) void submit(); }} placeholder={disabled ? "Replies are paused." : "Reply or @mention a teammate…"} readOnly={sending} value={draft?.body ?? ""} />
          <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
            <span className="text-xs text-[#999]">Reply in thread</span>
            <Button aria-label={sending ? "Sending reply" : draft?.status === "unconfirmed" ? "Retry reply" : "Send reply"} className="size-8 shrink-0 rounded-full shadow-none" disabled={disabled || !draft?.body.trim() || sending} onClick={() => void submit()} size="icon">{sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUp className="size-4.5" />}</Button>
          </div>
        </div>
        <p className="mt-2 px-1 text-xs text-[#737373]" role="status">{draft?.status === "unconfirmed" ? "Delivery unconfirmed. Your reply is saved; retry when connected." : waitingFor ? `Waiting for ${waitingFor}. Your reply is discussion, not an answer.` : "Replies stay here. Steer the thread to share the whole discussion with Hive."}</p>
      </footer>
    </section>
  );
}
