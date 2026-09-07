"use client";

import { MessageSquare } from "lucide-react";
import { ThreadReply } from "@/components/hive/thread-reply";
import type { ChatMessage, TeamMember } from "@/lib/task-session";

export function MessageThreadPreview({ message, members, disabled, queueing, onOpen, onSteerReply }: {
  message: ChatMessage;
  members: TeamMember[];
  disabled: boolean;
  queueing: boolean;
  onOpen: () => void;
  onSteerReply: (messageId: string, replyId: string) => void;
}) {
  const replies = message.annotations ?? [];
  if (replies.length === 0) return null;
  const earlier = replies.slice(0, -3);
  const renderReply = (reply: (typeof replies)[number]) => <ThreadReply disabled={disabled} key={reply.id} members={members} onSteer={() => onSteerReply(message.id, reply.id)} queueing={queueing} reply={reply} />;

  return (
    <section aria-label={`Replies to ${message.name}'s message`} className="ml-3 mt-1 min-w-0 border-l-2 border-[#e8e8e8] py-1 pl-3 text-left">
      {earlier.length > 0 ? (
        <details className="mb-3 text-xs text-[#737373]">
          <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2">{earlier.length} earlier {earlier.length === 1 ? "reply" : "replies"}</summary>
          <div className="mt-3 space-y-3">{earlier.map(renderReply)}</div>
        </details>
      ) : null}
      <div className="space-y-3">{replies.slice(-3).map(renderReply)}</div>
      <button aria-label={`Open thread with ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`} className="mt-3 flex items-center gap-2 rounded px-1 py-1 text-xs text-[#737373] hover:bg-[#f5f5f5] hover:text-[#171717] focus-visible:outline-2" onClick={onOpen} type="button">
        <MessageSquare aria-hidden="true" className="size-3.5" />
        <span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
        <span className="font-medium text-[#525252]">Open thread</span>
      </button>
    </section>
  );
}
