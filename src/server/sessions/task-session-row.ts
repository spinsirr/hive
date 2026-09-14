import { sql } from "drizzle-orm";
import { taskSessions } from "../../db/schema.ts";
import type { TaskSessionState } from "../../lib/session/task-session.ts";

export function sessionValues(session: TaskSessionState) {
  return {
    archived: session.archived ?? null,
    id: session.sessionId,
    title: session.title,
    createdBy: session.createdBy,
    createdAt: new Date(session.createdAt),
    version: session.version,
    messages: session.messages,
    steeringQueue: session.steeringQueue,
    activeSteer: session.activeSteer ?? null,
    repository: session.repository ?? null,
    workspace: session.workspace,
    updatedAt: new Date(session.updatedAt),
  };
}

export function sessionState(
  row: typeof taskSessions.$inferSelect
): TaskSessionState {
  // Older rows may carry a display status. Import its failure evidence once;
  // subsequent saves contain only timestamps/error, never a second phase flag.
  const { status, ...workspace } = row.workspace;
  if (status === "error" && workspace.error == null) workspace.error = "";
  return {
    archived: row.archived ?? undefined,
    sessionId: row.id,
    title: row.title,
    createdBy: row.createdBy ?? "hive-system",
    createdAt: row.createdAt.getTime(),
    version: row.version,
    messages: row.messages,
    steeringQueue: row.steeringQueue,
    activeSteer: row.activeSteer ?? undefined,
    repository: row.repository ?? undefined,
    workspace,
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Same run/restore evidence as isHiveRunActive; JSON null and absent fields agree. */
export const activeRunCondition = sql`
  ${taskSessions.workspace}->>'startedAt' IS NOT NULL
  AND ${taskSessions.workspace}->>'completedAt' IS NULL
  AND ${taskSessions.workspace}->>'restore' IS NULL
`;
