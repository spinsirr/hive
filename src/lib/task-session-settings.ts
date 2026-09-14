import { isCodingEffort } from "./coding-effort.ts";
import { selectedCodingModel, modelEffort } from "./coding-models.ts";
import type { CodingModelOption } from "./coding-models.ts";
import { normalizeTaskTitle } from "./task-title.ts";
import {
  type TeamMember,
  type RepositoryState,
  STALLED_RUN_ERROR,
  type TaskSessionState,
  type TaskSessionAction,
  createAgentSessionId,
  createInitialTaskSessionState,
  appendAgentMessage,
  isHiveRunActive,
  isHiveRunStalled,
  canSelectHarness,
  canSetCodingEffort,
  applyHiveRunError,
} from "./task-session-state.ts";

export function archiveTask(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "archive-task" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  if (state.archived || !members.some((member) => member.id === action.actor))
    return state;
  return {
    ...state,
    archived: { by: action.actor, at: now },
    version: state.version + 1,
    updatedAt: now,
  };
}

export function restoreTask(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "restore-task" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  if (!state.archived || !members.some((member) => member.id === action.actor))
    return state;
  return {
    ...state,
    archived: undefined,
    version: state.version + 1,
    updatedAt: now,
  };
}

export function renameTask(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "rename-task" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  const title = normalizeTaskTitle(action.title);
  if (
    !title ||
    title === state.title ||
    !members.some((member) => member.id === action.actor)
  )
    return state;
  return { ...state, title, version: state.version + 1, updatedAt: now };
}

export function setCodingEffort(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "set-coding-effort" }>,
  now: number,
  models: CodingModelOption[]
): TaskSessionState {
  const model = selectedCodingModel(
    models,
    state.workspace.agentSession?.runtime ?? "codex",
    state.workspace.codingModel
  );
  if (
    !model ||
    (action.modelId && action.modelId !== model.modelId) ||
    !model.efforts.includes(action.effort) ||
    !isCodingEffort(action.effort) ||
    !canSetCodingEffort(state) ||
    (state.workspace.codingEffort ?? "low") === action.effort
  )
    return state;
  return {
    ...state,
    workspace: { ...state.workspace, codingEffort: action.effort },
    version: state.version + 1,
    updatedAt: now,
  };
}

export function selectHarness(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "select-harness" }>,
  now: number,
  models: CodingModelOption[]
): TaskSessionState {
  const runtime = state.workspace.agentSession?.runtime ?? "codex";
  const model = selectedCodingModel(models, action.runtime, action.modelId);
  if (
    !model ||
    !canSetCodingEffort(state) ||
    (action.runtime !== runtime && !canSelectHarness(state))
  )
    return state;
  const previous = selectedCodingModel(
    models,
    runtime,
    state.workspace.codingModel
  );
  if (previous?.modelId === model.modelId && action.runtime === runtime)
    return state;
  return {
    ...state,
    version: state.version + 1,
    updatedAt: now,
    workspace: {
      ...state.workspace,
      codingModel: action.modelId ? model.modelId : undefined,
      codingEffort: modelEffort(model, state.workspace.codingEffort),
      agentSession:
        action.runtime === runtime && state.workspace.agentSession
          ? state.workspace.agentSession
          : {
              id: createAgentSessionId(state.sessionId, now),
              runtime: action.runtime,
            },
      ...(action.runtime !== runtime
        ? {
            sandboxName: undefined,
            environment: undefined,
            idleCheckpoint: undefined,
          }
        : {}),
    },
  };
}

export function recoverStalledRun(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "recover-stalled-run" }>,
  now: number,
  actor: TeamMember
): TaskSessionState {
  if (!isHiveRunStalled(state, now)) return state;
  return applyHiveRunError(
    state,
    `${STALLED_RUN_ERROR} ${actor.shortName} marked the run as lost; partial output and queued steers were kept, and nothing was rerun.`,
    now
  );
}

export function reset(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "reset" }>,
  now: number
): TaskSessionState {
  // Reset is destructive for the whole team: never while Hive is working or
  // while accepted input is still waiting to be applied.
  if (
    isHiveRunActive(state) ||
    state.activeSteer ||
    state.steeringQueue.length > 0
  )
    return state;
  const initialSession = createInitialTaskSessionState(now, state.sessionId, {
    title: state.title,
    createdBy: state.createdBy,
  });
  initialSession.createdAt = state.createdAt;
  initialSession.workspace.codingEffort = state.workspace.codingEffort;
  initialSession.workspace.codingModel = state.workspace.codingModel;
  initialSession.version = state.version + 1;
  if (state.workspace.agentSession)
    initialSession.workspace.agentSession = {
      id: createAgentSessionId(state.sessionId, now),
      runtime: state.workspace.agentSession.runtime,
    };
  if (!state.repository) return initialSession;
  return {
    ...initialSession,
    repository: state.repository,
    workspace: {
      status: "ready",
      codingEffort: state.workspace.codingEffort,
      codingModel: state.workspace.codingModel,
      agentSession: {
        id: createAgentSessionId(state.sessionId, now),
        runtime: state.workspace.agentSession?.runtime ?? "codex",
      },
      diff: "",
      files: [],
      commands: [],
      changedFiles: [],
    },
  };
}

export function connectRepository(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "connect-repository" }>,
  now: number,
  actor: TeamMember
): TaskSessionState {
  if (state.repository) return state;
  const repository: RepositoryState = {
    provider: "github-app",
    installationId: action.installationId,
    id: action.repositoryId,
    url: action.repositoryUrl,
    name: action.repositoryName,
    branch: action.repositoryBranch,
    visibility: action.visibility,
    authorizedByGitHub: {
      id: action.githubUserId,
      login: action.githubLogin,
    },
    connectedBy: action.actor,
    connectedAt: now,
  };
  return {
    ...state,
    version: state.version + 1,
    revision: 1,
    stage: "waiting",
    repository,
    workspace: {
      status: "ready",
      codingEffort: state.workspace.codingEffort,
      codingModel: state.workspace.codingModel,
      // Planning has no working copy. Attaching a repository creates a new
      // native session, never reuses its planning VM as a cloned repository.
      agentSession:
        state.workspace.agentSession &&
        !state.workspace.sandboxName &&
        !state.workspace.agentSession.resumeFrom
          ? state.workspace.agentSession
          : {
              id: createAgentSessionId(state.sessionId, now),
              runtime: state.workspace.agentSession?.runtime ?? "codex",
            },
      diff: "",
      files: [],
      commands: [],
      changedFiles: [],
    },
    messages: appendAgentMessage(
      state,
      `${actor.shortName} connected ${repository.name}. Hive can now inspect and execute against the repository.`,
      now,
      "repository-connected"
    ),
    updatedAt: now,
  };
}
