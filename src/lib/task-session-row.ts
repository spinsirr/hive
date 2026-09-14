import type { taskSessions } from "../db/schema.ts";
import type { TaskSessionState } from "./task-session.ts";

export function sessionValues(session: TaskSessionState) {
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

export function sessionState(
  row: typeof taskSessions.$inferSelect
): TaskSessionState {
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
