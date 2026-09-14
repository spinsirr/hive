"use client";
import type { ChatMessage } from "@/lib/session/task-session";
import type { WorkspaceRecoveryStatus } from "@/hooks/use-workspace-recovery";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { MessageThread } from "@/components/hive/conversation/message-thread";
import { PeerRequestSummary } from "@/components/hive/conversation/peer-request-summary";
import type { AnnotateCode } from "@/components/hive/workspace/code-annotation-composer";
import { Button } from "@/components/ui/button";
import { canResolvePeerReview } from "@/lib/conversation/peer-collaboration";
import {
  isHiveRunActive,
  hiveReplyThreadId,
  type TeamMember,
} from "@/lib/session/task-session";
import type { TaskSessionSnapshot } from "@/lib/session/task-session-contract";
import { cn } from "@/lib/utils";
import type { useWorkspaceNavigation } from "@/hooks/use-workspace-navigation";
import { Workspace } from "./repository-workspace";

type WorkspaceDetailProps = {
  session: TaskSessionSnapshot["session"];
  messages: ChatMessage[];
  currentMember: TeamMember;
  teamMembers: TeamMember[];
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  recoveryStatus: WorkspaceRecoveryStatus;
  receiveSnapshot: (snapshot: TaskSessionSnapshot) => void;
  annotateCode: AnnotateCode;
  annotate: Parameters<typeof MessageThread>[0]["onReply"];
  answerQuestion: NonNullable<
    Parameters<typeof MessageThread>[0]["onAnswerQuestion"]
  >;
  steerThread: Parameters<typeof MessageThread>[0]["onSteerThread"];
  resolveReview: NonNullable<
    Parameters<typeof MessageThread>[0]["onResolveReview"]
  >;
};

export function WorkspaceDetail({
  session,
  messages,
  currentMember,
  teamMembers,
  navigation,
  recoveryStatus,
  receiveSnapshot,
  annotateCode,
  annotate,
  answerQuestion,
  steerThread,
  resolveReview,
}: WorkspaceDetailProps) {
  const { workspace, repository, steeringQueue, sessionId } = session;
  const {
    threadMessage,
    tab,
    setTab,
    reviewContext,
    backToReviewRef,
    backToReview,
    openThread,
    closeThread,
    viewChanges,
  } = navigation;
  const archived = Boolean(session.archived);
  const workspaceLocked = Boolean(workspace.restore) || archived;
  const runActive = isHiveRunActive(session);
  const codeAnnotationIds = useMemo(
    () =>
      new Set(
        messages
          .filter(
            (message) =>
              message.codeReference &&
              message.memberId === currentMember.id &&
              message.clientId
          )
          .map((message) => message.clientId!)
      ),
    [currentMember.id, messages]
  );

  const workspaceReviews = useMemo(
    () =>
      reviewContext
        ? [reviewContext]
        : tab === "diff" && workspace.reviewRevision
          ? messages.filter(
              (message) =>
                message.interaction?.kind === "review" &&
                message.interaction.revision === workspace.reviewRevision
            )
          : [],
    [messages, reviewContext, tab, workspace.reviewRevision]
  );

  return (
    <>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          threadMessage && "hidden"
        )}
      >
        {workspaceReviews.length > 0 ? (
          <section
            aria-label="Workspace reviews"
            className="shrink-0 border-b border-border bg-white px-3 py-2"
          >
            {workspaceReviews.map((review) => (
              <div
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1"
                key={review.id}
              >
                <div className="min-w-0 flex-1 basis-48">
                  <PeerRequestSummary
                    className="mb-0"
                    message={review}
                    members={teamMembers}
                  />
                  {workspaceReviews.length > 1 ? (
                    <p
                      className="mt-1 truncate text-xs text-muted-foreground"
                      title={review.body}
                    >
                      {review.body}
                    </p>
                  ) : null}
                </div>
                <Button
                  ref={reviewContext ? backToReviewRef : undefined}
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => {
                    if (reviewContext) {
                      backToReview();
                    } else openThread(review.id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {reviewContext ? (
                    <>
                      <ArrowLeft className="size-3.5" /> Back to review
                    </>
                  ) : (
                    <>
                      <MessageSquare className="size-3.5" /> Open review
                    </>
                  )}
                </Button>
              </div>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              {archived
                ? "Archived · Read-only"
                : "Viewing changes only · Mark as reviewed in the thread"}
            </p>
            {reviewContext &&
            (!reviewContext.interaction?.revision ||
              reviewContext.interaction.revision !==
                workspace.reviewRevision) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                This review does not match the current diff. Return to the
                thread for context.
              </p>
            ) : null}
          </section>
        ) : null}
        <div className="min-h-0 flex-1">
          <Workspace
            active={!threadMessage}
            repository={repository}
            sessionId={sessionId}
            tab={tab}
            workspace={workspace}
            checkpointRevision={session.version}
            onRestored={receiveSnapshot}
            recoveryStatus={recoveryStatus}
            onTabChange={setTab}
            fileCollaboration={{
              memberId: currentMember.id,
              deliveredIds: codeAnnotationIds,
              disabled: workspaceLocked,
              onAnnotate: annotateCode,
            }}
          />
        </div>
      </div>
      {threadMessage ? (
        <MessageThread
          requests={messages.filter(
            (message) => message.threadId === threadMessage.id
          )}
          currentMember={currentMember.id}
          disabled={workspaceLocked}
          key={threadMessage.id}
          members={teamMembers}
          message={threadMessage}
          onClose={closeThread}
          onReply={annotate}
          onAnswerQuestion={answerQuestion}
          onSteerThread={steerThread}
          queue={steeringQueue}
          runActive={runActive}
          sessionId={sessionId}
          replying={
            runActive &&
            (workspace.liveReply?.threadId ?? hiveReplyThreadId(session)) ===
              threadMessage.id
          }
          reviewReady={canResolvePeerReview(
            session,
            threadMessage,
            currentMember.id,
            threadMessage.interaction?.revision ?? ""
          )}
          reviewCurrent={
            !runActive &&
            !workspace.restore &&
            Boolean(
              workspace.reviewRevision &&
              workspace.reviewRevision === threadMessage.interaction?.revision
            )
          }
          onResolveReview={resolveReview}
          onViewChanges={viewChanges}
        />
      ) : null}
    </>
  );
}
