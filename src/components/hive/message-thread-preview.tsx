"use client";

import { MessageSquare } from "lucide-react";
import { resolveMember, type ChatMessage, type TeamMember } from "@/lib/task-session";
import { cn } from "@/lib/utils";

export function MessageThreadPreview({ message, members, expanded = false, onOpen }: {
  message: ChatMessage;
  members: TeamMember[];
  expanded?: boolean;
  onOpen: () => void;
}) {
  const replies = message.annotations ?? [];
  const latest = replies.at(-1);
  if (!latest && !message.interaction) return null;
  const author = latest ? latest.role === "agent" ? "Hive" : resolveMember(latest.authorId, members).shortName : "";
  // A preview is not another transcript. Keep the full markdown and actions in
  // MessageThread; bound the text here as well as its visual height.
  const characters = Array.from((latest?.body ?? "").replace(/\s+/g, " ").trim());
  const preview = characters.slice(0, 180).join("") + (characters.length > 180 ? "…" : "");

  return (
    <button aria-expanded={expanded} aria-label={latest ? `Open thread with ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "Open collaboration thread"} className={cn("mt-1 min-w-0 max-w-full self-start rounded-lg px-2 py-1.5 text-left text-xs text-[#737373] hover:bg-[#f5f5f5] hover:text-[#171717] focus-visible:outline-2", !latest && "border border-[#dedede] px-3")} onClick={onOpen} type="button">
      <span className="flex items-center gap-2">
        <MessageSquare aria-hidden="true" className="size-3.5 shrink-0" />
        {latest ? <span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span> : null}
        <span className="font-medium text-[#525252]">{!latest ? "Open collaboration thread" : expanded ? "Thread open" : "Open thread"}</span>
      </span>
      {!expanded && latest ? <span className="mt-1 line-clamp-2 break-words text-sm leading-6 [overflow-wrap:anywhere]"><span className="font-medium">{author}: </span>{preview || (latest.deliveryStatus === "streaming" ? "Replying…" : "Reply")}</span> : null}
    </button>
  );
}
