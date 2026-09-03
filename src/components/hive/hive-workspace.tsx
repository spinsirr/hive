"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  FileTerminal,
  FileCode2,
  FolderGit2,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Send,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Terminal } from "@/components/ai-elements/terminal";
import { Button } from "@/components/ui/button";
import { useSharedRoom } from "@/hooks/use-shared-room";
import { displayHiveErrorMessage } from "@/lib/hive-error-copy";
import {
  type ActiveSteer,
  type ChatMessage,
  isDirectedAtTeammate,
  type MemberId,
  type RepositoryState,
  resolveMember,
  type RunStage,
  type SteeringQueueItem,
  type TeamMember,
  type WorkspaceState,
} from "@/lib/room";
import { shouldSubmitMessage } from "@/lib/message-keyboard";
import { cn } from "@/lib/utils";

type WorkspaceTab = "workspace" | "diff" | "files" | "terminal";

const stageCopy: Record<RunStage, { label: string; detail: string }> = {
  waiting: { label: "Ready", detail: "Ask Hive to inspect or change the connected repository." },
  running: { label: "Hive is working", detail: "The shared coding workspace is executing real tools." },
  review: { label: "Ready for review", detail: "Review the real git diff and command output." },
  approved: { label: "Approved", detail: "The team approved the current workspace diff." },
};

