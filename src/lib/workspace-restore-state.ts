import { z } from "zod";
import { isHiveRunActive, type TaskSessionState, type TeamMember } from "./task-session.ts";

export const restoreWorkspaceRequest = z.object({
  id: z.uuid(), snapshotId: z.string().min(1).max(200), version: z.number().int().nonnegative(),
});
export type RestoreWorkspaceRequest = z.infer<typeof restoreWorkspaceRequest>;

export class WorkspaceRestoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function workspaceRestoreBlockReason(session: TaskSessionState) {
  if (session.workspace.restore) return session.workspace.restore.status === "unconfirmed" ? "Restore needs confirmation. Retry the same checkpoint before continuing." : "Restoring workspace…";
  if (session.lifecycle === "completed") return "Reopen this task before restoring a checkpoint.";
  if (isHiveRunActive(session) || session.activeSteer) return "Wait for Hive to finish before restoring a checkpoint.";
  return null;
}

export function beginWorkspaceRestore(session: TaskSessionState, request: RestoreWorkspaceRequest, member: TeamMember, now = Date.now()): TaskSessionState {
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
    workspace: { ...session.workspace, restore: { id: request.id, snapshotId: request.snapshotId, by: pending?.by ?? member, status: "restoring", startedAt: now, retryAfter: now + 90_000 } },
  };
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
      checkpoints: session.workspace.checkpoints,
      lastRestore: { id: operation.id, snapshotId: checkpoint.id, by: operation.by.id, at: now },
    },
    // Team discussion and pending steers are never rewound or auto-executed.
    messages: [...session.messages, {
      id: `restore-${operation.id}`, memberId: operation.by.id, name: operation.by.name, initials: operation.by.initials, role: "human",
      body: `Restored workspace and agent context to checkpoint ${checkpoint.id}. Team discussion and queued steers were kept; nothing was rerun.`,
      time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(now),
    }],
  };
}

export function failWorkspaceRestore(session: TaskSessionState, operationId: string): TaskSessionState {
  if (session.workspace.restore?.id !== operationId) return session;
  return { ...session, version: session.version + 1, workspace: { ...session.workspace, restore: { ...session.workspace.restore, status: "unconfirmed" } } };
}
