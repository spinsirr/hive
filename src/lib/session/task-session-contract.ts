import type { CodingModelOption } from "../agents/coding-models.ts";
import type {
  MemberId,
  TaskSessionState,
  TeamMember,
  WorkspaceState,
} from "./task-session.ts";

/** Scoped IO for workspace controls; demos never replace browser globals. */
export type HiveClient = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  reload: () => void;
};

/** The allowlist is shared with the SQL projection. New stored fields stay private. */
export const publicWorkspaceFields = [
  "reviewRevision",
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
  "messages",
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
export type LivePresence = {
  activeMembers: MemberId[];
  typingMembers: MemberId[];
};
export type TaskRunScope = {
  sessionId: string;
  memberId: MemberId;
  runId: string;
};
type SessionRoster = LivePresence & {
  members: TeamMember[];
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
