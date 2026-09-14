import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ErrorHandler } from "hono";

import { getSessionMember, HIVE_SESSION_COOKIE } from "../auth/auth-session.ts";
import { isTaskSessionMember } from "../sessions/task-session-store.ts";
import { isTaskSessionId } from "../../lib/tasks/task-session-id.ts";
import type { TeamMember } from "../../lib/session/task-session.ts";

export type SessionApi = {
  Variables: { sessionId: string; member: TeamMember };
};

export const privateResponse = createMiddleware(async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

export const taskMember = createMiddleware<SessionApi>(async (c, next) => {
  const sessionId = c.req.param("sessionId");
  if (!isTaskSessionId(sessionId))
    throw new HTTPException(401, { message: "Unauthorized" });
  const member = await getSessionMember(getCookie(c, HIVE_SESSION_COOKIE));
  if (!member || !(await isTaskSessionMember(sessionId, member.id)))
    throw new HTTPException(401, { message: "Unauthorized" });
  c.set("sessionId", sessionId);
  c.set("member", member);
  await next();
});

export const apiError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  console.error("Task API request failed", {
    path: c.req.path,
    name: error.name,
  });
  return c.json(
    { error: "The request could not be completed. Try again." },
    500
  );
};
