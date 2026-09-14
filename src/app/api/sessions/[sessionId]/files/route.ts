import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import {
  withTaskWorkspaceRead,
  isTaskSessionMember,
} from "@/lib/task-session-store";
import { readWorkspace, WorkspaceReadError } from "@/lib/workspace-browser";
import { workspaceReadRequest } from "@/lib/workspace-files";
import { WorkspaceRestoreError } from "@/lib/workspace-restore-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

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
    ) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    }
    const input = workspaceReadRequest.safeParse({
      kind: request.nextUrl.searchParams.get("kind") ?? "directory",
      path: request.nextUrl.searchParams.get("path") ?? "",
      offset: request.nextUrl.searchParams.get("offset") ?? 0,
    });
    if (!input.success)
      return NextResponse.json(
        { error: "Invalid workspace path." },
        { status: 400, headers }
      );
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(45_000),
    ]);
    return NextResponse.json(
      await withTaskWorkspaceRead(sessionId, (session) =>
        readWorkspace(session, input.data, signal)
      ),
      { headers }
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
    return NextResponse.json({ error: message }, { status, headers });
  }
}
