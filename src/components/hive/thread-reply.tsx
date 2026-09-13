"use client";

import { Check } from "lucide-react";
import { AgentResponse } from "@/components/hive/agent-response";
import {
  resolveMember,
  type MessageAnnotation,
  type TeamMember,
} from "@/lib/task-session";

export function ThreadReply({
  reply,
  members,
  showTimestamp = false,
}: {
  reply: MessageAnnotation;
  members: TeamMember[];
  showTimestamp?: boolean;
}) {
  const author =
    reply.role === "agent"
      ? { name: "Hive", shortName: "Hive", initials: "H" }
      : resolveMember(reply.authorId, members);
  const promoter = reply.steeredBy ?? reply.queuedBy;
  return (
    <article className="flex min-w-0 gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full border border-[#dedede] bg-[#fafafa] text-xs font-medium"
      >
        {author.initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <span className="break-words font-medium">{author.name}</span>
          {showTimestamp ? (
            <time
              className="text-xs text-[#999]"
              dateTime={new Date(reply.createdAt).toISOString()}
            >
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(reply.createdAt)}
            </time>
          ) : null}
        </div>
        <div className="mt-1 break-words text-sm leading-6 text-[#414141] [overflow-wrap:anywhere]">
          {reply.role === "agent" ? (
            <AgentResponse streaming={reply.deliveryStatus === "streaming"}>
              {reply.body}
            </AgentResponse>
          ) : (
            <p className="whitespace-pre-wrap">{reply.body}</p>
          )}
        </div>
        {reply.deliveryStatus === "error" ? (
          <p role="status" className="mt-1 text-xs text-red-700">
            Run interrupted. Review the result before continuing.
          </p>
        ) : null}
        {reply.role !== "agent" && reply.status !== "open" ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-[#737373]">
            {reply.status === "steered" ? <Check className="size-3" /> : null}
            {reply.status === "queued" ? "Queued" : "Steered"}
            {promoter
              ? ` by ${resolveMember(promoter, members).shortName}`
              : ""}
          </p>
        ) : null}
      </div>
    </article>
  );
}
