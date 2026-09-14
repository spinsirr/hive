import { canChangeTaskSettings } from "./task-execution.ts";
import type { ClientTaskSessionAction } from "./task-session-actions.ts";
/**
 * The shared session is the product primitive: every teammate talks to the same
 * agent, sees the same run, and can turn an inline annotation into a steer.
 */

import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { type CodingEffort } from "../agents/coding-effort.ts";
import { type CodeReference } from "../workspace/code-reference.ts";
import {
  finalizeSubagents,
  type HiveSubagent,
} from "../agents/hive-subagents.ts";

import {
  finishPeerReviews,
  type PeerInteraction,
} from "../conversation/peer-collaboration.ts";
import type { TaskEnvironment } from "../workspace/task-environment-policy.ts";

export type MemberId = string;
export type CodingRuntime = "codex" | "claude-code";

export type TeamMember = {
  id: MemberId;
  name: string;
  shortName: string;
  initials: string;
  role?: string;
  githubLogin?: string;
  avatarUrl?: string;
};

export const memberDirectory: Record<string, TeamMember> = {
  maya: {
    id: "maya",
    name: "Maya Chen",
    shortName: "Maya",
    initials: "MC",
    role: "Product",
  },
  spencer: {
    id: "spencer",
    name: "Spencer Zhao",
    shortName: "Spencer",
    initials: "SZ",
    role: "Engineering",
  },
};

export function resolveMember(
  memberId: MemberId,
  members: TeamMember[] = []
): TeamMember {
  return (
    members.find((member) => member.id === memberId) ??
    memberDirectory[memberId] ?? {
      id: memberId,
      name: "Teammate",
      shortName: "Teammate",
      initials: "TM",
    }
  );
}
export type SteeringSource =
  | {
      kind: "peer-response";
      messageId: string;
      annotationId: string;
      replyThreadId?: string;
    }
  // Historical accepted input retains its source; new annotations use messages.
  | { kind: "workspace-annotation" }
  | { kind: "message"; messageId: string }
  | {
      kind: "message-thread";
      messageId: string;
      steerId: string;
      throughReplyId?: string;
    }
  | { kind: "message-annotation"; messageId: string; annotationId: string };

export type SteeringQueueItem = {
  id: string;
  body: string;
  authorId: MemberId;
  queuedAt: number;
  source: SteeringSource;
  sourceLabel: string;
};

export type ActiveSteer = SteeringQueueItem & { appliedAt: number };

export type MessageAnnotation = {
  deliveryStatus?: "streaming" | "error";
  subagents?: HiveSubagent[];
  id: string;
  clientId?: string;
  body: string;
  authorId: MemberId;
  role?: "agent";
  createdAt: number;
  status: "open" | "queued" | "steered";
  queuedBy?: MemberId;
  queuedAt?: number;
  steeredBy?: MemberId;
  steeredAt?: number;
};

export type ChatMessage = {
  /** Server-authored operation receipt: retained for agent context, not a chat bubble. */
  event?: "repository-connected" | "workspace-restored";
  /** Tool-created question belongs to this existing Thread, not the main timeline. */
  threadId?: string;
  interaction?: PeerInteraction;
  id: string;
  clientId?: string;
  name: string;
  initials: string;
  body: string;
  role: "human" | "agent";
  memberId?: MemberId;
  annotations?: MessageAnnotation[];
  threadSteer?: {
    id: string;
    throughReplyId: string;
    replyCount: number;
    requestedBy: MemberId;
    requestedAt: number;
    status: "queued" | "steered";
  };
  status?: "error" | "streaming";
  codeReference?: CodeReference;
  /** Server-zone label kept for messages saved before `createdAt` existed. */
  time: string;
  /** Epoch milliseconds; viewers format this in their own time zone. */
  createdAt?: number;
  /** Previous text is retained for the shared audit trail; execution is never replayed by an edit. */
  edits?: Array<{ body: string; replacedAt: number }>;
  subagents?: HiveSubagent[];
};

