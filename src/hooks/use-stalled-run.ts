"use client";

import { useEffect, useState } from "react";

import {
  isHiveRunActive,
  STALLED_RUN_AFTER_MS,
  type TaskSessionState,
} from "@/lib/task-session";

/**
 * Whether the active run has outlived the request that could still report for
 * it. Renders false on the server and until the browser has checked its clock;
 * the server enforces the same threshold when a member acts on it.
 */
export function useStalledRun(session: TaskSessionState) {
  const active = isHiveRunActive(session);
  const startedAt = session.workspace.startedAt;
  const [check, setCheck] = useState<{
    startedAt: number;
    stalled: boolean;
  } | null>(null);

  useEffect(() => {
    if (!active || startedAt === undefined) return;
    const evaluate = () =>
      setCheck({
        startedAt,
        stalled: Date.now() - startedAt >= STALLED_RUN_AFTER_MS,
      });
    const initial = setTimeout(evaluate, 0);
    const interval = setInterval(evaluate, 5_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [active, startedAt]);

  return (
    active && check !== null && check.startedAt === startedAt && check.stalled
  );
}
