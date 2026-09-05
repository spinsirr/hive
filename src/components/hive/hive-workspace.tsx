"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Search,
  Send,
  WifiOff,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AgentResponse } from "@/components/hive/agent-response";
import { DiffPane } from "@/components/hive/diff-pane";
import { MentionInput } from "@/components/hive/mention-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSharedSession } from "@/hooks/use-shared-session";
import { useMessageDraft } from "@/hooks/use-message-draft";
import type { MessageSubmission } from "@/lib/message-draft";
import { displayHiveErrorMessage } from "@/lib/hive-error-copy";
import {
  type ActiveSteer,
  type ChatMessage,
  canApplyNextSteer,
  canApproveChanges,
  isHiveRunActive,
  conversationMessages,
  isDirectedAtTeammate,
  type MemberId,
  type RepositoryState,
  resolveMember,
  type RunStage,
  type SteeringQueueItem,
  type TeamMember,
  type WorkspaceState,
} from "@/lib/task-session";
import { shouldSubmitMessage } from "@/lib/message-keyboard";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";
import { cn } from "@/lib/utils";

type WorkspaceTab = "diff" | "files" | "runs";

const CodeViewer = dynamic(() => import("./code-viewer"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-[#737373]" role="status">Loading code viewer…</div>,
});

type RepositoryOption = {
  id: number;
  name: string;
  defaultBranch: string;
  visibility: "private" | "public";
};

const stageCopy: Record<RunStage, { label: string; detail: string }> = {
  waiting: { label: "Ready", detail: "Ask Hive to inspect or change the connected repository." },
  running: { label: "Hive is working", detail: "The shared coding workspace is executing real tools." },
  review: { label: "Ready for review", detail: "Review the real git diff and command output." },
  approved: { label: "Approved", detail: "The team approved the current workspace diff." },
};

const tabs: Array<{ key: WorkspaceTab; label: string; icon: typeof Code2 }> = [
  { key: "diff", label: "Diff", icon: Code2 },
  { key: "files", label: "Files", icon: FileCode2 },
  { key: "runs", label: "Runs", icon: ListChecks },
];

function HiveMark({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span
      aria-label="Hive logo"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md",
        light ? "bg-[#ededed] text-[#171717]" : "bg-[#171717] text-white",
        className,
      )}
      role="img"
    >
      <svg aria-hidden="true" className="size-[68%]" fill="none" viewBox="0 0 24 24">
        <path d="M12 3.5 15 5.25v3.5l-3 1.75-3-1.75v-3.5L12 3.5ZM8 11l3 1.75v3.5L8 18l-3-1.75v-3.5L8 11Zm8 0 3 1.75v3.5L16 18l-3-1.75v-3.5L16 11Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
      </svg>
    </span>
  );
}