export type MessageEdit = Omit<
  Extract<ClientTaskSessionAction, { type: "edit-message" }>,
  "type"
>;

/** Restore receipts are server-authored evidence even though they carry a member's name. */
export function canEditMessage(message: ChatMessage, memberId: MemberId) {
  return (
    message.role === "human" &&
    message.memberId === memberId &&
    !message.codeReference &&
    !message.interaction &&
    !isWorkspaceEvent(message)
  );
}

export function isWorkspaceEvent(message: ChatMessage) {
  return Boolean(message.event || message.id.startsWith("restore-"));
}

export class MessageEditError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MessageEditError";
    this.status = status;
  }
}

type RepositoryDetails = {
  id: number;
  url: string;
  name: string;
  branch: string;
  visibility: "private" | "public";
  authorizedByGitHub: {
    id: number;
    login: string;
  };
  connectedBy: MemberId;
  connectedAt: number;
};

export type RepositoryState = RepositoryDetails & {
  provider: "github-app";
  installationId: number;
};

export type WorkspaceFile = {
  path: string;
  content: string;
};

export type WorkspaceCommand = {
  command: string;
  output: string;
  exitCode: number | null;
  /** A tool response can arrive without reporting the numeric process exit code. */
  resultReceived?: boolean;
  durationMs?: number;
};

export type WorkspaceState = {
  reviewRevision?: string;
  /** Shared coding preference, independent of the saved native conversation. */
  codingEffort?: CodingEffort;
  codingModel?: string;
  sandboxName?: string;
  environment?: TaskEnvironment;
  /** Private pairing for the provider's next idle-shutdown snapshot. */
  idleCheckpoint?: {
    vmId: string;
    completedAt: number;
    result: Omit<HiveRunResult, "snapshot">;
  };
  agentSession?: {
    id: string;
    runtime: CodingRuntime;
    /** Server-only native authentication boundary; not a credential. */
    authentication?: "gateway" | "claude-subscription";
    resumeFrom?: HarnessAgentResumeSessionState;
  };
  summary?: string;
  diff: string;
  files: WorkspaceFile[];
  commands: WorkspaceCommand[];
  changedFiles: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
  liveReply?: AgentReply;
  checkpoints?: SavedWorkspaceCheckpoint[];
  restore?: WorkspaceRestore;
  lastRestore?: { id: string; snapshotId: string; by: MemberId; at: number };
};

export const WORKSPACE_CHECKPOINT_LIMIT = 3;
export { MESSAGE_BODY_LIMIT } from "../conversation/message-draft.ts";
export type SavedWorkspaceCheckpoint = {
  id: string;
  createdAt: number;
  result: Omit<HiveRunResult, "snapshot">;
  error?: string;
};
export type WorkspaceRestore = {
  id: string;
  snapshotId: string;
  by: TeamMember;
  startedAt: number;
  retryAfter: number;
  /** Durable identity of the VM before any destructive restore step. */
  sourceSessionId?: string;
  status: "restoring" | "unconfirmed";
};

export type AgentReply = {
  threadId?: string;
  id: string;
  body: string;
  sequence: number;
  startedAt: number;
  subagentSequence?: number;
  subagents?: HiveSubagent[];
};

export type HiveRunResult = {
  snapshot?: { id: string; createdAt: number };
  environment?: TaskEnvironment;
  sandboxName: string;
  agentSession: NonNullable<WorkspaceState["agentSession"]>;
  summary: string;
  diff: string;
  files: WorkspaceFile[];
  commands: WorkspaceCommand[];
  changedFiles: string[];
};

// A failed turn may retain command results even if its sandbox or Codex
// checkpoint could not be read. Missing fields preserve the last saved state.
export type HiveSessionCheckpoint = Partial<Omit<HiveRunResult, "summary">>;
export type HivePlanningResult = Pick<
  HiveRunResult,
  "summary" | "sandboxName" | "agentSession" | "environment"
