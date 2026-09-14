"use client";

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { conversationTimelineMessages } from "@/lib/conversation/conversation-timeline";
import type { ChatMessage } from "@/lib/session/task-session";

/** A pointer to actionable input, not a second question widget or unread inbox. */
export function TaskAttention({
  messages,
  memberId,
  paused,
  onOpen,
}: {
  messages: ChatMessage[];
  memberId: string;
  paused: boolean;
  onOpen: (message: ChatMessage) => void;
}) {
  const visible = new Set(
    conversationTimelineMessages(messages).map((message) => message.id)
  );
  const pending = paused
    ? []
    : messages.filter((message) => {
        const question = message.interaction;
        return (
          (visible.has(message.id) || message.threadId) &&
          question?.kind === "question" &&
          !question.answer &&
          (!question.targetMemberId || question.targetMemberId === memberId)
        );
      });
  const label = pending.length
    ? `${pending.length} ${pending.length === 1 ? "question needs" : "questions need"} your answer`
    : "";
  return (
    <>
      <span className="sr-only" role="status" aria-atomic="true">
        {label}
      </span>
      {pending.length ? (
        <Button
          aria-label={label}
          title={label}
          onClick={() => onOpen(pending[0])}
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
        >
          <CircleHelp aria-hidden="true" className="size-3.5" />
          <span className="tabular-nums">{pending.length}</span>
          <span className="hidden sm:inline">
            {pending.length === 1 ? "question" : "questions"}
          </span>
        </Button>
      ) : null}
    </>
  );
}
