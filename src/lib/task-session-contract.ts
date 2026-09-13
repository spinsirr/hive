import type { CodingModelOption } from "./coding-models.ts";
import type {
  MemberId,
  TaskSessionState,
  TeamMember,
  WorkspaceState,
} from "./task-session.ts";

/** The allowlist is shared with the SQL projection. New stored fields stay private. */
export const publicWorkspaceFields = [
  "reviewRevision",
  "status",
  "codingEffort",
  "codingModel",
  "sandboxName",
  "environment",
  "summary",
  "diff",
  "files",
  "commands",
  "changedFiles",
  "startedAt",
  "completedAt",
  "error",
  "liveReply",
  "lastRestore",
] as const satisfies readonly (keyof WorkspaceState)[];

export const publicRestoreFields = [
  "id",
  "snapshotId",
  "by",
  "startedAt",
  "retryAfter",
  "status",
] as const;
export const publicSessionFields = [
  "archived",
  "sessionId",
  "title",
  "createdBy",
  "createdAt",
  "version",
  "revision",
  "stage",
  "messages",
  "annotation",
  "steeringQueue",
  "activeSteer",
  "repository",
  "updatedAt",
] as const satisfies readonly (keyof TaskSessionState)[];

export function pickFields<T, K extends keyof T>(
  value: T,
  keys: readonly K[]
): Pick<T, K> {
  // Object.fromEntries loses literal keys; every entry comes from the typed allowlist.
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]])
  ) as Pick<T, K>;
}

export type PublicWorkspaceState = Pick<
  WorkspaceState,
  (typeof publicWorkspaceFields)[number]
> & {
  agentSession?: Pick<
    NonNullable<WorkspaceState["agentSession"]>,
    "id" | "runtime"
  >;
  restore?: Pick<
    NonNullable<WorkspaceState["restore"]>,
    (typeof publicRestoreFields)[number]
  >;
};
export type PublicTaskSessionState = Pick<
  TaskSessionState,
  (typeof publicSessionFields)[number]
> & { workspace: PublicWorkspaceState };
type SessionRoster = {
  activeMembers: MemberId[];
  members: TeamMember[];
  typingMembers: MemberId[];
  codingModels?: CodingModelOption[];
};
export type TaskSessionSnapshot = SessionRoster & {
  session: PublicTaskSessionState;
};
export type PrivateTaskSessionSnapshot = SessionRoster & {
  session: TaskSessionState;
};

export function publicWorkspace(
  workspace: WorkspaceState
): PublicWorkspaceState {
  const { agentSession, restore } = workspace;
  return {
    ...pickFields(workspace, publicWorkspaceFields),
    ...(agentSession
      ? { agentSession: { id: agentSession.id, runtime: agentSession.runtime } }
      : {}),
    ...(restore ? { restore: pickFields(restore, publicRestoreFields) } : {}),
  };
}
