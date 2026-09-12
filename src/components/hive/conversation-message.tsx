"use client";

import { Copy, History, MessageSquare, MoreHorizontal, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AgentResponse } from "@/components/hive/agent-response";
import { HiveMark } from "@/components/hive/hive-mark";
import { MessageThreadPreview } from "@/components/hive/message-thread-preview";
import { MessageTime } from "@/components/hive/message-time";
import { MessageEditComposer, type MessageEditTarget } from "@/components/hive/message-edit-composer";
import { SubagentActivity } from "@/components/hive/subagent-activity";
import { PeerRequestSummary } from "@/components/hive/peer-request-summary";
import { QuestionAnswer } from "@/components/hive/question-answer";
import type { MessageSubmission } from "@/lib/message-draft";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { codeReferenceLabel } from "@/lib/code-reference";
import type { ConversationTurn as ConversationTurnData } from "@/lib/conversation-timeline";
import { canEditMessage, type ChatMessage, type MessageEdit, type TeamMember } from "@/lib/task-session";
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
  editing?: MessageEditTarget | null;
  onEdit?: (message: ChatMessage) => void;
  onSaveEdit?: (edit: MessageEdit) => Promise<void>;
  onCancelEdit?: () => void;
  onOpenThread: (messageId: string) => void;
  onAnswerQuestion?: (messageId: string, submission: MessageSubmission, replyThreadId?: string) => Promise<boolean>;
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

