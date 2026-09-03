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
import { isRoomId } from "@/lib/room-id";
import { applyRoomAction } from "@/lib/room-store";

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

function roomIdFromReturnTo(returnTo: string) {
  const match = returnTo.match(/^\/rooms\/([^/?#]+)/);
  const roomId = match?.[1];
  return isRoomId(roomId) ? roomId : "orbit-nav";
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
    if (oauthState.installationId && authorization.repositories.length !== 1) {
      return clearOAuthCookie(
        NextResponse.json(
          {
            error:
              "Hive's single-team demo expects exactly one selected repository. Update the GitHub App installation and try again.",
          },
          { status: 409 },
        ),
      );
    }

    const { expiresAt, member, token } = await createUserSession(
      authorization.user,
    );

    if (oauthState.installationId) {
      const [repository] = authorization.repositories;
      await applyRoomAction(
        roomIdFromReturnTo(oauthState.returnTo),
        {
          type: "connect-repository",
          actor: member.id,
          repositoryUrl: repository.cloneUrl,
          repositoryName: repository.name,
          repositoryId: repository.id,
          repositoryBranch: repository.defaultBranch,
          installationId: oauthState.installationId,
          visibility: repository.visibility,
          githubUserId: authorization.user.id,
          githubLogin: authorization.user.login,
        },
        member,
      );
    }

    const redirectUrl = new URL(oauthState.returnTo, request.url);
    if (oauthState.installationId) {
      redirectUrl.searchParams.set("github", "connected");
    }
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
