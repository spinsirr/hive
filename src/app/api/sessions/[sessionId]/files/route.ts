import { Hono } from "hono";
import { handle } from "hono/vercel";
import { zValidator } from "@hono/zod-validator";
import {
  apiError,
  privateResponse,
  taskMember,
  type SessionApi,
} from "@/server/http/session-middleware";

import { withTaskWorkspaceRead } from "@/server/sessions/task-session-store";
import {
  readWorkspace,
  WorkspaceReadError,
} from "@/server/workspace/workspace-browser";
import { workspaceReadRequest } from "@/lib/workspace/workspace-files";
import { WorkspaceRestoreError } from "@/lib/workspace/workspace-restore-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const app = new Hono<SessionApi>()
  .use("*", privateResponse)
  .onError(apiError)
  .get(
    "/api/sessions/:sessionId/files",
    taskMember,
    zValidator("query", workspaceReadRequest, (result, c) => {
      if (!result.success)
        return c.json({ error: "Invalid workspace path." }, 400);
    }),
    async (c) => {
      try {
        const sessionId = c.get("sessionId");
        const input = c.req.valid("query");
        const signal = AbortSignal.any([
          c.req.raw.signal,
          AbortSignal.timeout(45_000),
        ]);
        return Response.json(
          await withTaskWorkspaceRead(sessionId, (session) =>
            readWorkspace(session, input, signal)
          )
        );
      } catch (error) {
        const status =
          error instanceof WorkspaceReadError ||
          error instanceof WorkspaceRestoreError
            ? error.status
            : 503;
        const message =
          error instanceof WorkspaceReadError ||
          error instanceof WorkspaceRestoreError
            ? error.message
            : "Workspace could not be read. Try again.";
        return Response.json({ error: message }, { status });
      }
    }
  );

export const GET = handle(app);
