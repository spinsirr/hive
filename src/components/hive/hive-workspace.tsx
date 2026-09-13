"use client";
import { WorkspaceDetail } from "./workspace-detail";
import { Code2, MessageSquare } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHiveClient } from "@/components/hive/hive-client";
import { TaskAttention } from "@/components/hive/task-attention";

import { WorkspaceSplit } from "@/components/hive/workspace-split";
import type { AnnotateCode } from "@/components/hive/code-annotation-composer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSharedSession } from "@/hooks/use-shared-session";
import { useWorkspaceRecovery } from "@/hooks/use-workspace-recovery";
import { useStalledRun } from "@/hooks/use-stalled-run";
import type { MessageSubmission } from "@/lib/message-draft";
import type { CodingEffort } from "@/lib/coding-effort";

import {
  canApplyNextSteer,
  canArchiveTask,
  canSelectHarness,
  canSetCodingEffort,
  type CodingRuntime,
  isHiveRunActive,
  conversationMessages,
  type MessageEdit,
  resolveMember,
  type TeamMember,
} from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-contract";
import { cn } from "@/lib/utils";
import { useWorkspaceNavigation } from "@/hooks/use-workspace-navigation";
import { ProductHeader } from "./workspace-header";
import { SharedSession } from "./shared-conversation";

type SharedProps = Parameters<typeof SharedSession>[0];

type HiveWorkspaceProps = {
  currentMember: TeamMember;
  initialSnapshot: TaskSessionSnapshot;
  inviteToken: string;
  sessionId: string;
};

export function HiveWorkspace(props: HiveWorkspaceProps) {
  const connection = useSharedSession(props.sessionId, props.initialSnapshot);
  return <HiveWorkspaceView {...props} connection={connection} />;
}

