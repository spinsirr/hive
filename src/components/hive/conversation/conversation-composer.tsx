"use client";

import {
  ArrowUp,
  CornerDownRight,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { CodingAgentSelect } from "@/components/hive/conversation/coding-agent-select";
import { MentionInput } from "@/components/hive/conversation/mention-input";
import {
  isDirectedAtTeammate,
  MESSAGE_BODY_LIMIT,
  type CodingRuntime,
  type TeamMember,
} from "@/lib/session/task-session";
import type { CodingEffort } from "@/lib/agents/coding-effort";
import type { CodingModelOption } from "@/lib/agents/coding-models";

export function ConversationComposer({
  value,
  onChange,
  onSubmit,
  members,
  currentMember,
  disabled,
  sending,
  unconfirmed,
  queueing,
  runtime,
  modelId,
  models,
  agentLocked,
  agentDisabled,
  onSelectAgent,
  effort,
  effortLocked,
  onEffortChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  members: TeamMember[];
  currentMember: string;
  disabled: boolean;
  sending: boolean;
  unconfirmed: boolean;
  queueing: boolean;
  runtime: CodingRuntime;
  modelId?: string;
  models?: CodingModelOption[];
  agentLocked: boolean;
  agentDisabled: boolean;
  onSelectAgent: (runtime: CodingRuntime, modelId: string) => void;
  effort: CodingEffort;
  effortLocked: boolean;
  onEffortChange: (effort: CodingEffort, modelId?: string) => void;
}) {
  const toTeammate = isDirectedAtTeammate(value, currentMember, members);
  const queued = queueing && !toTeammate;
  const label = sending
    ? "Sending message"
    : unconfirmed
      ? "Retry message"
      : queued
        ? "Queue message"
        : "Send message";
  const canSubmit = !disabled && !sending && Boolean(value.trim());
  const submit = () => {
    if (canSubmit) onSubmit();
  };

  return (
    <div className="@container shrink-0 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
      <div className="rounded-[22px] border border-[#e4e4e4] bg-[#fafafa] p-2 shadow-[0_2px_8px_rgba(0,0,0,0.025)] transition-[border-color,box-shadow] focus-within:border-[#c7c7c7] focus-within:shadow-[0_2px_12px_rgba(0,0,0,0.04)] motion-reduce:transition-none">
        <MentionInput
          className="block min-h-[3.75rem] w-full px-3 pb-3 pt-2.5"
          currentMember={currentMember}
          disabled={disabled}
          maxLength={MESSAGE_BODY_LIMIT}
          members={members}
          onChange={onChange}
          onSubmit={submit}
          placeholder={
            queued
              ? "Add a follow-up for Hive…"
              : "Ask Hive or @mention a teammate…"
          }
          readOnly={sending}
          value={value}
        />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 px-0.5 pb-0.5">
          {toTeammate || queued ? (
            <div className="mr-auto flex min-w-0 basis-full items-center gap-1 px-2 @[400px]:basis-auto @[400px]:px-0">
              {toTeammate ? (
                <span className="truncate text-xs text-[#999]">
                  To teammates
                </span>
              ) : queued ? (
                <span className="flex items-center gap-1 truncate text-xs text-[#999]">
                  <CornerDownRight
                    aria-hidden="true"
                    className="size-3 shrink-0"
                  />{" "}
                  Queues next
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <CodingAgentSelect
              value={runtime}
              modelId={modelId}
              models={models}
              disabled={agentDisabled}
              locked={agentLocked}
              onChange={onSelectAgent}
              effort={effort}
              effortLocked={effortLocked}
              onEffortChange={onEffortChange}
            />
            <button
              aria-label={label}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-[#171717] text-white outline-none transition-[background-color,transform] hover:bg-[#333] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#171717] focus-visible:ring-offset-2 disabled:cursor-default disabled:bg-[#e8e8e8] disabled:text-[#aaa] disabled:active:scale-100 motion-reduce:transition-none"
              disabled={!canSubmit}
              onClick={submit}
              title={
                queued
                  ? "Queue for after the current run · Enter to send"
                  : "Enter to send · Shift+Enter for a new line"
              }
              type="button"
            >
              {sending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : unconfirmed ? (
                <RotateCcw aria-hidden="true" className="size-4" />
              ) : (
                <ArrowUp
                  aria-hidden="true"
                  className="size-4.5"
                  strokeWidth={2}
                />
              )}
            </button>
          </div>
        </div>
      </div>
      {unconfirmed ? (
        <p className="mt-2 px-3 text-xs text-[#888]" role="status">
          Delivery unconfirmed. Retry when connected.
        </p>
      ) : null}
    </div>
  );
}
