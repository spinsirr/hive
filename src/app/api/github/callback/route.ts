import { type NextRequest, NextResponse } from "next/server";

import {
  authorizeGitHubInstallation,
  exchangeGitHubOAuthCode,
  getGitHubUser,
  GITHUB_OAUTH_COOKIE,
  verifyGitHubOAuthState,
} from "@/lib/github-oauth";
import {
  createUserSession,
  HIVE_SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth-session";
import { saveGitHubInstallation } from "@/lib/github-connection-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set(GITHUB_OAUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/api/github",
    sameSite: "lax",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthState = state
    ? verifyGitHubOAuthState(
        state,
        request.cookies.get(GITHUB_OAUTH_COOKIE)?.value,
      )
    : null;

  if (!code || !oauthState) {
    return clearOAuthCookie(
      NextResponse.json(
        { error: "GitHub authorization was cancelled or could not be verified." },
        { status: 400 },
      ),
    );
  }

  try {
    const accessToken = await exchangeGitHubOAuthCode(code);
    const authorization = oauthState.installationId
      ? await authorizeGitHubInstallation(
          accessToken,
          oauthState.installationId,
        )
      : {
          repositories: [],
          user: await getGitHubUser(accessToken),
        };
    const { expiresAt, member, token } = await createUserSession(
      authorization.user,
    );

    if (oauthState.installationId) {
      await saveGitHubInstallation(
        oauthState.installationId,
        member.id,
      );
    }

    const redirectUrl = new URL(oauthState.returnTo, request.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(HIVE_SESSION_COOKIE, token, {
      ...sessionCookieOptions(request.nextUrl.protocol === "https:"),
      expires: expiresAt,
    });
    return clearOAuthCookie(response);
  } catch (error) {
    console.error("GitHub OAuth callback failed", error);
    return clearOAuthCookie(
      NextResponse.json(
        {
          error:
            "Hive could not bind this GitHub user to the App installation.",
        },
        { status: 502 },
      ),
    );
  }
}
