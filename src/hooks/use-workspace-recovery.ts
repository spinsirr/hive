"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { useHiveClient } from "@/components/hive/hive-client";
import type { WorkspaceRestore } from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-contract";

/** Task-owned recovery: changing workspace tabs must not stop confirmation. */
export function useWorkspaceRecovery(
  sessionId: string,
  revision: number,
  restore: WorkspaceRestore | undefined,
  onRestored: (snapshot: TaskSessionSnapshot) => void
) {
  const client = useHiveClient();
  const [checkRequest, setCheckRequest] = useState(0);
  const { id, snapshotId, startedAt, retryAfter } = restore ?? {};
  const key = JSON.stringify([
    sessionId,
    id,
    startedAt,
    retryAfter,
    checkRequest,
  ]);
  const [state, setState] = useState<{
    key: string;
    checking: boolean;
    notice: string;
  }>();
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
        const response = await client.request(
          `/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "check",
              id,
              snapshotId,
              version: currentVersion(),
            }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(12_000),
            ]),
          }
        );
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 200) {
          setState({ key, checking: false, notice: "" });
          receive(body);
          return;
        }
        if (response.status !== 202)
          throw new Error(
            body.error ||
              "Restore status could not be checked. Try checking again."
          );
        // Bounded metadata checks, never another restore or an idle heartbeat.
        // Ordinary task revisions do not reset this operation's retry budget.
        if (++attempts < 18) {
          setState({
            key,
            checking: false,
            notice:
              "Checking automatically. You can keep reading; editing will return when recovery is confirmed.",
          });
          timer = setTimeout(() => void confirm(), 10_000);
        } else
          setState({
            key,
            checking: false,
            notice:
              "This is taking longer than usual. Check status again before retrying the same checkpoint.",
          });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (++attempts < 18) {
          setState({
            key,
            checking: false,
            notice:
              "Confirmation is taking longer than usual. Checking again automatically; you can keep reading.",
          });
          timer = setTimeout(() => void confirm(), 10_000);
        } else
          setState({
            key,
            checking: false,
            notice:
              error instanceof Error && error.name !== "TimeoutError"
                ? error.message
                : "Status is temporarily unavailable. Check again to confirm recovery.",
          });
      }
    }
    // Read-only confirmation must not wait for the destructive retry lease.
    timer = setTimeout(
      () => void confirm(),
      checkRequest ? 0 : Math.min(3_000, Math.max(0, retryAfter - Date.now()))
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, sessionId, id, snapshotId, retryAfter, key, checkRequest]);

  return {
    checking: state?.key === key && state.checking,
    notice: state?.key === key ? state.notice : "",
    check,
  };
}

export type WorkspaceRecoveryStatus = ReturnType<typeof useWorkspaceRecovery>;
