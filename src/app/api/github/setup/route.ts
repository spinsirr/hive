import { type NextRequest, NextResponse } from "next/server";

import {
  getSessionMember,
  HIVE_SESSION_COOKIE,
} from "@/server/auth/auth-session";
import { verifyGitHubInstallState } from "@/server/auth/github-oauth";
import { isTaskSessionId } from "@/lib/tasks/task-session-id";
import { isTaskSessionMember } from "@/server/sessions/task-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function installationIdFrom(request: Request) {
  const value = new URL(request.url).searchParams.get("installation_id");
  if (!value || !/^\d+$/.test(value)) return null;
  const installationId = Number(value);
  return Number.isSafeInteger(installationId) && installationId > 0
    ? installationId
    : null;
}

export async function GET(request: NextRequest) {
  const installationId = installationIdFrom(request);
  const state = new URL(request.url).searchParams.get("state");
  const sessionId = verifyGitHubInstallState(state);
  if (!installationId || !isTaskSessionId(sessionId)) {
    return NextResponse.json(
      { error: "GitHub did not provide a valid installation ID." },
      { status: 400 }
    );
  }

  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  if (!member || !(await isTaskSessionMember(sessionId, member.id))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // The callback verifies user access; an App-level lookup is not authorization.
  return NextResponse.redirect(
    new URL(
      `/api/github/login?installation_id=${installationId}&session_id=${encodeURIComponent(sessionId)}&return_to=${encodeURIComponent(`/sessions/${sessionId}?github=connected`)}`,
      request.url
    )
  );
}
