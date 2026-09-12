"use client";

import { Check, Copy, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AgentResponse } from "@/components/hive/agent-response";
import { HiveMark } from "@/components/hive/hive-mark";
import { MessageThreadPreview } from "@/components/hive/message-thread-preview";
import { MessageTime } from "@/components/hive/message-time";
import { SubagentActivity } from "@/components/hive/subagent-activity";
import { PeerRequestSummary } from "@/components/hive/peer-request-summary";
import { codeReferenceLabel } from "@/lib/code-reference";
import type { ChatMessage, TeamMember } from "@/lib/task-session";
import { cn } from "@/lib/utils";

export function ConversationMessage({ message, currentMember, members, sessionId, disabled, runActive, queueing, selected, onOpenThread, onSteerReply }: {
  message: ChatMessage;
  currentMember: string;
  members: TeamMember[];
  sessionId: string;
  disabled: boolean;
  runActive: boolean;
  queueing: boolean;
  selected: boolean;
  onOpenThread: (messageId: string) => void;
  onSteerReply: (messageId: string, replyId: string) => void;
}) {
  const isAgent = message.role === "agent";
  const isOwn = !isAgent && message.memberId === currentMember;
  const hasReplies = Boolean(message.annotations?.length);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.body); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  const actionClass = "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs text-[#999] outline-none transition-colors hover:bg-[#f4f4f4] hover:text-[#333] focus-visible:ring-2 focus-visible:ring-[#171717] motion-reduce:transition-none";

  return (
    <Message className={cn("min-w-0 max-w-full gap-2.5 rounded-xl", selected && "outline-1 outline-offset-8 outline-[#dedede]")} from={isOwn ? "user" : "assistant"}>
      <div className={cn("flex items-center gap-2 px-0.5", isOwn && "justify-end")}>
        {isAgent ? <HiveMark className="size-6 rounded-full border border-[#dedede]" light /> : <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#f1f1f1] text-xs font-semibold text-[#555]">{message.initials}</span>}
        <span className="text-xs font-medium text-[#444]">{message.name}</span>
        <MessageTime className="text-xs text-[#aaa]" message={message} />
      </div>
      {message.subagents?.length ? <SubagentActivity live={message.status === "streaming" && runActive && !disabled} sessionId={sessionId} tasks={message.subagents} /> : null}
      <PeerRequestSummary message={message} members={members} />
      {message.body ? (
        <MessageContent className={cn(
          "max-w-full text-sm leading-6 shadow-none",
          isAgent ? "w-full overflow-visible bg-transparent px-0.5 py-1 text-[#333]" : "w-fit whitespace-pre-wrap rounded-[18px] bg-[#f4f4f4] px-4 py-3 text-[#333] group-[.is-user]:rounded-[18px] group-[.is-user]:bg-[#f4f4f4] sm:max-w-[94%]",
          hasReplies && "w-full sm:max-w-full",
        )}>
          {isAgent ? <AgentResponse streaming={message.status === "streaming"}>{message.body}</AgentResponse> : message.codeReference ? <div><p className="break-all text-xs text-[#737373]">{codeReferenceLabel(message.codeReference)}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre font-mono text-xs leading-5">{message.codeReference.quote}</pre></div> : message.body}
        </MessageContent>
      ) : null}
      {message.interaction ? <button type="button" onClick={() => onOpenThread(message.id)} className="self-start rounded-lg border border-[#dedede] px-3 py-1.5 text-xs font-medium hover:bg-[#fafafa] focus-visible:outline-2">Open collaboration thread</button> : null}
      {message.status !== "streaming" ? (
        <div className={cn("-mt-1 flex items-center gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0 motion-reduce:transition-none", isOwn && "justify-end")}>
          {isAgent && message.body ? <button aria-label={copyState === "copied" ? "Response copied" : "Copy response"} className={actionClass} onClick={() => { void copy(); }} type="button" title={copyState === "copied" ? "Copied" : "Copy response"}>{copyState === "copied" ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}</button> : null}
          {!disabled ? <button aria-label={`Reply in thread to ${message.name}'s message`} className={actionClass} onClick={() => onOpenThread(message.id)} type="button"><MessageSquare aria-hidden="true" className="size-3.5" /> Reply</button> : null}
          {copyState === "failed" ? <span className="text-xs text-[#888]" role="status">Couldn’t copy. Select the text to copy it.</span> : null}
        </div>
      ) : null}
      <MessageThreadPreview disabled={disabled} members={members} message={message} onOpen={() => onOpenThread(message.id)} onSteerReply={onSteerReply} queueing={queueing} />
    </Message>
  );
}
