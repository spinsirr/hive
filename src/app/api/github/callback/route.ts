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
import {
  GITHUB_USER_COOKIE,
  GITHUB_USER_MAX_AGE,
  githubUserCookieOptions,
  sealGitHubUserToken,
} from "@/lib/github-user-session";

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
        request.cookies.get(GITHUB_OAUTH_COOKIE)?.value
      )
    : null;

  if (!code || !oauthState) {
    return clearOAuthCookie(
      NextResponse.redirect(new URL("/?signin=retry", request.url))
    );
  }

  try {
    const { accessToken, expiresIn } = await exchangeGitHubOAuthCode(code);
    const authorization = oauthState.installationId
      ? await authorizeGitHubInstallation(
          accessToken,
          oauthState.installationId
        )
      : {
          repositories: [],
          user: await getGitHubUser(accessToken),
        };
    const { expiresAt, token } = await createUserSession(authorization.user);

    const redirectUrl = new URL(oauthState.returnTo, request.url);
    const response = NextResponse.redirect(redirectUrl);
    const githubMaxAge =
      typeof expiresIn === "number" &&
      Number.isFinite(expiresIn) &&
      expiresIn > 0
        ? Math.min(Math.floor(expiresIn), GITHUB_USER_MAX_AGE)
        : GITHUB_USER_MAX_AGE;
    response.cookies.set(
      GITHUB_USER_COOKIE,
      await sealGitHubUserToken(accessToken, token, githubMaxAge),
      githubUserCookieOptions(
        request.nextUrl.protocol === "https:",
        githubMaxAge
      )
    );
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
        { status: 502 }
      )
    );
  }
}
