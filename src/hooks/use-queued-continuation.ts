"use client";

import { useEffect, useRef } from "react";
import { nextAutomaticSteer, type TaskSessionState } from "@/lib/task-session";
import type { ClientTaskSessionAction } from "@/lib/task-session-actions";

type ContinueAction = Extract<
  ClientTaskSessionAction,
  { type: "continue-queued-steer" }
>;

export function useQueuedContinuation(
  session: TaskSessionState,
  disconnected: boolean,
  dispatch: (action: ContinueAction) => Promise<unknown>
) {
  const attempted = useRef<string | null>(null);
  const next = nextAutomaticSteer(session);
  useEffect(() => {
    if (disconnected) {
      // A lost action response can be retried on reconnect. The server checks
      // this exact queue head under the task lock before granting execution.
      attempted.current = null;
      return;
    }
    if (!next || attempted.current === next) return;
    attempted.current = next;
    void dispatch({ type: "continue-queued-steer", steerId: next });
  }, [next, disconnected, dispatch]);
}
