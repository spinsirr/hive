"use client";
import { Check, Copy, RotateCcw, WifiOff } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";
import { TaskArchiveControl } from "@/components/hive/task-archive-control";
import { TaskTitleControl } from "@/components/hive/task-title-control";
import { taskTitleLabel } from "@/lib/task-title";
import { Button } from "@/components/ui/button";
import { HiveMark } from "@/components/hive/hive-mark";
import {
  type MemberId,
  type RepositoryState,
  type TeamMember,
} from "@/lib/task-session";
import { cn } from "@/lib/utils";

function OnlineMembers({
  activeMembers,
  members,
}: {
  activeMembers: MemberId[];
  members: TeamMember[];
}) {
  const onlineMembers = members.filter((member) =>
    activeMembers.includes(member.id)
  );

  if (onlineMembers.length === 0) return null;

  return (
    <div
      aria-label="Online in this task"
      className="flex items-center"
      role="group"
    >
      {onlineMembers.map((member, index) => (
        <span
          aria-label={`${member.name} · online`}
          className={cn(
            "relative grid size-7 place-items-center rounded-full border border-[#d8d8d8] bg-white text-xs font-semibold",
            index > 0 && "-ml-1.5",
            index === 0 && "bg-[#171717] text-white"
          )}
          key={member.id}
          role="img"
          title={`${member.name} · online`}
        >
          {member.initials}
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-white bg-[#171717]"
          />
        </span>
      ))}
    </div>
  );
}

export function ProductHeader({
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
  renameDisabled,
  onRename,
  attention,
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
  renameDisabled: boolean;
  onRename: (title: string) => Promise<void>;
  attention?: ReactNode;
}) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[#e8e8e8] bg-white px-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link className="flex shrink-0 items-center gap-2.5" href={homeHref}>
          <HiveMark className="size-7" />
          <span className="hidden text-sm font-semibold tracking-[-0.025em] sm:inline">
            Hive
          </span>
        </Link>
        <span className="text-[#d4d4d4]">/</span>
        <div className="min-w-0">
          <TaskTitleControl
            title={sessionTitle}
            disabled={renameDisabled}
            onRename={onRename}
          />
          <p className="hidden truncate text-xs text-[#929292] md:block">
            {repository?.name ?? "Repository not attached"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {attention}
        <TaskArchiveControl
          title={taskTitleLabel(sessionTitle)}
          archived={archived}
          disabled={archiveDisabled}
          onChange={onArchiveChange}
        />
        <div className="hidden items-center gap-1.5 text-xs text-[#777] sm:flex">
          {syncError ? (
            <WifiOff className="size-3" />
          ) : (
            <span
              className={cn(
                "size-1.5 rounded-full bg-[#171717]",
                syncing && "animate-pulse bg-[#a1a1a1]"
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
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span className="hidden sm:inline">
            {copied ? "Copied" : "Invite"}
          </span>
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
          <OnlineMembers
            activeMembers={syncError ? [] : activeMembers}
            members={members}
          />
        </div>
        <Button
          aria-label="Reset session"
          className="size-8 rounded-md text-[#777]"
          disabled={resetDisabled}
          onClick={onReset}
          size="icon"
          title={
            resetDisabled
              ? "Reset is unavailable while Hive is working or steers are waiting"
              : "Reset shared session"
          }
          variant="ghost"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}
