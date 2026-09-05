import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { NextRequest } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { sessionEvents } from "@/lib/session-events";
import { subscribeToTaskSession } from "@/lib/session-live";
import { isTaskSessionId } from "@/lib/task-session-id";
import { getAgentReply, getTaskSessionSnapshot, isTaskSessionMember } from "@/lib/task-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!isTaskSessionId(sessionId)) return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  const token = request.cookies.get(HIVE_SESSION_COOKIE)?.value;
  async function authorized() {
    const member = await getSessionMember(token);
    return Boolean(member && await isTaskSessionMember(sessionId, member.id));
  }
  if (!await authorized()) return new Response(null, { status: 401 });

  return experimental_upgradeWebSocket((socket) => subscribeToTaskSession(socket, {
    sessionId,
    authorized,
    snapshot: () => getTaskSessionSnapshot(sessionId),
    reply: () => getAgentReply(sessionId),
    events: sessionEvents,
  }), { maxPayload: 1024 });
}
