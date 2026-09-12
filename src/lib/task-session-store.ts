import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";

import { db } from "@/db";
import { taskSessionMembers, taskSessions, users } from "@/db/schema";
import { sessionNotification } from "@/lib/session-events";
import { type CodingModelOption } from "./coding-models.ts";
import { platformCodingModels } from "./platform-models.ts";
import { assertHiveToolRun, hiveThreadReply, type HiveToolContext } from "@/lib/hive-tool-context";
import type { HiveToolScope } from "@/lib/hive-tool-token";
import { requestPeerInput, type PeerRequest, type PeerRequestReceipt } from "./peer-collaboration.ts";
import { subagentUpdateSchema, type HiveSubagent, type SubagentSession } from "./hive-subagents.ts";
import { assertWorkspaceRestoreAttempt, beginWorkspaceRestore, completeWorkspaceRestore, failWorkspaceRestore, recordWorkspaceRestoreSource, WorkspaceRestoreError, type RestoreWorkspaceRequest } from "@/lib/workspace-restore-state";
import {
  applyHiveRunError,
  ARCHIVED_TASK_MESSAGE,
  taskActionBlockReason,
  applyHiveRunResult,
  appendHiveReply as appendHiveReplyToSession,
  createInitialTaskSessionState,
  didStartHiveRun,
  type HiveRunResult,
  type HiveSessionCheckpoint,
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
  codingModels?: CodingModelOption[];
};
export class TaskSessionAccessError extends Error {
  constructor() {
    super("You no longer have access to this task.");
  }
}
const randomSuffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

