import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { taskSessions } from "@/db/schema";
import {
  readTaskIdleCheckpoint,
  refreshTaskEnvironment,
  type TaskEnvironmentContext,
} from "./task-environment.ts";
import { sessionNotification } from "../sessions/session-events.ts";
import { sessionState } from "../sessions/task-session-row.ts";
import { WORKSPACE_CHECKPOINT_LIMIT } from "../../lib/session/task-session.ts";

/** Slow provider calls hold only a VM-specific renewal lock, never a task row lock. */
export async function refreshStoredTaskEnvironment(
  sessionId: string,
  vmId: string,
  now: number
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"hive-idle:" + vmId}, 0))`
    );
    const [row] = await transaction
      .select({
        sessionId: taskSessions.id,
        version: taskSessions.version,
        workspace: sql<TaskEnvironmentContext["workspace"]>`jsonb_build_object(
        'environment', ${taskSessions.workspace}->'environment',
        'agentSession', jsonb_build_object('id', ${taskSessions.workspace}->'agentSession'->'id'),
        'sandboxName', ${taskSessions.workspace}->'sandboxName',
        'restore', ${taskSessions.workspace}->'restore'
      )`,
      })
      .from(taskSessions)
      .where(eq(taskSessions.id, sessionId));
    if (
      !row ||
      row.workspace.environment?.vmId !== vmId ||
      row.workspace.restore
    )
      return;
    const environment = await refreshTaskEnvironment(row, now);
    if (
      !environment ||
      environment.idleUntil === row.workspace.environment.idleUntil
    )
      return;
    const changed = await transaction
      .update(taskSessions)
      .set({
        workspace: sql`jsonb_set(${taskSessions.workspace}, '{environment}', ${JSON.stringify(environment)}::jsonb)`,
      })
      .where(
        and(
          eq(taskSessions.id, sessionId),
          eq(taskSessions.version, row.version),
          sql`${taskSessions.workspace}->'environment' = ${JSON.stringify(row.workspace.environment)}::jsonb`,
          sql`${taskSessions.workspace}->'restore' IS NULL`
        )
      )
      .returning({ id: taskSessions.id });
    if (changed.length) {
      await transaction.execute(sessionNotification(sessionId));
      return environment;
    }
  });
}

/** Observe outside the lock, then pair only the unchanged VM/native-context version. */
export async function syncTaskIdleCheckpoint(sessionId: string) {
  const row = await db.query.taskSessions.findFirst({
    where: eq(taskSessions.id, sessionId),
  });
  if (!row) throw new Error("Task not found.");
  const session = sessionState(row);
  const saved = await readTaskIdleCheckpoint(session);
  if (!saved) return;
  const checkpoints = [
    saved,
    ...(session.workspace.checkpoints ?? []).filter(
      (entry) => entry.id !== saved.id
    ),
  ].slice(0, WORKSPACE_CHECKPOINT_LIMIT);
  await db.transaction(async (transaction) => {
    const changed = await transaction
      .update(taskSessions)
      .set({
        workspace: sql`jsonb_set(${taskSessions.workspace} - 'idleCheckpoint', '{checkpoints}', ${JSON.stringify(checkpoints)}::jsonb)`,
        version: sql`${taskSessions.version} + 1`,
      })
      .where(
        and(
          eq(taskSessions.id, sessionId),
          eq(taskSessions.version, session.version),
          sql`${taskSessions.workspace}->'idleCheckpoint' = ${JSON.stringify(session.workspace.idleCheckpoint)}::jsonb`,
          sql`${taskSessions.workspace}->'restore' IS NULL`
        )
      )
      .returning({ id: taskSessions.id });
    if (changed.length)
      await transaction.execute(sessionNotification(sessionId));
  });
}
