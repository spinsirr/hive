"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveMember, type MessageAnnotation, type TeamMember } from "@/lib/task-session";

export function ThreadReply({ reply, members, disabled, queueing, onSteer, showTimestamp = false }: {
  reply: MessageAnnotation;
  members: TeamMember[];
  disabled: boolean;
  queueing: boolean;
  onSteer: () => void;
  showTimestamp?: boolean;
}) {
  const author = reply.role === "agent" ? { name: "Hive", shortName: "Hive", initials: "H" } : resolveMember(reply.authorId, members);
  const promoter = reply.steeredBy ?? reply.queuedBy;
  return (
    <article className="flex min-w-0 gap-2.5">
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full border border-[#dedede] bg-[#fafafa] text-[8px] font-medium">{author.initials}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <span className="break-words font-medium">{author.name}</span>
          {showTimestamp ? <time className="text-[10px] text-[#999]" dateTime={new Date(reply.createdAt).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(reply.createdAt)}</time> : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#414141] [overflow-wrap:anywhere]">{reply.body}</p>
        {reply.role === "agent" ? null : reply.status === "open" ? (
          <Button aria-label={`${queueing ? "Queue steer" : "Steer Hive"} for ${author.shortName}'s reply`} className="mt-1 h-6 px-1.5 text-[11px] text-[#737373]" disabled={disabled} onClick={onSteer} size="sm" variant="ghost">{queueing ? "Queue steer" : "Steer Hive"}</Button>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-[#737373]">{reply.status === "steered" ? <Check className="size-3" /> : null}{reply.status === "queued" ? "Queued" : "Steered"}{promoter ? ` by ${resolveMember(promoter, members).shortName}` : ""}</p>
        )}
      </div>
    </article>
  );
}
