import { Sandbox } from "@vercel/sandbox";
import {
  WORKSPACE_CHECKPOINT_LIMIT,
  type TaskSessionState,
  type WorkspaceRestore,
} from "./task-session.ts";
import { existingWorkspace } from "./workspace-browser.ts";
import { WorkspaceRestoreError } from "./workspace-restore-state.ts";

async function isRestoredSession(
  sandbox: Sandbox,
  operation: WorkspaceRestore,
  signal: AbortSignal
) {
  const current = sandbox.currentSession();
  if (
    !operation.sourceSessionId ||
    current.sessionId === operation.sourceSessionId ||
    current.sourceSnapshotId !== operation.snapshotId
  )
    return false;
  if (sandbox.status === "running")
    return sandbox.currentSnapshotId === operation.snapshotId;
  if (sandbox.status !== "stopped") return false;
  // A restored VM can time out before a viewer returns. Its automatic save
  // advances currentSnapshotId; require the exact new VM -> target-derived save
  // chain while the task is still fenced, not merely a matching source snapshot.
  const { snapshots } = await sandbox.listSnapshots({
    limit: 10,
    sortOrder: "desc",
    signal,
  });
  return snapshots.some(
    (saved) =>
      saved.id === sandbox.currentSnapshotId &&
      saved.sourceSessionId === current.sessionId &&
      saved.parentId === operation.snapshotId &&
      saved.status === "created" &&
      (!saved.expiresAt || saved.expiresAt > Date.now())
  );
}

/** Metadata only: never resumes, stops, or rewinds a sandbox. */
export async function confirmSandboxCheckpoint(
  session: TaskSessionState,
  signal: AbortSignal
) {
  if (!session.workspace.restore?.sourceSessionId) return false;
  return isRestoredSession(
    await existingWorkspace(session, false, signal),
    session.workspace.restore,
    signal
  );
}

/** Call only after the durable task fence has excluded runs and file readers. */
export async function restoreSandboxCheckpoint(
  session: TaskSessionState,
  signal: AbortSignal,
  recordSource: (sourceSessionId: string) => Promise<void>
) {
  const operation = session.workspace.restore;
  const checkpoint = session.workspace.checkpoints?.find(
    (entry) => entry.id === operation?.snapshotId
  );
  if (!operation || !checkpoint)
    throw new WorkspaceRestoreError(409, "No matching restore is pending.");
  let sandbox = await existingWorkspace(session, false, signal);
  // A retry first acknowledges an already-finished restore, without replaying it.
  if (await isRestoredSession(sandbox, operation, signal)) return;
  const { snapshots } = await sandbox.listSnapshots({
    limit: 10,
    sortOrder: "desc",
    signal,
  });
  const target = snapshots.find(
    (entry) =>
      entry.id === checkpoint.id &&
      entry.status === "created" &&
      (!entry.expiresAt || entry.expiresAt > Date.now())
  );
  if (!target)
    throw new WorkspaceRestoreError(
      409,
      "This checkpoint is no longer available. The workspace remains paused for recovery."
    );

  // Persist before touching the VM. Source snapshot alone is not proof: an old
  // running VM may have started from that snapshot and since accumulated edits.
  const sourceSessionId =
    operation.sourceSessionId ?? sandbox.currentSession().sessionId;
  if (!operation.sourceSessionId) await recordSource(sourceSessionId);

  // Stopping the currently-open file browser saves a recovery point. Temporarily
  // reserve room so that save cannot evict the selected older checkpoint.
  await sandbox.update(
    { keepLastSnapshots: { count: 10, expiration: 0 } },
    { signal }
  );
  if (sandbox.status !== "stopped") await sandbox.stop({ signal });
  sandbox = await Sandbox.get({ name: sandbox.name, resume: false, signal });
  if (sandbox.status !== "stopped")
    throw new WorkspaceRestoreError(
      503,
      "Waiting for the workspace to stop. Retry this restore shortly."
    );
  await sandbox.update({ currentSnapshotId: checkpoint.id }, { signal });
  const restored = await Sandbox.get({
    name: sandbox.name,
    resume: true,
    signal,
  });
  if (
    !(await isRestoredSession(
      restored,
      { ...operation, sourceSessionId },
      signal
    ))
  )
    throw new WorkspaceRestoreError(
      503,
      "The restored workspace could not be confirmed. Retry this restore shortly."
    );
  // The restored files are confirmed. Retention housekeeping must not report a
  // failed restore after that boundary; the next run also enforces this limit.
  await restored
    .update(
      {
        keepLastSnapshots: { count: WORKSPACE_CHECKPOINT_LIMIT, expiration: 0 },
      },
      { signal }
    )
    .catch(() => {
      console.warn(
        "[workspace-restore] Restored successfully; snapshot retention update deferred."
      );
    });
}
