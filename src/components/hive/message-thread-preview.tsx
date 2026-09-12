"use client";

import { ChevronRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <Button aria-expanded={expanded} aria-label={latest ? `Open thread with ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "Open collaboration thread"} className={cn("h-auto min-w-0 max-w-full flex-col items-stretch gap-1.5 whitespace-normal text-left text-xs font-normal text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset active:not-aria-[haspopup]:translate-y-0", message.interaction ? "w-full rounded-none border-0 border-t border-border bg-muted/30 px-4 py-3" : "ml-3 self-stretch rounded-none rounded-r-lg border-0 border-l-2 border-border px-3 py-2", expanded && "bg-muted/50")} onClick={onOpen} type="button" variant="ghost">
      <span className="flex min-w-0 items-center gap-2">
        <MessageSquare aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="font-medium text-foreground/80">{latest ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : message.interaction?.kind === "question" ? "Answer in thread" : "Open review"}</span>
        <span className="ml-auto">{expanded ? "Thread open" : latest ? "View thread" : null}</span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
      </span>
      {!expanded && latest ? <span className="line-clamp-2 break-words text-sm leading-6 [overflow-wrap:anywhere]"><span className="font-medium text-foreground/80">{author}: </span>{preview || (latest.deliveryStatus === "streaming" ? "Replying…" : "Reply")}</span> : null}
    </Button>
  );
}
