import { type NextRequest, NextResponse } from "next/server";

import { getInstallationRepositories } from "@/lib/github-app";
import {
  createGitHubOAuthState,
  GITHUB_OAUTH_COOKIE,
  githubOAuthAuthorizeUrl,
} from "@/lib/github-oauth";

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
  if (!installationId) {
    return NextResponse.json(
      { error: "A valid GitHub App installation ID is required." },
      { status: 400 },
    );
  }

  try {
    await getInstallationRepositories(installationId);
    const { maxAge, nonce, state } = createGitHubOAuthState(installationId);
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
      { status: 502 },
    );
  }
}
