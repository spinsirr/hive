import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { handle } from "hono/vercel";
import { zValidator } from "@hono/zod-validator";
import {
  apiError,
  privateResponse,
  taskMember,
  type SessionApi,
} from "@/server/http/session-middleware";

import {
  getTaskSessionSnapshot,
  getPublicTaskSessionSnapshot,
  syncTaskIdleCheckpoint,
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
const app = new Hono<SessionApi>()
  .use("*", privateResponse, csrf())
  .onError(apiError)
  .get("/api/sessions/:sessionId/checkpoints", taskMember, async (c) => {
    try {
      const sessionId = c.get("sessionId");
      await syncTaskIdleCheckpoint(sessionId);
      const { session } = await getTaskSessionSnapshot(sessionId);
      const signal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(30_000),
      ]);
      return Response.json(await readWorkspaceCheckpoints(session, signal));
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof WorkspaceReadError
              ? error.message
              : "Checkpoints could not be loaded. Try again.",
        },
        {
          status: error instanceof WorkspaceReadError ? error.status : 503,
        }
      );
    }
  })
  .post(
    "/api/sessions/:sessionId/checkpoints",
    taskMember,
    zValidator("json", restoreWorkspaceRequest, (result, c) => {
      if (!result.success)
        return c.json({ error: "Invalid checkpoint restore request." }, 400);
    }),
    async (c) => {
      const sessionId = c.get("sessionId");
      const member = c.get("member");
      const input = c.req.valid("json");
      let started = false;
      let startedAt = 0;
      try {
        if (input.mode === "check") {
          const { session } = await getTaskSessionSnapshot(sessionId);
          if (
            session.workspace.lastRestore?.id === input.id &&
            session.workspace.lastRestore.snapshotId === input.snapshotId &&
            !session.workspace.restore
          ) {
            return Response.json(
              publicTaskSessionSnapshot(
                await getPublicTaskSessionSnapshot(sessionId)
              )
            );
          }
          const pending = session.workspace.restore;
          if (
            !pending ||
            pending.id !== input.id ||
            pending.snapshotId !== input.snapshotId
          )
            throw new WorkspaceRestoreError(
              409,
              "The restore changed. Refresh Checkpoints to see its status."
            );
          // The lease fences another WRITE, not a metadata read. A new VM booted
          // from the selected checkpoint is proof even before the retry window.
          if (
            !(await confirmSandboxCheckpoint(
              session,
              AbortSignal.timeout(8_000)
            ))
          ) {
            return Response.json({ pending: true }, { status: 202 });
          }
          const snapshot = await finishTaskWorkspaceRestore(
            sessionId,
            pending.id,
            true,
            pending.startedAt
          );
          return Response.json(publicTaskSessionSnapshot(snapshot));
        }
        const operation = await startTaskWorkspaceRestore(
          sessionId,
          input,
          member
        );
        started = operation.started;
        if (!started)
          return Response.json(
            publicTaskSessionSnapshot(
              await getPublicTaskSessionSnapshot(sessionId)
            )
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
              input.id,
              startedAt,
              sourceSessionId
            );
          }
        );
        const snapshot = await finishTaskWorkspaceRestore(
          sessionId,
          input.id,
          true,
          startedAt
        );
        return Response.json(publicTaskSessionSnapshot(snapshot));
      } catch (error) {
        if (started) {
          // A provider may finish after its response times out. Use a fresh, short
          // read budget before reporting uncertainty; never reuse the aborted signal.
          try {
            const { session } = await getTaskSessionSnapshot(sessionId);
            // A viewer's read-only check may have confirmed this worker already.
            if (
              !session.workspace.restore &&
              session.workspace.lastRestore?.id === input.id &&
              session.workspace.lastRestore.snapshotId === input.snapshotId
            ) {
              return Response.json(
                publicTaskSessionSnapshot(
                  await getPublicTaskSessionSnapshot(sessionId)
                )
              );
            }
            if (
              session.workspace.restore?.id === input.id &&
              session.workspace.restore.startedAt === startedAt &&
              (await confirmSandboxCheckpoint(
                session,
                AbortSignal.timeout(5_000)
              ))
            ) {
              const snapshot = await finishTaskWorkspaceRestore(
                sessionId,
                input.id,
                true,
                startedAt
              );
              return Response.json(publicTaskSessionSnapshot(snapshot));
            }
          } catch {
            /* Keep the durable fence when provider confirmation is unavailable. */
          }
          await finishTaskWorkspaceRestore(
            sessionId,
            input.id,
            false,
            startedAt
          ).catch(() => undefined);
          console.warn("[workspace-restore] Unconfirmed restore", {
            sessionId,
            operationId: input.id,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
        if (error instanceof TaskSessionAccessError)
          return Response.json({ error: error.message }, { status: 403 });
        const known =
          error instanceof WorkspaceRestoreError ||
          error instanceof WorkspaceReadError;
        return Response.json(
          {
            error: known
              ? error.message
              : "Still confirming the restored workspace. You can keep reading; editing will return once recovery is confirmed.",
          },
          { status: known ? error.status : 503 }
        );
      }
    }
  );

export const GET = handle(app);
export const POST = handle(app);
