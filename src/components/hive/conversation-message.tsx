"use client";

import { Copy, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AgentResponse } from "@/components/hive/agent-response";
import { HiveMark } from "@/components/hive/hive-mark";
import { MessageThreadPreview } from "@/components/hive/message-thread-preview";
import { MessageTime } from "@/components/hive/message-time";
import { SubagentActivity } from "@/components/hive/subagent-activity";
import { PeerRequestSummary } from "@/components/hive/peer-request-summary";
import { Button } from "@/components/ui/button";
import { codeReferenceLabel } from "@/lib/code-reference";
import type { ConversationTurn as ConversationTurnData } from "@/lib/conversation-timeline";
import type { ChatMessage, TeamMember } from "@/lib/task-session";
import { cn } from "@/lib/utils";

type ConversationMessageProps = {
  message: ChatMessage;
  currentMember: string;
  members: TeamMember[];
  sessionId: string;
  disabled: boolean;
  runActive: boolean;
  selected: boolean;
  hideAuthor?: boolean;
  onOpenThread: (messageId: string) => void;
};

export function ConversationTurn({ turn, selectedThreadId, ...props }: Omit<ConversationMessageProps, "message" | "selected" | "hideAuthor"> & {
  turn: ConversationTurnData;
  selectedThreadId?: string | null;
}) {
  return <div className="flex min-w-0 flex-col gap-3" data-slot="conversation-turn">
    <ConversationMessage {...props} message={turn.message} selected={selectedThreadId === turn.message.id} />
    {turn.requests.map((message) => <ConversationMessage {...props} hideAuthor key={message.id} message={message} selected={selectedThreadId === message.id} />)}
  </div>;
}

export function ConversationMessage({ message, currentMember, members, sessionId, disabled, runActive, selected, hideAuthor = false, onOpenThread }: ConversationMessageProps) {
  const isAgent = message.role === "agent";
  const isOwn = !isAgent && message.memberId === currentMember;
  const hasReplies = Boolean(message.annotations?.length);
  const hasThread = hasReplies || Boolean(message.interaction);
  const canStartThread = !disabled && !hasReplies && !message.interaction;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [copyState]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.body); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  const actions = message.status !== "streaming" && ((isAgent && message.body) || canStartThread) ? (
    <div className={cn("ml-auto flex shrink-0 items-center gap-1 text-muted-foreground transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0 motion-reduce:transition-none", isOwn && "ml-0")}>
      {isAgent && message.body ? <Button aria-label={copyState === "copied" ? "Response copied" : "Copy response"} className="text-muted-foreground" onClick={() => { void copy(); }} size={copyState === "copied" ? "xs" : "icon-xs"} type="button" variant="ghost" title={copyState === "copied" ? "Copied" : "Copy text"}><Copy aria-hidden="true" className="size-3.5" />{copyState === "copied" ? <span>Copied</span> : null}</Button> : null}
      {canStartThread ? <Button aria-label={`Reply in thread to ${message.name}'s message`} className="text-xs text-muted-foreground" onClick={() => onOpenThread(message.id)} size="xs" type="button" variant="ghost"><MessageSquare aria-hidden="true" className="size-3.5" /> Reply</Button> : null}
    </div>
  ) : null;
  const body = message.body ? (
    <MessageContent className={cn(
      "max-w-full text-sm leading-6 shadow-none",
      isAgent ? "w-full overflow-visible bg-transparent px-0.5 py-1 text-[#333]" : "w-fit whitespace-pre-wrap rounded-[18px] bg-[#f4f4f4] px-4 py-3 text-[#333] group-[.is-user]:rounded-[18px] group-[.is-user]:bg-[#f4f4f4] sm:max-w-[94%]",
      hasThread && "w-full rounded-none bg-transparent px-0.5 py-1 group-[.is-user]:rounded-none group-[.is-user]:bg-transparent group-[.is-user]:px-0.5 group-[.is-user]:py-1 sm:max-w-full",
    )}>
      {isAgent ? <AgentResponse streaming={message.status === "streaming"}>{message.body}</AgentResponse> : message.codeReference ? <div><p className="break-all text-xs text-[#737373]">{codeReferenceLabel(message.codeReference)}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre font-mono text-xs leading-5">{message.codeReference.quote}</pre></div> : message.body}
    </MessageContent>
  ) : null;
  const thread = <MessageThreadPreview expanded={selected} members={members} message={message} onOpen={() => onOpenThread(message.id)} />;

  return (
    <Message className={cn("min-w-0 max-w-full gap-2.5 rounded-xl", selected && !hasThread && "outline-1 outline-offset-4 outline-border")} data-message-id={message.id} from={isOwn ? "user" : "assistant"}>
      {!hideAuthor ? <div className={cn("flex min-w-0 items-center gap-2 px-0.5", isOwn && "justify-end")}>
        {isAgent ? <HiveMark className="size-6 rounded-full border border-[#dedede]" light /> : <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#f1f1f1] text-xs font-semibold text-[#555]">{message.initials}</span>}
        <span className="min-w-0 truncate text-xs font-medium text-[#444]">{message.name}</span>
        <MessageTime className="shrink-0 text-xs text-[#aaa]" message={message} />
        {!message.interaction ? actions : null}
      </div> : null}
      {message.subagents?.length ? <SubagentActivity live={message.status === "streaming" && runActive && !disabled} sessionId={sessionId} tasks={message.subagents} /> : null}
      {hasThread ? <div className={cn("w-full overflow-hidden rounded-xl border border-border bg-background", selected && "border-foreground/30")} data-slot="threaded-message">
        <div className="flex min-w-0 flex-col gap-2 px-4 py-3">
          {message.interaction ? <div className="flex min-w-0 items-center gap-2">
            <PeerRequestSummary className="mb-0" message={message} members={members} />
            {actions}
          </div> : null}
          {body}
        </div>
        {thread}
      </div> : body}
      {copyState === "failed" ? <span className="text-xs text-muted-foreground" role="status">Couldn’t copy. Select the text to copy it.</span> : null}
    </Message>
  );
}
