import "server-only";

import { asc } from "drizzle-orm";

import { db } from "@/db";
import { githubInstallations } from "@/db/schema";
import {
  getInstallationRepositories,
  type GitHubInstallationRepository,
} from "@/lib/github-app";
import type { MemberId } from "@/lib/task-session";

export type TeamRepository = GitHubInstallationRepository & {
  installationId: number;
};

export async function saveGitHubInstallation(
  installationId: number,
  installedBy: MemberId,
  now = new Date(),
) {
  await db
    .insert(githubInstallations)
    .values({
      id: installationId,
      installedBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: githubInstallations.id,
      set: { installedBy, updatedAt: now },
    });
}

export async function listTeamRepositories(): Promise<TeamRepository[]> {
  const installations = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .orderBy(asc(githubInstallations.createdAt));

  const repositories = await Promise.all(
    installations.map(async ({ id }) =>
      (await getInstallationRepositories(id)).map((repository) => ({
        ...repository,
        installationId: id,
      })),
    ),
  );

  return repositories
    .flat()
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function hasGitHubInstallation() {
  const installation = await db.query.githubInstallations.findFirst();
  return Boolean(installation);
}