export function HiveWorkspaceView({
  currentMember,
  inviteToken,
  sessionId,
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
  const [copied, setCopied] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [harnessSaving, setHarnessSaving] = useState(false);
  const { dispatch, setTyping, snapshot, syncing, syncError, receiveSnapshot } =
    connection;
  const { session, activeMembers, members, typingMembers } = snapshot;
  const teamMembers = useMemo(
    () => [
      currentMember,
      ...members.filter((member) => member.id !== currentMember.id),
    ],
    [currentMember, members]
  );
  const {
    activeSteer,
    annotation,
    repository,
    stage,
    steeringQueue,
    workspace,
  } = session;
  const recoveryStatus = useWorkspaceRecovery(
    sessionId,
    session.version,
    workspace.restore,
    receiveSnapshot
  );
  const messages = useMemo(() => conversationMessages(session), [session]);
  const navigation = useWorkspaceNavigation(messages);
  const {
    pane,
    showConversation,
    showWorkspace,
    threadMessage,
    selectedThreadId,
    openThread,
    closeThread,
    openQuestion,
    openCheckpoints,
    resetNavigation,
    visibleThreadRef,
  } = navigation;
  const runActive = isHiveRunActive(session);
  const runStalled = useStalledRun(session);
  const archived = Boolean(session.archived);
  const workspaceLocked = Boolean(workspace.restore) || archived;
  const changeArchive = useCallback(
    async (archive: boolean) => {
      const next = await dispatch({
        type: archive ? "archive-task" : "restore-task",
      });
      if (!next || Boolean(next.session.archived) !== archive)
        throw new Error(
          "Could not update the task. Check the connection and finish any pending work before retrying."
        );
    },
    [dispatch]
  );
  const renameTask = useCallback(
    async (title: string) => {
      const next = await dispatch({ type: "rename-task", title });
      if (!next || next.session.title !== title)
        throw new Error(
          "Could not rename this task. Check your connection and try again."
        );
    },
    [dispatch]
  );
  const harnessLocked = !canSelectHarness(session);
  const effortLocked = !canSetCodingEffort(session);
  // Reset is irreversible for every member; require an idle task and a confirmation.
  const resetDisabled =
    workspaceLocked ||
    runActive ||
    Boolean(activeSteer) ||
    steeringQueue.length > 0;
  const canApplySteer = canApplyNextSteer(session);
  const attemptedAnswer = useRef<string | null>(null);
  const nextAnswer =
    canApplySteer &&
    workspace.status !== "error" &&
    steeringQueue[0]?.source.kind === "peer-response" &&
    (!workspace.lastRestore ||
      steeringQueue[0].queuedAt > workspace.lastRestore.at)
      ? steeringQueue[0].id
      : null;
  useEffect(() => {
    if (
      !nextAnswer ||
      syncing ||
      syncError ||
      attemptedAnswer.current === nextAnswer
    )
      return;
    attemptedAnswer.current = nextAnswer;
    // Every connected teammate may observe readiness. The server checks this
    // exact queue item under its task lock and grants execution only once.
    void dispatch({ type: "continue-peer-response", steerId: nextAnswer });
  }, [nextAnswer, syncing, syncError, dispatch]);
  const steered = annotation.status === "steered";
  const queued = annotation.status === "queued";
  const queuePosition =
    steeringQueue.findIndex(
      (item) => item.source.kind === "workspace-annotation"
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
  const annotate = useCallback(
    async (messageId: string, { body, clientId }: MessageSubmission) => {
      const nextSnapshot = await dispatch({
        type: "annotate-message",
        messageId,
        body,
        clientId,
      });
      return (
        nextSnapshot?.session.messages
          .find((message) => message.id === messageId)
          ?.annotations?.some(
            (annotation) =>
              annotation.authorId === currentMember.id &&
              annotation.clientId === clientId &&
              annotation.body === body
          ) ?? false
      );
    },
    [currentMember.id, dispatch]
  );
  const annotateCode = useCallback<AnnotateCode>(
    async (reference, { body, clientId }) => {
      const nextSnapshot = await dispatch({
        type: "annotate-code",
        reference,
        body,
        clientId,
      });
      const delivered =
        nextSnapshot?.session.messages.some(
          (message) =>
            message.memberId === currentMember.id &&
            message.clientId === clientId &&
            message.annotations?.some((annotation) => annotation.body === body)
        ) ?? false;
      if (delivered) showConversation();
      return delivered;
    },
    [currentMember.id, dispatch, showConversation]
  );
  const answerQuestion = useCallback(
    async (
      messageId: string,
      submission: MessageSubmission,
      replyThreadId?: string
    ) => {
      const next = await dispatch({
        type: "answer-question",
        messageId,
        replyThreadId,
        ...submission,
      });
      return (
        next?.session.messages
          .find((message) => message.id === messageId)
          ?.annotations?.some(
            (reply) =>
              reply.authorId === currentMember.id &&
              reply.clientId === submission.clientId
          ) ?? false
      );
    },
    [currentMember.id, dispatch]
  );
  const editMessage = useCallback(
    async (edit: MessageEdit) => {
      const next = await dispatch(
        { type: "edit-message", ...edit },
        { throwOnError: true }
      );
      if (
        !next?.session.messages.some(
          (message) =>
            message.id === edit.messageId &&
            message.memberId === currentMember.id &&
            message.body === edit.body.trim()
        )
      ) {
        throw new Error(
          "Couldn’t confirm the saved edit. Your draft is still here."
        );
      }
    },
    [currentMember.id, dispatch]
  );
  const resolveReview = useCallback(
    async (messageId: string, revision: string) => {
      const next = await dispatch({
        type: "resolve-peer-review",
        messageId,
        revision,
      });
      const review = next?.session.messages.find(
        (message) => message.id === messageId
      )?.interaction;
      return (
        review?.kind === "review" &&
        review.revision === revision &&
        review.resolved?.by === currentMember.id
      );
    },
    [currentMember.id, dispatch]
  );
  const steer = useCallback(() => {
    void dispatch({ type: "steer-agent" });
  }, [dispatch]);
  const steerThread = useCallback(
    async (messageId: string, throughReplyId: string) => {
      const nextSnapshot = await dispatch({
        type: "steer-thread",
        messageId,
        throughReplyId,
      });
      const confirmed =
        nextSnapshot?.session.messages.find(
          (message) => message.id === messageId
        )?.threadSteer?.throughReplyId === throughReplyId;
      // Only the sender follows a confirmed handoff. A delayed acknowledgement
      // must not pull them out of a different discussion or evidence view.
      if (confirmed && visibleThreadRef.current === messageId) closeThread();
      return confirmed;
    },
    [closeThread, dispatch, visibleThreadRef]
  );
  const moveSteer = useCallback(
    (steerId: string, direction: "up" | "down") => {
      void dispatch({ type: "reorder-queued-steer", steerId, direction });
    },
    [dispatch]
  );
  const removeSteer = useCallback(
    (steerId: string) => {
      void dispatch({ type: "remove-queued-steer", steerId });
    },
    [dispatch]
  );
  const send = useCallback(
    async ({ body, clientId }: MessageSubmission) => {
      if (harnessSaving) return false;
      const nextSnapshot = await dispatch({
        type: "send-message",
        body,
        clientId,
      });
      return (
        nextSnapshot?.session.messages.some(
          (message) =>
            message.memberId === currentMember.id &&
            message.clientId === clientId &&
            message.body === body
        ) ?? false
      );
    },
    [currentMember.id, dispatch, harnessSaving]
  );
  const selectHarness = useCallback(
    async (runtime: CodingRuntime, modelId: string) => {
      if (harnessSaving) return;
      setHarnessSaving(true);
      try {
        await dispatch({ type: "select-harness", runtime, modelId });
      } finally {
        setHarnessSaving(false);
      }
    },
    [dispatch, harnessSaving]
  );
  const setCodingEffort = useCallback(
    async (effort: CodingEffort, modelId?: string) => {
      if (harnessSaving) return;
      setHarnessSaving(true);
      try {
        await dispatch({ type: "set-coding-effort", effort, modelId });
      } finally {
        setHarnessSaving(false);
      }
    },
    [dispatch, harnessSaving]
  );
  const applySteer = useCallback(() => {
    if (!canApplySteer) return;
    void dispatch({ type: "apply-next-steer" });
  }, [canApplySteer, dispatch]);
  const openReset = useCallback(() => setResetOpen(true), []);
  const confirmReset = useCallback(() => {
    setResetOpen(false);
    resetNavigation();
    void dispatch({ type: "reset" });
  }, [dispatch, resetNavigation]);
  const recoverRun = useCallback(() => {
    void dispatch({ type: "recover-stalled-run" });
  }, [dispatch]);

  const shared: SharedProps = {
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
    typingMembers,
    steeringQueue,
    workspaceAnnotation: annotation.text,
    codingRuntime: workspace.agentSession?.runtime ?? "codex",
    codingModel: workspace.codingModel,
    codingModels: snapshot.codingModels,
    harnessLocked,
    harnessDisabled: workspaceLocked || harnessSaving || syncing || syncError,
    onSelectHarness: (runtime, modelId) => void selectHarness(runtime, modelId),
    effort: workspace.codingEffort ?? "low",
    effortLocked,
    onEffortChange: (effort, modelId) => void setCodingEffort(effort, modelId),
    onOpenThread: openThread,
    onAnswerQuestion: answerQuestion,
    onEditMessage: editMessage,
    selectedThreadId,
    onMoveSteer: moveSteer,
    onRemoveSteer: removeSteer,
    onSteer: steer,
    onSend: send,
    onTyping: setTyping,
    onApplySteer: applySteer,
  };

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#fafafa] text-[#171717]">
      <ProductHeader
        activeMembers={activeMembers}
        copied={copied}
        currentMember={currentMember}
        members={teamMembers}
        onCopyInvite={copyInvite}
        onSignOut={signOut}
        onReset={openReset}
        repository={repository}
        sessionTitle={session.title}
        resetDisabled={resetDisabled}
        syncing={syncing}
        syncError={syncError}
        homeHref={homeHref}
        connectionLabel={connectionLabel}
        accountActionsDisabled={accountActionsDisabled}
        archived={archived}
        archiveDisabled={
          syncing || syncError || (!archived && !canArchiveTask(session))
        }
        onArchiveChange={changeArchive}
        renameDisabled={syncing || syncError || workspaceLocked}
        onRename={renameTask}
        attention={
          <TaskAttention
            messages={messages}
            memberId={currentMember.id}
            paused={workspaceLocked}
            onOpen={openQuestion}
          />
        }
      />
      {notice}
      {session.archived ? (
        <div
          className="shrink-0 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
          role="status"
        >
          Archived by{" "}
          {resolveMember(session.archived.by, teamMembers).shortName} ·
          Read-only for everyone. Restore this task to continue.
        </div>
      ) : null}
      <Dialog onOpenChange={setResetOpen} open={resetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset this task for everyone?</DialogTitle>
            <DialogDescription>
              This clears the shared conversation, Threads, queued steers and
              approval for every member and starts a fresh agent workspace. It
              cannot be undone. GitHub commits and pull requests are not
              changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setResetOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={resetDisabled} onClick={confirmReset}>
              Reset task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {workspace.restore ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8e8e8] px-4 py-2 text-xs text-[#737373]"
          role="status"
        >
          <span>
            {workspace.restore.status === "unconfirmed"
              ? recoveryStatus.notice ||
                "Still confirming recovery. You can keep reading."
              : "Restoring workspace and agent context… You can keep reading."}
          </span>
          <button
            className="shrink-0 underline underline-offset-4"
            onClick={openCheckpoints}
            type="button"
          >
            View checkpoints
          </button>
        </div>
      ) : null}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[#e8e8e8] bg-[#fafafa] p-1 min-[960px]:hidden">
        <button
          aria-pressed={pane === "chat"}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-[#777]",
            pane === "chat" &&
              "border border-[#e1e1e1] bg-white text-[#171717] shadow-sm"
          )}
          onClick={() => showConversation()}
          type="button"
        >
          <MessageSquare className="size-3.5" /> Conversation
        </button>
        <button
          aria-pressed={pane === "workspace"}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-[#777]",
            pane === "workspace" &&
              "border border-[#e1e1e1] bg-white text-[#171717] shadow-sm"
          )}
          onClick={() => showWorkspace()}
          type="button"
        >
          <Code2 className="size-3.5" />{" "}
          {threadMessage ? "Thread" : "Workspace"}
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
          <WorkspaceDetail
            session={session}
            messages={messages}
            currentMember={currentMember}
            teamMembers={teamMembers}
            navigation={navigation}
            recoveryStatus={recoveryStatus}
            receiveSnapshot={receiveSnapshot}
            annotateCode={annotateCode}
            annotate={annotate}
            answerQuestion={answerQuestion}
            steerThread={steerThread}
            resolveReview={resolveReview}
          />
        }
      />
    </main>
  );
}