export function ConversationMessage({ message, currentMember, members, sessionId, disabled, runActive, selected, hideAuthor = false, editing, onEdit, onSaveEdit, onCancelEdit, onOpenThread, onAnswerQuestion }: ConversationMessageProps) {
  const isAgent = message.role === "agent";
  const isOwn = !isAgent && message.memberId === currentMember;
  const question = message.interaction?.kind === "question" ? message.interaction : undefined;
  const discussion = question ? { ...message, annotations: message.annotations?.filter((reply) => reply.id !== question.answer?.replyId) } : message;
  const hasReplies = Boolean(discussion.annotations?.length);
  const hasThread = !message.threadId && (hasReplies || message.interaction?.kind === "review");
  const hasCard = hasThread || Boolean(message.interaction);
  const canStartThread = !disabled && !hasThread && !message.threadId;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showHistory, setShowHistory] = useState(false);
  const isEditing = isOwn && editing?.message.id === message.id;
  const canEdit = canEditMessage(message, currentMember) && !disabled && Boolean(onEdit);
  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [copyState]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.body); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  const actions = message.status !== "streaming" && (message.body || canStartThread) ? (
    <div className={cn("ml-auto flex shrink-0 items-center gap-1 text-muted-foreground transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0 motion-reduce:transition-none", isOwn && "ml-0")}>
      {isAgent && message.body ? <Button aria-label={copyState === "copied" ? "Response copied" : "Copy response"} className="text-muted-foreground" onClick={() => { void copy(); }} size={copyState === "copied" ? "xs" : "icon-xs"} type="button" variant="ghost" title={copyState === "copied" ? "Copied" : "Copy text"}><Copy aria-hidden="true" className="size-3.5" />{copyState === "copied" ? <span>Copied</span> : null}</Button> : null}
      {canStartThread ? <Button aria-label={`Reply in thread to ${message.name}'s message`} data-thread-trigger={message.id} className="text-xs text-muted-foreground" onClick={() => onOpenThread(message.id)} size="xs" type="button" variant="ghost"><MessageSquare aria-hidden="true" className="size-3.5" /> Reply</Button> : null}
      {!isAgent ? <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Message actions for ${message.name}`} data-message-actions={message.id} render={<Button size="icon-xs" variant="ghost" />}><MoreHorizontal aria-hidden="true" className="size-3.5" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" finalFocus={() => document.getElementById(`message-editor-${message.id}`)?.querySelector<HTMLElement>("textarea") ?? true}>
          {canEdit ? <DropdownMenuItem onClick={() => onEdit?.(message)}><Pencil aria-hidden="true" />Edit message</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => { void copy(); }}><Copy aria-hidden="true" />Copy message</DropdownMenuItem>
          {!message.threadId ? <DropdownMenuItem disabled={!hasThread && disabled} onClick={() => onOpenThread(message.id)}><MessageSquare aria-hidden="true" />Open thread</DropdownMenuItem> : null}
          {message.edits?.length ? <DropdownMenuItem onClick={() => setShowHistory(true)}><History aria-hidden="true" />View edit history</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </div>
  ) : null;
  const body = isEditing && editing && onSaveEdit && onCancelEdit ? <MessageEditComposer key={`${message.id}:${currentMember}`} {...editing} disabled={disabled} onSave={onSaveEdit} onCancel={onCancelEdit} /> : message.body ? (
    <MessageContent className={cn(
      "max-w-full text-sm leading-6 shadow-none",
      isAgent ? "w-full overflow-visible bg-transparent px-0.5 py-1 text-[#333]" : "w-fit whitespace-pre-wrap rounded-[18px] bg-[#f4f4f4] px-4 py-3 text-[#333] group-[.is-user]:rounded-[18px] group-[.is-user]:bg-[#f4f4f4] sm:max-w-[94%]",
      hasCard && "w-full rounded-none bg-transparent px-0.5 py-1 group-[.is-user]:rounded-none group-[.is-user]:bg-transparent group-[.is-user]:px-0.5 group-[.is-user]:py-1 sm:max-w-full",
    )}>
      {isAgent ? <AgentResponse streaming={message.status === "streaming"}>{message.body}</AgentResponse> : message.codeReference ? <div><p className="break-all text-xs text-[#737373]">{codeReferenceLabel(message.codeReference)}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre font-mono text-xs leading-5">{message.codeReference.quote}</pre></div> : message.body}
    </MessageContent>
  ) : null;
  const thread = <MessageThreadPreview expanded={selected} members={members} message={discussion} onOpen={() => onOpenThread(message.id)} />;

  return (
    <Message className={cn("min-w-0 max-w-full gap-2.5 rounded-xl", selected && !hasThread && "outline-1 outline-offset-4 outline-border")} data-message-id={message.id} from={isOwn ? "user" : "assistant"}>
      {!hideAuthor ? <div className={cn("flex min-w-0 items-center gap-2 px-0.5", isOwn && "justify-end")}>
        {isAgent ? <HiveMark className="size-6 rounded-full border border-[#dedede]" light /> : <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#f1f1f1] text-xs font-semibold text-[#555]">{message.initials}</span>}
        <span className="min-w-0 truncate text-xs font-medium text-[#444]">{message.name}</span>
        <MessageTime className="shrink-0 text-xs text-[#aaa]" message={message} />
        {message.edits?.length ? <Button aria-expanded={showHistory} className="text-muted-foreground" onClick={() => setShowHistory((visible) => !visible)} size="xs" variant="ghost">Edited</Button> : null}
        {!message.interaction ? actions : null}
      </div> : null}
      {message.subagents?.length ? <SubagentActivity live={message.status === "streaming" && runActive && !disabled} sessionId={sessionId} tasks={message.subagents} /> : null}
      {hasCard ? <div className={cn("w-full overflow-hidden rounded-xl border border-border bg-background", selected && "border-foreground/30")} data-slot={hasThread ? "threaded-message" : "question-message"}>
        <div className="flex min-w-0 flex-col gap-2 px-4 py-3">
          {message.interaction ? <div className="flex min-w-0 items-center gap-2">
            <PeerRequestSummary className="mb-0" message={message} members={members} />
            {actions}
          </div> : null}
          {body}
          {question && onAnswerQuestion && !selected ? <QuestionAnswer currentMember={currentMember} disabled={disabled} members={members} message={message} onAnswer={onAnswerQuestion} replyThreadId={message.threadId} sessionId={sessionId} /> : null}
        </div>
        {hasThread ? thread : null}
      </div> : body}
      {showHistory && message.edits?.length ? <section aria-label={`Edit history for ${message.name}'s message`} className="w-full rounded-xl border border-border bg-muted/30 p-3 text-xs">
        <div className="mb-3 flex items-center gap-2 text-muted-foreground"><History aria-hidden="true" className="size-3.5" /><span className="flex-1">Previous versions</span><Button onClick={() => setShowHistory(false)} size="xs" variant="ghost">Hide history</Button></div>
        <div className="max-h-60 space-y-3 overflow-y-auto">{message.edits.map((edit, index) => <div className="border-l-2 border-border pl-3" key={index}><p className="mb-1 flex flex-wrap gap-1.5 text-muted-foreground">Version {index + 1} · replaced <MessageTime message={{ createdAt: edit.replacedAt, time: "" }} /></p><p className="whitespace-pre-wrap break-words text-sm leading-6">{edit.body}</p></div>)}</div>
      </section> : null}
      {!isAgent && copyState === "copied" ? <span className="text-xs text-muted-foreground" role="status">Message copied</span> : null}
      {copyState === "failed" ? <span className="text-xs text-muted-foreground" role="status">Couldn’t copy. Select the text to copy it.</span> : null}
    </Message>
  );
}
