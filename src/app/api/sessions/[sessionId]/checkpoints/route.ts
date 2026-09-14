import { type NextRequest, NextResponse } from "next/server";

import {
  getSessionMember,
  HIVE_SESSION_COOKIE,
} from "@/server/auth/auth-session";
import { isTaskSessionId } from "@/lib/tasks/task-session-id";
import {
  getTaskSessionSnapshot,
  getPublicTaskSessionSnapshot,
  syncTaskIdleCheckpoint,
  isTaskSessionMember,
  startTaskWorkspaceRestore,
  recordTaskWorkspaceRestoreSource,
  finishTaskWorkspaceRestore,
  TaskSessionAccessError,
} from "@/server/sessions/task-session-store";
import {
  readWorkspaceCheckpoints,
  WorkspaceReadError,
} from "@/server/workspace/workspace-browser";
import {
  restoreWorkspaceRequest,
  WorkspaceRestoreError,
} from "@/lib/workspace/workspace-restore-state";
import {
  confirmSandboxCheckpoint,
  restoreSandboxCheckpoint,
} from "@/server/workspace/workspace-restore";
import { publicTaskSessionSnapshot } from "@/lib/session/task-session-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const member = await getSessionMember(
      request.cookies.get(HIVE_SESSION_COOKIE)?.value
    );
    if (
      !isTaskSessionId(sessionId) ||
      !member ||
      !(await isTaskSessionMember(sessionId, member.id))
    )
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    await syncTaskIdleCheckpoint(sessionId);
    const { session } = await getTaskSessionSnapshot(sessionId);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(30_000),
    ]);
    return NextResponse.json(await readWorkspaceCheckpoints(session, signal), {
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof WorkspaceReadError
            ? error.message
            : "Checkpoints could not be loaded. Try again.",
      },
      {
        status: error instanceof WorkspaceReadError ? error.status : 503,
        headers,
      }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  if (
    !isTaskSessionId(sessionId) ||
    !member ||
    !(await isTaskSessionMember(sessionId, member.id))
  )
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers }
    );
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403, headers }
    );
  const parsed = restoreWorkspaceRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid checkpoint restore request." },
      { status: 400, headers }
    );
  let started = false;
  let startedAt = 0;
  try {
    if (parsed.data.mode === "check") {
      const { session } = await getTaskSessionSnapshot(sessionId);
      if (
        session.workspace.lastRestore?.id === parsed.data.id &&
        session.workspace.lastRestore.snapshotId === parsed.data.snapshotId &&
        !session.workspace.restore
      ) {
        return NextResponse.json(
          publicTaskSessionSnapshot(
            await getPublicTaskSessionSnapshot(sessionId)
          ),
          { headers }
        );
      }
      const pending = session.workspace.restore;
      if (
        !pending ||
        pending.id !== parsed.data.id ||
        pending.snapshotId !== parsed.data.snapshotId
      )
        throw new WorkspaceRestoreError(
          409,
          "The restore changed. Refresh Checkpoints to see its status."
        );
      // The lease fences another WRITE, not a metadata read. A new VM booted
      // from the selected checkpoint is proof even before the retry window.
      if (
        !(await confirmSandboxCheckpoint(session, AbortSignal.timeout(8_000)))
      ) {
        return NextResponse.json({ pending: true }, { status: 202, headers });
      }
      const snapshot = await finishTaskWorkspaceRestore(
        sessionId,
        pending.id,
        true,
        pending.startedAt
      );
      return NextResponse.json(publicTaskSessionSnapshot(snapshot), {
        headers,
      });
    }
    const operation = await startTaskWorkspaceRestore(
      sessionId,
      parsed.data,
      member
    );
    started = operation.started;
    if (!started)
      return NextResponse.json(
        publicTaskSessionSnapshot(
          await getPublicTaskSessionSnapshot(sessionId)
        ),
        { headers }
      );
    startedAt = operation.session.workspace.restore!.startedAt;
    // Do not couple a destructive operation to a browser tab closing. All
    // provider calls are bounded; the durable fence outlives this 60s worker.
    await restoreSandboxCheckpoint(
      operation.session,
      AbortSignal.timeout(45_000),
      async (sourceSessionId) => {
        await recordTaskWorkspaceRestoreSource(
          sessionId,
          parsed.data.id,
          startedAt,
          sourceSessionId
        );
      }
    );
    const snapshot = await finishTaskWorkspaceRestore(
      sessionId,
      parsed.data.id,
      true,
      startedAt
    );
    return NextResponse.json(publicTaskSessionSnapshot(snapshot), { headers });
  } catch (error) {
    if (started) {
      // A provider may finish after its response times out. Use a fresh, short
      // read budget before reporting uncertainty; never reuse the aborted signal.
      try {
        const { session } = await getTaskSessionSnapshot(sessionId);
        // A viewer's read-only check may have confirmed this worker already.
        if (
          !session.workspace.restore &&
          session.workspace.lastRestore?.id === parsed.data.id &&
          session.workspace.lastRestore.snapshotId === parsed.data.snapshotId
        ) {
          return NextResponse.json(
            publicTaskSessionSnapshot(
              await getPublicTaskSessionSnapshot(sessionId)
            ),
            { headers }
          );
        }
        if (
          session.workspace.restore?.id === parsed.data.id &&
          session.workspace.restore.startedAt === startedAt &&
          (await confirmSandboxCheckpoint(session, AbortSignal.timeout(5_000)))
        ) {
          const snapshot = await finishTaskWorkspaceRestore(
            sessionId,
            parsed.data.id,
            true,
            startedAt
          );
          return NextResponse.json(publicTaskSessionSnapshot(snapshot), {
            headers,
          });
        }
      } catch {
        /* Keep the durable fence when provider confirmation is unavailable. */
      }
      await finishTaskWorkspaceRestore(
        sessionId,
        parsed.data.id,
        false,
        startedAt
      ).catch(() => undefined);
      console.warn("[workspace-restore] Unconfirmed restore", {
        sessionId,
        operationId: parsed.data.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
    if (error instanceof TaskSessionAccessError)
      return NextResponse.json(
        { error: error.message },
        { status: 403, headers }
      );
    const known =
      error instanceof WorkspaceRestoreError ||
      error instanceof WorkspaceReadError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : "Still confirming the restored workspace. You can keep reading; editing will return once recovery is confirmed.",
      },
      { status: known ? error.status : 503, headers }
    );
  }
}
