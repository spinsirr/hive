"use client";
import { LoaderCircle, MessageSquare, WifiOff } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ConversationComposer } from "@/components/hive/conversation/conversation-composer";
import { ConversationTurn } from "@/components/hive/conversation/conversation-message";
import type { MessageEditTarget } from "@/components/hive/conversation/message-edit-composer";
import { SteeringQueue } from "@/components/hive/conversation/steering-queue";
import { MessageTime } from "@/components/hive/conversation/message-time";
import { Button } from "@/components/ui/button";
import { useMessageDraft } from "@/hooks/use-message-draft";
import type { MessageSubmission } from "@/lib/conversation/message-draft";
import type { CodingEffort } from "@/lib/agents/coding-effort";
import type { CodingModelOption } from "@/lib/agents/coding-models";
import { displayHiveErrorMessage } from "@/lib/agents/hive-error-copy";
import { conversationTimelineTurns } from "@/lib/conversation/conversation-timeline";
import {
  type ActiveSteer,
  type ChatMessage,
  canEditMessage,
  type CodingRuntime,
  STALLED_RUN_AFTER_MS,
  type MemberId,
  type MessageEdit,
  resolveMember,
  type SteeringQueueItem,
  type TeamMember,
} from "@/lib/session/task-session";
import { cn } from "@/lib/utils";

