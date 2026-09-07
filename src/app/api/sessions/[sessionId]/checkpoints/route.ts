import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import { getTaskSessionSnapshot, isTaskSessionMember } from "@/lib/task-session-store";
import { readWorkspaceCheckpoints, WorkspaceReadError } from "@/lib/workspace-browser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const member = await getSessionMember(request.cookies.get(HIVE_SESSION_COOKIE)?.value);
    if (!isTaskSessionId(sessionId) || !member || !(await isTaskSessionMember(sessionId, member.id))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const { session } = await getTaskSessionSnapshot(sessionId);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    return NextResponse.json(await readWorkspaceCheckpoints(session, signal), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof WorkspaceReadError ? error.message : "Checkpoints could not be loaded. Try again." }, { status: error instanceof WorkspaceReadError ? error.status : 503, headers });
  }
}
