"use client";

import { History, LoaderCircle, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { workspaceCheckpointsResponse, type WorkspaceCheckpointsResponse } from "@/lib/workspace-files";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";
import type { RestoreWorkspaceRequest } from "@/lib/workspace-restore-state";

const dateLabel = (date: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);

export function WorkspaceCheckpoints({ sessionId, revision, onRestored }: { sessionId: string; revision: number; onRestored: (snapshot: TaskSessionSnapshot) => void }) {
  const [refresh, setRefresh] = useState(0);
  const key = `${sessionId}:${revision}:${refresh}`;
  const [state, setState] = useState<{ key: string; data?: WorkspaceCheckpointsResponse; error?: string }>();
  const [confirm, setConfirm] = useState<{ request: RestoreWorkspaceRequest; createdAt?: number }>();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [readyRetry, setReadyRetry] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Checkpoints could not be loaded.");
        const data = workspaceCheckpointsResponse.parse(body);
        if (!controller.signal.aborted) setState({ key, data });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "Checkpoints could not be loaded." });
      }
    }
    void load();
    return () => controller.abort();
  }, [key, sessionId]);
  const current = state?.key === key ? state : undefined;
  const recovery = current?.data?.restore;
  const retryKey = recovery ? `${recovery.id}:${recovery.retryAfter}` : "";
  useEffect(() => {
    if (!recovery) return;
    const timer = setTimeout(() => setReadyRetry(retryKey), Math.max(0, recovery.retryAfter - Date.now()));
    return () => clearTimeout(timer);
  }, [recovery, retryKey]);
  const restore = async () => {
    if (!confirm || restoring) return;
    setRestoring(true);
    setRestoreError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(confirm.request) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Restore could not be confirmed. Refresh Checkpoints before retrying.");
      onRestored(body);
      setConfirm(undefined);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Restore could not be confirmed. Refresh Checkpoints before retrying.");
      setConfirm(undefined);
    } finally { setRestoring(false); setRefresh((value) => value + 1); }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#ebebeb] px-4 py-2">
        <p className="text-xs text-[#737373]">Workspace recovery points</p>
        <Button aria-label="Refresh checkpoints" className="size-7 shrink-0" onClick={() => setRefresh((value) => value + 1)} size="icon" variant="ghost"><RotateCw className="size-3.5" /></Button>
      </div>
      {current?.data?.blockedReason ? <div className="flex items-center justify-between gap-3 border-b border-[#ebebeb] bg-[#fafafa] px-4 py-3 text-xs text-[#737373]" role="status"><p>{current.data.blockedReason}</p>{recovery ? <Button disabled={restoring || readyRetry !== retryKey} onClick={() => { setRestoreError(""); setConfirm({ request: { id: recovery.id, snapshotId: recovery.snapshotId, version: current.data!.version } }); }} size="sm" variant="outline">Retry restore</Button> : null}</div> : null}
      {restoreError ? <p className="px-4 py-3 text-xs text-[#737373]" role="status">{restoreError}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {!current ? <p className="p-6 text-xs text-[#737373]" role="status">Loading checkpoints…</p> : current.error ? <p className="p-6 text-xs text-[#737373]" role="status">{current.error}</p> : current.data?.checkpoints.length === 0 ? <p className="p-6 text-xs text-[#737373]">No saved checkpoint yet.</p> : current.data?.checkpoints.map((checkpoint) => (
          <div className="flex items-start gap-3 border-b border-[#ebebeb] px-4 py-4" key={checkpoint.id}>
            <History className="mt-0.5 size-4 shrink-0 text-[#737373]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{dateLabel(checkpoint.createdAt)}{checkpoint.current ? <span className="ml-2 font-normal text-[#737373]">Current</span> : null}</p>
              <p className="mt-1 truncate text-xs text-[#737373]" title={checkpoint.id}>{checkpoint.id}</p>
              {!checkpoint.restorable ? <p className="mt-1 text-xs text-[#737373]">No matching agent checkpoint</p> : null}
            </div>
            <Button aria-label={`Restore checkpoint from ${dateLabel(checkpoint.createdAt)}`} className="h-7 shrink-0 text-xs" disabled={!checkpoint.restorable || Boolean(current.data?.blockedReason) || restoring} onClick={() => { setRestoreError(""); setConfirm({ request: { id: crypto.randomUUID(), snapshotId: checkpoint.id, version: current.data!.version }, createdAt: checkpoint.createdAt }); }} size="sm" variant="outline"><RotateCcw className="size-3" /> Restore</Button>
          </div>
        ))}
      </div>
      <p className="shrink-0 border-t border-[#ebebeb] px-4 py-3 text-xs text-[#737373]">Only checkpoints saved with matching agent context can be restored.{current?.data?.retentionCount ? ` Up to ${current.data.retentionCount} sandbox recovery points are retained.` : ""}</p>
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open && !restoring) setConfirm(undefined); }}>
        <DialogContent initialFocus={cancelButton} showCloseButton={!restoring}>
          <DialogHeader>
            <DialogTitle>Restore this checkpoint?</DialogTitle>
            <DialogDescription>{confirm?.createdAt ? `Restore files and Codex context to ${dateLabel(confirm.createdAt)}. ` : "Retry restoring the selected files and Codex context. "}Team discussion and queued steers will stay; nothing will run automatically. GitHub commits and pull requests are not changed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={restoring} onClick={() => setConfirm(undefined)} ref={cancelButton} variant="outline">Cancel</Button>
            <Button disabled={restoring} onClick={() => void restore()}>{restoring ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{restoring ? "Restoring…" : "Restore checkpoint"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
