import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";

import { db } from "@/db";
import { taskSessionMembers, taskSessionPresence, taskSessions, users } from "@/db/schema";
import { sessionNotification } from "@/lib/session-events";
import {
  applyHiveRunError,
  applyHiveRunResult,
  appendHiveReply as appendHiveReplyToSession,
  createInitialTaskSessionState,
  didStartHiveRun,
  type HiveRunResult,
  type HiveSessionCheckpoint,
  isMemberId,
  type MemberId,
  reduceTaskSession,
  resolveMember,
  type TaskSessionAction,
  type TaskSessionState,
  type TeamMember,
} from "@/lib/task-session";

export type TaskSessionSnapshot = {
  session: TaskSessionState;
  activeMembers: MemberId[];
  members: TeamMember[];
  typingMembers: MemberId[];
};

const ACTIVE_WINDOW_MS = 12_000;
const randomSuffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

function sessionValues(session: TaskSessionState) {
  return {
    id: session.sessionId,
    title: session.title,
    lifecycle: session.lifecycle,
    createdBy: session.createdBy,
    createdAt: new Date(session.createdAt),
    completedAt: session.completedAt ? new Date(session.completedAt) : null,
    version: session.version,
    revision: session.revision,
    stage: session.stage,
    messages: session.messages,
    annotation: session.annotation,
    steeringQueue: session.steeringQueue,
    activeSteer: session.activeSteer ?? null,
    repository: session.repository ?? null,
    workspace: session.workspace,
    updatedAt: new Date(session.updatedAt),
  };
}

function sessionState(row: typeof taskSessions.$inferSelect): TaskSessionState {
  return {
    sessionId: row.id,
    title: row.title,
    lifecycle: row.lifecycle,
    createdBy: row.createdBy ?? "hive-system",
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt?.getTime(),
    version: row.version,
    revision: row.revision === 2 ? 2 : 1,
    stage: row.stage,
    messages: row.messages,
    annotation: row.annotation,
    steeringQueue: row.steeringQueue,
    activeSteer: row.activeSteer ?? undefined,
    repository: row.repository ?? undefined,
    workspace: row.workspace,
    updatedAt: row.updatedAt.getTime(),
  };
}

async function getSessionMembers(sessionId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      memberId: taskSessionMembers.memberId,
      avatarUrl: users.avatarUrl,
      githubLogin: users.githubLogin,
      initials: users.initials,
      name: users.name,
      shortName: users.shortName,
    })
    .from(taskSessionMembers)
    .leftJoin(users, eq(taskSessionMembers.memberId, users.id))
    .where(eq(taskSessionMembers.sessionId, sessionId));

  return rows.map((row) =>
    row.name && row.shortName && row.initials
      ? {
          id: row.memberId,
          name: row.name,
          shortName: row.shortName,
          initials: row.initials,
          githubLogin: row.githubLogin ?? undefined,
          avatarUrl: row.avatarUrl ?? undefined,
        }
      : resolveMember(row.memberId),
  );
}

