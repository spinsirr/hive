"use client";

import { History, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { workspaceCheckpointsResponse, type WorkspaceCheckpointsResponse } from "@/lib/workspace-files";

export function WorkspaceCheckpoints({ sessionId, revision }: { sessionId: string; revision?: number }) {
  const [refresh, setRefresh] = useState(0);
  const key = `${sessionId}:${revision}:${refresh}`;
  const [state, setState] = useState<{ key: string; data?: WorkspaceCheckpointsResponse; error?: string }>();
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#ebebeb] px-4 py-2">
        <p className="text-xs text-[#737373]">Saved automatically when the sandbox stops.</p>
        <Button aria-label="Refresh checkpoints" className="size-7 shrink-0" onClick={() => setRefresh((value) => value + 1)} size="icon" variant="ghost"><RotateCw className="size-3.5" /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!current ? <p className="p-6 text-xs text-[#737373]" role="status">Loading checkpoints…</p> : current.error ? <p className="p-6 text-xs text-[#737373]" role="status">{current.error}</p> : current.data?.checkpoints.length === 0 ? <p className="p-6 text-xs text-[#737373]">No saved checkpoint yet.</p> : current.data?.checkpoints.map((checkpoint) => (
          <div className="flex items-start gap-3 border-b border-[#ebebeb] px-4 py-4" key={checkpoint.id}>
            <History className="mt-0.5 size-4 shrink-0 text-[#737373]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(checkpoint.createdAt)}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-[#737373]" title={checkpoint.id}>{checkpoint.id}</p>
            </div>
            <span className="text-[11px] text-[#737373]">{checkpoint.current ? "Current" : "Saved"}</span>
          </div>
        ))}
      </div>
      {current?.data?.retentionCount ? <p className="shrink-0 border-t border-[#ebebeb] px-4 py-3 text-[11px] text-[#737373]">{current.data.retentionCount === 1 ? "The sandbox keeps its latest recovery point." : `The sandbox keeps its latest ${current.data.retentionCount} recovery points.`}</p> : null}
    </div>
  );
}
