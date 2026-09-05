import "server-only";

import { createAppAuth } from "@octokit/auth-app";

import type { RepositoryState } from "@/lib/task-session";

const GITHUB_API_VERSION = "2026-03-10";
const DEFAULT_APP_SLUG = "hive-multiplayer-agent";

type GitHubRepositoryPayload = {
  id: number;
  full_name: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
};

type InstallationRepositoriesPayload = {
  repositories: GitHubRepositoryPayload[];
  total_count: number;
};

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

export async function getGitHubAppOwnerId() {
  const authentication = await createAppAuth(appCredentials())({ type: "app" });
  const response = await fetch("https://api.github.com/app", {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${authentication.token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) throw new Error("GitHub could not verify the App owner.");
  const payload = (await response.json()) as { owner?: { id?: number } };
  const ownerId = payload.owner?.id;
  if (typeof ownerId !== "number" || !Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new Error("GitHub did not return a valid App owner.");
  }
  return ownerId;
}

async function tokenForInstallation(
  installationId: number,
  repositoryId?: number,
) {
  const authentication = await installationAuth()({
    type: "installation",
    installationId,
    ...(repositoryId
      ? {
          repositoryIds: [repositoryId],
          permissions: { contents: "read" as const },
        }
      : {}),
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
    `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`,
  );
  if (state) url.searchParams.set("state", state);
  return url;
}

export async function getInstallationRepositories(
  installationId: number,
): Promise<GitHubInstallationRepository[]> {
  const token = await tokenForInstallation(installationId);
  const repositories: GitHubRepositoryPayload[] = [];
  let page = 1;
  let totalCount = 0;

  do {
    const response = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub rejected installation ${installationId}.`);
    }

    const payload = (await response.json()) as InstallationRepositoriesPayload;
    totalCount = payload.total_count;
    repositories.push(...payload.repositories);
    page += 1;
  } while (repositories.length < totalCount);

  return repositories.map((repository) => ({
    id: repository.id,
    name: repository.full_name,
    cloneUrl: repository.clone_url,
    defaultBranch: repository.default_branch,
    visibility: repository.private ? "private" : "public",
  }));
}

export async function getRepositoryCloneCredentials(
  repository: RepositoryState,
) {
  const token = await tokenForInstallation(
    repository.installationId,
    repository.id,
  );

  return {
    username: "x-access-token",
    password: token,
  };
}