export function SharedSession({
  sessionId,
  activeMembers,
  activeSteer,
  canApplySteer,
  runActive,
  runStalled,
  onRecoverRun,
  steeringQueue,
  currentMember,
  disabled,
  members,
  messages,
  onApplySteer,
  onOpenThread,
  onAnswerQuestion,
  onEditMessage,
  selectedThreadId,
  onMoveSteer,
  onRemoveSteer,
  onSend,
  onTyping,
  typingMembers,
  codingRuntime,
  codingModel,
  codingModels,
  harnessLocked,
  harnessDisabled,
  onSelectHarness,
  effort,
  effortLocked,
  onEffortChange,
  compact = false,
}: {
  sessionId: string;
  activeMembers: MemberId[];
  activeSteer?: ActiveSteer;
  canApplySteer: boolean;
  runActive: boolean;
  runStalled: boolean;
  onRecoverRun: () => void;
  steeringQueue: SteeringQueueItem[];
  currentMember: MemberId;
  disabled: boolean;
  members: TeamMember[];
  messages: ChatMessage[];
  onApplySteer: () => void;
  onOpenThread: (messageId: string) => void;
  onAnswerQuestion: (
    messageId: string,
    submission: MessageSubmission,
    replyThreadId?: string
  ) => Promise<boolean>;
  onEditMessage: (edit: MessageEdit) => Promise<void>;
  selectedThreadId: string | null;
  onMoveSteer: (steerId: string, direction: "up" | "down") => void;
  onRemoveSteer: (steerId: string) => void;
  onSend: (submission: MessageSubmission) => Promise<boolean>;
  onTyping: (typing: boolean) => void;
  typingMembers: MemberId[];
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
  const timeline = useMemo(
    () => conversationTimelineTurns(messages),
    [messages]
  );
  const [editing, setEditing] = useState<MessageEditTarget | null>(null);
  const edit = (message: ChatMessage) => {
    if (disabled || !canEditMessage(message, currentMember)) return;
    const queued = steeringQueue.find(
      (item) =>
        item.source.kind === "message" && item.source.messageId === message.id
    );
    setEditing({ message, queuedSteerId: queued?.id });
    requestAnimationFrame(() =>
      document
        .getElementById(`message-editor-${message.id}`)
        ?.scrollIntoView({ block: "nearest" })
    );
  };
  const cancelEdit = () => {
    const id = editing?.message.id;
    setEditing(null);
    requestAnimationFrame(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-message-actions]")
      )
        .find((element) => element.dataset.messageActions === id)
        ?.focus()
    );
  };
  const deliveredIds = useMemo(
    () =>
      new Set(
        messages
          .filter(
            (message) => message.memberId === currentMember && message.clientId
          )
          .map((message) => message.clientId!)
      ),
    [currentMember, messages]
  );
  const messageDraft = useMessageDraft(
    `hive-draft:v1:${sessionId}:${currentMember}:message`,
    deliveredIds,
    onSend
  );
  const { draft } = messageDraft;
  const sending = draft?.status === "sending";
  const submit = useCallback(() => {
    if (disabled || !draft?.body.trim()) return;
    onTyping(false);
    void messageDraft.submit();
  }, [disabled, draft, messageDraft, onTyping]);

  const otherTyping = typingMembers.filter(
    (memberId) => memberId !== currentMember
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center border-b border-[#ebebeb] px-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-[#666]" />
          <h2 className="text-xs font-semibold">Task conversation</h2>
          <span className="text-xs text-[#8a8a8a]">
            {activeMembers.length} online
          </span>
        </div>
      </div>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={cn("gap-7 px-4 py-5 sm:px-6 sm:py-7", compact && "gap-5")}
        >
          {timeline.map((turn) => {
            const { message } = turn;
            if (message.status === "error") {
              return (
                <div
                  className="flex items-center gap-2 px-1 text-xs text-[#8a8a8a]"
                  key={message.id}
                  role="status"
                >
                  <WifiOff className="size-3 shrink-0" />
                  <span>{displayHiveErrorMessage(message.body)}</span>
                  <MessageTime
                    className="text-xs text-[#b0b0b0]"
                    message={message}
                  />
                </div>
              );
            }
            return (
              <ConversationTurn
                key={message.id}
                turn={turn}
                currentMember={currentMember}
                members={members}
                sessionId={sessionId}
                disabled={disabled}
                runActive={runActive}
                selectedThreadId={selectedThreadId}
                onOpenThread={onOpenThread}
                onAnswerQuestion={onAnswerQuestion}
                editing={editing}
                onEdit={edit}
                onSaveEdit={onEditMessage}
                onCancelEdit={cancelEdit}
              />
            );
          })}
          {runActive && runStalled ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-[#e8e8e8] bg-[#fafafa] px-3 py-2 text-xs text-[#525252]"
              role="status"
            >
              <WifiOff className="size-3 shrink-0" />
              <span className="min-w-0 flex-1">
                Hive hasn’t reported for over {STALLED_RUN_AFTER_MS / 60_000}{" "}
                minutes; its execution process was probably lost. Marking it
                lost keeps the discussion, partial output and queued steers, and
                reruns nothing.
              </span>
              <Button
                className="h-7 rounded px-2 text-xs"
                disabled={disabled}
                onClick={onRecoverRun}
                size="sm"
                variant="outline"
              >
                Mark run as lost
              </Button>
            </div>
          ) : runActive && !activeSteer ? (
            <p
              className="flex items-center gap-2 px-1 text-xs text-[#777]"
              role="status"
            >
              <LoaderCircle className="size-3 animate-spin" /> Hive is working…
            </p>
          ) : null}
          {otherTyping.length > 0 ? (
            <p className="px-1 text-xs text-[#8f8f8f]">
              {otherTyping
                .map((memberId) => resolveMember(memberId, members).shortName)
                .join(", ")}{" "}
              {otherTyping.length === 1 ? "is" : "are"} typing…
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <SteeringQueue
        activeSteer={activeSteer}
        canApply={canApplySteer}
        disabled={disabled}
        items={steeringQueue}
        messages={messages}
        currentMember={currentMember}
        members={members}
        onApply={onApplySteer}
        onMove={onMoveSteer}
        onRemove={onRemoveSteer}
        onEdit={edit}
        onOpenThread={onOpenThread}
      />
      <ConversationComposer
        value={draft?.body ?? ""}
        onChange={(value) => {
          messageDraft.edit(value);
          onTyping(Boolean(value.trim()));
        }}
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
