"use client";

import { ArrowDown, ArrowUp, CornerDownRight, LoaderCircle, MessageSquare, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { resolveMember, type ActiveSteer, type ChatMessage, type SteeringQueueItem, type TeamMember } from "@/lib/task-session";

export function SteeringQueue({ activeSteer, canApply, disabled, items, messages, currentMember, members, onApply, onMove, onRemove, onEdit, onOpenThread }: {
  activeSteer?: ActiveSteer;
  canApply: boolean;
  disabled: boolean;
  items: SteeringQueueItem[];
  messages: ChatMessage[];
  currentMember: string;
  members: TeamMember[];
  onApply: () => void;
  onMove: (steerId: string, direction: "up" | "down") => void;
  onRemove: (steerId: string) => void;
  onEdit: (message: ChatMessage) => void;
  onOpenThread: (messageId: string) => void;
}) {
  if (!activeSteer && !items.length) return null;
  return <section aria-label="Queued steering" className="mx-3 mt-2 shrink-0 overflow-hidden rounded-2xl border border-[#e5e5e5] bg-[#fafafa] sm:mx-5">
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-[#777]">
      <span>{items.length ? `${items.length} queued` : "Current steer"}</span>
      {items.length ? <button className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[#444] hover:bg-[#eee] focus-visible:outline-2 disabled:cursor-default disabled:text-[#aaa] disabled:hover:bg-transparent" disabled={disabled || !canApply} onClick={onApply} title="Starts the next steer only after the current run finishes" type="button"><Play aria-hidden="true" className="size-3" /> {canApply ? "Run next" : "After current run"}</button> : null}
    </div>
    {activeSteer ? <p className="flex items-center gap-2 border-t border-[#e8e8e8] px-3 py-2 text-xs text-[#777]" role="status"><LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> Applying {resolveMember(activeSteer.authorId, members).shortName}’s steer</p> : null}
    <div className="max-h-40 overflow-y-auto">
      {items.map((item, index) => {
        const member = resolveMember(item.authorId, members);
        const messageId = "messageId" in item.source ? item.source.messageId : undefined;
        const message = messages.find((entry) => entry.id === messageId);
        const editable = item.source.kind === "message" && message?.role === "human" && message.memberId === currentMember && !message.codeReference;
        return <div className="group/queue flex min-w-0 items-center gap-2 border-t border-[#e8e8e8] px-3 py-2" key={item.id}>
          <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0 text-[#999]" />
          <div className="min-w-0 flex-1"><p className="truncate text-xs text-[#444]" title={item.body}>{item.source.kind === "message-thread" ? item.sourceLabel : item.body}</p><p className="mt-0.5 text-xs text-[#999]">{member.shortName}</p></div>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`Actions for queued steer ${index + 1}`} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-[#777] hover:bg-[#eaeaea] focus-visible:outline-2" disabled={disabled}><MoreHorizontal aria-hidden="true" className="size-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
              {editable ? <DropdownMenuItem onClick={() => onEdit(message)}><Pencil aria-hidden="true" /> Edit message</DropdownMenuItem> : null}
              {messageId ? <DropdownMenuItem onClick={() => onOpenThread(messageId)}><MessageSquare aria-hidden="true" /> Open thread</DropdownMenuItem> : null}
              <DropdownMenuItem disabled={index === 0} onClick={() => onMove(item.id, "up")}><ArrowUp aria-hidden="true" /> Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={index === items.length - 1} onClick={() => onMove(item.id, "down")}><ArrowDown aria-hidden="true" /> Move down</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onRemove(item.id)}><Trash2 aria-hidden="true" /> Remove from queue</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>;
      })}
    </div>
  </section>;
}
