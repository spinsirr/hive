"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  History,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Play,
  RotateCcw,
  Search,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useHiveClient } from "@/components/hive/hive-client";
import { TaskArchiveControl } from "@/components/hive/task-archive-control";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ConversationComposer } from "@/components/hive/conversation-composer";
import { ConversationMessage } from "@/components/hive/conversation-message";
import { DiffPane } from "@/components/hive/diff-pane";
import { MessageThread } from "@/components/hive/message-thread";
import { MessageTime } from "@/components/hive/message-time";
import { PeerRequestSummary } from "@/components/hive/peer-request-summary";
import { WorkspaceSplit } from "@/components/hive/workspace-split";
import { WorkspaceFiles } from "@/components/hive/workspace-files";
import { WorkspaceCheckpoints } from "@/components/hive/workspace-checkpoints";
import { RunsPane } from "@/components/hive/workspace-runs";
import type { AnnotateCode } from "@/components/hive/code-annotation-composer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSharedSession } from "@/hooks/use-shared-session";
import { HiveMark } from "@/components/hive/hive-mark";
import { useMessageDraft } from "@/hooks/use-message-draft";
import { useStalledRun } from "@/hooks/use-stalled-run";
import type { MessageSubmission } from "@/lib/message-draft";
import type { CodingEffort } from "@/lib/coding-effort";
import type { CodingModelOption } from "@/lib/coding-models";
import { displayHiveErrorMessage } from "@/lib/hive-error-copy";
import { workspaceReadRevision } from "@/lib/workspace-files";
import { canResolvePeerReview } from "@/lib/peer-collaboration";
import {
  type ActiveSteer,
  type ChatMessage,
  canApplyNextSteer,
  canArchiveTask,
  canSelectHarness,
  canSetCodingEffort,
  type CodingRuntime,
  isHiveRunActive,
  conversationMessages,
  isDirectedAtTeammate,
  STALLED_RUN_AFTER_MS,
  type MemberId,
  type RepositoryState,
  resolveMember,
  type RunStage,
  type SteeringQueueItem,
  type TeamMember,
  type WorkspaceState,
} from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";
import { cn } from "@/lib/utils";

type WorkspaceTab = "diff" | "files" | "runs" | "checkpoints";

type RepositoryOption = {
  id: number;
  name: string;
  defaultBranch: string;
  visibility: "private" | "public";
};

const tabs: Array<{ key: WorkspaceTab; label: string; icon: typeof Code2 }> = [
  { key: "diff", label: "Diff", icon: Code2 },
  { key: "files", label: "Files", icon: FileCode2 },
  { key: "runs", label: "Runs", icon: ListChecks },
  { key: "checkpoints", label: "Checkpoints", icon: History },
];

