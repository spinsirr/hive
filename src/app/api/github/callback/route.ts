import { type NextRequest, NextResponse } from "next/server";

import {
  authorizeGitHubInstallation,
  exchangeGitHubOAuthCode,
  GITHUB_OAUTH_COOKIE,
  verifyGitHubOAuthState,
} from "@/lib/github-oauth";
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

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const installationId = state
    ? verifyGitHubOAuthState(
        state,
        request.cookies.get(GITHUB_OAUTH_COOKIE)?.value,
      )
    : null;

  if (!code || !installationId) {
    return clearOAuthCookie(
      NextResponse.json(
        { error: "GitHub authorization was cancelled or could not be verified." },
        { status: 400 },
      ),
    );
  }

  try {
    const accessToken = await exchangeGitHubOAuthCode(code);
    const { repositories, user } = await authorizeGitHubInstallation(
      accessToken,
      installationId,
    );

    if (repositories.length !== 1) {
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

    const [repository] = repositories;
    await applyRoomAction({
      type: "connect-repository",
      actor: "spencer",
      repositoryUrl: repository.cloneUrl,
      repositoryName: repository.name,
      repositoryId: repository.id,
      repositoryBranch: repository.defaultBranch,
      installationId,
      visibility: repository.visibility,
      githubUserId: user.id,
      githubLogin: user.login,
    });

    return clearOAuthCookie(
      NextResponse.redirect(
        new URL("/?as=spencer&github=connected", request.url),
      ),
    );
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