const tabs: Array<{ key: WorkspaceTab; label: string; icon: typeof Code2 }> = [
  { key: "workspace", label: "Overview", icon: FolderGit2 },
  { key: "diff", label: "Diff", icon: Code2 },
  { key: "files", label: "Files", icon: FileCode2 },
  { key: "terminal", label: "Terminal", icon: FileTerminal },
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
  repository,
  syncing,
  syncError,
  onCopyInvite,
  onSignOut,
  onReset,
}: {
  activeMembers: MemberId[];
  copied: boolean;
  currentMember: TeamMember;
  members: TeamMember[];
  repository?: RepositoryState;
  syncing: boolean;
  syncError: boolean;
  onCopyInvite: () => void;
  onSignOut: () => void;
  onReset: () => void;
}) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-[#e8e8e8] bg-white px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <HiveMark className="size-7" />
        <span className="text-sm font-semibold tracking-[-0.025em]">Hive</span>
        <span className="text-[#d4d4d4]">/</span>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-xs font-medium text-[#3d3d3d]">
            {repository?.name ?? "No repository"}
          </span>
          <span className="hidden text-[11px] text-[#8a8a8a] sm:inline">
            {repository?.branch ?? "GitHub"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
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
          className="hidden h-8 rounded-md bg-white px-2.5 text-xs text-[#333] md:inline-flex"
          onClick={onCopyInvite}
          size="sm"
          variant="outline"
        >
          <Copy className="size-3.5" /> {copied ? "Copied" : "Invite"}
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

function SteeringQueue({ activeSteer, items, members, onMove, onRemove }: {
  activeSteer?: ActiveSteer;
  items: SteeringQueueItem[];
  members: TeamMember[];
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

function SharedSession({ activeMembers, activeSteer, queued, queuedBy, queuePosition, steered, steeredBy, steeringQueue, currentMember, members, messages, onAnnotate, onMoveSteer, onRemoveSteer, onSteer, onSteerMessageAnnotation, onSend, onTyping, stage, typingMembers, workspaceAnnotation, compact = false }: {
  activeMembers: MemberId[];
  activeSteer?: ActiveSteer;
  queued: boolean;
  queuedBy?: MemberId;
  queuePosition?: number;
  steered: boolean;
  steeredBy?: MemberId;
  steeringQueue: SteeringQueueItem[];
  currentMember: MemberId;
  members: TeamMember[];
  messages: ChatMessage[];
  onAnnotate: (messageId: string, body: string) => void;
  onMoveSteer: (steerId: string, direction: "up" | "down") => void;
  onRemoveSteer: (steerId: string) => void;
  onSteer: () => void;
  onSteerMessageAnnotation: (messageId: string, annotationId: string) => void;
  onSend: (message: string) => void;
  onTyping: (typing: boolean) => void;
  stage: RunStage;
  typingMembers: MemberId[];
  workspaceAnnotation: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [annotationTarget, setAnnotationTarget] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    onTyping(false);
    setDraft("");
  }, [draft, onSend, onTyping]);

  const beginAnnotation = useCallback((messageId: string) => {
    setAnnotationTarget(messageId);
    setAnnotationDraft("");
  }, []);

  const cancelAnnotation = useCallback(() => {
    setAnnotationTarget(null);
    setAnnotationDraft("");
  }, []);

  const submitAnnotation = useCallback(() => {
    const body = annotationDraft.trim();
    if (!body || !annotationTarget) return;
    onAnnotate(annotationTarget, body);
    cancelAnnotation();
  }, [annotationDraft, annotationTarget, cancelAnnotation, onAnnotate]);

  const otherTyping = typingMembers.filter((memberId) => memberId !== currentMember);

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center border-b border-[#ebebeb] px-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-[#666]" />
          <h2 className="text-xs font-semibold">Team room</h2>
          <span className="text-[11px] text-[#8a8a8a]">{activeMembers.length} online</span>
        </div>
      </div>
      <SteeringQueue activeSteer={activeSteer} items={steeringQueue} members={members} onMove={onMoveSteer} onRemove={onRemoveSteer} />
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
                  {message.role === "human" ? (
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
                  {message.body}
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
                                  title={stage === "running" ? "Queue this steer for Hive's next safe boundary" : "Promote this annotation into a follow-up turn"}
                                  variant="ghost"
                                >
                                  {stage === "running" ? "Queue steer" : "Steer Hive"}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {annotationTarget === message.id ? (
                  <div className={cn("w-[88%] border border-[#d8d8d8] bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.05)]", isCurrentMember ? "ml-auto mr-0" : "ml-7")}>
                    <div className="mb-1.5">
                      <span className="text-[11px] text-[#737373]">Comment only — you can promote it to a steer later.</span>
                    </div>
                    <textarea
                      aria-label={`Annotation for ${message.name}'s message`}
                      autoFocus
                      className="min-h-14 w-full resize-none bg-[#fafafa] px-2 py-1.5 text-[12px] leading-4 outline-none placeholder:text-[#a1a1a1]"
                      maxLength={500}
                      onChange={(event) => setAnnotationDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          submitAnnotation();
                        }
                        if (event.key === "Escape") cancelAnnotation();
                      }}
                      placeholder="Add context, a concern, or a question for the team…"
                      value={annotationDraft}
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button className="h-7 rounded px-2.5 text-[11px]" onClick={cancelAnnotation} size="sm" variant="ghost">Cancel</Button>
                      <Button className="h-7 rounded bg-[#171717] px-2.5 text-[11px] text-white" disabled={!annotationDraft.trim()} onClick={submitAnnotation} size="sm">Add annotation</Button>
                    </div>
                  </div>
                ) : null}
              </Message>
            );
          })}
          {otherTyping.length > 0 ? <p className="px-1 text-[11px] text-[#8f8f8f]">{otherTyping.map((memberId) => resolveMember(memberId, members).shortName).join(", ")} {otherTyping.length === 1 ? "is" : "are"} typing…</p> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {workspaceAnnotation ? <AnnotationCard members={members} onSteer={onSteer} queuePosition={queuePosition} queued={queued} queuedBy={queuedBy} stage={stage} steered={steered} steeredBy={steeredBy} /> : null}
      <div className="border-t border-[#ebebeb] bg-[#fafafa] p-3">
        <div className="rounded-xl border border-[#d9d9d9] bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus-within:border-[#999]">
          <div className="flex items-end gap-2">
          <textarea
            aria-label="Ask Hive or mention a teammate"
            className="max-h-24 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13px] leading-5 outline-none placeholder:text-[#aaa]"
            onChange={(event) => {
              setDraft(event.target.value);
              onTyping(Boolean(event.target.value.trim()));
            }}
            onKeyDown={(event) => {
              if (shouldSubmitMessage(event)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask Hive or @mention a teammate…"
            rows={1}
            value={draft}
          />
            <Button
              aria-label="Send message"
              className="size-8 rounded-lg"
              disabled={!draft.trim()}
              onClick={submit}
              size="icon"
            >
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceOverview({ repository, roomId, workspace }: {
  repository?: RepositoryState;
  roomId: string;
  workspace: WorkspaceState;
}) {
  if (!repository) {
    return (
      <div className="hairline-grid flex h-full min-h-[420px] items-center justify-center bg-[#fafafa] p-8">
        <div className="w-full max-w-lg rounded-xl border border-[#dcdcdc] bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.05)]">
          <FolderGit2 className="size-7" />
          <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em]">Connect the repository Hive will operate</h3>
          <p className="mt-2 text-sm leading-6 text-[#737373]">Install the repository-scoped GitHub App. Hive will mint a short-lived read token only when Vercel Sandbox needs to clone the selected repository.</p>
          <a className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black" href={`/api/github/install?room_id=${encodeURIComponent(roomId)}`}><FolderGit2 className="size-4" /> Connect GitHub</a>
          <p className="mt-3 font-mono text-[9px] text-[#a1a1a1]">One selected repository · no PAT · token expires within one hour</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-[#fafafa] p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-start justify-between gap-4 border-b border-[#ededed] px-4 py-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FolderGit2 className="size-3.5 text-[#666]" />
                <span className="truncate text-xs font-semibold">
                  {repository.name}
                </span>
                <span className="text-[11px] text-[#888]">
                  {repository.branch}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-[#888]">
                {repository.visibility} repository · GitHub App
              </p>
            </div>
          </div>

          <div className="min-h-36 px-4 py-5">
            {workspace.status === "running" ? (
              <div className="flex items-start gap-3 text-sm text-[#444]">
                <LoaderCircle className="mt-0.5 size-4 animate-spin" />
                <p className="font-medium">Working in Sandbox…</p>
              </div>
            ) : workspace.error ? (
              <div className="flex items-center gap-2 text-xs text-[#777]">
                <WifiOff className="size-3.5" />
                <span>{displayHiveErrorMessage(workspace.error)}</span>
              </div>
            ) : workspace.summary ? (
              <div>
                <p className="text-[11px] font-medium text-[#777]">
                  Latest result
                </p>
                <p className="mt-3 text-sm leading-6 text-[#444]">
                  {workspace.summary}
                </p>
              </div>
            ) : (
              <div className="grid min-h-24 place-items-center text-center">
                <div>
                  <p className="text-sm font-medium">No run yet</p>
                  <p className="mt-1 text-xs text-[#888]">
                    Give Hive a concrete task in the team room.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 border-t border-[#ededed] bg-[#fafafa]">
            <div className="px-4 py-3">
              <p className="text-[11px] text-[#888]">Files</p>
              <p className="mt-1 text-sm font-semibold">{workspace.changedFiles.length}</p>
            </div>
            <div className="border-l border-[#ededed] px-4 py-3">
              <p className="text-[11px] text-[#888]">Commands</p>
              <p className="mt-1 text-sm font-semibold">{workspace.commands.length}</p>
            </div>
            <div className="border-l border-[#ededed] px-4 py-3">
              <p className="text-[11px] text-[#888]">Runtime</p>
              <p className="mt-1 text-sm font-semibold">Sandbox</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffPane({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center"><div><Code2 className="mx-auto size-6 text-[#737373]" /><p className="mt-3 text-sm font-medium">No git diff yet</p><p className="mt-1 text-xs text-[#8f8f8f]">Ask Hive to make a change in the connected repository.</p></div></div>;
  }
  return (
    <div className="h-full overflow-auto bg-white p-5">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-[#e2e2e2]">
        <div className="border-b border-[#ebebeb] bg-[#fafafa] px-3 py-2 font-mono text-[11px]">git diff --no-ext-diff HEAD</div>
        <div className="overflow-x-auto py-2 font-mono text-[12px] leading-6">
          {diff.split("\n").map((line, index) => (
            <div className={cn("flex min-w-[720px]", line.startsWith("+") && !line.startsWith("+++") && "bg-[#f2f2f2]", line.startsWith("-") && !line.startsWith("---") && "bg-[#fafafa] text-[#737373]")} key={`${index}-${line}`}>
              <span className="w-12 shrink-0 select-none border-r border-[#eeeeee] px-2 text-right text-[#b0b0b0]">{index + 1}</span><code className="whitespace-pre px-3">{line || " "}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilesPane({ files }: { files: WorkspaceState["files"] }) {
  const [selected, setSelected] = useState("");
  const selectedFile = files.find((file) => file.path === selected) ?? files[0];
  if (!selectedFile) {
    return <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center"><div><FileCode2 className="mx-auto size-6 text-[#737373]" /><p className="mt-3 text-sm font-medium">No changed files yet</p><p className="mt-1 text-xs text-[#8f8f8f]">Files written by Hive will appear here verbatim.</p></div></div>;
  }
  return (
    <div className="grid h-full min-h-[420px] grid-cols-[230px_1fr] bg-white">
      <div className="h-full overflow-auto border-r border-[#ebebeb] bg-[#fafafa] p-2">{files.map((file) => <button className={cn("mb-1 block w-full truncate rounded px-2 py-2 text-left font-mono text-[10px] text-[#737373] hover:bg-white", selectedFile.path === file.path && "bg-white text-[#171717]")} key={file.path} onClick={() => setSelected(file.path)} title={file.path} type="button">{file.path}</button>)}</div>
      <div className="min-w-0 overflow-auto"><div className="sticky top-0 border-b border-[#ebebeb] bg-[#fafafa] px-4 py-2 font-mono text-[11px] text-[#737373]">{selectedFile.path}</div><pre className="p-5 font-mono text-[12px] leading-6 text-[#4d4d4d]">{selectedFile.content}</pre></div>
    </div>
  );
}

function TerminalPane({ commands }: { commands: WorkspaceState["commands"] }) {
  const output = commands.length > 0
    ? commands.map((command) => `$ ${command.command}\n${command.output || "(no output)"}\n\n[exit ${command.exitCode}${command.durationMs ? ` · ${command.durationMs}ms` : ""}]`).join("\n\n")
    : "Waiting for Hive to run a real repository command…";
  return (
    <div className="h-full overflow-auto bg-white p-5"><div className="mx-auto max-w-5xl"><Terminal output={output} /></div></div>
  );
}

function Workspace({ repository, roomId, tab, workspace, onTabChange }: { repository?: RepositoryState; roomId: string; tab: WorkspaceTab; workspace: WorkspaceState; onTabChange: (tab: WorkspaceTab) => void }) {
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
      <div className="min-h-0 flex-1">{tab === "workspace" ? <WorkspaceOverview repository={repository} roomId={roomId} workspace={workspace} /> : null}{tab === "diff" ? <DiffPane diff={workspace.diff} /> : null}{tab === "files" ? <FilesPane files={workspace.files} /> : null}{tab === "terminal" ? <TerminalPane commands={workspace.commands} /> : null}</div>
    </section>
  );
}

function RunBar({ activeSteer, queueCount, repository, stage, onAdvance }: { activeSteer?: ActiveSteer; queueCount: number; repository?: RepositoryState; stage: RunStage; onAdvance: () => void }) {
  const action = !repository ? "Connect repository" : stage === "waiting" ? "Send Hive a task" : stage === "running" && activeSteer ? "Applying queued steer" : stage === "running" && queueCount > 0 ? "Apply next steer" : stage === "running" ? "Hive is working" : stage === "review" ? "Approve changes" : "Approved";
  const Icon = stage === "review" || stage === "approved" ? GitPullRequest : Play;
  const disabled = !repository || stage === "waiting" || stage === "approved" || Boolean(activeSteer) || (stage === "running" && queueCount === 0);
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-[#ebebeb] bg-[#fafafa] px-3 sm:px-4">
      <p className="min-w-0 truncate text-[11px] text-[#777]">
        {queueCount > 0
          ? `${queueCount} steer${queueCount === 1 ? "" : "s"} waiting for a safe boundary.`
          : stageCopy[stage].detail}
      </p>
      <Button
        className="h-8 shrink-0 rounded-md bg-[#171717] px-3 text-xs text-white"
        disabled={disabled}
        onClick={onAdvance}
        size="sm"
      >
        <Icon className="size-3.5" /> {action}
      </Button>
    </div>
  );
}

type SharedProps = {
  activeMembers: MemberId[];
  activeSteer?: ActiveSteer;
  queued: boolean;
  queuedBy?: MemberId;
  queuePosition?: number;
  steered: boolean;
  steeredBy?: MemberId;
  currentMember: MemberId;
  members: TeamMember[];
  messages: ChatMessage[];
  stage: RunStage;
  tab: WorkspaceTab;
  typingMembers: MemberId[];
  steeringQueue: SteeringQueueItem[];
  workspaceAnnotation: string;
  onAnnotate: (messageId: string, body: string) => void;
  onMoveSteer: (steerId: string, direction: "up" | "down") => void;
  onRemoveSteer: (steerId: string) => void;
  onSteer: () => void;
  onSteerMessageAnnotation: (messageId: string, annotationId: string) => void;
  onSend: (message: string) => void;
  onTyping: (typing: boolean) => void;
  onAdvance: () => void;
  onTabChange: (tab: WorkspaceTab) => void;
};

export function HiveWorkspace({
  currentMember,
  roomId,
}: {
  currentMember: TeamMember;
  roomId: string;
}) {
  const [pane, setPane] = useState<"chat" | "workspace">("chat");
  const [tab, setTab] = useState<WorkspaceTab>("workspace");
  const [copied, setCopied] = useState(false);
  const { dispatch, setTyping, snapshot, syncing, syncError } = useSharedRoom(roomId);
  const { room, activeMembers, members, typingMembers } = snapshot;
  const teamMembers = useMemo(
    () => [currentMember, ...members.filter((member) => member.id !== currentMember.id)],
    [currentMember, members],
  );
  const { activeSteer, annotation, messages, repository, stage, steeringQueue, workspace } = room;
  const steered = annotation.status === "steered";
  const queued = annotation.status === "queued";
  const queuePosition = steeringQueue.findIndex(
    (item) => item.source.kind === "workspace-annotation",
  ) + 1;

  const copyInvite = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  }, []);
  const signOut = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST" }).then(() => {
      window.location.reload();
    });
  }, []);
  const annotate = useCallback((messageId: string, body: string) => {
    void dispatch({ type: "annotate-message", messageId, body });
  }, [dispatch]);
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
  const send = useCallback((body: string) => {
    if (
      repository &&
      !isDirectedAtTeammate(body, currentMember.id, teamMembers)
    ) {
      setTab("terminal");
    }
    void dispatch({ type: "send-message", body }).then((nextSnapshot) => {
      if (nextSnapshot?.room.stage === "review") setTab("diff");
    });
  }, [currentMember.id, dispatch, repository, teamMembers]);
  const advance = useCallback(() => {
    const action = stage === "running" && steeringQueue.length > 0
      ? ({ type: "apply-next-steer" } as const)
      : ({ type: "advance-run" } as const);
    void dispatch(action).then((nextSnapshot) => {
      if (nextSnapshot?.room.stage === "review") setTab("diff");
    });
  }, [dispatch, stage, steeringQueue.length]);
  const reset = useCallback(() => {
    setPane("chat");
    setTab("workspace");
    void dispatch({ type: "reset" });
  }, [dispatch]);

  const shared = useMemo<SharedProps>(() => ({
    activeMembers,
    activeSteer,
    queued,
    queuedBy: annotation.queuedBy,
    queuePosition: queuePosition || undefined,
    steered,
    steeredBy: annotation.steeredBy,
    currentMember: currentMember.id,
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
  }), [activeMembers, activeSteer, advance, annotate, annotation.queuedBy, annotation.steeredBy, annotation.text, currentMember.id, messages, moveSteer, queuePosition, queued, removeSteer, send, setTyping, stage, steer, steerMessageAnnotation, steered, steeringQueue, tab, teamMembers, typingMembers]);

  return (
    <main className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-[#fafafa] text-[#171717]">
      <ProductHeader activeMembers={activeMembers} copied={copied} currentMember={currentMember} members={teamMembers} onCopyInvite={copyInvite} onSignOut={signOut} onReset={reset} repository={repository} syncing={syncing} syncError={syncError} />
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
          <MessageSquare className="size-3.5" /> Team room
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
            <Workspace repository={repository} roomId={roomId} tab={shared.tab} workspace={workspace} onTabChange={shared.onTabChange} />
          </div>
          <RunBar activeSteer={activeSteer} queueCount={steeringQueue.length} repository={repository} stage={shared.stage} onAdvance={shared.onAdvance} />
        </div>
      </div>
    </main>
  );
}
