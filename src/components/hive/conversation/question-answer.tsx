"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { MentionInput } from "@/components/hive/conversation/mention-input";
import { Button } from "@/components/ui/button";
import { useMessageDraft } from "@/hooks/use-message-draft";
import type { MessageSubmission } from "@/lib/conversation/message-draft";
import {
  resolveMember,
  type ChatMessage,
  type TeamMember,
} from "@/lib/session/task-session";

/** The same question/answer control renders in chat or in its originating Thread. */
export function QuestionAnswer({
  message,
  members,
  currentMember,
  sessionId,
  disabled,
  replyThreadId,
  onAnswer,
}: {
  message: ChatMessage;
  members: TeamMember[];
  currentMember: string;
  sessionId: string;
  disabled: boolean;
  replyThreadId?: string;
  onAnswer: (
    messageId: string,
    submission: MessageSubmission,
    replyThreadId?: string
  ) => Promise<boolean>;
}) {
  const question =
    message.interaction?.kind === "question" ? message.interaction : undefined;
  const [writing, setWriting] = useState(false);
  const eligible = Boolean(
    question &&
    !question.answer &&
    (!question.targetMemberId || question.targetMemberId === currentMember)
  );
  const deliveredIds = useMemo(
    () =>
      new Set(
        (message.annotations ?? [])
          .filter((reply) => reply.authorId === currentMember && reply.clientId)
          .map((reply) => reply.clientId!)
      ),
    [message.annotations, currentMember]
  );
  const send = useCallback(
    async (submission: MessageSubmission) => {
      if (!eligible) return false;
      const delivered = await onAnswer(message.id, submission, replyThreadId);
      if (delivered) setWriting(false);
      return delivered;
    },
    [eligible, onAnswer, message.id, replyThreadId]
  );
  const { draft, edit, submit } = useMessageDraft(
    `hive-draft:v1:${sessionId}:${currentMember}:question:${message.id}`,
    deliveredIds,
    send
  );
  if (!question) return null;
  const answer = message.annotations?.find(
    (reply) => reply.id === question.answer?.replyId
  );
  if (question.answer)
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
        <span className="font-medium text-foreground">
          {resolveMember(question.answer.by, members).shortName}:{" "}
        </span>
        {answer?.body ?? "Answer recorded"}
      </p>
    );
  if (!eligible)
    return (
      <p className="text-xs text-muted-foreground">
        Waiting for {resolveMember(question.targetMemberId!, members).shortName}{" "}
        to answer.
      </p>
    );
  const sending = draft?.status === "sending";
  // Restored free text remains visible, but only an explicit writing action
  // focuses the input. A question arriving must not summon another composer.
  const showInput =
    writing ||
    !question.options.length ||
    Boolean(draft?.body && !question.options.includes(draft.body));
  const sendButton = (
    <Button
      aria-label={
        sending
          ? "Sending answer"
          : draft?.status === "unconfirmed"
            ? "Retry answer"
            : "Send answer"
      }
      title={`Answer & continue${replyThreadId ? " in this thread" : ""}`}
      disabled={disabled || !draft?.body.trim() || sending}
      size="sm"
      variant="secondary"
      className="h-7 gap-1.5 px-2.5 text-xs"
      onClick={() => void submit()}
    >
      {sending ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-3 animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {sending
        ? "Sending…"
        : draft?.status === "unconfirmed"
          ? "Retry"
          : "Answer"}
      {!sending ? <ArrowRight aria-hidden="true" className="size-3" /> : null}
    </Button>
  );
  return (
    <div
      className="space-y-2"
      role="group"
      aria-label={`Answer: ${message.body}`}
      aria-busy={sending}
    >
      {question.options.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {question.options.map((option, index) => (
            <Button
              className="h-auto min-h-7 max-w-full whitespace-normal px-2.5 py-1 text-left text-xs font-normal [overflow-wrap:anywhere]"
              key={index}
              size="sm"
              variant={draft?.body === option ? "secondary" : "outline"}
              disabled={disabled || sending || !draft}
              onClick={() => {
                edit(option);
                setWriting(false);
                void submit();
              }}
            >
              {sending && draft?.body === option ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {option}
            </Button>
          ))}
          {!showInput ? (
            <Button
              aria-label="Write an answer"
              className="h-7 px-2 text-xs font-normal text-muted-foreground"
              size="sm"
              variant="ghost"
              disabled={disabled || sending || !draft}
              onClick={() => setWriting(true)}
            >
              Write an answer…
            </Button>
          ) : null}
        </div>
      ) : null}
      {showInput ? (
        <div className="flex w-full max-w-lg items-end gap-1 rounded-lg border border-border p-1 focus-within:border-foreground/30">
          <MentionInput
            autoFocus={writing}
            rows={1}
            className="min-h-8 w-full px-2 py-1"
            currentMember={currentMember}
            disabled={disabled || !draft}
            label="Answer Hive"
            maxLength={4000}
            members={members}
            onChange={edit}
            onSubmit={() => {
              if (!disabled) void submit();
            }}
            placeholder="Your answer…"
            readOnly={sending}
            value={draft?.body ?? ""}
          />
          <div className="shrink-0 pb-0.5">{sendButton}</div>
        </div>
      ) : null}
      {sending && !showInput ? (
        <span className="sr-only" role="status">
          Sending answer…
        </span>
      ) : null}
      {draft?.status === "unconfirmed" ? (
        <p className="text-xs text-muted-foreground" role="status">
          Delivery unconfirmed.{" "}
          {showInput
            ? "Your answer is saved; retry when connected."
            : "Choose the option again to retry."}
        </p>
      ) : null}
    </div>
  );
}
