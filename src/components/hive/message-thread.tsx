"use client";

import { LoaderCircle, MessageSquare, Send, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { AgentResponse } from "@/components/hive/agent-response";
import { MentionInput } from "@/components/hive/mention-input";
import { MessageTime } from "@/components/hive/message-time";
import { ThreadReply } from "@/components/hive/thread-reply";
import { Button } from "@/components/ui/button";
import { useMessageDraft } from "@/hooks/use-message-draft";
import { codeReferenceLabel } from "@/lib/code-reference";
import type { MessageSubmission } from "@/lib/message-draft";
import { resolveMember, type ChatMessage, type SteeringQueueItem, type TeamMember } from "@/lib/task-session";

export function MessageThread({ sessionId, message, members, currentMember, disabled, runActive, queue, onClose, onReply, onSteerReply, onSteerThread }: {
  sessionId: string;
  message: ChatMessage;
  members: TeamMember[];
  currentMember: string;
  disabled: boolean;
  runActive: boolean;
  queue: SteeringQueueItem[];
  onClose: () => void;
  onReply: (messageId: string, submission: MessageSubmission) => Promise<boolean>;
  onSteerReply: (messageId: string, replyId: string) => void;
  onSteerThread: (messageId: string, throughReplyId: string) => Promise<boolean>;
}) {
  const replies = message.annotations;
  const deliveredIds = useMemo(() => new Set((replies ?? []).filter((reply) => reply.authorId === currentMember && reply.clientId).map((reply) => reply.clientId!)), [currentMember, replies]);
  const send = useCallback((submission: MessageSubmission) => onReply(message.id, submission), [message.id, onReply]);
  // Keep existing annotation drafts when upgrading the presentation to threads.
  const { draft, edit, submit } = useMessageDraft(`hive-draft:v1:${sessionId}:${currentMember}:annotation:${message.id}`, deliveredIds, send);
  const [steering, setSteering] = useState(false);
  const [error, setError] = useState("");
  const sending = draft?.status === "sending";
  const lastReply = replies?.at(-1);
  const previous = message.threadSteer;
  const alreadySteered = Boolean(lastReply && previous?.throughReplyId === lastReply.id);
  const queueing = runActive || queue.length > 0;
  const steerAll = async () => {
    if (!lastReply || disabled || steering || alreadySteered) return;
    setSteering(true);
    setError("");
    try {
      if (!await onSteerThread(message.id, lastReply.id)) setError("The thread could not be steered. Reconnect and retry, or steer one reply if the discussion is too long.");
    } finally { setSteering(false); }
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
            <div className="mb-2 flex items-center gap-2 text-xs"><span className="grid size-6 shrink-0 place-items-center rounded-full border border-[#dedede] bg-[#fafafa] text-xs font-medium">{message.initials}</span><span className="font-medium">{message.name}</span><MessageTime className="text-[#999]" message={message} /></div>
            <div className="min-w-0 break-words text-sm leading-6">
              {message.role === "agent" ? <AgentResponse>{message.body}</AgentResponse> : message.codeReference ? <><p className="break-all text-xs text-[#737373]">{codeReferenceLabel(message.codeReference)}</p><pre className="mt-2 max-h-52 overflow-auto font-mono text-xs leading-5">{message.codeReference.quote}</pre></> : <p className="whitespace-pre-wrap">{message.body}</p>}
            </div>
          </article>
          {(replies?.length ?? 0) === 0 ? <p className="text-xs text-[#737373]">Start a discussion about this message.</p> : replies?.map((reply) => <ThreadReply disabled={disabled} key={reply.id} members={members} onSteer={() => onSteerReply(message.id, reply.id)} queueing={queueing} reply={reply} showTimestamp />)}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <footer className="shrink-0 border-t border-[#ebebeb] bg-[#fafafa] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
        {lastReply ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#737373]">{previous ? `${previous.replyCount} ${previous.replyCount === 1 ? "reply" : "replies"} ${previous.status === "queued" ? "queued" : "steered"} by ${resolveMember(previous.requestedBy, members).shortName}` : `${replies!.length} ${replies!.length === 1 ? "reply" : "replies"}`}</p>
          <Button aria-label={`${queueing ? "Queue" : "Steer"} entire thread with ${replies!.length} replies`} className="h-8 text-xs" disabled={disabled || alreadySteered || steering} onClick={() => void steerAll()} size="sm" variant="outline">{steering ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{alreadySteered ? previous?.status === "queued" ? "Thread queued" : "Thread steered" : queueing ? "Queue thread" : "Steer thread"}</Button>
        </div> : null}
        {error ? <p className="mb-2 text-xs text-[#737373]" role="status">{error}</p> : null}
        <div className="flex items-end gap-2 rounded-xl border border-[#d9d9d9] bg-white p-2 focus-within:border-[#999]">
          <MentionInput autoFocus currentMember={currentMember} disabled={disabled || !draft} label="Reply in thread" maxLength={4000} members={members} onChange={edit} onSubmit={() => { if (!disabled) void submit(); }} placeholder={disabled ? "Replies are paused." : "Reply or @mention a teammate…"} readOnly={sending} value={draft?.body ?? ""} />
          <Button aria-label={sending ? "Sending reply" : draft?.status === "unconfirmed" ? "Retry reply" : "Send reply"} className="size-10 shrink-0 rounded-lg sm:size-9" disabled={disabled || !draft?.body.trim() || sending} onClick={() => void submit()} size="icon">{sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}</Button>
        </div>
        <p className="mt-2 px-1 text-xs text-[#737373]" role="status">{draft?.status === "unconfirmed" ? "Delivery unconfirmed. Your reply is saved; retry when connected." : "Replies stay in the thread until you steer Hive."}</p>
      </footer>
    </section>
  );
}
