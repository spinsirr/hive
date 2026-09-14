"use client";

import { ChevronRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  resolveMember,
  type ChatMessage,
  type TeamMember,
} from "@/lib/task-session";
import { cn } from "@/lib/utils";

export function MessageThreadPreview({
  message,
  members,
  expanded = false,
  className,
  onOpen,
}: {
  message: ChatMessage;
  members: TeamMember[];
  expanded?: boolean;
  className?: string;
  onOpen: () => void;
}) {
  const replies = message.annotations ?? [];
  const latest = replies.at(-1);
  if (!latest && !message.interaction) return null;
  const author = latest
    ? latest.role === "agent"
      ? "Hive"
      : resolveMember(latest.authorId, members).shortName
    : "";
  // A preview is not another transcript. Keep the full markdown and actions in
  // MessageThread; bound the text here as well as its visual height.
  const characters = Array.from(
    (latest?.body ?? "").replace(/\s+/g, " ").trim()
  );
  const preview =
    characters.slice(0, 180).join("") + (characters.length > 180 ? "…" : "");

  return (
    <Button
      data-thread-trigger={message.id}
      aria-expanded={expanded}
      aria-label={
        latest
          ? `Open thread with ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
          : "Open collaboration thread"
      }
      className={cn(
        "h-auto w-fit min-w-0 max-w-full flex-col items-stretch gap-1 whitespace-normal rounded-none border-0 border-l-2 border-border bg-transparent px-3 py-1.5 text-left text-xs font-normal text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset active:not-aria-[haspopup]:translate-y-0",
        expanded && "border-foreground/40 bg-muted/30",
        className
      )}
      onClick={onOpen}
      type="button"
      variant="ghost"
    >
      <span className="flex min-w-0 items-center gap-2">
        <MessageSquare aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="font-medium text-foreground/80">
          {latest
            ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
            : "No replies yet"}
        </span>
        <span>{expanded ? "Thread open" : "Open thread"}</span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
      </span>
      {!expanded && latest ? (
        <span className="line-clamp-2 break-words text-xs leading-5 [overflow-wrap:anywhere]">
          <span className="font-medium text-foreground/80">{author}: </span>
          {preview ||
            (latest.deliveryStatus === "streaming" ? "Replying…" : "Reply")}
        </span>
      ) : null}
    </Button>
  );
}