>;

export type TaskSessionState = {
  archived?: { at: number; by: MemberId };
  sessionId: string;
  title: string;
  createdBy: MemberId;
  createdAt: number;
  version: number;
  messages: ChatMessage[];
  steeringQueue: SteeringQueueItem[];
  activeSteer?: ActiveSteer;
  repository?: RepositoryState;
  workspace: WorkspaceState;
  updatedAt: number;
};

export type TaskSessionAction =
  | (ClientTaskSessionAction & { actor: MemberId })
  | {
      type: "connect-repository";
      actor: MemberId;
      repositoryUrl: string;
      repositoryName: string;
      repositoryId: number;
      repositoryBranch: string;
      installationId: number;
      visibility: "private" | "public";
      githubUserId: number;
      githubLogin: string;
    };

export function createAgentSessionId(sessionId: string, now = Date.now()) {
  const safeSessionId = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 24);
  return `hive-${safeSessionId || "session"}-${now.toString(36)}`;
}

export function createInitialTaskSessionState(
  now = Date.now(),
  sessionId = "task-session",
  options: { title?: string; createdBy?: MemberId } = {}
): TaskSessionState {
  return {
    sessionId,
    title: options.title?.trim() ?? "",
    createdBy: options.createdBy ?? "hive-system",
    createdAt: now,
    version: 1,
    messages: [],
    steeringQueue: [],
    workspace: {
      diff: "",
      files: [],
      commands: [],
      changedFiles: [],
    },
    updatedAt: now,
  };
}

