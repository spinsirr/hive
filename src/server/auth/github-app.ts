import "server-only";

import { createAppAuth } from "@octokit/auth-app";

import type { RepositoryState } from "@/lib/session/task-session";

const DEFAULT_APP_SLUG = "hive-multiplayer-agent";

export type GitHubInstallationRepository = {
  id: number;
  name: string;
  cloneUrl: string;
  defaultBranch: string;
  visibility: "private" | "public";
};

function appCredentials() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();

  if (!appId || !/^\d+$/.test(appId)) {
    throw new Error("GITHUB_APP_ID is not configured.");
  }
  if (!privateKey) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is not configured.");
  }

  return {
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

function installationAuth() {
  return createAppAuth(appCredentials());
}

async function tokenForInstallation(
  installationId: number,
  repositoryId: number
) {
  const authentication = await installationAuth()({
    type: "installation",
    installationId,
    repositoryIds: [repositoryId],
    permissions: { contents: "read" },
  });

  if (
    authentication.type !== "token" ||
    authentication.tokenType !== "installation"
  ) {
    throw new Error("GitHub did not return an installation token.");
  }

  return authentication.token;
}

export function githubAppInstallUrl(state?: string) {
  const slug = process.env.GITHUB_APP_SLUG?.trim() || DEFAULT_APP_SLUG;
  const url = new URL(
    `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`
  );
  if (state) url.searchParams.set("state", state);
  return url;
}

export async function getRepositoryCloneCredentials(
  repository: RepositoryState
) {
  const token = await tokenForInstallation(
    repository.installationId,
    repository.id
  );

  return {
    username: "x-access-token",
    password: token,
  };
}