function OnlineMembers({
  activeMembers,
  members,
}: {
  activeMembers: MemberId[];
  members: TeamMember[];
}) {
  const onlineMembers = members.filter((member) => activeMembers.includes(member.id));

  if (onlineMembers.length === 0) return null;

  return (
    <div aria-label="Online in this task" className="flex items-center" role="group">
      {onlineMembers.map((member, index) => (
        <span
          aria-label={`${member.name} · online`}
          className={cn(
            "relative grid size-7 place-items-center rounded-full border border-[#d8d8d8] bg-white text-xs font-semibold",
            index > 0 && "-ml-1.5",
            index === 0 && "bg-[#171717] text-white",
          )}
          key={member.id}
          role="img"
          title={`${member.name} · online`}
        >
          {member.initials}
          <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-white bg-[#171717]" />
        </span>
      ))}
    </div>
  );
}

function ProductHeader({
  activeMembers,
  copied,
  currentMember,
  members,
  repository,
  sessionTitle,
  resetDisabled,
  syncing,
  syncError,
  onCopyInvite,
  onSignOut,
  onReset,
  homeHref,
  connectionLabel,
  accountActionsDisabled,
  archived,
  archiveDisabled,
  onArchiveChange,
}: {
  activeMembers: MemberId[];
  copied: boolean;
  currentMember: TeamMember;
  members: TeamMember[];
  repository?: RepositoryState;
  sessionTitle: string;
  resetDisabled: boolean;
  syncing: boolean;
  syncError: boolean;
  onCopyInvite: () => void;
  onSignOut: () => void;
  onReset: () => void;
  homeHref: string;
  connectionLabel: string;
  accountActionsDisabled: boolean;
  archived: boolean;
  archiveDisabled: boolean;
  onArchiveChange: (archived: boolean) => Promise<void>;
}) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[#e8e8e8] bg-white px-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link className="flex shrink-0 items-center gap-2.5" href={homeHref}>
          <HiveMark className="size-7" />
          <span className="hidden text-sm font-semibold tracking-[-0.025em] sm:inline">Hive</span>
        </Link>
        <span className="text-[#d4d4d4]">/</span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[#3d3d3d]">{sessionTitle}</p>
          <p className="hidden truncate text-xs text-[#929292] md:block">
            {repository?.name ?? "Repository not attached"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <TaskArchiveControl title={sessionTitle} archived={archived} disabled={archiveDisabled} onChange={onArchiveChange} />
        <div className="hidden items-center gap-1.5 text-xs text-[#777] sm:flex">
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
          {syncError ? "Offline" : syncing ? "Syncing" : connectionLabel}
        </div>
        <Button
          aria-label={copied ? "Invite link copied" : "Invite teammate"}
          disabled={accountActionsDisabled}
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
          disabled={accountActionsDisabled}
          size="sm"
          title={`Sign out @${currentMember.githubLogin ?? currentMember.shortName}`}
          variant="outline"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#171717] text-xs font-semibold text-white">
            {currentMember.initials}
          </span>
          <span className="hidden sm:inline">{currentMember.shortName}</span>
        </Button>
        <div className="hidden sm:block">
          <OnlineMembers activeMembers={syncError ? [] : activeMembers} members={members} />
        </div>
        <Button
          aria-label="Reset session"
          className="size-8 rounded-md text-[#777]"
          disabled={resetDisabled}
          onClick={onReset}
          size="icon"
          title={resetDisabled ? "Reset is unavailable while Hive is working or steers are waiting" : "Reset shared session"}
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
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#171717] text-xs font-semibold text-white">MC</span>
          <span className="text-xs font-medium">Maya annotated Preview</span>
        </div>
        <span className="text-xs text-[#8a8a8a]">Preview</span>
      </div>
      <div className="space-y-2 px-3 py-3">
        <p className="text-sm font-medium leading-5">Keep the parent expanded, but highlight only the active child route.</p>
      </div>
      <div className="flex items-center justify-between gap-1.5 border-t border-[#eeeeee] bg-[#fafafa] px-2.5 py-2">
        {steered ? (
          <span className="flex items-center gap-1.5 px-1 text-xs font-medium"><Check className="size-3.5" /> Steered by {steeredBy ? resolveMember(steeredBy, members).shortName : "team"} · added to run</span>
        ) : queued ? (
          <span className="flex items-center gap-1.5 px-1 text-xs font-medium"><span className="grid h-5 min-w-5 shrink-0 place-items-center rounded bg-[#171717] px-1 text-xs text-white">{queuePosition ?? "·"}</span> Queued by {queuedBy ? resolveMember(queuedBy, members).shortName : "team"}</span>
        ) : (
          <>
            <span className="px-1 text-xs text-[#777]">{stage === "running" ? "Hive is working" : "Start a follow-up turn"}</span>
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
          <span className="text-xs font-semibold">Queued steering</span>
          <span className="grid min-w-4 place-items-center rounded bg-[#171717] px-1 text-xs text-white">{items.length}</span>
        </div>
        {items.length > 0 ? (
          <Button className="h-7 rounded px-2 text-xs" disabled={!canApply} onClick={onApply} size="sm" variant="outline">
            <Play className="size-3" /> Apply next steer
          </Button>
        ) : null}
      </div>
      {activeSteer ? (
        <div className="mb-1.5 flex items-center gap-2 border border-[#171717] bg-[#171717] px-2 py-1.5 text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-white" />
          <span className="min-w-0 flex-1 truncate text-xs">Applying {resolveMember(activeSteer.authorId, members).shortName}’s steer</span>
        </div>
      ) : null}
      <div className="max-h-28 space-y-1 overflow-y-auto">
        {items.map((item, index) => {
          const member = resolveMember(item.authorId, members);
          return (
            <div className="group/queue flex items-center gap-2 border border-[#e3e3e3] bg-white px-2 py-1.5" key={item.id}>
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-sm bg-[#171717] px-1 text-xs text-white">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{item.source.kind === "message-thread" ? item.sourceLabel : item.body}</p>
                <p className="mt-0.5 truncate text-xs text-[#8a8a8a]">{member.shortName}</p>
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

function SharedSession({ sessionId, activeMembers, activeSteer, canApplySteer, runActive, runStalled, onRecoverRun, queued, queuedBy, queuePosition, steered, steeredBy, steeringQueue, currentMember, disabled, members, messages, onApplySteer, onOpenThread, onSteerReply, selectedThreadId, onMoveSteer, onRemoveSteer, onSteer, onSend, onTyping, stage, typingMembers, workspaceAnnotation, codingRuntime, codingModel, codingModels, harnessLocked, harnessDisabled, onSelectHarness, effort, effortLocked, onEffortChange, compact = false }: {
  sessionId: string;
  activeMembers: MemberId[];
  activeSteer?: ActiveSteer;
  canApplySteer: boolean;
  runActive: boolean;
  runStalled: boolean;
  onRecoverRun: () => void;
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
  onApplySteer: () => void;
  onOpenThread: (messageId: string) => void;
  onSteerReply: (messageId: string, replyId: string) => void;
  selectedThreadId: string | null;
  onMoveSteer: (steerId: string, direction: "up" | "down") => void;
  onRemoveSteer: (steerId: string) => void;
  onSteer: () => void;
  onSend: (submission: MessageSubmission) => Promise<boolean>;
  onTyping: (typing: boolean) => void;
  stage: RunStage;
  typingMembers: MemberId[];
  workspaceAnnotation: string;
  codingRuntime: CodingRuntime;
  codingModel?: string;
  codingModels?: CodingModelOption[];
  harnessLocked: boolean;
  harnessDisabled: boolean;
  onSelectHarness: (runtime: CodingRuntime, modelId: string) => void;
  effort: CodingEffort;
  effortLocked: boolean;
  onEffortChange: (effort: CodingEffort, modelId?: string) => void;
  compact?: boolean;
}) {
  const deliveredIds = useMemo(() => new Set(
    messages.filter((message) => message.memberId === currentMember && message.clientId).map((message) => message.clientId!),
  ), [currentMember, messages]);
  const messageDraft = useMessageDraft(`hive-draft:v1:${sessionId}:${currentMember}:message`, deliveredIds, onSend);
  const { draft } = messageDraft;
  const sending = draft?.status === "sending";
  const submit = useCallback(() => {
    if (disabled || !draft?.body.trim()) return;
    onTyping(false);
    void messageDraft.submit();
  }, [disabled, draft, messageDraft, onTyping]);

  const otherTyping = typingMembers.filter((memberId) => memberId !== currentMember);

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center border-b border-[#ebebeb] px-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-[#666]" />
          <h2 className="text-xs font-semibold">Task conversation</h2>
          <span className="text-xs text-[#8a8a8a]">{activeMembers.length} online</span>
        </div>
      </div>
      <SteeringQueue activeSteer={activeSteer} canApply={canApplySteer} items={steeringQueue} members={members} onApply={onApplySteer} onMove={onMoveSteer} onRemove={onRemoveSteer} />
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className={cn("gap-7 px-4 py-5 sm:px-6 sm:py-7", compact && "gap-5")}>
          {messages.map((message) => {
            if (message.status === "error") {
              return (
                <div
                  className="flex items-center gap-2 px-1 text-xs text-[#8a8a8a]"
                  key={message.id}
                  role="status"
                >
                  <WifiOff className="size-3 shrink-0" />
                  <span>{displayHiveErrorMessage(message.body)}</span>
                  <MessageTime className="text-xs text-[#b0b0b0]" message={message} />
                </div>
              );
            }
            return (
              <ConversationMessage key={message.id} message={message} currentMember={currentMember} members={members} sessionId={sessionId} disabled={disabled} runActive={runActive} queueing={runActive || steeringQueue.length > 0} selected={selectedThreadId === message.id} onOpenThread={onOpenThread} onSteerReply={onSteerReply} />
            );
          })}
          {runActive && runStalled ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#e8e8e8] bg-[#fafafa] px-3 py-2 text-xs text-[#525252]" role="status">
              <WifiOff className="size-3 shrink-0" />
              <span className="min-w-0 flex-1">Hive hasn’t reported for over {STALLED_RUN_AFTER_MS / 60_000} minutes; its execution process was probably lost. Marking it lost keeps the discussion, partial output and queued steers, and reruns nothing.</span>
              <Button className="h-7 rounded px-2 text-xs" disabled={disabled} onClick={onRecoverRun} size="sm" variant="outline">Mark run as lost</Button>
            </div>
          ) : runActive && !activeSteer ? <p className="flex items-center gap-2 px-1 text-xs text-[#777]" role="status"><LoaderCircle className="size-3 animate-spin" /> Hive is working…</p> : null}
          {otherTyping.length > 0 ? <p className="px-1 text-xs text-[#8f8f8f]">{otherTyping.map((memberId) => resolveMember(memberId, members).shortName).join(", ")} {otherTyping.length === 1 ? "is" : "are"} typing…</p> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {workspaceAnnotation ? <AnnotationCard members={members} onSteer={onSteer} queuePosition={queuePosition} queued={queued} queuedBy={queuedBy} stage={stage} steered={steered} steeredBy={steeredBy} /> : null}
      <ConversationComposer
        value={draft?.body ?? ""}
        onChange={(value) => { messageDraft.edit(value); onTyping(Boolean(value.trim())); }}
        onSubmit={submit}
        currentMember={currentMember}
        members={members}
        disabled={disabled || !draft}
        sending={sending}
        unconfirmed={draft?.status === "unconfirmed"}
        queueing={runActive || steeringQueue.length > 0}
        runtime={codingRuntime}
        modelId={codingModel}
        models={codingModels}
        agentLocked={harnessLocked}
        agentDisabled={harnessDisabled}
        effort={effort}
        effortLocked={effortLocked}
        onEffortChange={onEffortChange}
        onSelectAgent={onSelectHarness}
      />
    </section>
  );
}

function RepositorySetup({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const client = useHiveClient();
  const [repositories, setRepositories] = useState<RepositoryOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectingId, setConnectingId] = useState<number | null>(null);
  const [needsInstallation, setNeedsInstallation] = useState(false);
  const [needsAuthorization, setNeedsAuthorization] = useState(false);
  const [error, setError] = useState("");
  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return repositories ?? [];
    return (repositories ?? []).filter((candidate) =>
      candidate.name.toLowerCase().includes(normalizedQuery),
    );
  }, [query, repositories]);

  const loadRepositories = useCallback(async () => {
    if (disabled) return;
    setLoading(true);
    setError("");
    try {
      const response = await client.request(
        `/api/github/repositories?session_id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        client.reload();
        return;
      }
      const payload = (await response.json()) as {
        error?: string;
        needsInstallation?: boolean;
        needsAuthorization?: boolean;
        repositories?: RepositoryOption[];
      };
      setNeedsAuthorization(payload.needsAuthorization === true);
      if (payload.needsAuthorization) {
        setRepositories(null);
        return;
      }
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
  }, [sessionId, client, disabled]);

  const connectRepository = useCallback(async (repositoryId: number) => {
    if (disabled) return;
    setConnectingId(repositoryId);
    setError("");
    try {
      const response = await client.request(
        `/api/github/repositories?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryId }),
        },
      );
      if (response.status === 401) {
        client.reload();
        return;
      }
      const payload = (await response.json()) as { error?: string; needsAuthorization?: boolean };
      if (payload.needsAuthorization) {
        setNeedsAuthorization(true);
        setRepositories(null);
        setConnectingId(null);
        return;
      }
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
  }, [sessionId, client, disabled]);

  return (
    <fieldset disabled={disabled} className="hairline-grid flex h-full min-h-[420px] items-center justify-center bg-[#fafafa] p-8">
      <div className="w-full max-w-lg rounded-xl border border-[#dcdcdc] bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.05)]">
        <FolderGit2 className="size-7" />
        <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em]">Attach a repository</h3>
        <p className="mt-2 text-sm leading-6 text-[#737373]">{disabled ? "Restore this archived task before attaching a repository." : "Choose a repository you can access on GitHub. Everyone invited to this task can work on its shared copy."}</p>

        {disabled ? null : needsAuthorization ? (
          <a className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black" href={`/api/github/login?return_to=${encodeURIComponent(`/sessions/${sessionId}`)}`}>
            <FolderGit2 className="size-4" /> Reconnect GitHub
          </a>
        ) : needsInstallation ? (
          <a className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black" href={`/api/github/install?session_id=${encodeURIComponent(sessionId)}`}>
            <FolderGit2 className="size-4" /> Connect your GitHub
          </a>
        ) : repositories ? (
          <div className="mt-5">
            {repositories.length > 5 ? (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8a8a8a]" />
                <Input
                  aria-label="Search repositories"
                  className="h-9 rounded-md border-[#dedede] pl-9 text-base shadow-none sm:text-sm"
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
                    <span className="mt-0.5 block text-xs text-[#888]">{candidate.defaultBranch} · {candidate.visibility}</span>
                  </span>
                  {connectingId === candidate.id ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <span className="shrink-0 text-xs font-medium text-[#666]">Select</span>}
                </button>
              ))}
              {filteredRepositories.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-[#888]">
                  {repositories.length === 0
                    ? "No repositories are authorized for your account."
                    : "No matching repositories."}
                </p>
              ) : null}
            </div>
            <Button className="mt-2 h-8 px-2 text-xs" disabled={loading || connectingId !== null} onClick={() => void loadRepositories()} size="sm" variant="ghost">Refresh repositories</Button>
            <a className="ml-2 text-xs text-[#666] underline underline-offset-4" href={`/api/github/install?session_id=${encodeURIComponent(sessionId)}`}>Manage GitHub access</a>
          </div>
        ) : (
          <Button className="mt-5 h-10 rounded-md px-4 text-sm" disabled={loading} onClick={() => void loadRepositories()}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <FolderGit2 className="size-4" />}
            {loading ? "Loading repositories…" : "Choose repository"}
          </Button>
        )}
        {error ? <p className="mt-3 text-xs leading-5 text-[#777]">{error}</p> : null}
        <p className="mt-3 text-xs leading-5 text-[#888]">Other tasks and repositories stay private.</p>
      </div>
    </fieldset>
  );
}

function Workspace({ repository, sessionId, tab, workspace, onTabChange, fileCollaboration, checkpointRevision, onRestored, active }: {
  repository?: RepositoryState; sessionId: string; tab: WorkspaceTab; workspace: WorkspaceState; onTabChange: (tab: WorkspaceTab) => void;
  fileCollaboration: { memberId: string; deliveredIds: ReadonlySet<string>; disabled: boolean; onAnnotate: AnnotateCode };
  checkpointRevision: number; onRestored: (snapshot: TaskSessionSnapshot) => void; active: boolean;
}) {
  if (!repository) {
    return (
      <section className="h-full min-h-0 bg-white">
        <RepositorySetup sessionId={sessionId} disabled={fileCollaboration.disabled} />
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
                  "h-7 rounded-md px-2.5 text-xs text-[#777]",
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
      <div className="min-h-0 flex-1">
        {tab === "diff" ? <DiffPane diff={workspace.diff} /> : null}
        <WorkspaceFiles key={JSON.stringify([sessionId, fileCollaboration.memberId])} sessionId={sessionId} initialPath={workspace.files[0]?.path} revision={workspaceReadRevision(workspace)} active={active && tab === "files"} locked={Boolean(workspace.restore)} {...fileCollaboration} />
        {tab === "runs" ? <RunsPane commands={workspace.commands} /> : null}
        {active && tab === "checkpoints" ? <WorkspaceCheckpoints sessionId={sessionId} revision={checkpointRevision} onRestored={onRestored} /> : null}
      </div>
    </section>
  );
}

type SharedProps = Parameters<typeof SharedSession>[0] & {
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
};

type HiveWorkspaceProps = {
  currentMember: TeamMember;
  initialSnapshot: TaskSessionSnapshot;
  inviteToken: string;
  sessionId: string;
  sessionTitle: string;
};

export function HiveWorkspace(props: HiveWorkspaceProps) {
  const connection = useSharedSession(props.sessionId, props.initialSnapshot);
  return <HiveWorkspaceView {...props} connection={connection} />;
}

export function HiveWorkspaceView({
  currentMember,
  inviteToken,
  sessionId,
  sessionTitle,
  connection,
  homeHref = "/",
  connectionLabel = "Live",
  accountActionsDisabled = false,
  notice,
}: Omit<HiveWorkspaceProps, "initialSnapshot"> & {
  connection: ReturnType<typeof useSharedSession>;
  homeHref?: string;
  connectionLabel?: string;
  accountActionsDisabled?: boolean;
  notice?: ReactNode;
}) {
  const client = useHiveClient();
  const [pane, setPane] = useState<"chat" | "workspace">("chat");
  const [tab, setTab] = useState<WorkspaceTab>("diff");
  const [copied, setCopied] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [viewingReviewChanges, setViewingReviewChanges] = useState(false);
  const backToReviewRef = useRef<HTMLButtonElement>(null);
  const [threadTrigger, setThreadTrigger] = useState<HTMLElement | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [harnessSaving, setHarnessSaving] = useState(false);
  const { dispatch, setTyping, snapshot, syncing, syncError, receiveSnapshot } = connection;
  const { session, activeMembers, members, typingMembers } = snapshot;
  const teamMembers = useMemo(
    () => [currentMember, ...members.filter((member) => member.id !== currentMember.id)],
    [currentMember, members],
  );
  const { activeSteer, annotation, repository, stage, steeringQueue, workspace } = session;
  const messages = useMemo(() => conversationMessages(session), [session]);
  const codeAnnotationIds = useMemo(() => new Set(messages.filter((message) => message.codeReference && message.memberId === currentMember.id && message.clientId).map((message) => message.clientId!)), [currentMember.id, messages]);
  const selectedThread = messages.find((message) => message.id === threadId);
  const reviewContext = viewingReviewChanges && selectedThread?.interaction?.kind === "review" ? selectedThread : undefined;
  const workspaceReviews = useMemo(() => reviewContext ? [reviewContext] : tab === "diff" && workspace.reviewRevision
    ? messages.filter((message) => message.interaction?.kind === "review" && message.interaction.revision === workspace.reviewRevision)
    : [], [messages, reviewContext, tab, workspace.reviewRevision]);
  const threadMessage = reviewContext ? undefined : selectedThread;
  const selectedThreadId = threadMessage?.id ?? null;
  useEffect(() => {
    if (viewingReviewChanges) backToReviewRef.current?.focus();
  }, [viewingReviewChanges]);
  const openThread = useCallback((messageId: string) => {
    setThreadTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setThreadId(messageId);
    setViewingReviewChanges(false);
    setPane("workspace");
  }, []);
  const closeThread = useCallback(() => {
    setThreadId(null);
    setViewingReviewChanges(false);
    setPane("chat");
    requestAnimationFrame(() => threadTrigger?.focus());
  }, [threadTrigger]);
  const runActive = isHiveRunActive(session);
  const runStalled = useStalledRun(session);
  const archived = Boolean(session.archived);
  const workspaceLocked = Boolean(workspace.restore) || archived;
  const changeArchive = useCallback(async (archive: boolean) => {
    const next = await dispatch({ type: archive ? "archive-task" : "restore-task" });
    if (!next || Boolean(next.session.archived) !== archive) throw new Error("Could not update the task. Check the connection and finish any pending work before retrying.");
  }, [dispatch]);
  const harnessLocked = !canSelectHarness(session);
  const effortLocked = !canSetCodingEffort(session);
  // Reset is irreversible for every member; require an idle task and a confirmation.
  const resetDisabled = workspaceLocked || runActive || Boolean(activeSteer) || steeringQueue.length > 0;
  const canApplySteer = canApplyNextSteer(session);
  const attemptedAnswer = useRef<string | null>(null);
  const nextAnswer = canApplySteer && workspace.status !== "error" && steeringQueue[0]?.source.kind === "peer-response" &&
    (!workspace.lastRestore || steeringQueue[0].queuedAt > workspace.lastRestore.at) ? steeringQueue[0].id : null;
  useEffect(() => {
    if (!nextAnswer || syncing || syncError || attemptedAnswer.current === nextAnswer) return;
    attemptedAnswer.current = nextAnswer;
    // Every connected teammate may observe readiness. The server checks this
    // exact queue item under its task lock and grants execution only once.
    void dispatch({ type: "continue-peer-response", steerId: nextAnswer });
  }, [nextAnswer, syncing, syncError, dispatch]);
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
    void client.request("/api/auth/logout", { method: "POST" }).then(() => {
      client.reload();
    });
  }, [client]);
  const annotate = useCallback(async (messageId: string, { body, clientId }: MessageSubmission) => {
    const nextSnapshot = await dispatch({ type: "annotate-message", messageId, body, clientId });
    return nextSnapshot?.session.messages.find((message) => message.id === messageId)?.annotations?.some(
      (annotation) => annotation.authorId === currentMember.id && annotation.clientId === clientId && annotation.body === body,
    ) ?? false;
  }, [currentMember.id, dispatch]);
  const annotateCode = useCallback<AnnotateCode>(async (reference, { body, clientId }) => {
    const nextSnapshot = await dispatch({ type: "annotate-code", reference, body, clientId });
    const delivered = nextSnapshot?.session.messages.some((message) => message.memberId === currentMember.id && message.clientId === clientId && message.annotations?.some((annotation) => annotation.body === body)) ?? false;
    if (delivered) setPane("chat");
    return delivered;
  }, [currentMember.id, dispatch]);
  const answerQuestion = useCallback(async (messageId: string, submission: MessageSubmission) => {
    const next = await dispatch({ type: "answer-question", messageId, ...submission });
    return next?.session.messages.find((message) => message.id === messageId)?.annotations?.some((reply) => reply.authorId === currentMember.id && reply.clientId === submission.clientId) ?? false;
  }, [currentMember.id, dispatch]);
  const resolveReview = useCallback(async (messageId: string, revision: string) => {
    const next = await dispatch({ type: "resolve-peer-review", messageId, revision });
    const review = next?.session.messages.find((message) => message.id === messageId)?.interaction;
    return review?.kind === "review" && review.revision === revision && review.resolved?.by === currentMember.id;
  }, [currentMember.id, dispatch]);
  const steer = useCallback(() => { void dispatch({ type: "steer-agent" }); }, [dispatch]);
  const steerMessageAnnotation = useCallback((messageId: string, annotationId: string) => {
    void dispatch({ type: "steer-message-annotation", messageId, annotationId });
  }, [dispatch]);
  const steerThread = useCallback(async (messageId: string, throughReplyId: string) => {
    const nextSnapshot = await dispatch({ type: "steer-thread", messageId, throughReplyId });
    return nextSnapshot?.session.messages.find((message) => message.id === messageId)?.threadSteer?.throughReplyId === throughReplyId;
  }, [dispatch]);
  const moveSteer = useCallback((steerId: string, direction: "up" | "down") => {
    void dispatch({ type: "reorder-queued-steer", steerId, direction });
  }, [dispatch]);
  const removeSteer = useCallback((steerId: string) => {
    void dispatch({ type: "remove-queued-steer", steerId });
  }, [dispatch]);
  const send = useCallback(async ({ body, clientId }: MessageSubmission) => {
    if (harnessSaving) return false;
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
  }, [currentMember.id, dispatch, repository, teamMembers, harnessSaving]);
  const selectHarness = useCallback(async (runtime: CodingRuntime, modelId: string) => {
    if (harnessSaving) return;
    setHarnessSaving(true);
    try { await dispatch({ type: "select-harness", runtime, modelId }); }
    finally { setHarnessSaving(false); }
  }, [dispatch, harnessSaving]);
  const setCodingEffort = useCallback(async (effort: CodingEffort, modelId?: string) => {
    if (harnessSaving) return;
    setHarnessSaving(true);
    try { await dispatch({ type: "set-coding-effort", effort, modelId }); }
    finally { setHarnessSaving(false); }
  }, [dispatch, harnessSaving]);
  const applySteer = useCallback(() => {
    if (!canApplySteer) return;
    void dispatch({ type: "apply-next-steer" }).then((nextSnapshot) => {
      if (nextSnapshot?.session.stage === "review") setTab("diff");
    });
  }, [canApplySteer, dispatch]);
  const openReset = useCallback(() => setResetOpen(true), []);
  const confirmReset = useCallback(() => {
    setResetOpen(false);
    setPane("chat");
    setTab("diff");
    void dispatch({ type: "reset" });
  }, [dispatch]);
  const recoverRun = useCallback(() => { void dispatch({ type: "recover-stalled-run" }); }, [dispatch]);

  const shared = useMemo<SharedProps>(() => ({
    sessionId,
    activeMembers,
    activeSteer,
    canApplySteer,
    runActive,
    runStalled,
    onRecoverRun: recoverRun,
    queued,
    queuedBy: annotation.queuedBy,
    queuePosition: queuePosition || undefined,
    steered,
    steeredBy: annotation.steeredBy,
    currentMember: currentMember.id,
    disabled: workspaceLocked || harnessSaving,
    members: teamMembers,
    messages,
    stage,
    tab,
    typingMembers,
    steeringQueue,
    workspaceAnnotation: annotation.text,
    codingRuntime: workspace.agentSession?.runtime ?? "codex",
    codingModel: workspace.codingModel,
    codingModels: snapshot.codingModels,
    harnessLocked,
    harnessDisabled: workspaceLocked || harnessSaving || syncing || syncError,
    onSelectHarness: selectHarness,
    effort: workspace.codingEffort ?? "low",
    effortLocked,
    onEffortChange: setCodingEffort,
    onOpenThread: openThread,
    onSteerReply: steerMessageAnnotation,
    selectedThreadId,
    onMoveSteer: moveSteer,
    onRemoveSteer: removeSteer,
    onSteer: steer,
    onSend: send,
    onTyping: setTyping,
    onApplySteer: applySteer,
    onTabChange: setTab,
  }), [activeMembers, activeSteer, applySteer, openThread, steerMessageAnnotation, selectedThreadId, annotation.queuedBy, annotation.steeredBy, annotation.text, canApplySteer, currentMember.id, workspaceLocked, harnessSaving, messages, moveSteer, queuePosition, queued, recoverRun, removeSteer, runActive, runStalled, send, sessionId, setTyping, stage, steer, steered, steeringQueue, tab, teamMembers, typingMembers, workspace.agentSession?.runtime, workspace.codingModel, harnessLocked, syncing, syncError, selectHarness, workspace.codingEffort, effortLocked, setCodingEffort, snapshot.codingModels]);

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#fafafa] text-[#171717]">
      <ProductHeader activeMembers={activeMembers} copied={copied} currentMember={currentMember} members={teamMembers} onCopyInvite={copyInvite} onSignOut={signOut} onReset={openReset} repository={repository} sessionTitle={sessionTitle} resetDisabled={resetDisabled} syncing={syncing} syncError={syncError} homeHref={homeHref} connectionLabel={connectionLabel} accountActionsDisabled={accountActionsDisabled} archived={archived} archiveDisabled={syncing || syncError || (!archived && !canArchiveTask(session))} onArchiveChange={changeArchive} />
      {notice}
      {session.archived ? <div className="shrink-0 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground" role="status">Archived by {resolveMember(session.archived.by, teamMembers).shortName} · Read-only for everyone. Restore this task to continue.</div> : null}
      <Dialog onOpenChange={setResetOpen} open={resetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset this task for everyone?</DialogTitle>
            <DialogDescription>This clears the shared conversation, Threads, queued steers and approval for every member and starts a fresh agent workspace. It cannot be undone. GitHub commits and pull requests are not changed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setResetOpen(false)} variant="outline">Cancel</Button>
            <Button disabled={resetDisabled} onClick={confirmReset}>Reset task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {workspace.restore ? <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8e8e8] px-4 py-2 text-xs text-[#737373]" role="status">
        <span>{workspace.restore.status === "unconfirmed" ? "Restore needs confirmation. The workspace is paused." : "Restoring workspace and agent context…"}</span>
        <button className="shrink-0 underline underline-offset-4" onClick={() => { setThreadId(null); setTab("checkpoints"); setPane("workspace"); }} type="button">View checkpoints</button>
      </div> : null}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[#e8e8e8] bg-[#fafafa] p-1 min-[960px]:hidden">
        <button
          aria-pressed={pane === "chat"}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-[#777]",
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
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-[#777]",
            pane === "workspace" && "border border-[#e1e1e1] bg-white text-[#171717] shadow-sm",
          )}
          onClick={() => setPane("workspace")}
          type="button"
        >
          <Code2 className="size-3.5" /> {threadMessage ? "Thread" : "Workspace"}
          {!threadMessage && workspace.changedFiles.length > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#171717] px-1 text-xs text-white">
              {workspace.changedFiles.length}
            </span>
          ) : null}
        </button>
      </div>
      <WorkspaceSplit
        activePane={pane}
        conversation={<SharedSession {...shared} compact />}
        workspace={
          <>
            <div className={cn("flex min-h-0 flex-1 flex-col", threadMessage && "hidden")}>
              {workspaceReviews.length > 0 ? <section aria-label="Workspace reviews" className="shrink-0 border-b border-border bg-white px-3 py-2">
                {workspaceReviews.map((review) => <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1" key={review.id}>
                  <div className="min-w-0 flex-1 basis-48">
                    <PeerRequestSummary className="mb-0" message={review} members={teamMembers} />
                    {workspaceReviews.length > 1 ? <p className="mt-1 truncate text-xs text-muted-foreground" title={review.body}>{review.body}</p> : null}
                  </div>
                  <Button ref={reviewContext ? backToReviewRef : undefined} className="h-7 shrink-0 px-2 text-xs" onClick={() => {
                    if (reviewContext) { setViewingReviewChanges(false); setPane("workspace"); }
                    else openThread(review.id);
                  }} size="sm" variant="ghost">
                    {reviewContext ? <><ArrowLeft className="size-3.5" /> Back to review</> : <><MessageSquare className="size-3.5" /> Open review</>}
                  </Button>
                </div>)}
                <p className="mt-1 text-xs text-muted-foreground">{archived ? "Archived · Read-only" : "Viewing changes only · Verify in the review thread"}</p>
                {reviewContext && (!reviewContext.interaction?.revision || reviewContext.interaction.revision !== workspace.reviewRevision) ? <p className="mt-1 text-xs text-muted-foreground">This review does not match the current diff. Return to the thread for context.</p> : null}
              </section> : null}
              <div className="min-h-0 flex-1">
                <Workspace active={!threadMessage} repository={repository} sessionId={sessionId} tab={shared.tab} workspace={workspace} checkpointRevision={session.version} onRestored={receiveSnapshot} onTabChange={shared.onTabChange} fileCollaboration={{ memberId: currentMember.id, deliveredIds: codeAnnotationIds, disabled: workspaceLocked, onAnnotate: annotateCode }} />
              </div>
            </div>
            {threadMessage ? <MessageThread currentMember={currentMember.id} disabled={workspaceLocked} key={threadMessage.id} members={teamMembers} message={threadMessage} onClose={closeThread} onReply={annotate} onAnswerQuestion={answerQuestion} onSteerReply={steerMessageAnnotation} onSteerThread={steerThread} queue={steeringQueue} runActive={runActive} sessionId={sessionId}
              reviewReady={canResolvePeerReview(session, threadMessage, currentMember.id, threadMessage.interaction?.revision ?? "")}
              reviewCurrent={!runActive && !workspace.restore && Boolean(workspace.reviewRevision && workspace.reviewRevision === threadMessage.interaction?.revision)}
              onResolveReview={resolveReview} onViewChanges={() => { setViewingReviewChanges(true); setPane("workspace"); setTab("diff"); }} /> : null}
          </>
        }
      />
    </main>
  );
}
