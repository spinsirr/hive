"use client";

import { useCallback, useMemo } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { MentionInput } from "@/components/hive/mention-input";
import { Button } from "@/components/ui/button";
import { useMessageDraft } from "@/hooks/use-message-draft";
import type { MessageSubmission } from "@/lib/message-draft";
import { resolveMember, type ChatMessage, type TeamMember } from "@/lib/task-session";

/** The same question/answer control renders in chat or in its originating Thread. */
export function QuestionAnswer({ message, members, currentMember, sessionId, disabled, replyThreadId, onAnswer }: {
  message: ChatMessage; members: TeamMember[]; currentMember: string; sessionId: string; disabled: boolean;
  replyThreadId?: string;
  onAnswer: (messageId: string, submission: MessageSubmission, replyThreadId?: string) => Promise<boolean>;
}) {
  const question = message.interaction?.kind === "question" ? message.interaction : undefined;
  const eligible = Boolean(question && !question.answer && (!question.targetMemberId || question.targetMemberId === currentMember));
  const deliveredIds = useMemo(() => new Set((message.annotations ?? []).filter((reply) => reply.authorId === currentMember && reply.clientId).map((reply) => reply.clientId!)), [message.annotations, currentMember]);
  const send = useCallback((submission: MessageSubmission) => eligible ? onAnswer(message.id, submission, replyThreadId) : Promise.resolve(false), [eligible, onAnswer, message.id, replyThreadId]);
  const { draft, edit, submit } = useMessageDraft(`hive-draft:v1:${sessionId}:${currentMember}:question:${message.id}`, deliveredIds, send);
  if (!question) return null;
  const answer = message.annotations?.find((reply) => reply.id === question.answer?.replyId);
  if (question.answer) return <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">{resolveMember(question.answer.by, members).shortName}: </span>{answer?.body ?? "Answer recorded"}</p>;
  if (!eligible) return <p className="text-xs text-muted-foreground">Waiting for {resolveMember(question.targetMemberId!, members).shortName} to answer.</p>;
  const sending = draft?.status === "sending";
  return <div className="space-y-3" role="group" aria-label={`Answer: ${message.body}`}>
    {question.options.length ? <div className="flex flex-wrap gap-2">{question.options.map((option, index) => <Button aria-pressed={draft?.body === option} className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left [overflow-wrap:anywhere]" key={index} size="sm" variant={draft?.body === option ? "secondary" : "outline"} disabled={disabled || sending} onClick={() => edit(option)}>{option}</Button>)}</div> : null}
    <div className="rounded-xl border border-border bg-muted/30 p-2 focus-within:border-foreground/30">
      <MentionInput className="min-h-12 w-full px-2 py-1" currentMember={currentMember} disabled={disabled || !draft} label="Answer Hive" maxLength={4000} members={members} onChange={edit} onSubmit={() => { if (!disabled) void submit(); }} placeholder="Choose an option or write your answer…" readOnly={sending} value={draft?.body ?? ""} />
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted-foreground">Answer & continue{replyThreadId ? " in this thread" : ""}</span>
        <Button aria-label={sending ? "Sending answer" : draft?.status === "unconfirmed" ? "Retry answer" : "Send answer"} disabled={disabled || !draft?.body.trim() || sending} size="icon" className="size-7 rounded-full" onClick={() => void submit()}>{sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUp className="size-4" />}</Button>
      </div>
    </div>
    {draft?.status === "unconfirmed" ? <p className="text-xs text-muted-foreground" role="status">Delivery unconfirmed. Your answer is saved; retry when connected.</p> : null}
  </div>;
}