function sessionValues(session: TaskSessionState) {
  return {
    archived: session.archived ?? null,
    id: session.sessionId,
    title: session.title,
    createdBy: session.createdBy,
    createdAt: new Date(session.createdAt),
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
    archived: row.archived ?? undefined,
    sessionId: row.id,
    title: row.title,
    createdBy: row.createdBy ?? "hive-system",
    createdAt: row.createdAt.getTime(),
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

// Agent tools never load code artifacts, credentials, or the native recovery checkpoint.
const agentToolColumns = {
  archived: taskSessions.archived,
  sessionId: taskSessions.id, title: taskSessions.title,
  version: taskSessions.version, stage: taskSessions.stage,
  messages: taskSessions.messages, repository: taskSessions.repository,
  steeringQueue: taskSessions.steeringQueue, activeSteer: taskSessions.activeSteer,
  workspace: sql<HiveToolContext["workspace"]>`jsonb_build_object(
    'status', ${taskSessions.workspace}->'status',
    'runtime', ${taskSessions.workspace}->'agentSession'->'runtime',
    'restore', ${taskSessions.workspace}->'restore',
    'lastRestore', ${taskSessions.workspace}->'lastRestore',
    'liveReply', jsonb_build_object('id', ${taskSessions.workspace}->'liveReply'->'id')
  )`.as("workspace"),
};

export async function readHiveToolContext(scope: HiveToolScope): Promise<HiveToolContext> {
  const [row] = await db.select(agentToolColumns).from(taskSessions).where(eq(taskSessions.id, scope.sessionId));
  if (!row) throw new Error("Task not found.");
  const context = { ...row, archived: row.archived ?? undefined, repository: row.repository ?? undefined, activeSteer: row.activeSteer ?? undefined, members: await getSessionMembers(scope.sessionId) };
  assertHiveToolRun(context, scope);
  return context;
}

export async function appendHiveToolReply(scope: HiveToolScope, messageId: string, body: string, requestId: string) {
  return db.transaction(async (transaction) => {
    const [row] = await transaction.select(agentToolColumns).from(taskSessions).where(eq(taskSessions.id, scope.sessionId)).for("update");
    if (!row) throw new Error("Task not found.");
    const members = await transaction.select({ memberId: taskSessionMembers.memberId }).from(taskSessionMembers).where(and(eq(taskSessionMembers.sessionId, scope.sessionId), eq(taskSessionMembers.memberId, scope.memberId)));
    const context = { ...row, archived: row.archived ?? undefined, repository: row.repository ?? undefined, activeSteer: row.activeSteer ?? undefined, members: members.map(({ memberId }) => resolveMember(memberId)) };
    assertHiveToolRun(context, scope);
    const parent = row.messages.find((message) => message.id === messageId && !message.status);
    if (!parent) throw new Error("Thread not found.");
    const replyId = `hive-${scope.runId}-${requestId}`;
    const existing = parent.annotations?.find((reply) => reply.id === replyId);
    if (existing) {
      if (existing.body !== body.trim()) throw new Error("Reply key already used for different content.");
      return { messageId, replyId: existing.id };
    }
    const reply = hiveThreadReply(body, replyId);
    await transaction.update(taskSessions).set({
      messages: row.messages.map((message) => message.id === messageId ? { ...message, annotations: [...(message.annotations ?? []), reply] } : message),
      version: row.version + 1, updatedAt: new Date(),
    }).where(eq(taskSessions.id, scope.sessionId));
    await transaction.execute(sessionNotification(scope.sessionId));
    return { messageId, replyId };
  });
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

export async function createHivePeerRequest(scope: HiveToolScope, request: PeerRequest): Promise<PeerRequestReceipt> {
  return db.transaction(async (transaction) => {
    const [row] = await transaction.select(getTableColumns(taskSessions)).from(taskSessions)
      .innerJoin(taskSessionMembers, and(eq(taskSessionMembers.sessionId, taskSessions.id), eq(taskSessionMembers.memberId, scope.memberId)))
      .where(eq(taskSessions.id, scope.sessionId)).for("update");
    if (!row) throw new TaskSessionAccessError();
    const membership = await transaction.select({ id: taskSessionMembers.memberId }).from(taskSessionMembers)
      .where(eq(taskSessionMembers.sessionId, scope.sessionId)).for("share");
    const state = sessionState(row);
    const published = requestPeerInput(state, scope, request, membership.map(({ id }) => resolveMember(id)), Date.now());
    if (published.session !== state) {
      await transaction.update(taskSessions).set(sessionValues(published.session)).where(eq(taskSessions.id, scope.sessionId));
      await transaction.execute(sessionNotification(scope.sessionId));
    }
    const interaction = published.session.messages.find((message) => message.id === published.messageId)!.interaction!;
    return { messageId: published.messageId, created: published.session !== state,
      status: interaction.kind === "review" ? "review" : interaction.answer ? "answered" : "awaiting_answer" };
  });
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
      repository: taskSessions.repository,
      updatedAt: taskSessions.updatedAt,
      archived: taskSessions.archived,
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

export async function applyTaskSessionAction(
  sessionId: string,
  action: TaskSessionAction,
  actor: TeamMember,
  now = Date.now(),
) {
  if (!actor || actor.id !== action.actor) throw new TaskSessionAccessError();
  const storedMembers = await getSessionMembers(sessionId);
  if (!storedMembers.some((member) => member.id === action.actor)) throw new TaskSessionAccessError();
  const changingModel = action.type === "select-harness" || action.type === "set-coding-effort";
  const members = [actor, ...storedMembers.filter((member) => member.id !== actor.id)];

  const applied = await db.transaction(async (transaction) => {
    const [storedSession] = await transaction
      .select(getTableColumns(taskSessions))
      .from(taskSessions)
      .innerJoin(taskSessionMembers, and(
        eq(taskSessionMembers.sessionId, taskSessions.id),
        eq(taskSessionMembers.memberId, action.actor),
      ))
      .where(eq(taskSessions.id, sessionId))
      // Lock membership along with the task so a stale route check cannot
      // authorize a write after membership has been revoked.
      .for("update");

    if (!storedSession) {
      throw new TaskSessionAccessError();
    }

    const previousSession = sessionState(storedSession);
    const blocked = taskActionBlockReason(previousSession, action);
    if (blocked) throw new WorkspaceRestoreError(409, blocked);
    if (previousSession.workspace.restore) throw new WorkspaceRestoreError(409, "Finish restoring the workspace before continuing.");
    const nextSession = reduceTaskSession(
      previousSession,
      action,
      now,
      members,
      changingModel ? platformCodingModels(process.env) : undefined,
    );
    if (nextSession === previousSession) {
      // Return the current shared state on a no-op or stale selection. Do not
      // broadcast a fabricated version or overwrite a teammate's newer model.
      return { session: previousSession, startedRun: false };
    }
    const startedRun = didStartHiveRun(previousSession, nextSession);
    if (startedRun) {
      const source = nextSession.activeSteer?.source;
      const threadId = source && "messageId" in source && nextSession.messages.some((message) => message.id === source.messageId && message.interaction)
        ? source.messageId : action.type === "steer-message-annotation" && nextSession.messages.some((message) => message.id === action.messageId && message.interaction) ? action.messageId : undefined;
      nextSession.workspace = {
        ...nextSession.workspace,
        liveReply: { id: `agent-${randomUUID()}`, threadId, body: "", sequence: 0, startedAt: now },
      };
    }
    await transaction
      .update(taskSessions)
      .set(sessionValues(nextSession))
      .where(eq(taskSessions.id, sessionId));

    await transaction.execute(sessionNotification(sessionId));

    return {
      session: nextSession,
      // Grant execution inside the row lock, not by comparing request timestamps.
      startedRun,
    };
  });

  return {
    snapshot: await snapshotWithMembers(applied.session),
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
    subagents?: HiveSubagent[];
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
    if (currentSession.archived || currentSession.workspace.restore) return;
    if (options.forReplyId && currentSession.workspace.liveReply?.id !== options.forReplyId) return;
    if (options.subagents && currentSession.workspace.liveReply) {
      currentSession.workspace.liveReply = { ...currentSession.workspace.liveReply, subagents: options.subagents };
    }
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
  return getPublicTaskSessionSnapshot(sessionId);
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
      sql`${taskSessions.archived} IS NULL`,
      sql`${taskSessions.workspace}->>'startedAt' IS NOT NULL`,
      sql`${taskSessions.workspace}->>'completedAt' IS NULL`,
      sql`${taskSessions.workspace}->'liveReply'->>'id' = ${replyId}`,
      sql`(${taskSessions.workspace}->'liveReply'->>'sequence')::integer < ${sequence}`,
    )).returning({ id: taskSessions.id });
    if (changed.length) await transaction.execute(sessionNotification(sessionId, "reply"));
  });
}

export async function checkpointSubagents(sessionId: string, replyId: string, value: unknown) {
  const update = subagentUpdateSchema.parse(value);
  if (update.runId !== replyId || update.tasks.some((task) => task.runId !== replyId)) throw new Error("Subagent run mismatch.");
  await db.transaction(async (transaction) => {
    const changed = await transaction.update(taskSessions).set({
      workspace: sql`jsonb_set(${taskSessions.workspace}, '{liveReply}',
        (${taskSessions.workspace}->'liveReply') || ${JSON.stringify({ subagents: update.tasks, subagentSequence: update.sequence })}::jsonb)`,
    }).where(and(
      eq(taskSessions.id, sessionId), eq(taskSessions.stage, "running"),
      sql`${taskSessions.archived} IS NULL`,
      sql`${taskSessions.workspace}->>'startedAt' IS NOT NULL`,
      sql`${taskSessions.workspace}->>'completedAt' IS NULL`,
      sql`${taskSessions.workspace}->'liveReply'->>'id' = ${replyId}`,
      sql`coalesce((${taskSessions.workspace}->'liveReply'->>'subagentSequence')::integer, 0) < ${update.sequence}`,
    )).returning({ id: taskSessions.id });
    if (changed.length) await transaction.execute(sessionNotification(sessionId, "reply"));
  });
}

/** Control reads never download transcripts, file snapshots or native history. */
export async function withTaskSubagentControl<T>(sessionId: string, control: (session: SubagentSession) => Promise<T>): Promise<T> {
  return db.transaction(async (transaction) => {
    const lock = await transaction.execute(sql`select pg_try_advisory_xact_lock_shared(hashtextextended(${'hive-workspace:' + sessionId}, 0)) as acquired`);
    if (!lock.rows[0]?.acquired) throw new WorkspaceRestoreError(409, "Workspace is busy. Try again shortly.");
    const [row] = await transaction.select({
      sessionId: taskSessions.id, stage: taskSessions.stage, repository: taskSessions.repository, archived: taskSessions.archived,
      workspace: sql<SubagentSession["workspace"]>`jsonb_build_object(
        'startedAt', ${taskSessions.workspace}->'startedAt', 'completedAt', ${taskSessions.workspace}->'completedAt',
        'restore', ${taskSessions.workspace}->'restore', 'sandboxName', ${taskSessions.workspace}->'sandboxName',
        'agentSession', jsonb_build_object('id', ${taskSessions.workspace}->'agentSession'->'id', 'runtime', ${taskSessions.workspace}->'agentSession'->'runtime'),
        'liveReply', jsonb_build_object('id', ${taskSessions.workspace}->'liveReply'->'id')
      )`,
    }).from(taskSessions).where(eq(taskSessions.id, sessionId));
    if (!row) throw new WorkspaceRestoreError(404, "Task not found.");
    if (row.archived) throw new WorkspaceRestoreError(409, ARCHIVED_TASK_MESSAGE);
    return control({ ...row, repository: row.repository ?? undefined });
  });
}

/** A file reader may resume a VM. Drain those readers before fencing a restore. */
export async function withTaskWorkspaceRead<T>(sessionId: string, read: (session: TaskSessionState) => Promise<T>): Promise<T> {
  return db.transaction(async (transaction) => {
    const lock = await transaction.execute(sql`select pg_try_advisory_xact_lock_shared(hashtextextended(${'hive-workspace:' + sessionId}, 0)) as acquired`);
    if (!lock.rows[0]?.acquired) throw new WorkspaceRestoreError(409, "Workspace is busy. Try again shortly.");
    const [row] = await transaction.select().from(taskSessions).where(eq(taskSessions.id, sessionId));
    if (!row) throw new WorkspaceRestoreError(404, "Task not found.");
    const session = sessionState(row);
    if (session.workspace.restore) throw new WorkspaceRestoreError(409, "The workspace is being restored. Refresh Checkpoints to see its status.");
    return read(session);
  });
}

export async function startTaskWorkspaceRestore(sessionId: string, request: RestoreWorkspaceRequest, member: TeamMember) {
  return db.transaction(async (transaction) => {
    const lock = await transaction.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${'hive-workspace:' + sessionId}, 0)) as acquired`);
    if (!lock.rows[0]?.acquired) throw new WorkspaceRestoreError(409, "Files are still loading. Try restoring again shortly.");
    const [row] = await transaction.select(getTableColumns(taskSessions)).from(taskSessions)
      .innerJoin(taskSessionMembers, and(
        eq(taskSessionMembers.sessionId, taskSessions.id),
        eq(taskSessionMembers.memberId, member.id),
      )).where(eq(taskSessions.id, sessionId)).for("update");
    if (!row) throw new TaskSessionAccessError();
    const previous = sessionState(row);
    const next = beginWorkspaceRestore(previous, request, member);
    if (next === previous) return { session: previous, started: false };
    await transaction.update(taskSessions).set(sessionValues(next)).where(eq(taskSessions.id, sessionId));
    await transaction.execute(sessionNotification(sessionId));
    return { session: next, started: true };
  });
}

export async function recordTaskWorkspaceRestoreSource(sessionId: string, operationId: string, startedAt: number, sourceSessionId: string) {
  return db.transaction(async (transaction) => {
    const [row] = await transaction.select().from(taskSessions).where(eq(taskSessions.id, sessionId)).for("update");
    if (!row) throw new WorkspaceRestoreError(404, "Task not found.");
    const session = sessionState(row);
    const next = recordWorkspaceRestoreSource(session, operationId, startedAt, sourceSessionId);
    if (next !== session) {
      await transaction.update(taskSessions).set(sessionValues(next)).where(eq(taskSessions.id, sessionId));
      await transaction.execute(sessionNotification(sessionId));
    }
    return next;
  });
}

export async function finishTaskWorkspaceRestore(sessionId: string, operationId: string, confirmed: boolean, startedAt: number) {
  await db.transaction(async (transaction) => {
    const [row] = await transaction.select().from(taskSessions).where(eq(taskSessions.id, sessionId)).for("update");
    if (!row) throw new WorkspaceRestoreError(404, "Task not found.");
    const session = sessionState(row);
    // A late status check or timed-out worker cannot finish a newer retry.
    if (session.workspace.lastRestore?.id === operationId && !session.workspace.restore) return;
    assertWorkspaceRestoreAttempt(session, operationId, startedAt);
    const next = confirmed ? completeWorkspaceRestore(session, operationId) : failWorkspaceRestore(session, operationId);
    if (next === session) return;
    await transaction.update(taskSessions).set(sessionValues(next)).where(eq(taskSessions.id, sessionId));
    await transaction.execute(sessionNotification(sessionId));
  });
  return getPublicTaskSessionSnapshot(sessionId);
}

/** Streaming does not repeatedly transfer files, diffs, or private Codex checkpoints. */
export async function getAgentReply(sessionId: string) {
  const [row] = await db.select({
    reply: sql<TaskSessionState["workspace"]["liveReply"]>`${taskSessions.workspace}->'liveReply'`,
  }).from(taskSessions).where(eq(taskSessions.id, sessionId));
  return row?.reply ?? null;
}

/** UI reads discard private recovery payloads in Postgres, before network transfer. */
export async function getPublicTaskSessionSnapshot(sessionId: string): Promise<TaskSessionSnapshot> {
  const [row] = await db.select({
    ...getTableColumns(taskSessions),
    workspace: sql<TaskSessionState["workspace"]>`(${taskSessions.workspace} - 'checkpoints') #- '{agentSession,resumeFrom}'`.as("workspace"),
  }).from(taskSessions).where(eq(taskSessions.id, sessionId));
  if (!row) throw new Error(`Session ${sessionId} could not be loaded.`);
  return snapshotWithMembers(sessionState(row));
}

/** Server-only recovery readers need the complete checkpoint data. Never use for UI synchronization. */
export async function getTaskSessionSnapshot(
  sessionId: string,
): Promise<TaskSessionSnapshot> {
  const storedSession = await db.query.taskSessions.findFirst({
    where: eq(taskSessions.id, sessionId),
  });

  if (!storedSession) {
    throw new Error(`Session ${sessionId} could not be loaded.`);
  }

  return snapshotWithMembers(sessionState(storedSession));
}

/** Durable reads contain the roster. Only live connections can assert who is online. */
async function snapshotWithMembers(session: TaskSessionState): Promise<TaskSessionSnapshot> {
  const members = await getSessionMembers(session.sessionId);
  return {
    session,
    members,
    codingModels: platformCodingModels(process.env),
    activeMembers: [],
    typingMembers: [],
  };
}
