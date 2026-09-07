import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import { getTaskSessionSnapshot, isTaskSessionMember, startTaskWorkspaceRestore, finishTaskWorkspaceRestore } from "@/lib/task-session-store";
import { readWorkspaceCheckpoints, WorkspaceReadError } from "@/lib/workspace-browser";
import { restoreWorkspaceRequest, WorkspaceRestoreError } from "@/lib/workspace-restore-state";
import { restoreSandboxCheckpoint } from "@/lib/workspace-restore";
import { publicTaskSessionSnapshot } from "@/lib/task-session-snapshot";

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

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const member = await getSessionMember(request.cookies.get(HIVE_SESSION_COOKIE)?.value);
  if (!isTaskSessionId(sessionId) || !member || !(await isTaskSessionMember(sessionId, member.id))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const parsed = restoreWorkspaceRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid checkpoint restore request." }, { status: 400, headers });
  let started = false;
  try {
    const operation = await startTaskWorkspaceRestore(sessionId, parsed.data, member);
    started = operation.started;
    if (!started) return NextResponse.json(publicTaskSessionSnapshot(await getTaskSessionSnapshot(sessionId)), { headers });
    // Do not couple a destructive operation to a browser tab closing. All
    // provider calls are bounded; the durable fence outlives this 60s worker.
    await restoreSandboxCheckpoint(operation.session, AbortSignal.timeout(45_000));
    const snapshot = await finishTaskWorkspaceRestore(sessionId, parsed.data.id, true);
    return NextResponse.json(publicTaskSessionSnapshot(snapshot), { headers });
  } catch (error) {
    if (started) await finishTaskWorkspaceRestore(sessionId, parsed.data.id, false).catch(() => undefined);
    const known = error instanceof WorkspaceRestoreError || error instanceof WorkspaceReadError;
    return NextResponse.json({ error: known ? error.message : "Restore could not be confirmed. Refresh Checkpoints and retry the same restore before continuing." }, { status: known ? error.status : 503, headers });
  }
}
