"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { resolveMember, type TeamMember } from "@/lib/session/task-session";
import type { PeerInteraction } from "@/lib/conversation/peer-collaboration";

type ReviewProps = {
  messageId: string;
  review: Extract<PeerInteraction, { kind: "review" }>;
  members: TeamMember[];
  currentMember: string;
  disabled: boolean;
  runActive: boolean;
  ready: boolean;
  current: boolean;
  onViewChanges?: () => void;
  onResolve?: (messageId: string, revision: string) => Promise<boolean>;
};

function reviewHint({
  review,
  disabled,
  ready,
  current,
  runActive,
  currentMember,
  members,
}: ReviewProps) {
  if (review.resolved || (!disabled && ready)) return null;
  if (disabled) return "Reviewing is paused for this task.";
  if (review.status === "preparing")
    return "Waiting for Hive to finish these changes.";
  if (review.status === "unavailable")
    return "No completed changes to review. Ask Hive to try again.";
  if (runActive) return "Waiting for Hive to finish.";
  if (!current)
    return "These changes are out of date. Ask Hive for a new review.";
  if (review.targetMemberId && review.targetMemberId !== currentMember)
    return `Waiting for ${resolveMember(review.targetMemberId, members).shortName} to review.`;
  return "Finish pending work and feedback before marking as reviewed.";
}

/** Own review feedback separately from discussion drafts and thread handoff. */
export function ThreadReviewActions(props: ReviewProps) {
  const { review, ready, disabled, onResolve, onViewChanges, messageId } =
    props;
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const hint = reviewHint(props);
  const resolve = async () => {
    if (!review.revision || !ready || disabled || !onResolve || resolving)
      return;
    setResolving(true);
    setError("");
    try {
      if (!(await onResolve(messageId, review.revision)))
        setError(
          "The review changed. Check the latest changes and replies before marking it reviewed."
        );
    } finally {
      setResolving(false);
    }
  };
  return (
    <div className="mt-3 space-y-2" role="group" aria-label="Review actions">
      {hint ? (
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {onViewChanges ? (
          <Button
            className="h-7 px-2.5 text-xs"
            size="sm"
            variant="outline"
            onClick={onViewChanges}
          >
            View changes
          </Button>
        ) : null}
        {onResolve && !review.resolved ? (
          <Button
            className="h-7 px-2.5 text-xs"
            size="sm"
            variant="secondary"
            title="Records your review only; does not approve or merge a pull request."
            disabled={disabled || !ready || resolving}
            onClick={() => void resolve()}
          >
            {resolving ? "Saving…" : "Mark as reviewed"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-muted-foreground" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
