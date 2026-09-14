import { type NextRequest, NextResponse } from "next/server";

import {
  getSessionMember,
  HIVE_SESSION_COOKIE,
} from "@/server/auth/auth-session";
import { canonicalGitHubLoginUrl } from "@/server/auth/github-login-origin";
import {
  createGitHubOAuthState,
  GITHUB_OAUTH_COOKIE,
  githubOAuthAuthorizeUrl,
} from "@/server/auth/github-oauth";
import { isTaskSessionId } from "@/lib/tasks/task-session-id";
import { isTaskSessionMember } from "@/server/sessions/task-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function installationIdFrom(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("installation_id");
  if (!value || !/^\d+$/.test(value)) return null;
  const installationId = Number(value);
  return Number.isSafeInteger(installationId) && installationId > 0
    ? installationId
    : null;
}

export async function GET(request: NextRequest) {
  const installationId = installationIdFrom(request);
  const sessionId = request.nextUrl.searchParams.get("session_id");

  try {
    const canonicalLogin = canonicalGitHubLoginUrl(
      request.url,
      undefined,
      request.headers.get("host")
    );
    if (canonicalLogin) return NextResponse.redirect(canonicalLogin);

    if (installationId) {
      if (!isTaskSessionId(sessionId)) {
        return NextResponse.json({ error: "Invalid session" }, { status: 400 });
      }
      const member = await getSessionMember(
        request.cookies.get(HIVE_SESSION_COOKIE)?.value
      );
      if (!member || !(await isTaskSessionMember(sessionId, member.id))) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }
    }
    const { maxAge, nonce, state } = createGitHubOAuthState({
      installationId: installationId ?? undefined,
      returnTo: request.nextUrl.searchParams.get("return_to") ?? undefined,
    });
    const response = NextResponse.redirect(githubOAuthAuthorizeUrl(state));
    response.cookies.set(GITHUB_OAUTH_COOKIE, nonce, {
      httpOnly: true,
      maxAge,
      path: "/api/github",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
  } catch (error) {
    console.error("GitHub OAuth start failed", error);
    return NextResponse.json(
      {
        error:
          "Hive could not verify this GitHub App installation before authorization.",
      },
      { status: 502 }
    );
  }
}