function sessionSlug(title: string) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${base || "task"}-${randomSuffix()}`;
}

export async function createTaskSession(
  title: string,
  creator: TeamMember,
  now = Date.now(),
) {
  const normalizedTitle = title.trim().slice(0, 120);
  if (!normalizedTitle) throw new Error("Task title is required.");

  const sessionId = sessionSlug(normalizedTitle);
  const initialSession = createInitialTaskSessionState(now, sessionId, {
    title: normalizedTitle,
    createdBy: creator.id,
  });

  await db.transaction(async (transaction) => {
    await transaction.insert(taskSessions).values(sessionValues(initialSession));
    await transaction.insert(taskSessionMembers).values({
      sessionId,
      memberId: creator.id,
      joinedAt: new Date(now),
    });
  });

  return initialSession;
}

export async function isTaskSessionMember(sessionId: string, memberId: MemberId) {
  const membership = await db.query.taskSessionMembers.findFirst({
    where: and(
      eq(taskSessionMembers.sessionId, sessionId),
      eq(taskSessionMembers.memberId, memberId),
    ),
  });
  return Boolean(membership);
}

export async function taskSessionExists(sessionId: string) {
  return Boolean(
    await db.query.taskSessions.findFirst({
      columns: { id: true },
      where: eq(taskSessions.id, sessionId),
    }),
  );
}

export async function joinTaskSession(
  sessionId: string,
  memberId: MemberId,
  now = Date.now(),
) {
  const session = await db.query.taskSessions.findFirst({ where: eq(taskSessions.id, sessionId) });
  if (!session) return false;
  await db
    .insert(taskSessionMembers)
    .values({ sessionId, memberId, joinedAt: new Date(now) })
    .onConflictDoNothing();
  await db.execute(sessionNotification(sessionId));
  return true;
}

export async function listTaskSessions(memberId: MemberId) {
  const rows = await db
    .select({
      id: taskSessions.id,
      title: taskSessions.title,
      lifecycle: taskSessions.lifecycle,
      repository: taskSessions.repository,
      updatedAt: taskSessions.updatedAt,
    })
    .from(taskSessionMembers)
    .innerJoin(taskSessions, eq(taskSessionMembers.sessionId, taskSessions.id))
    .where(eq(taskSessionMembers.memberId, memberId))
    .orderBy(desc(taskSessions.updatedAt));

  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.getTime(),
  }));
}

export async function heartbeat(
  sessionId: string,
  memberId: MemberId,
  typing = false,
  now = Date.now(),
) {
  if (!(await isTaskSessionMember(sessionId, memberId))) {
    throw new Error("Session member not found.");
  }
  await db
    .insert(taskSessionPresence)
    .values({ sessionId, memberId, lastSeen: new Date(now), typing })
    .onConflictDoUpdate({
      target: [taskSessionPresence.sessionId, taskSessionPresence.memberId],
      set: { lastSeen: new Date(now), typing },
    });

  await db.execute(sessionNotification(sessionId));
}

export async function applyTaskSessionAction(
  sessionId: string,
  action: TaskSessionAction,
  actor?: TeamMember,
  now = Date.now(),
) {
  const storedMembers = await getSessionMembers(sessionId);
  const members = actor
    ? [actor, ...storedMembers.filter((member) => member.id !== actor.id)]
    : storedMembers;

  const applied = await db.transaction(async (transaction) => {
    const [storedSession] = await transaction
      .select()
      .from(taskSessions)
      .where(eq(taskSessions.id, sessionId))
      .for("update");

    if (!storedSession) {
      throw new Error(`Session ${sessionId} could not be loaded.`);
    }

    const previousSession = sessionState(storedSession);
    const nextSession = reduceTaskSession(
      previousSession,
      action,
      now,
      members,
    );
    const startedRun = didStartHiveRun(previousSession, nextSession);
    if (startedRun) {
      nextSession.workspace = {
        ...nextSession.workspace,
        liveReply: { id: `agent-${randomUUID()}`, body: "", sequence: 0, startedAt: now },
      };
    }
    await transaction
      .update(taskSessions)
      .set(sessionValues(nextSession))
      .where(eq(taskSessions.id, sessionId));

    await transaction.execute(sessionNotification(sessionId));

    await transaction
      .insert(taskSessionPresence)
      .values({
        sessionId,
        memberId: action.actor,
        lastSeen: new Date(now),
        typing: false,
      })
      .onConflictDoUpdate({
        target: [taskSessionPresence.sessionId, taskSessionPresence.memberId],
        set: { lastSeen: new Date(now) },
      });

    return {
      session: nextSession,
      // Grant execution inside the row lock, not by comparing request timestamps.
      startedRun,
    };
  });

  const snapshot = await getTaskSessionSnapshot(sessionId, now);
  return {
    snapshot: { ...snapshot, session: applied.session },
    startedRun: applied.startedRun,
  };
}

export async function appendHiveReply(
  sessionId: string,
  body: string,
  options: {
    forReplyId?: string;
    forMessageId?: string;
    forMessageAnnotation?: {
      messageId: string;
      annotationId: string;
      steeredAt: number;
    };
    forActiveSteerAt?: number;
    forSteerAt?: number;
    status?: "error";
    runResult?: HiveRunResult;
    runError?: string;
    runCheckpoint?: HiveSessionCheckpoint;
  } = {},
  now = Date.now(),
) {
  await db.transaction(async (transaction) => {
    const [storedSession] = await transaction
      .select()
      .from(taskSessions)
      .where(eq(taskSessions.id, sessionId))
      .for("update");

    if (!storedSession) {
      throw new Error(`Session ${sessionId} could not be loaded.`);
    }

    const currentSession = sessionState(storedSession);
    if (options.forReplyId && currentSession.workspace.liveReply?.id !== options.forReplyId) return;
    if (
      options.forMessageId &&
      !currentSession.messages.some(
        (message) => message.id === options.forMessageId,
      )
    ) {
      return;
    }
    if (
      options.forSteerAt &&
      currentSession.annotation.steeredAt !== options.forSteerAt
    ) {
      return;
    }
    if (options.forMessageAnnotation) {
      const { annotationId, messageId, steeredAt } =
        options.forMessageAnnotation;
      const annotation = currentSession.messages
        .find((message) => message.id === messageId)
        ?.annotations?.find((item) => item.id === annotationId);
      if (annotation?.steeredAt !== steeredAt) return;
    }
    if (
      options.forActiveSteerAt &&
      currentSession.activeSteer?.appliedAt !== options.forActiveSteerAt
    ) {
      return;
    }

    const nextSession = options.runResult
      ? applyHiveRunResult(currentSession, options.runResult, now)
      : options.runError
        ? applyHiveRunError(
            currentSession,
            options.runError,
            now,
            options.runCheckpoint,
          )
        : appendHiveReplyToSession(currentSession, body, now, options.status);
    await transaction
      .update(taskSessions)
      .set(sessionValues(nextSession))
      .where(eq(taskSessions.id, sessionId));
    await transaction.execute(sessionNotification(sessionId));
  });
  return getTaskSessionSnapshot(sessionId, now);
}

export async function checkpointAgentReply(sessionId: string, replyId: string, body: string, sequence: number) {
  await db.transaction(async (transaction) => {
    // Atomic JSON patch: no transcript/files round-trip and no stale read overwrites a teammate's action.
    const changed = await transaction.update(taskSessions).set({
      workspace: sql`jsonb_set(${taskSessions.workspace}, '{liveReply}',
        (${taskSessions.workspace}->'liveReply') || ${JSON.stringify({ body, sequence })}::jsonb)`,
    }).where(and(
      eq(taskSessions.id, sessionId),
      eq(taskSessions.stage, "running"),
      sql`${taskSessions.workspace}->>'startedAt' IS NOT NULL`,
      sql`${taskSessions.workspace}->>'completedAt' IS NULL`,
      sql`${taskSessions.workspace}->'liveReply'->>'id' = ${replyId}`,
      sql`(${taskSessions.workspace}->'liveReply'->>'sequence')::integer < ${sequence}`,
    )).returning({ id: taskSessions.id });
    if (changed.length) await transaction.execute(sessionNotification(sessionId, "reply"));
  });
}

/** Streaming does not repeatedly transfer files, diffs, or private Codex checkpoints. */
export async function getAgentReply(sessionId: string) {
  const [row] = await db.select({
    reply: sql<TaskSessionState["workspace"]["liveReply"]>`${taskSessions.workspace}->'liveReply'`,
  }).from(taskSessions).where(eq(taskSessions.id, sessionId));
  return row?.reply ?? null;
}

export async function getTaskSessionSnapshot(
  sessionId: string,
  now = Date.now(),
): Promise<TaskSessionSnapshot> {
  const storedSession = await db.query.taskSessions.findFirst({
    where: eq(taskSessions.id, sessionId),
  });

  if (!storedSession) {
    throw new Error(`Session ${sessionId} could not be loaded.`);
  }

  const activePresence = await db
    .select()
    .from(taskSessionPresence)
    .where(
      and(
        eq(taskSessionPresence.sessionId, sessionId),
        gte(taskSessionPresence.lastSeen, new Date(now - ACTIVE_WINDOW_MS)),
      ),
    );

  const members = await getSessionMembers(sessionId);
  const memberName = (memberId: MemberId) =>
    resolveMember(memberId, members).name;
  const activeMembers = activePresence
    .map(({ memberId }) => memberId)
    .filter(isMemberId)
    .sort((left, right) => memberName(left).localeCompare(memberName(right)));
  const typingMembers = activePresence
    .filter(({ typing }) => typing)
    .map(({ memberId }) => memberId)
    .filter(isMemberId)
    .sort((left, right) => memberName(left).localeCompare(memberName(right)));

  return {
    session: sessionState(storedSession),
    activeMembers,
    members,
    typingMembers,
  };
}
