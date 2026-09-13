import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { githubAppInstallUrl } from "@/lib/github-app";
import { createGitHubInstallState } from "@/lib/github-oauth";
import { isTaskSessionId } from "@/lib/task-session-id";
import { isTaskSessionMember } from "@/lib/task-session-store";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!isTaskSessionId(sessionId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }
  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  if (!member || !(await isTaskSessionMember(sessionId, member.id))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.redirect(
    githubAppInstallUrl(createGitHubInstallState(sessionId))
  );
}
