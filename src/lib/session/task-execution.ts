import type {
  TaskSessionState,
  WorkspaceState,
  WorkspaceRestore,
} from "./task-session-state.ts";

/**
 * A run that has not reported this long after starting has outlived the request
 * hosting it (the session route's `maxDuration` is 300 s). Members may then mark
 * it as lost; nothing reruns and the discussion/queue are kept.
 */
export const STALLED_RUN_AFTER_MS = 6 * 60_000;

export const STALLED_RUN_ERROR =
  "Hive's execution process was lost before it reported a result.";

/** One execution view, derived from run/restore evidence. A queue is pending
 * input, never evidence that a worker is running. Review belongs to its Thread. */
export type TaskExecution =
  | { kind: "running"; startedAt: number }
  | { kind: "restoring"; restore: WorkspaceRestore }
  | { kind: "failed"; error: string }
  | { kind: "completed"; completedAt: number }
  | { kind: "idle" };

export function taskExecution(state: {
  workspace: Pick<
    WorkspaceState,
    "startedAt" | "completedAt" | "error" | "restore"
  >;
}): TaskExecution {
  const workspace = state.workspace;
  if (workspace.restore)
    return { kind: "restoring", restore: workspace.restore };
  if (isHiveRunActive(state))
    return { kind: "running", startedAt: workspace.startedAt! };
  if (workspace.error != null)
    return { kind: "failed", error: workspace.error };
  if (workspace.completedAt != null)
    return { kind: "completed", completedAt: workspace.completedAt };
  return { kind: "idle" };
}

export function isHiveRunActive({
  workspace,
}: {
  workspace: Pick<WorkspaceState, "startedAt" | "completedAt" | "restore">;
}): boolean {
  return (
    !workspace.restore &&
    workspace.startedAt != null &&
    workspace.completedAt == null
  );
}

/** True once an active run has outlived the request that could still report for it. */
export function isHiveRunStalled(
  state: TaskSessionState,
  now = Date.now()
): boolean {
  return (
    isHiveRunActive(state) &&
    now - state.workspace.startedAt! >= STALLED_RUN_AFTER_MS
  );
}

export function canApplyNextSteer(state: TaskSessionState): boolean {
  return (
    !state.archived &&
    !state.workspace.restore &&
    state.steeringQueue.length > 0 &&
    !state.activeSteer &&
    !isHiveRunActive(state)
  );
}

/** Only already-submitted input may auto-continue. Errors and restored history
 * require an explicit restart; the exact head ID fences competing clients. */
export function nextAutomaticSteer(state: TaskSessionState): string | null {
  const next = state.steeringQueue[0];
  if (
    !canApplyNextSteer(state) ||
    !next ||
    taskExecution(state).kind === "failed" ||
    (state.workspace.lastRestore &&
      next.queuedAt <= state.workspace.lastRestore.at)
  )
    return null;
  return next.id;
}

export function didStartHiveRun(
  previous: TaskSessionState,
  next: TaskSessionState
): boolean {
  return !isHiveRunActive(previous) && isHiveRunActive(next);
}

/** A native conversation belongs to one harness; never reinterpret its history. */
export function canSelectHarness(state: TaskSessionState) {
  return (
    canChangeTaskSettings(state) &&
    (!state.repository ||
      (!state.workspace.sandboxName &&
        !state.workspace.agentSession?.resumeFrom &&
        !state.workspace.checkpoints?.length &&
        state.workspace.startedAt === undefined))
  );
}

/** Settings, archive and reset require the same quiescent task. */
export function canChangeTaskSettings(state: TaskSessionState) {
  return (
    !state.archived &&
    !isHiveRunActive(state) &&
    !state.workspace.restore &&
    !state.activeSteer &&
    state.steeringQueue.length === 0
  );
}
