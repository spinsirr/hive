import { Sandbox } from "@vercel/sandbox";
import { WORKSPACE_CHECKPOINT_LIMIT, type TaskSessionState } from "./task-session.ts";
import { existingWorkspace } from "./workspace-browser.ts";
import { WorkspaceRestoreError } from "./workspace-restore-state.ts";

/** Call only after the durable task fence has excluded runs and file readers. */
export async function restoreSandboxCheckpoint(session: TaskSessionState, signal: AbortSignal) {
  const operation = session.workspace.restore;
  const checkpoint = session.workspace.checkpoints?.find((entry) => entry.id === operation?.snapshotId);
  if (!operation || !checkpoint) throw new WorkspaceRestoreError(409, "No matching restore is pending.");
  let sandbox = await existingWorkspace(session, false, signal);
  const { snapshots } = await sandbox.listSnapshots({ limit: 10, sortOrder: "desc", signal });
  const target = snapshots.find((entry) => entry.id === checkpoint.id && entry.status === "created" && (!entry.expiresAt || entry.expiresAt > Date.now()));
  if (!target) throw new WorkspaceRestoreError(409, "This checkpoint is no longer available. The workspace remains paused for recovery.");

  // Stopping the currently-open file browser saves a recovery point. Temporarily
  // reserve room so that save cannot evict the selected older checkpoint.
  await sandbox.update({ keepLastSnapshots: { count: 10, expiration: 0 } }, { signal });
  if (sandbox.status !== "stopped") await sandbox.stop({ signal });
  sandbox = await Sandbox.get({ name: sandbox.name, resume: false, signal });
  if (sandbox.status !== "stopped") throw new WorkspaceRestoreError(503, "Waiting for the workspace to stop. Retry this restore shortly.");
  await sandbox.update({ currentSnapshotId: checkpoint.id }, { signal });
  const restored = await Sandbox.get({ name: sandbox.name, resume: true, signal });
  if (restored.status !== "running" || restored.currentSession().sourceSnapshotId !== checkpoint.id) throw new WorkspaceRestoreError(503, "The restored workspace could not be confirmed. Retry this restore shortly.");
  // The restored files are confirmed. Retention housekeeping must not report a
  // failed restore after that boundary; the next run also enforces this limit.
  await restored.update({ keepLastSnapshots: { count: WORKSPACE_CHECKPOINT_LIMIT, expiration: 0 } }, { signal }).catch(() => {
    console.warn("[workspace-restore] Restored successfully; snapshot retention update deferred.");
  });
}
