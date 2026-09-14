"use client";

import { History, LoaderCircle, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { useHiveClient } from "@/components/hive/hive-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  workspaceCheckpointsResponse,
  type WorkspaceCheckpointsResponse,
} from "@/lib/workspace/workspace-files";
import type { TaskSessionSnapshot } from "@/lib/session/task-session-contract";
import type { RestoreWorkspaceRequest } from "@/lib/workspace/workspace-restore-state";
import type { WorkspaceRecoveryStatus } from "@/hooks/use-workspace-recovery";

const dateLabel = (date: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

export function WorkspaceCheckpoints({
  sessionId,
  revision,
  onRestored,
  recoveryStatus,
}: {
  sessionId: string;
  revision: number;
  onRestored: (snapshot: TaskSessionSnapshot) => void;
  recoveryStatus: WorkspaceRecoveryStatus;
}) {
  const client = useHiveClient();
  const { data, error, isLoading, isValidating, mutate } = useSWR<
    WorkspaceCheckpointsResponse,
    Error
  >(
    [client.request, sessionId, revision],
    async () => {
      const response = await client.request(
        `/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
        { cache: "no-store", signal: AbortSignal.timeout(15_000) }
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Checkpoints could not be loaded.");
      return workspaceCheckpointsResponse.parse(body);
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      keepPreviousData: false,
    }
  );
  const [confirm, setConfirm] = useState<{
    request: RestoreWorkspaceRequest;
    createdAt?: number;
  }>();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [now, setNow] = useState(Date.now);
  const { checking, notice: recoveryNotice, check } = recoveryStatus;
  const cancelButton = useRef<HTMLButtonElement>(null);
  const observedRecovery = useRef(false);
  const recovery = data?.restore;
  useEffect(() => {
    if (data?.restore) observedRecovery.current = true;
    else if (data && observedRecovery.current) {
      observedRecovery.current = false;
      setRestoreError("");
      setConfirm(undefined);
    }
  }, [data]);
  const retrySeconds = recovery
    ? Math.max(0, Math.ceil((recovery.retryAfter - now) / 1000))
    : 0;
  // A teammate can archive or advance the task while this dialog is open.
  const confirmDisabled =
    restoring ||
    checking ||
    isValidating ||
    Boolean(error) ||
    !data ||
    (recovery
      ? retrySeconds > 0
      : Boolean(data.blockedReason) ||
        confirm?.request.version !== data.version);
  useEffect(() => {
    if (!recovery) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recovery]);
  const restore = async () => {
    if (!confirm || confirmDisabled) return;
    setRestoring(true);
    setRestoreError("");
    try {
      const response = await client.request(
        `/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirm.request),
          signal: AbortSignal.timeout(55_000),
        }
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error ||
            "Restore could not be confirmed. Refresh Checkpoints before retrying."
        );
      onRestored(body);
      setConfirm(undefined);
    } catch (error) {
      setRestoreError(
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "Still confirming the restored workspace. Checking automatically; you can keep reading."
      );
      setConfirm(undefined);
    } finally {
      setRestoring(false);
      void mutate();
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#ebebeb] px-4 py-2">
        <p className="text-xs text-[#737373]">Workspace recovery points</p>
        <Button
          aria-label="Refresh checkpoints"
          className="size-7 shrink-0"
          disabled={isValidating}
          onClick={() => void mutate()}
          size="icon"
          variant="ghost"
        >
          <RotateCw className="size-3.5" />
        </Button>
      </div>
      {data?.blockedReason ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebebeb] bg-[#fafafa] px-4 py-3 text-xs text-[#737373]">
          <div role="status" className="min-w-0 flex-1 basis-48">
            <p>{data.blockedReason}</p>
            {recovery ? (
              <p className="mt-1">
                {recoveryNotice ||
                  "Checking automatically. You can keep reading; editing will return when recovery is confirmed."}
              </p>
            ) : null}
          </div>
          {recovery ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={checking}
                onClick={check}
                size="sm"
                variant="outline"
              >
                {checking ? "Checking…" : "Check status"}
              </Button>
              <Button
                disabled={restoring || checking || retrySeconds > 0}
                onClick={() => {
                  setRestoreError("");
                  setConfirm({
                    request: {
                      id: recovery.id,
                      snapshotId: recovery.snapshotId,
                      version: data.version,
                    },
                  });
                }}
                size="sm"
                variant="ghost"
              >
                Retry restore
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {restoring && !confirm ? (
        <p className="px-4 py-3 text-xs text-muted-foreground" role="status">
          Restoring the checkpoint. You can keep reading the discussion; closing
          the dialog does not cancel recovery.
        </p>
      ) : null}
      {restoreError && !recovery ? (
        <p className="px-4 py-3 text-xs text-[#737373]" role="status">
          {restoreError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <p className="p-6 text-xs text-[#737373]" role="status">
            Loading checkpoints…
          </p>
        ) : error ? (
          <p className="p-6 text-xs text-[#737373]" role="status">
            {error.message}
          </p>
        ) : data?.checkpoints.length === 0 ? (
          <p className="p-6 text-xs text-[#737373]">No saved checkpoint yet.</p>
        ) : (
          data?.checkpoints.map((checkpoint) => (
            <div
              className="flex items-start gap-3 border-b border-[#ebebeb] px-4 py-4"
              key={checkpoint.id}
            >
              <History className="mt-0.5 size-4 shrink-0 text-[#737373]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {dateLabel(checkpoint.createdAt)}
                  {checkpoint.current ? (
                    <span className="ml-2 font-normal text-[#737373]">
                      Current
                    </span>
                  ) : null}
                </p>
                <p
                  className="mt-1 truncate text-xs text-[#737373]"
                  title={checkpoint.id}
                >
                  {checkpoint.id}
                </p>
                {!checkpoint.restorable ? (
                  <p className="mt-1 text-xs text-[#737373]">
                    No matching agent checkpoint
                  </p>
                ) : null}
              </div>
              <Button
                aria-label={`Restore checkpoint from ${dateLabel(checkpoint.createdAt)}`}
                className="h-7 shrink-0 text-xs"
                disabled={
                  isValidating ||
                  !checkpoint.restorable ||
                  Boolean(data?.blockedReason) ||
                  restoring
                }
                onClick={() => {
                  setRestoreError("");
                  setConfirm({
                    request: {
                      id: crypto.randomUUID(),
                      snapshotId: checkpoint.id,
                      version: data.version,
                    },
                    createdAt: checkpoint.createdAt,
                  });
                }}
                size="sm"
                variant="outline"
              >
                <RotateCcw className="size-3" /> Restore
              </Button>
            </div>
          ))
        )}
      </div>
      <p className="shrink-0 border-t border-[#ebebeb] px-4 py-3 text-xs text-[#737373]">
        The environment saves a checkpoint after 30 minutes without messages.
        Only checkpoints with matching agent context can be restored.
        {data?.retentionCount
          ? ` Up to ${data.retentionCount} recovery points are retained.`
          : ""}
      </p>
      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
      >
        <DialogContent initialFocus={cancelButton}>
          <DialogHeader>
            <DialogTitle>Restore this checkpoint?</DialogTitle>
            <DialogDescription>
              {confirm?.createdAt
                ? `Restore files and Codex context to ${dateLabel(confirm.createdAt)}. `
                : "Retry restoring the selected files and Codex context. "}
              Team discussion and queued steers will stay; nothing will run
              automatically. GitHub commits and pull requests are not changed.
            </DialogDescription>
          </DialogHeader>
          {data?.blockedReason && !recovery ? (
            <p className="text-xs text-muted-foreground" role="status">
              {data.blockedReason}
            </p>
          ) : null}
          {restoring ? (
            <p className="text-xs text-muted-foreground" role="status">
              Saving the current workspace and restoring the checkpoint. You can
              close this dialog; recovery will continue and no agent will run.
            </p>
          ) : recovery && retrySeconds > 0 ? (
            <p className="text-xs text-muted-foreground" role="status">
              Checking the previous attempt automatically. Another restore
              cannot start while it is still finishing.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => setConfirm(undefined)}
              ref={cancelButton}
              variant="outline"
            >
              {restoring ? "Close dialog" : "Cancel"}
            </Button>
            <Button disabled={confirmDisabled} onClick={() => void restore()}>
              {restoring ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              {restoring ? "Restoring…" : "Restore checkpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
