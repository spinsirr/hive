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
import { z } from "zod";
import { withTaskSubagentControl } from "@/server/sessions/task-session-store";
import { controlSubagent } from "@/server/agents/tools/subagent-control";

export const runtime = "nodejs";
export const maxDuration = 30;
const stopRequest = z
  .object({ id: z.string().uuid(), runId: z.string().min(1).max(120) })
  .strict();

const app = new Hono<SessionApi>()
  .use("*", privateResponse, csrf())
  .onError(apiError)
  .post(
    "/api/sessions/:sessionId/subagents",
    taskMember,
    async (c, next) => {
      if ((await c.req.text()).length > 2048)
        return c.json({ error: "Invalid request" }, 400);
      await next();
    },
    zValidator("json", stopRequest, (result, c) => {
      if (!result.success) return c.json({ error: "Invalid request" }, 400);
    }),
    async (c) => {
      const sessionId = c.get("sessionId");
      const input = c.req.valid("json");
      try {
        const signal = AbortSignal.any([
          c.req.raw.signal,
          AbortSignal.timeout(20_000),
        ]);
        const task = await withTaskSubagentControl(sessionId, (session) =>
          controlSubagent(
            session,
            input.runId,
            { action: "stop", id: input.id },
            signal
          )
        );
        return Response.json({ task });
      } catch {
        return Response.json(
          {
            error:
              "Stop could not be confirmed. Check the task's current state before retrying.",
          },
          { status: 409 }
        );
      }
    }
  );

export const POST = handle(app);
