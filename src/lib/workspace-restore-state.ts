import { z } from "zod";
import { ARCHIVED_TASK_MESSAGE, isHiveRunActive, timeLabel, type TaskSessionState, type TeamMember } from "./task-session.ts";
import { coldResumeState } from "./task-environment-policy.ts";

export const restoreWorkspaceRequest = z.object({
  id: z.uuid(), snapshotId: z.string().min(1).max(200), version: z.number().int().nonnegative(),
  mode: z.enum(["restore", "check"]).optional(),
});
export type RestoreWorkspaceRequest = z.infer<typeof restoreWorkspaceRequest>;

export class WorkspaceRestoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function workspaceRestoreBlockReason(session: TaskSessionState) {
  if (session.archived) return ARCHIVED_TASK_MESSAGE;
  if (session.workspace.restore) return session.workspace.restore.status === "unconfirmed" ? "Still confirming the restored workspace…" : "Restoring workspace…";
  if (isHiveRunActive(session) || session.activeSteer) return "Wait for Hive to finish before restoring a checkpoint.";
  return null;
}

export function beginWorkspaceRestore(session: TaskSessionState, request: RestoreWorkspaceRequest, member: TeamMember, now = Date.now()): TaskSessionState {
  if (session.archived) throw new WorkspaceRestoreError(409, ARCHIVED_TASK_MESSAGE);
  if (session.workspace.lastRestore?.id === request.id && session.workspace.lastRestore.snapshotId === request.snapshotId) return session;
  const pending = session.workspace.restore;
  if (pending) {
    // A timed-out request can be uncertain at the provider. Keep the task
    // fenced, and retry only that operation after its bounded worker has ended.
    if (pending.id !== request.id || pending.snapshotId !== request.snapshotId || now < pending.retryAfter) throw new WorkspaceRestoreError(409, "A restore is already in progress. Refresh Checkpoints before retrying.");
  } else {
    const blocked = workspaceRestoreBlockReason(session);
    if (blocked) throw new WorkspaceRestoreError(409, blocked);
    if (session.version !== request.version) throw new WorkspaceRestoreError(409, "The task changed. Refresh Checkpoints and confirm again.");
  }
  const checkpoint = session.workspace.checkpoints?.find((entry) => entry.id === request.snapshotId);
  if (!checkpoint?.result.agentSession.resumeFrom || checkpoint.result.agentSession.id !== session.workspace.agentSession?.id || checkpoint.result.sandboxName !== session.workspace.sandboxName) throw new WorkspaceRestoreError(409, "This snapshot has no matching agent checkpoint and cannot be restored safely.");
  return {
    ...session, version: session.version + 1, updatedAt: now,
    workspace: { ...session.workspace, restore: { id: request.id, snapshotId: request.snapshotId, by: pending?.by ?? member, sourceSessionId: pending?.sourceSessionId, status: "restoring", startedAt: now, retryAfter: now + 90_000 } },
  };
}

export function assertWorkspaceRestoreAttempt(session: TaskSessionState, operationId: string, startedAt: number) {
  if (session.workspace.restore?.id !== operationId || session.workspace.restore.startedAt !== startedAt) {
    throw new WorkspaceRestoreError(409, "The restore attempt changed. Refresh Checkpoints to see its status.");
  }
}

export function recordWorkspaceRestoreSource(session: TaskSessionState, operationId: string, startedAt: number, sourceSessionId: string): TaskSessionState {
  assertWorkspaceRestoreAttempt(session, operationId, startedAt);
  const operation = session.workspace.restore!;
  if (operation.sourceSessionId) return session;
  if (!sourceSessionId) throw new WorkspaceRestoreError(503, "The original workspace could not be identified. Nothing was restored.");
  return { ...session, version: session.version + 1, workspace: { ...session.workspace, restore: { ...operation, sourceSessionId } } };
}

export function completeWorkspaceRestore(session: TaskSessionState, operationId: string, now = Date.now()): TaskSessionState {
  const operation = session.workspace.restore;
  if (!operation || operation.id !== operationId) return session;
  const checkpoint = session.workspace.checkpoints?.find((entry) => entry.id === operation.snapshotId);
  if (!checkpoint) throw new WorkspaceRestoreError(409, "The saved agent checkpoint is unavailable.");
  const hasChanges = checkpoint.result.diff.trim().length > 0;
  return {
    ...session, version: session.version + 1, updatedAt: now, revision: 2,
    stage: hasChanges && !checkpoint.error ? "review" : "waiting", activeSteer: undefined,
    workspace: {
      ...checkpoint.result, status: checkpoint.error ? "error" : hasChanges ? "review" : "ready", error: checkpoint.error, completedAt: now,
      environment: undefined,
      idleCheckpoint: undefined,
      agentSession: { ...checkpoint.result.agentSession, resumeFrom: coldResumeState(checkpoint.result.agentSession.resumeFrom) },
      codingEffort: session.workspace.codingEffort,
      codingModel: session.workspace.codingModel,
      checkpoints: session.workspace.checkpoints,
      lastRestore: { id: operation.id, snapshotId: checkpoint.id, by: operation.by.id, at: now },
    },
    // Team discussion and pending steers are never rewound or auto-executed.
    messages: [...session.messages, {
      id: `restore-${operation.id}`, memberId: operation.by.id, name: operation.by.name, initials: operation.by.initials, role: "human",
      event: "workspace-restored",
      body: `Restored workspace and agent context to checkpoint ${checkpoint.id}. Team discussion and queued steers were kept; nothing was rerun.`,
      time: timeLabel(now),
      createdAt: now,
    }],
  };
}

export function failWorkspaceRestore(session: TaskSessionState, operationId: string): TaskSessionState {
  if (session.workspace.restore?.id !== operationId) return session;
  return { ...session, version: session.version + 1, workspace: { ...session.workspace, restore: { ...session.workspace.restore, status: "unconfirmed" } } };
}