/** Fallback label only; it follows the server process time zone. Viewers format `createdAt`. */
export function timeLabel(now: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

export function appendAgentMessage(
  state: TaskSessionState,
  body: string,
  now: number,
  event?: ChatMessage["event"]
): ChatMessage[] {
  return [
    ...state.messages,
    {
      id: `agent-${now}-${state.version + 1}`,
      name: "Hive",
      initials: "AI",
      body,
      ...(event ? { event } : {}),
      role: "agent",
      time: timeLabel(now),
      createdAt: now,
    },
  ];
}

/** Pending requests are visible in the UI, but are not context for this run. */
export function pendingMessageIds(
  state: Pick<TaskSessionState, "steeringQueue">
) {
  return new Set(
    state.steeringQueue.flatMap(({ source }) =>
      source.kind === "message" || source.kind === "message-thread"
        ? [source.messageId]
        : []
    )
  );
}

function finishAgentReply(
  state: TaskSessionState,
  body: string,
  now: number,
  final = true
): ChatMessage[] {
  const liveReply = state.workspace.liveReply;
  if (!liveReply) return appendAgentMessage(state, body, now);
  // A tool-only question/review is already a visible response. Do not append
  // an empty assistant bubble or manufacture an acknowledgement beside it.
  if (
    final &&
    !body.trim() &&
    !liveReply.body.trim() &&
    !liveReply.subagents?.length &&
    state.messages.some(
      (message) => message.interaction?.runId === liveReply.id
    )
  )
    return state.messages;
  if (
    liveReply.threadId &&
    state.messages.some((message) => message.id === liveReply.threadId)
  ) {
    return state.messages.map((message) =>
      message.id === liveReply.threadId
        ? {
            ...message,
            annotations: [
              ...(message.annotations ?? []),
              {
                id: liveReply.id,
                authorId: "hive-agent",
                role: "agent",
                body: body || liveReply.body,
                status: "open",
                createdAt: liveReply.startedAt,
                deliveryStatus: final ? undefined : "streaming",
                subagents: final
                  ? finalizeSubagents(liveReply.subagents)
                  : liveReply.subagents,
              },
            ],
          }
        : message
    );
  }
  return [
    ...state.messages,
    {
      id: liveReply.id,
      name: "Hive",
      initials: "AI",
      // The completed text is authoritative; the streamed checkpoint is best effort
      // and may lag if a progress save failed. Failures pass "" to keep partial text.
      body: body || liveReply.body,
      role: "agent",
      time: timeLabel(liveReply.startedAt),
      createdAt: liveReply.startedAt,
      subagents: final
        ? finalizeSubagents(liveReply.subagents)
        : liveReply.subagents,
    },
  ];
}

export function conversationMessages(state: TaskSessionState): ChatMessage[] {
  if (
    !state.workspace.liveReply?.body &&
    !state.workspace.liveReply?.subagents?.length
  )
    return state.messages;
  const messages = finishAgentReply(state, "", state.updatedAt, false);
  if (state.workspace.liveReply?.threadId) return messages;
  return messages.map((message, index) =>
    index === messages.length - 1
      ? { ...message, status: "streaming" }
      : message
  );
}

/** Explicit steers hand work back to main; their source is provenance, not a
 * reply destination. Only a structured answer explicitly made in a Thread
 * continues there. Already-admitted runs retain their saved liveReply route. */
export function hiveReplyThreadId(state: TaskSessionState): string | undefined {
  const source = state.activeSteer?.source;
  const messageId =
    source?.kind === "peer-response" ? source.replyThreadId : undefined;
  return messageId && state.messages.some((message) => message.id === messageId)
    ? messageId
    : undefined;
}

export const ARCHIVED_TASK_MESSAGE =
  "This task is archived for the team. Restore it before making changes.";

export function taskActionBlockReason(
  state: TaskSessionState,
  action: TaskSessionAction
) {
  if (
    state.archived &&
    action.type !== "restore-task" &&
    action.type !== "archive-task"
  )
    return ARCHIVED_TASK_MESSAGE;
  if (
    action.type === "archive-task" &&
    !state.archived &&
    !canChangeTaskSettings(state)
  )
    return "Finish the current run, queued instructions and workspace recovery before archiving.";
  return null;
}

export function appendHiveReply(
  state: TaskSessionState,
  body: string,
  now = Date.now(),
  status?: ChatMessage["status"]
): TaskSessionState {
  return {
    ...state,
    activeSteer: undefined,
    workspace: !state.repository
      ? {
          ...state.workspace,
          startedAt: undefined,
          completedAt: now,
          error: undefined,
          liveReply: undefined,
        }
      : state.workspace,
    version: state.version + 1,
    messages: finishAgentReply(state, body, now).map(
      (message, index, messages) =>
        index === messages.length - 1 && status
          ? { ...message, status }
          : message
    ),
    updatedAt: now,
  };
}

export function applyHiveRunResult(
  state: TaskSessionState,
  result: HiveRunResult,
  now = Date.now()
): TaskSessionState {
  if (state.workspace.restore) return state;
  return {
    ...state,
    version: state.version + 1,
    activeSteer: undefined,
    workspace: {
      reviewRevision: state.workspace.liveReply?.id,
      codingEffort: state.workspace.codingEffort,
      codingModel: state.workspace.codingModel,
      sandboxName: result.sandboxName,
      environment: result.environment,
      idleCheckpoint: result.environment
        ? { vmId: result.environment.vmId, completedAt: now, result }
        : undefined,
      agentSession: result.agentSession,
      summary: result.summary,
      diff: result.diff,
      files: result.files,
      commands: result.commands,
      changedFiles: result.changedFiles,
      startedAt: state.workspace.startedAt,
      completedAt: now,
      checkpoints: savedWorkspaceCheckpoints(
        state.workspace.checkpoints,
        result
      ),
      lastRestore: state.workspace.lastRestore,
    },
    messages: finishPeerReviews(
      state,
      finishAgentReply(state, result.summary, now),
      true
    ),
    updatedAt: now,
  };
}

export function applyHiveRunError(
  state: TaskSessionState,
  message: string,
  now = Date.now(),
  checkpoint?: HiveSessionCheckpoint
): TaskSessionState {
  if (state.workspace.restore) return state;
  const partial =
    state.workspace.liveReply?.body ||
    state.workspace.liveReply?.subagents?.length
      ? finishAgentReply(state, "", now)
      : state.messages;
  const errorId = `agent-error-${now}-${state.version + 1}`;
  const threadId = state.workspace.liveReply?.threadId;
  const messages: ChatMessage[] =
    threadId && partial.some((entry) => entry.id === threadId)
      ? partial.map((entry) =>
          entry.id === threadId
            ? {
                ...entry,
                annotations: [
                  ...(entry.annotations ?? []),
                  {
                    id: errorId,
                    role: "agent",
                    authorId: "hive-agent",
                    body: message,
                    status: "open",
                    deliveryStatus: "error",
                    createdAt: now,
                  },
                ],
              }
            : entry
        )
      : [
          ...partial,
          {
            id: errorId,
            name: "Hive",
            initials: "AI",
            body: message,
            role: "agent",
            status: "error",
            time: timeLabel(now),
            createdAt: now,
          },
        ];
  return {
    ...state,
    version: state.version + 1,
    activeSteer: undefined,
    workspace: {
      ...state.workspace,
      reviewRevision: undefined,
      sandboxName: checkpoint?.sandboxName ?? state.workspace.sandboxName,
      environment: undefined,
      idleCheckpoint: undefined,
      agentSession: checkpoint?.agentSession ?? state.workspace.agentSession,
      diff: checkpoint?.diff ?? state.workspace.diff,
      files: checkpoint?.files ?? state.workspace.files,
      commands: checkpoint?.commands ?? state.workspace.commands,
      changedFiles: checkpoint?.changedFiles ?? state.workspace.changedFiles,
      error: message,
      completedAt: now,
      liveReply: undefined,
      checkpoints:
        checkpoint?.snapshot &&
        checkpoint.agentSession?.resumeFrom &&
        checkpoint.sandboxName &&
        checkpoint.diff !== undefined &&
        checkpoint.files &&
        checkpoint.commands &&
        checkpoint.changedFiles
          ? savedWorkspaceCheckpoints(
              state.workspace.checkpoints,
              { ...checkpoint, summary: message } as HiveRunResult,
              message
            )
          : state.workspace.checkpoints,
    },
    messages: finishPeerReviews(state, messages, false),
    updatedAt: now,
  };
}

function savedWorkspaceCheckpoints(
  previous: SavedWorkspaceCheckpoint[] = [],
  result: HiveRunResult,
  error?: string
): SavedWorkspaceCheckpoint[] {
  const { snapshot, ...saved } = result;
  if (!snapshot || !result.agentSession.resumeFrom) return previous;
  return [
    { ...snapshot, result: saved, ...(error ? { error } : {}) },
    ...previous.filter((checkpoint) => checkpoint.id !== snapshot.id),
  ].slice(0, WORKSPACE_CHECKPOINT_LIMIT);
}

export function isMemberId(value: unknown): value is MemberId {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[a-z0-9][a-z0-9_-]*$/i.test(value)
  );
}

export function isDirectedAtTeammate(
  body: string,
  actor: MemberId,
  members: TeamMember[] = Object.values(memberDirectory)
) {
  const mention = body
    .trim()
    .match(/^@([a-z0-9_-]+)\b/i)?.[1]
    ?.toLowerCase();
  if (!mention) return false;

  const knownMembers =
    members.length > 0 ? members : Object.values(memberDirectory);
  return knownMembers.some((member) => {
    if (member.id === actor) return false;
    return [member.id, member.githubLogin, member.shortName]
      .filter(Boolean)
      .some((candidate) => candidate?.toLowerCase() === mention);
  });
}
