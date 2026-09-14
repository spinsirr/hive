import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createOAuthUserAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { z } from "zod";

import type { GitHubInstallationRepository } from "@/server/auth/github-app";
import { safeReturnTo } from "@/server/auth/return-to";

const GITHUB_API_VERSION = "2026-03-10";
const STATE_TTL_MS = 10 * 60 * 1000;
const GitHub = Octokit.plugin(paginateRest);
// GitHub's SDK also supports bigint IDs; Hive stores positive safe integers.
const githubId = z
  .union([z.number(), z.bigint()])
  .transform(Number)
  .pipe(z.int().positive());

export const GITHUB_OAUTH_COOKIE = "hive_github_oauth";

type OAuthStatePayload = {
  installationId?: number;
  nonce: string;
  expiresAt: number;
  returnTo: string;
};

type InstallStatePayload = {
  sessionId: string;
  expiresAt: number;
};

export type GitHubUserPayload = Pick<
  Awaited<ReturnType<typeof getGitHubUser>>,
  "id" | "login" | "name" | "avatar_url"
>;

function oauthCredentials() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL?.trim();

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error("GitHub App OAuth credentials are not configured.");
  }

  return { clientId, clientSecret, callbackUrl };
}

function sign(payload: string) {
  return createHmac("sha256", oauthCredentials().clientSecret)
    .update(payload)
    .digest("base64url");
}

function signaturesMatch(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function createGitHubInstallState(sessionId: string) {
  const encoded = Buffer.from(
    JSON.stringify({
      sessionId,
      expiresAt: Date.now() + STATE_TTL_MS,
    } satisfies InstallStatePayload)
  ).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyGitHubInstallState(state?: string | null) {
  const [encoded, signature, extra] = state?.split(".") ?? [];
  if (!encoded || !signature || extra) return null;
  if (!signaturesMatch(sign(encoded), signature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as InstallStatePayload;
    return payload.expiresAt >= Date.now() ? payload.sessionId : null;
  } catch {
    return null;
  }
}

export function createGitHubOAuthState(options: {
  installationId?: number;
  returnTo?: string;
}) {
  const nonce = randomBytes(24).toString("base64url");
  const payload: OAuthStatePayload = {
    installationId: options.installationId,
    nonce,
    expiresAt: Date.now() + STATE_TTL_MS,
    returnTo: safeReturnTo(options.returnTo),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return {
    nonce,
    state: `${encoded}.${sign(encoded)}`,
    maxAge: STATE_TTL_MS / 1000,
  };
}

export function verifyGitHubOAuthState(state: string, cookieNonce?: string) {
  const [encoded, signature, extra] = state.split(".");
  if (!encoded || !signature || extra || !cookieNonce) return null;
  if (!signaturesMatch(sign(encoded), signature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as OAuthStatePayload;
    if (
      payload.nonce !== cookieNonce ||
      payload.expiresAt < Date.now() ||
      (payload.installationId !== undefined &&
        (!Number.isSafeInteger(payload.installationId) ||
          payload.installationId <= 0))
    ) {
      return null;
    }
    return {
      installationId: payload.installationId,
      returnTo: safeReturnTo(payload.returnTo),
    };
  } catch {
    return null;
  }
}

export function githubOAuthAuthorizeUrl(state: string) {
  const { callbackUrl, clientId } = oauthCredentials();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeGitHubOAuthCode(code: string) {
  const { callbackUrl, clientId, clientSecret } = oauthCredentials();
  try {
    const auth = createOAuthUserAuth({
      clientType: "github-app",
      clientId,
      clientSecret,
      redirectUrl: callbackUrl,
      request: githubClient().request,
      code,
    });
    const authentication = await auth();
    if (!authentication.token) throw new Error("Missing GitHub token.");
    return {
      accessToken: authentication.token,
      expiresIn:
        "expiresAt" in authentication
          ? (Date.parse(authentication.expiresAt) - Date.now()) / 1000
          : undefined,
    };
  } catch {
    // SDK errors carry request bodies containing the code and client secret.
    throw new Error("GitHub rejected the OAuth authorization code.");
  }
}

export class GitHubUserAuthorizationError extends Error {
  constructor() {
    super("Reconnect GitHub to choose a repository.");
  }
}

function githubClient(accessToken?: string) {
  const github = new GitHub({
    auth: accessToken,
    request: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  github.request = github.request.defaults({
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  github.hook.error("request", (error) => {
    if ("status" in error && error.status === 401)
      throw new GitHubUserAuthorizationError();
    throw new Error("The GitHub user cannot access this App installation.");
  });
  return github;
}

export async function getGitHubUser(accessToken: string) {
  const { data } = await githubClient(accessToken).request("GET /user");
  return { ...data, id: githubId.parse(data.id) };
}

export async function authorizeGitHubInstallation(
  accessToken: string,
  installationId: number
): Promise<{
  user: GitHubUserPayload;
  repositories: GitHubInstallationRepository[];
}> {
  const [user, repositories] = await Promise.all([
    getGitHubUser(accessToken),
    getGitHubUserInstallationRepositories(
      githubClient(accessToken),
      installationId
    ),
  ]);
  return { user, repositories };
}

async function getGitHubUserInstallationRepositories(
  github: InstanceType<typeof GitHub>,
  installationId: number
): Promise<GitHubInstallationRepository[]> {
  const repositories = await github.paginate(
    "GET /user/installations/{installation_id}/repositories",
    { installation_id: installationId, per_page: 100 }
  );
  return repositories.map((repository) => ({
    id: githubId.parse(repository.id),
    name: repository.full_name,
    cloneUrl: repository.clone_url,
    defaultBranch: repository.default_branch,
    visibility: repository.private ? "private" : "public",
  }));
}

export async function listGitHubUserRepositories(accessToken: string) {
  const github = githubClient(accessToken);
  const installations = await github.paginate("GET /user/installations", {
    per_page: 100,
  });
  // The user endpoint returns the intersection of App and user permissions.
  // An installation token alone would expose other members' private repositories.
  const repositories = [];
  for (const { id } of installations) {
    const installationId = githubId.parse(id);
    const accessible = await getGitHubUserInstallationRepositories(
      github,
      installationId
    );
    repositories.push(
      ...accessible.map((repository) => ({ ...repository, installationId }))
    );
  }
  return repositories.sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}
