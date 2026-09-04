import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import type { GitHubUserPayload } from "@/lib/github-oauth";
import type { TeamMember } from "@/lib/task-session";

export const HIVE_SESSION_COOKIE = "hive_session";
export const HIVE_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function displayName(user: GitHubUserPayload) {
  return user.name?.trim() || user.login;
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0]}` : name.slice(0, 2))
    .toUpperCase();
}

function memberFromUser(user: typeof users.$inferSelect): TeamMember {
  return {
    id: user.id,
    name: user.name,
    shortName: user.shortName,
    initials: user.initials,
    githubLogin: user.githubLogin,
    avatarUrl: user.avatarUrl ?? undefined,
  };
}

export async function createUserSession(
  githubUser: GitHubUserPayload,
  now = new Date(),
) {
  const name = displayName(githubUser);
  const member: TeamMember = {
    id: `github-${githubUser.id}`,
    name,
    shortName: name.split(/\s+/)[0] || githubUser.login,
    initials: initialsFor(name),
    githubLogin: githubUser.login,
    avatarUrl: githubUser.avatar_url ?? undefined,
  };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + HIVE_SESSION_MAX_AGE * 1000);

  await db.transaction(async (transaction) => {
    await transaction
      .insert(users)
      .values({
        id: member.id,
        githubUserId: githubUser.id,
        githubLogin: githubUser.login,
        name: member.name,
        shortName: member.shortName,
        initials: member.initials,
        avatarUrl: member.avatarUrl ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          githubLogin: githubUser.login,
          name: member.name,
          shortName: member.shortName,
          initials: member.initials,
          avatarUrl: member.avatarUrl ?? null,
          updatedAt: now,
        },
      });
    await transaction.insert(authSessions).values({
      tokenHash: tokenHash(token),
      userId: member.id,
      createdAt: now,
      expiresAt,
    });
  });

  return { expiresAt, member, token };
}

export async function getSessionMember(token?: string | null) {
  if (!token) return null;

  const [result] = await db
    .select({ user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash(token)),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return result ? memberFromUser(result.user) : null;
}

export async function deleteUserSession(token?: string | null) {
  if (!token) return;
  await db
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash(token)));
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: HIVE_SESSION_MAX_AGE,
    path: "/",
    sameSite: "lax" as const,
    secure,
  };
}
