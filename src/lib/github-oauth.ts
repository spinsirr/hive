import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { GitHubInstallationRepository } from "@/lib/github-app";

const GITHUB_API_VERSION = "2026-03-10";
const STATE_TTL_MS = 10 * 60 * 1000;

export const GITHUB_OAUTH_COOKIE = "hive_github_oauth";

type OAuthStatePayload = {
  installationId?: number;
  nonce: string;
  expiresAt: number;
  returnTo: string;
};

type InstallStatePayload = {
  roomId: string;
  expiresAt: number;
};

type OAuthTokenPayload = {
  access_token?: string;
  error?: string;
};

export type GitHubUserPayload = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
};

type InstallationRepositoriesPayload = {
  repositories: Array<{
    id: number;
    full_name: string;
    clone_url: string;
    default_branch: string;
    private: boolean;
  }>;
  total_count: number;
};

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

export function createGitHubInstallState(roomId: string) {
  const encoded = Buffer.from(
    JSON.stringify({
      roomId,
      expiresAt: Date.now() + STATE_TTL_MS,
    } satisfies InstallStatePayload),
  ).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyGitHubInstallState(state?: string | null) {
  const [encoded, signature, extra] = state?.split(".") ?? [];
  if (!encoded || !signature || extra) return null;
  if (!signaturesMatch(sign(encoded), signature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as InstallStatePayload;
    return payload.expiresAt >= Date.now() ? payload.roomId : null;
  } catch {
    return null;
  }
}

export function safeReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/rooms/orbit-nav";
  }
  return value;
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
      Buffer.from(encoded, "base64url").toString("utf8"),
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
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl,
    }),
  });
  const payload = (await response.json()) as OAuthTokenPayload;
  if (!response.ok || !payload.access_token || payload.error) {
    throw new Error("GitHub rejected the OAuth authorization code.");
  }
  return payload.access_token;
}

async function githubUserRequest<T>(accessToken: string, path: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new Error("The GitHub user cannot access this App installation.");
  }
  return (await response.json()) as T;
}

export function getGitHubUser(accessToken: string) {
  return githubUserRequest<GitHubUserPayload>(accessToken, "/user");
}

export async function authorizeGitHubInstallation(
  accessToken: string,
  installationId: number,
): Promise<{
  user: GitHubUserPayload;
  repositories: GitHubInstallationRepository[];
}> {
  const [user, payload] = await Promise.all([
    getGitHubUser(accessToken),
    githubUserRequest<InstallationRepositoriesPayload>(
      accessToken,
      `/user/installations/${installationId}/repositories?per_page=100`,
    ),
  ]);

  if (payload.total_count > payload.repositories.length) {
    throw new Error(
      "Hive currently supports up to 100 repositories per installation.",
    );
  }

  return {
    user,
    repositories: payload.repositories.map((repository) => ({
      id: repository.id,
      name: repository.full_name,
      cloneUrl: repository.clone_url,
      defaultBranch: repository.default_branch,
      visibility: repository.private ? "private" : "public",
    })),
  };
}