function MemberStack({
  activeMembers,
  members,
}: {
  activeMembers: MemberId[];
  members: TeamMember[];
}) {
  return (
    <div className="flex items-center">
      {members.map((member, index) => {
        const active = activeMembers.includes(member.id);
        return (
          <span
            className={cn(
              "relative grid size-7 place-items-center rounded-full border border-[#d8d8d8] bg-white text-[9px] font-semibold",
              index > 0 && "-ml-1.5",
              index === 0 && "bg-[#171717] text-white",
            )}
            key={member.id}
            title={`${member.name}${active ? " · online" : " · away"}`}
          >
            {member.initials}
            <span className={cn("absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-white", active ? "bg-[#171717]" : "bg-[#cfcfcf]")} />
          </span>
        );
      })}
      <span className="relative -ml-1.5" title="Hive · active">
        <HiveMark className="size-7 rounded-full border border-[#d8d8d8]" light />
        <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-white bg-[#171717]" />
      </span>
    </div>
  );
}

function ProductHeader({
  activeMembers,
  copied,
  currentMember,
  members,
  lifecycle,
  repository,
  sessionTitle,
  runActive,
  queueCount,
  syncing,
  syncError,
  onCopyInvite,
  onToggleLifecycle,
  onSignOut,
  onReset,
}: {
  activeMembers: MemberId[];
  copied: boolean;
  currentMember: TeamMember;
  members: TeamMember[];
  lifecycle: "active" | "completed";
  repository?: RepositoryState;
  sessionTitle: string;
  runActive: boolean;
  queueCount: number;
  syncing: boolean;
  syncError: boolean;
  onCopyInvite: () => void;
  onToggleLifecycle: () => void;
  onSignOut: () => void;
  onReset: () => void;
}) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[#e8e8e8] bg-white px-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link className="flex shrink-0 items-center gap-2.5" href="/">
          <HiveMark className="size-7" />
          <span className="hidden text-sm font-semibold tracking-[-0.025em] sm:inline">Hive</span>
        </Link>
        <span className="text-[#d4d4d4]">/</span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[#3d3d3d]">{sessionTitle}</p>
          <p className="hidden truncate text-[10px] text-[#929292] md:block">
            {repository?.name ?? "Repository not attached"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden items-center gap-1.5 text-[11px] text-[#777] sm:flex">
          {syncError ? (
            <WifiOff className="size-3" />
          ) : (
            <span
              className={cn(
                "size-1.5 rounded-full bg-[#171717]",
                syncing && "animate-pulse bg-[#a1a1a1]",
              )}
            />
          )}
          {syncError ? "Offline" : syncing ? "Syncing" : "Live"}
        </div>
        <Button
          aria-label={lifecycle === "completed" ? "Reopen task" : "Complete task"}
          className="h-8 rounded-md bg-white px-2 text-xs text-[#333] sm:px-2.5"
          disabled={runActive || queueCount > 0}
          onClick={onToggleLifecycle}
          size="sm"
          title={lifecycle === "completed" ? "Reopen task" : "Complete task"}
          variant="outline"
        >
          <Check className="size-3.5" />
          <span className="hidden sm:inline">{lifecycle === "completed" ? "Reopen" : "Complete"}</span>
        </Button>
        <Button
          aria-label={copied ? "Invite link copied" : "Invite teammate"}
          className="h-8 rounded-md bg-white px-2 text-xs text-[#333] sm:px-2.5"
          onClick={onCopyInvite}
          size="sm"
          title={copied ? "Invite link copied" : "Invite teammate"}
          variant="outline"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
        </Button>
        <Button
          className="h-8 rounded-md bg-white px-2 text-xs text-[#333]"
          onClick={onSignOut}
          size="sm"
          title={`Sign out @${currentMember.githubLogin ?? currentMember.shortName}`}
          variant="outline"
        >
          <span className="grid size-4 place-items-center rounded-full bg-[#171717] text-[7px] font-semibold text-white">
            {currentMember.initials}
          </span>
          <span className="hidden sm:inline">{currentMember.shortName}</span>
        </Button>
        <div className="hidden sm:block">
          <MemberStack activeMembers={activeMembers} members={members} />
        </div>
        <Button
          aria-label="Reset session"
          className="size-8 rounded-md text-[#777]"
          disabled={lifecycle === "completed"}
          onClick={onReset}
          size="icon"
          title="Reset shared session"
          variant="ghost"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

function AnnotationCard({ members, queued, queuedBy, queuePosition, steered, steeredBy, onSteer, stage }: { members: TeamMember[]; queued: boolean; queuedBy?: MemberId; queuePosition?: number; steered: boolean; steeredBy?: MemberId; onSteer: () => void; stage: RunStage }) {
  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-[#d5d5d5] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between border-b border-[#eeeeee] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-full bg-[#171717] text-[7px] font-semibold text-white">MC</span>
          <span className="text-[11px] font-medium">Maya annotated Preview</span>
        </div>
        <span className="text-[11px] text-[#8a8a8a]">Preview</span>
      </div>
      <div className="space-y-2 px-3 py-3">
        <p className="text-[13px] font-medium leading-5">Keep the parent expanded, but highlight only the active child route.</p>
      </div>
      <div className="flex items-center justify-between gap-1.5 border-t border-[#eeeeee] bg-[#fafafa] px-2.5 py-2">
        {steered ? (
          <span className="flex items-center gap-1.5 px-1 text-[11px] font-medium"><Check className="size-3.5" /> Steered by {steeredBy ? resolveMember(steeredBy, members).shortName : "team"} · added to run</span>
        ) : queued ? (
          <span className="flex items-center gap-1.5 px-1 text-[11px] font-medium"><span className="grid size-4 place-items-center rounded bg-[#171717] text-[9px] text-white">{queuePosition ?? "·"}</span> Queued by {queuedBy ? resolveMember(queuedBy, members).shortName : "team"}</span>
        ) : (
          <>
            <span className="px-1 text-[11px] text-[#777]">{stage === "running" ? "Hive is working" : "Start a follow-up turn"}</span>
            <div className="flex items-center gap-1.5">
              <Button className="h-7 rounded-md text-xs" size="sm" variant="ghost">Reply</Button>
              <Button className="h-7 rounded-md bg-[#171717] px-2.5 text-xs text-white" onClick={onSteer} size="sm">{stage === "waiting" ? "Steer Hive" : "Queue steer"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SteeringQueue({ activeSteer, canApply, items, members, onApply, onMove, onRemove }: {
  activeSteer?: ActiveSteer;
  canApply: boolean;
  items: SteeringQueueItem[];
  members: TeamMember[];
  onApply: () => void;
  onMove: (steerId: string, direction: "up" | "down") => void;
  onRemove: (steerId: string) => void;
}) {
  if (!activeSteer && items.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-[#dedede] bg-[#f7f7f7] px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold">Queued steering</span>
          <span className="grid min-w-4 place-items-center rounded bg-[#171717] px-1 text-[9px] text-white">{items.length}</span>
        </div>
        {items.length > 0 ? (
          <Button className="h-7 rounded px-2 text-[11px]" disabled={!canApply} onClick={onApply} size="sm" variant="outline">
            <Play className="size-3" /> Apply next steer
          </Button>
        ) : null}
      </div>
      {activeSteer ? (
        <div className="mb-1.5 flex items-center gap-2 border border-[#171717] bg-[#171717] px-2 py-1.5 text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-white" />
          <span className="min-w-0 flex-1 truncate text-[11px]">Applying {resolveMember(activeSteer.authorId, members).shortName}’s steer</span>
        </div>
      ) : null}
      <div className="max-h-28 space-y-1 overflow-y-auto">
        {items.map((item, index) => {
          const member = resolveMember(item.authorId, members);
          return (
            <div className="group/queue flex items-center gap-2 border border-[#e3e3e3] bg-white px-2 py-1.5" key={item.id}>
              <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-[#171717] text-[9px] text-white">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{item.body}</p>
                <p className="mt-0.5 truncate text-[11px] text-[#8a8a8a]">{member.shortName}</p>
              </div>
              <div className="flex items-center opacity-0 transition group-hover/queue:opacity-100 group-focus-within/queue:opacity-100">
                <button aria-label={`Move steer ${index + 1} up`} className="grid size-5 place-items-center text-[#737373] hover:bg-[#f2f2f2] hover:text-[#171717] disabled:opacity-25" disabled={index === 0} onClick={() => onMove(item.id, "up")} type="button"><ArrowUp className="size-3" /></button>
                <button aria-label={`Move steer ${index + 1} down`} className="grid size-5 place-items-center text-[#737373] hover:bg-[#f2f2f2] hover:text-[#171717] disabled:opacity-25" disabled={index === items.length - 1} onClick={() => onMove(item.id, "down")} type="button"><ArrowDown className="size-3" /></button>
                <button aria-label={`Remove steer ${index + 1}`} className="grid size-5 place-items-center text-[#737373] hover:bg-[#f2f2f2] hover:text-[#171717]" onClick={() => onRemove(item.id)} type="button"><X className="size-3" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function annotationTime(createdAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(createdAt);
}

function AnnotationComposer({ sessionId, currentMember, message, onAnnotate, onCancel }: {
  sessionId: string;
  currentMember: MemberId;
  message: ChatMessage;
  onAnnotate: (messageId: string, submission: MessageSubmission) => Promise<boolean>;
  onCancel: (messageId: string) => void;
}) {
  const deliveredIds = useMemo(() => new Set(
    (message.annotations ?? []).filter((annotation) => annotation.authorId === currentMember && annotation.clientId).map((annotation) => annotation.clientId!),
  ), [currentMember, message.annotations]);
  const send = useCallback(async (submission: MessageSubmission) => {
    const delivered = await onAnnotate(message.id, submission);
    if (delivered) onCancel(message.id);
    return delivered;
  }, [message.id, onAnnotate, onCancel]);
  const { draft, edit, clear, submit } = useMessageDraft(
    `hive-draft:v1:${sessionId}:${currentMember}:annotation:${message.id}`,
    deliveredIds,
    send,
  );
  const sending = draft?.status === "sending";
  const cancel = () => { if (!sending) { clear(); onCancel(message.id); } };

  return <>
    <textarea
      aria-label={`Annotation for ${message.name}'s message`}
      autoFocus
      className="min-h-14 w-full resize-none bg-[#fafafa] px-2 py-1.5 text-[12px] leading-4 outline-none placeholder:text-[#a1a1a1]"
      disabled={!draft}
      maxLength={500}
      onChange={(event) => edit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && shouldSubmitMessage(event)) {
          event.preventDefault();
          void submit();
        }
        if (event.key === "Escape") cancel();
      }}
      placeholder="Add context, a concern, or a question for the team…"
      readOnly={sending}
      value={draft?.body ?? ""}
    />
    {draft?.status === "unconfirmed" ? <p className="mt-1 text-[11px] text-[#737373]" role="status">Delivery unconfirmed. Retry when connected.</p> : null}
    <div className="mt-2 flex justify-end gap-1.5">
      <Button className="h-7 rounded px-2.5 text-[11px]" disabled={sending} onClick={cancel} size="sm" variant="ghost">Cancel</Button>
      <Button className="h-7 rounded bg-[#171717] px-2.5 text-[11px] text-white" disabled={!draft?.body.trim() || sending} onClick={() => void submit()} size="sm">{sending ? "Sending…" : draft?.status === "unconfirmed" ? "Retry annotation" : "Add annotation"}</Button>
    </div>
  </>;
}

function SharedSession({ sessionId, activeMembers, activeSteer, canApplySteer, runActive, queued, queuedBy, queuePosition, steered, steeredBy, steeringQueue, currentMember, disabled, members, messages, onAdvance, onAnnotate, onMoveSteer, onRemoveSteer, onSteer, onSteerMessageAnnotation, onSend, onTyping, stage, typingMembers, workspaceAnnotation, compact = false }: {
  sessionId: string;
  activeMembers: MemberId[];
  activeSteer?: ActiveSteer;
  canApplySteer: boolean;
  runActive: boolean;
  queued: boolean;
  queuedBy?: MemberId;
  queuePosition?: number;
  steered: boolean;
  steeredBy?: MemberId;
  steeringQueue: SteeringQueueItem[];
  currentMember: MemberId;
  disabled: boolean;
  members: TeamMember[];
  messages: ChatMessage[];
  onAdvance: () => void;
  onAnnotate: (messageId: string, submission: MessageSubmission) => Promise<boolean>;
  onMoveSteer: (steerId: string, direction: "up" | "down") => void;
  onRemoveSteer: (steerId: string) => void;
  onSteer: () => void;
  onSteerMessageAnnotation: (messageId: string, annotationId: string) => void;
  onSend: (submission: MessageSubmission) => Promise<boolean>;
  onTyping: (typing: boolean) => void;
  stage: RunStage;
  typingMembers: MemberId[];
  workspaceAnnotation: string;
  compact?: boolean;
}) {
  const deliveredIds = useMemo(() => new Set(
    messages.filter((message) => message.memberId === currentMember && message.clientId).map((message) => message.clientId!),
  ), [currentMember, messages]);
  const messageDraft = useMessageDraft(`hive-draft:v1:${sessionId}:${currentMember}:message`, deliveredIds, onSend);
  const { draft } = messageDraft;
  const sending = draft?.status === "sending";
  const [annotationTarget, setAnnotationTarget] = useState<string | null>(null);
  const submit = useCallback(() => {
    if (disabled || !draft?.body.trim()) return;
    onTyping(false);
    void messageDraft.submit();
  }, [disabled, draft, messageDraft, onTyping]);

  const beginAnnotation = useCallback((messageId: string) => {
    setAnnotationTarget(messageId);
  }, []);

  const cancelAnnotation = useCallback((messageId: string) => {
    setAnnotationTarget((current) => current === messageId ? null : current);
  }, []);

  const otherTyping = typingMembers.filter((memberId) => memberId !== currentMember);

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center border-b border-[#ebebeb] px-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-[#666]" />
          <h2 className="text-xs font-semibold">Task conversation</h2>
          <span className="text-[11px] text-[#8a8a8a]">{activeMembers.length} online</span>
        </div>
      </div>
      <SteeringQueue activeSteer={activeSteer} canApply={canApplySteer} items={steeringQueue} members={members} onApply={onAdvance} onMove={onMoveSteer} onRemove={onRemoveSteer} />
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className={cn("gap-5 px-5 py-6", compact && "gap-4")}>
          {messages.map((message) => {
            const isCurrentMember = message.memberId === currentMember;
            const messageAnnotations = message.annotations ?? [];
            if (message.status === "error") {
              return (
                <div
                  className="flex items-center gap-2 px-1 text-[11px] text-[#8a8a8a]"
                  key={message.id}
                  role="status"
                >
                  <WifiOff className="size-3 shrink-0" />
                  <span>{displayHiveErrorMessage(message.body)}</span>
                  <span className="text-[10px] text-[#b0b0b0]">
                    {message.time}
                  </span>
                </div>
              );
            }
            return (
              <Message className="max-w-full gap-2" from={message.role === "agent" || !isCurrentMember ? "assistant" : "user"} key={message.id}>
                <div className={cn("flex items-center gap-2", isCurrentMember && "justify-end")}>
                  {message.role === "agent" ? <HiveMark className="size-5 rounded-full border border-[#dedede]" light /> : <span className="grid size-5 place-items-center rounded-full border border-[#dedede] bg-[#fafafa] text-[8px] font-semibold">{message.initials}</span>}
                  <span className="text-[12px] font-medium">{message.name}</span>
                  <span className="text-[10px] text-[#999]">{message.time}</span>
                  {message.role === "human" && !disabled ? (
                    <button
                      aria-label={`Annotate ${message.name}'s message`}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#8f8f8f] opacity-0 transition hover:bg-[#f2f2f2] hover:text-[#171717] focus:opacity-100 group-hover:opacity-100"
                      onClick={() => beginAnnotation(message.id)}
                      type="button"
                    >
                      <MessageSquarePlus className="size-3" /> Annotate
                    </button>
                  ) : null}
                </div>
                <MessageContent className={cn("w-fit max-w-[94%] rounded-lg border border-[#e8e8e8] px-3 py-2.5 text-[13px] leading-5 shadow-none", message.role === "agent" ? "bg-[#fafafa] text-[#4d4d4d]" : isCurrentMember ? "ml-auto bg-white" : "bg-white")}>
                  {message.role === "agent" ? <AgentResponse streaming={message.status === "streaming"}>{message.body}</AgentResponse> : message.body}
                </MessageContent>

                {messageAnnotations.length > 0 ? (
                  <div className={cn("w-[88%] space-y-2 border-l border-[#cfcfcf] pl-3", isCurrentMember ? "ml-auto border-l-0 border-r pr-3 text-right" : "ml-7")}>
                    {messageAnnotations.map((annotation) => {
                      const author = resolveMember(annotation.authorId, members);
                      return (
                        <div className="bg-[#fafafa] px-2.5 py-2 text-left" key={annotation.id}>
                          <div className="flex items-center gap-1.5">
                            <span className="grid size-4 place-items-center rounded-full bg-[#171717] text-[6px] font-semibold text-white">{author.initials}</span>
                            <span className="text-[11px] font-medium">{author.shortName}</span>
                            <span className="text-[10px] text-[#999]">{annotationTime(annotation.createdAt)}</span>
                          </div>
                          <p className="mt-1.5 text-[12px] leading-4 text-[#4d4d4d]">{annotation.body}</p>
                          <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#ebebeb] pt-1.5">
                            {annotation.status === "steered" ? (
                              <span className="flex items-center gap-1 text-[11px] text-[#666]"><Check className="size-3" /> Steered by {annotation.steeredBy ? resolveMember(annotation.steeredBy, members).shortName : "team"}</span>
                            ) : annotation.status === "queued" ? (
                              <span className="flex items-center gap-1 text-[11px] text-[#666]"><span className="grid size-4 place-items-center rounded-sm bg-[#171717] text-[9px] text-white">{steeringQueue.findIndex((item) => item.source.kind === "message-annotation" && item.source.annotationId === annotation.id) + 1}</span> Queued by {annotation.queuedBy ? resolveMember(annotation.queuedBy, members).shortName : "team"}</span>
                            ) : (
                              <div className="ml-auto">
                                <Button
                                  className="h-7 rounded px-2.5 text-[11px]"
                                  onClick={() => onSteerMessageAnnotation(message.id, annotation.id)}
                                  size="sm"
                                  title={runActive || steeringQueue.length > 0 ? "Queue this steer for Hive's next safe boundary" : "Promote this annotation into a follow-up turn"}
                                  variant="ghost"
                                >
                                  {runActive || steeringQueue.length > 0 ? "Queue steer" : "Steer Hive"}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {annotationTarget === message.id && !disabled ? (
                  <div className={cn("w-[88%] border border-[#d8d8d8] bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.05)]", isCurrentMember ? "ml-auto mr-0" : "ml-7")}>
                    <div className="mb-1.5">
                      <span className="text-[11px] text-[#737373]">Comment only — you can promote it to a steer later.</span>
                    </div>
                    <AnnotationComposer currentMember={currentMember} key={message.id} message={message} onAnnotate={onAnnotate} onCancel={cancelAnnotation} sessionId={sessionId} />
                  </div>
                ) : null}
              </Message>
            );
          })}
          {runActive && !activeSteer ? <p className="flex items-center gap-2 px-1 text-[11px] text-[#777]" role="status"><LoaderCircle className="size-3 animate-spin" /> Hive is working…</p> : null}
          {otherTyping.length > 0 ? <p className="px-1 text-[11px] text-[#8f8f8f]">{otherTyping.map((memberId) => resolveMember(memberId, members).shortName).join(", ")} {otherTyping.length === 1 ? "is" : "are"} typing…</p> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {workspaceAnnotation ? <AnnotationCard members={members} onSteer={onSteer} queuePosition={queuePosition} queued={queued} queuedBy={queuedBy} stage={stage} steered={steered} steeredBy={steeredBy} /> : null}
      <div className="border-t border-[#ebebeb] bg-[#fafafa] p-3">
        <div className="rounded-xl border border-[#d9d9d9] bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus-within:border-[#999]">
          <div className="flex items-end gap-2">
          <MentionInput
            currentMember={currentMember}
            disabled={disabled || !draft}
            members={members}
            onChange={(value) => {
              messageDraft.edit(value);
              onTyping(Boolean(value.trim()));
            }}
            onSubmit={submit}
            readOnly={sending}
            value={draft?.body ?? ""}
          />
            <Button
              aria-label={sending ? "Sending message" : draft?.status === "unconfirmed" ? "Retry message" : "Send message"}
              className="size-8 rounded-lg"
              disabled={disabled || !draft?.body.trim() || sending}
              onClick={submit}
              size="icon"
            >
              {sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>
        </div>
        {draft?.status === "unconfirmed" ? <p className="mt-1.5 px-1 text-[11px] text-[#737373]" role="status">Delivery unconfirmed. Retry when connected.</p> : null}
      </div>
    </section>
  );
}

function RepositorySetup({ sessionId }: { sessionId: string }) {
  const [repositories, setRepositories] = useState<RepositoryOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectingId, setConnectingId] = useState<number | null>(null);
  const [needsInstallation, setNeedsInstallation] = useState(false);
  const [error, setError] = useState("");
  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return repositories ?? [];
    return (repositories ?? []).filter((candidate) =>
      candidate.name.toLowerCase().includes(normalizedQuery),
    );
  }, [query, repositories]);

  const loadRepositories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/github/repositories?session_id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const payload = (await response.json()) as {
        error?: string;
        needsInstallation?: boolean;
        repositories?: RepositoryOption[];
      };
      if (!response.ok || !Array.isArray(payload.repositories)) {
        throw new Error(payload.error || "Repositories are unavailable.");
      }
      setNeedsInstallation(payload.needsInstallation === true);
      setRepositories(payload.repositories);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Repositories are unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const connectRepository = useCallback(async (repositoryId: number) => {
    setConnectingId(repositoryId);
    setError("");
    try {
      const response = await fetch(
        `/api/github/repositories?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryId }),
        },
      );
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Repository connection failed.");
      }
    } catch (connectError) {
      setConnectingId(null);
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Repository connection failed.",
      );
    }
  }, [sessionId]);

  return (
    <div className="hairline-grid flex h-full min-h-[420px] items-center justify-center bg-[#fafafa] p-8">
      <div className="w-full max-w-lg rounded-xl border border-[#dcdcdc] bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.05)]">
        <FolderGit2 className="size-7" />
        <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em]">Attach a repository</h3>
        <p className="mt-2 text-sm leading-6 text-[#737373]">The conversation can start without code. When the task is ready, attach one repository from the team&apos;s GitHub access.</p>

        {needsInstallation ? (
          <a className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black" href={`/api/github/install?session_id=${encodeURIComponent(sessionId)}`}>
            <FolderGit2 className="size-4" /> Connect team GitHub
          </a>
        ) : repositories ? (
          <div className="mt-5">
            {repositories.length > 5 ? (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8a8a8a]" />
                <Input
                  aria-label="Search repositories"
                  className="h-9 rounded-md border-[#dedede] pl-9 text-xs shadow-none"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search repositories"
                  value={query}
                />
              </div>
            ) : null}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[#e5e5e5]">
              {filteredRepositories.map((candidate) => (
                <button
                  className="flex w-full items-center justify-between gap-4 border-b border-[#eeeeee] px-3 py-3 text-left transition last:border-b-0 hover:bg-[#fafafa] disabled:cursor-wait disabled:opacity-60"
                  disabled={connectingId !== null}
                  key={candidate.id}
                  onClick={() => void connectRepository(candidate.id)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{candidate.name}</span>
                    <span className="mt-0.5 block text-[11px] text-[#888]">{candidate.defaultBranch} · {candidate.visibility}</span>
                  </span>
                  {connectingId === candidate.id ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <span className="shrink-0 text-[11px] font-medium text-[#666]">Select</span>}
                </button>
              ))}
              {filteredRepositories.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-[#888]">
                  {repositories.length === 0
                    ? "No repositories are authorized for the team."
                    : "No matching repositories."}
                </p>
              ) : null}
            </div>
            <Button className="mt-2 h-8 px-2 text-[11px]" disabled={loading || connectingId !== null} onClick={() => void loadRepositories()} size="sm" variant="ghost">Refresh repositories</Button>
          </div>
        ) : (
          <Button className="mt-5 h-10 rounded-md px-4 text-sm" disabled={loading} onClick={() => void loadRepositories()}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <FolderGit2 className="size-4" />}
            {loading ? "Loading repositories…" : "Choose repository"}
          </Button>
        )}
        {error ? <p className="mt-3 text-xs leading-5 text-[#777]">{error}</p> : null}
        <p className="mt-3 font-mono text-[9px] text-[#a1a1a1]">Team access · one repository per task · short-lived credential</p>
      </div>
    </div>
  );
}

function FilesPane({ files }: { files: WorkspaceState["files"] }) {
  const [selected, setSelected] = useState("");
  const selectedFile = files.find((file) => file.path === selected) ?? files[0];
  if (!selectedFile) {
    return <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center"><div><FileCode2 className="mx-auto size-6 text-[#737373]" /><p className="mt-3 text-sm font-medium">No changed files yet</p><p className="mt-1 text-xs text-[#8f8f8f]">Review file snapshots here after Hive makes a change.</p></div></div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-white sm:flex-row">
      <nav aria-label="Changed files" className="flex max-h-36 shrink-0 gap-1 overflow-auto border-b border-[#ebebeb] bg-[#fafafa] p-2 sm:max-h-none sm:w-40 sm:flex-col sm:border-b-0 sm:border-r lg:w-52">
        {files.map((file) => (
          <button
            aria-current={selectedFile.path === file.path ? "true" : undefined}
            className={cn("shrink-0 truncate rounded px-2 py-2 text-left font-mono text-[11px] text-[#737373] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#737373] sm:w-full", selectedFile.path === file.path && "bg-white text-[#171717]")}
            key={file.path}
            onClick={() => setSelected(file.path)}
            title={file.path}
            type="button"
          >
            {file.path}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-[#ebebeb] px-4 py-2 text-[11px] text-[#737373]">
          <span className="min-w-0 flex-1 truncate font-mono" title={selectedFile.path}>{selectedFile.path}</span>
          <span className="shrink-0">Snapshot · Read-only</span>
        </div>
        <div className="min-h-0 flex-1">
          <CodeViewer content={selectedFile.content} path={selectedFile.path} />
        </div>
      </div>
    </div>
  );
}

function RunsPane({ commands }: { commands: WorkspaceState["commands"] }) {
  if (commands.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center">
        <div>
          <ListChecks className="mx-auto size-6 text-[#737373]" />
          <p className="mt-3 text-sm font-medium">No runs yet</p>
          <p className="mt-1 text-xs text-[#8f8f8f]">
            Commands executed by Hive will appear here for the team to review.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white">
      {commands.map((command, index) => {
        const succeeded = command.exitCode === 0;
        return (
          <details
            className="group border-b border-[#e9e9e9] last:border-b-0"
            key={`${index}-${command.command}`}
          >
            <summary className="grid cursor-pointer list-none grid-cols-[24px_minmax(0,1fr)_auto_auto_16px] items-center gap-3 px-4 py-3.5 transition hover:bg-[#fafafa] [&::-webkit-details-marker]:hidden">
              <span className="grid size-6 place-items-center rounded-full border border-[#dedede] font-mono text-[9px] text-[#737373]">
                {index + 1}
              </span>
              <code className="truncate font-mono text-[12px] text-[#292929]">
                {command.command}
              </code>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-[10px] font-medium",
                  succeeded ? "text-[#3d3d3d]" : "text-[#737373]",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    succeeded ? "bg-[#171717]" : "bg-[#a1a1a1]",
                  )}
                />
                {succeeded ? "Passed" : command.exitCode === null ? "Incomplete" : `Failed · ${command.exitCode}`}
              </span>
              <span className="font-mono text-[10px] text-[#999]">
                {command.durationMs ? `${command.durationMs}ms` : "—"}
              </span>
              <ChevronDown className="size-3.5 text-[#999] transition-transform group-open:rotate-180" />
            </summary>
            <pre className="overflow-x-auto border-t border-[#242424] bg-[#0a0a0a] px-4 py-4 font-mono text-[11px] leading-5 text-[#d8d8d8]">
              {command.output || "No output"}
            </pre>
          </details>
        );
      })}
    </div>
  );
}

function Workspace({ repository, sessionId, tab, workspace, onTabChange }: { repository?: RepositoryState; sessionId: string; tab: WorkspaceTab; workspace: WorkspaceState; onTabChange: (tab: WorkspaceTab) => void }) {
  if (!repository) {
    return (
      <section className="h-full min-h-0 bg-white">
        <RepositorySetup sessionId={sessionId} />
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center border-b border-[#ebebeb] bg-white px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                className={cn(
                  "h-7 rounded-md px-2.5 text-[11px] text-[#777]",
                  tab === item.key && "bg-[#f1f1f1] text-[#171717]",
                )}
                key={item.key}
                onClick={() => onTabChange(item.key)}
                size="sm"
                variant="ghost"
              >
                <Icon className="size-3.5" /> {item.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">{tab === "diff" ? <DiffPane diff={workspace.diff} /> : null}{tab === "files" ? <FilesPane files={workspace.files} /> : null}{tab === "runs" ? <RunsPane commands={workspace.commands} /> : null}</div>
    </section>
  );
}

function RunBar({ activeSteer, completed, reviewReady, runActive, queueCount, repository, stage, onAdvance }: { activeSteer?: ActiveSteer; completed: boolean; reviewReady: boolean; runActive: boolean; queueCount: number; repository?: RepositoryState; stage: RunStage; onAdvance: () => void }) {
  const action = completed ? "Task complete" : runActive ? activeSteer ? "Applying queued steer" : "Hive is working" : queueCount > 0 ? "Steers queued" : reviewReady ? "Approve changes" : stage === "approved" ? "Approved" : "Send Hive a task";
  const Icon = reviewReady || stage === "approved" ? Check : Play;
  const disabled = !reviewReady;
  const detail = completed
    ? "This task is read-only until a teammate reopens it."
    : !repository
      ? "Planning mode · discuss intent now, attach code when the team is ready."
      : queueCount > 0
        ? runActive ? `${queueCount} steer${queueCount === 1 ? "" : "s"} waiting for this run to finish.` : "Apply the next steer from the conversation."
        : stageCopy[stage === "review" && !reviewReady ? "waiting" : stage].detail;
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-[#ebebeb] bg-[#fafafa] px-3 sm:px-4">
      <p className="min-w-0 truncate text-[11px] text-[#777]">
        {detail}
      </p>
      {repository ? (
        <Button
          className="h-8 shrink-0 rounded-md bg-[#171717] px-3 text-xs text-white"
          disabled={disabled}
          onClick={onAdvance}
          size="sm"
        >
          <Icon className="size-3.5" /> {action}
        </Button>
      ) : (
        <span className="shrink-0 rounded border border-[#dedede] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#888]">
          Planning
        </span>
      )}
    </div>
  );
}

type SharedProps = Parameters<typeof SharedSession>[0] & {
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
};

export function HiveWorkspace({
  currentMember,
  initialSnapshot,
  inviteToken,
  sessionId,
  sessionTitle,
}: {
  currentMember: TeamMember;
  initialSnapshot: TaskSessionSnapshot;
  inviteToken: string;
  sessionId: string;
  sessionTitle: string;
}) {
  const [pane, setPane] = useState<"chat" | "workspace">("chat");
  const [tab, setTab] = useState<WorkspaceTab>("diff");
  const [copied, setCopied] = useState(false);
  const { dispatch, setTyping, snapshot, syncing, syncError } = useSharedSession(sessionId, initialSnapshot);
  const { session, activeMembers, members, typingMembers } = snapshot;
  const teamMembers = useMemo(
    () => [currentMember, ...members.filter((member) => member.id !== currentMember.id)],
    [currentMember, members],
  );
  const { activeSteer, annotation, lifecycle, repository, stage, steeringQueue, workspace } = session;
  const messages = useMemo(() => conversationMessages(session), [session]);
  const runActive = isHiveRunActive(session);
  const canApplySteer = canApplyNextSteer(session);
  const steered = annotation.status === "steered";
  const queued = annotation.status === "queued";
  const queuePosition = steeringQueue.findIndex(
    (item) => item.source.kind === "workspace-annotation",
  ) + 1;

  const copyInvite = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("invite", inviteToken);
    url.hash = "";
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  }, [inviteToken]);
  const signOut = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST" }).then(() => {
      window.location.reload();
    });
  }, []);
  const annotate = useCallback(async (messageId: string, { body, clientId }: MessageSubmission) => {
    const nextSnapshot = await dispatch({ type: "annotate-message", messageId, body, clientId });
    return nextSnapshot?.session.messages.find((message) => message.id === messageId)?.annotations?.some(
      (annotation) => annotation.authorId === currentMember.id && annotation.clientId === clientId && annotation.body === body,
    ) ?? false;
  }, [currentMember.id, dispatch]);
  const steer = useCallback(() => { void dispatch({ type: "steer-agent" }); }, [dispatch]);
  const steerMessageAnnotation = useCallback((messageId: string, annotationId: string) => {
    void dispatch({ type: "steer-message-annotation", messageId, annotationId });
  }, [dispatch]);
  const moveSteer = useCallback((steerId: string, direction: "up" | "down") => {
    void dispatch({ type: "reorder-queued-steer", steerId, direction });
  }, [dispatch]);
  const removeSteer = useCallback((steerId: string) => {
    void dispatch({ type: "remove-queued-steer", steerId });
  }, [dispatch]);
  const send = useCallback(async ({ body, clientId }: MessageSubmission) => {
    if (
      repository &&
      !isDirectedAtTeammate(body, currentMember.id, teamMembers)
    ) {
      setTab("runs");
    }
    const nextSnapshot = await dispatch({ type: "send-message", body, clientId });
    if (nextSnapshot?.session.stage === "review") setTab("diff");
    return nextSnapshot?.session.messages.some(
      (message) => message.memberId === currentMember.id && message.clientId === clientId && message.body === body,
    ) ?? false;
  }, [currentMember.id, dispatch, repository, teamMembers]);
  const advance = useCallback(() => {
    const action = canApplySteer
      ? ({ type: "apply-next-steer" } as const)
      : ({ type: "advance-run" } as const);
    void dispatch(action).then((nextSnapshot) => {
      if (nextSnapshot?.session.stage === "review") setTab("diff");
    });
  }, [canApplySteer, dispatch]);
  const reset = useCallback(() => {
    setPane("chat");
    setTab("diff");
    void dispatch({ type: "reset" });
  }, [dispatch]);
  const toggleLifecycle = useCallback(() => {
    void dispatch({
      type: lifecycle === "completed" ? "reopen-session" : "complete-session",
    });
  }, [dispatch, lifecycle]);

  const shared = useMemo<SharedProps>(() => ({
    sessionId,
    activeMembers,
    activeSteer,
    canApplySteer,
    runActive,
    queued,
    queuedBy: annotation.queuedBy,
    queuePosition: queuePosition || undefined,
    steered,
    steeredBy: annotation.steeredBy,
    currentMember: currentMember.id,
    disabled: lifecycle === "completed",
    members: teamMembers,
    messages,
    stage,
    tab,
    typingMembers,
    steeringQueue,
    workspaceAnnotation: annotation.text,
    onAnnotate: annotate,
    onMoveSteer: moveSteer,
    onRemoveSteer: removeSteer,
    onSteer: steer,
    onSteerMessageAnnotation: steerMessageAnnotation,
    onSend: send,
    onTyping: setTyping,
    onAdvance: advance,
    onTabChange: setTab,
  }), [activeMembers, activeSteer, advance, annotate, annotation.queuedBy, annotation.steeredBy, annotation.text, canApplySteer, currentMember.id, lifecycle, messages, moveSteer, queuePosition, queued, removeSteer, runActive, send, sessionId, setTyping, stage, steer, steerMessageAnnotation, steered, steeringQueue, tab, teamMembers, typingMembers]);

  return (
    <main className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-[#fafafa] text-[#171717]">
      <ProductHeader activeMembers={activeMembers} copied={copied} currentMember={currentMember} lifecycle={lifecycle} members={teamMembers} onCopyInvite={copyInvite} onSignOut={signOut} onReset={reset} onToggleLifecycle={toggleLifecycle} repository={repository} sessionTitle={sessionTitle} runActive={runActive} queueCount={steeringQueue.length} syncing={syncing} syncError={syncError} />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[#e8e8e8] bg-[#fafafa] p-1 min-[960px]:hidden">
        <button
          aria-pressed={pane === "chat"}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] text-[#777]",
            pane === "chat" && "border border-[#e1e1e1] bg-white text-[#171717] shadow-sm",
          )}
          onClick={() => setPane("chat")}
          type="button"
        >
          <MessageSquare className="size-3.5" /> Conversation
        </button>
        <button
          aria-pressed={pane === "workspace"}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] text-[#777]",
            pane === "workspace" && "border border-[#e1e1e1] bg-white text-[#171717] shadow-sm",
          )}
          onClick={() => setPane("workspace")}
          type="button"
        >
          <Code2 className="size-3.5" /> Workspace
          {workspace.changedFiles.length > 0 ? (
            <span className="grid size-4 place-items-center rounded-full bg-[#171717] font-mono text-[8px] text-white">
              {workspace.changedFiles.length}
            </span>
          ) : null}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 min-[960px]:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <div
          className={cn(
            "min-h-0 border-r border-[#ebebeb]",
            pane !== "chat" && "hidden min-[960px]:block",
          )}
        >
          <SharedSession {...shared} compact />
        </div>
        <div
          className={cn(
            "min-h-0 flex-col",
            pane === "workspace" ? "flex" : "hidden min-[960px]:flex",
          )}
        >
          <div className="min-h-0 flex-1">
            <Workspace repository={repository} sessionId={sessionId} tab={shared.tab} workspace={workspace} onTabChange={shared.onTabChange} />
          </div>
          <RunBar activeSteer={activeSteer} completed={lifecycle === "completed"} reviewReady={canApproveChanges(session)} runActive={runActive} queueCount={steeringQueue.length} repository={repository} stage={shared.stage} onAdvance={shared.onAdvance} />
        </div>
      </div>
    </main>
  );
}
