import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

import {
  repositoryDirectory,
  resolvePersistentSandboxName,
} from "./hive-sandbox.ts";
import type { TaskSessionState } from "./task-session.ts";
import {
  workspaceReadRequest,
  workspaceReadResponse,
  type WorkspaceReadRequest,
  type WorkspaceCheckpointsResponse,
} from "./workspace-files.ts";
import { workspaceReadScript } from "./workspace-read-script.ts";
import { workspaceRestoreBlockReason } from "./workspace-restore-state.ts";

export class WorkspaceReadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const commandResponse = z.union([
  z.object({ status: z.literal(200), data: workspaceReadResponse }),
  z.object({
    status: z.union([
      z.literal(400),
      z.literal(403),
      z.literal(404),
      z.literal(413),
      z.literal(415),
      z.literal(500),
    ]),
    error: z.string(),
  }),
]);

export async function readWorkspace(
  session: TaskSessionState,
  input: WorkspaceReadRequest,
  signal: AbortSignal
) {
  const request = workspaceReadRequest.safeParse(input);
  if (!request.success)
    throw new WorkspaceReadError(400, "Invalid workspace path.");
  const sandbox = await existingWorkspace(session, true, signal);
  const root = path.posix.join(
    sandbox.currentSession().cwd,
    repositoryDirectory(session.repository!.url)
  );
  const result = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", workspaceReadScript, root, JSON.stringify(request.data)],
    signal,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0)
    throw new WorkspaceReadError(
      503,
      "Workspace could not be read. Try again."
    );
  const response = commandResponse.parse(
    JSON.parse(await result.stdout({ signal }))
  );
  if (response.status !== 200)
    throw new WorkspaceReadError(response.status, response.error);
  return response.data;
}

export async function readWorkspaceCheckpoints(
  session: TaskSessionState,
  signal: AbortSignal
): Promise<WorkspaceCheckpointsResponse> {
  const context = {
    version: session.version,
    blockedReason: workspaceRestoreBlockReason(session),
    restore: session.workspace.restore
      ? {
          id: session.workspace.restore.id,
          snapshotId: session.workspace.restore.snapshotId,
          status: session.workspace.restore.status,
          retryAfter: session.workspace.restore.retryAfter,
        }
      : null,
  };
  if (
    !session.workspace.agentSession ||
    (!session.workspace.startedAt && !session.workspace.completedAt)
  )
    return { ...context, checkpoints: [], retentionCount: null };
  // Metadata-only lookup: opening Checkpoints does not resume or stop the VM.
  const sandbox = await existingWorkspace(session, false, signal);
  const result = await sandbox.listSnapshots({
    limit: 10,
    sortOrder: "desc",
    signal,
  });
  return {
    ...context,
    checkpoints: result.snapshots
      .filter(
        (snapshot) =>
          snapshot.status === "created" &&
          (!snapshot.expiresAt || snapshot.expiresAt > Date.now())
      )
      .map((snapshot) => ({
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        sizeBytes: snapshot.sizeBytes,
        current: snapshot.id === sandbox.currentSnapshotId,
        restorable:
          session.workspace.checkpoints?.some(
            (saved) =>
              saved.id === snapshot.id &&
              Boolean(saved.result.agentSession.resumeFrom)
          ) ?? false,
      })),
    retentionCount: sandbox.keepLastSnapshots?.count ?? null,
  };
}

export async function existingWorkspace(
  session: TaskSessionState,
  resume: boolean,
  signal: AbortSignal
) {
  if (resume && session.workspace.restore)
    throw new WorkspaceReadError(
      409,
      "The workspace is being restored. Refresh Checkpoints to see its status."
    );
  const agentId = session.workspace.agentSession?.id;
  if (
    !session.repository ||
    !agentId ||
    (!session.workspace.startedAt &&
      !session.workspace.completedAt &&
      !session.workspace.sandboxName)
  ) {
    throw new WorkspaceReadError(
      409,
      "The workspace will be available after Hive starts working on the repository."
    );
  }

  let sandbox: Sandbox;
  try {
    // Never create, clone, fork, stop, or start a Codex turn from file browsing.
    sandbox = await Sandbox.get({
      name: resolvePersistentSandboxName(session, agentId),
      resume,
      signal,
    });
  } catch {
    throw new WorkspaceReadError(
      503,
      "Workspace is unavailable. Try again shortly."
    );
  }
  if (sandbox.tags?.session && sandbox.tags.session !== session.sessionId) {
    throw new WorkspaceReadError(
      403,
      "Workspace does not belong to this task."
    );
  }
  return sandbox;
}
