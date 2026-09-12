"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { useHiveClient } from "@/components/hive/hive-client";
import type { WorkspaceRestore } from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";

/** Task-owned recovery: changing workspace tabs must not stop confirmation. */
export function useWorkspaceRecovery(sessionId: string, revision: number, restore: WorkspaceRestore | undefined, onRestored: (snapshot: TaskSessionSnapshot) => void) {
  const client = useHiveClient();
  const [checkRequest, setCheckRequest] = useState(0);
  const { id, snapshotId, startedAt, retryAfter } = restore ?? {};
  const key = JSON.stringify([sessionId, id, startedAt, retryAfter, checkRequest]);
  const [state, setState] = useState<{ key: string; checking: boolean; notice: string }>();
  const currentVersion = useEffectEvent(() => revision);
  const receive = useEffectEvent(onRestored);
  const check = useCallback(() => setCheckRequest((value) => value + 1), []);

  useEffect(() => {
    if (!id || !snapshotId || retryAfter === undefined) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function confirm() {
      setState({ key, checking: true, notice: "" });
      try {
        const response = await client.request(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "check", id, snapshotId, version: currentVersion() }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 200) {
          setState({ key, checking: false, notice: "" });
          receive(body);
          return;
        }
        if (response.status !== 202) throw new Error(body.error || "Restore status could not be checked. Try checking again.");
        // Bounded metadata checks, never another restore or an idle heartbeat.
        // Ordinary task revisions do not reset this operation's retry budget.
        if (++attempts < 12) {
          setState({ key, checking: false, notice: "Waiting for Sandbox confirmation. Checking status does not restore files again." });
          timer = setTimeout(() => void confirm(), 10_000);
        } else setState({ key, checking: false, notice: "Not confirmed yet. Check status again, or retry the same checkpoint." });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, checking: false, notice: error instanceof Error ? error.message : "Restore status could not be checked. Try checking again." });
      }
    }
    timer = setTimeout(() => void confirm(), Math.max(0, retryAfter - Date.now()));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [client, sessionId, id, snapshotId, retryAfter, key]);

  return { checking: state?.key === key && state.checking, notice: state?.key === key ? state.notice : "", check };
}

export type WorkspaceRecoveryStatus = ReturnType<typeof useWorkspaceRecovery>;
