/**
 * The shared session is the product primitive: every teammate talks to the same
 * agent, sees the same run, and can turn an inline annotation into a steer.
 */

import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { codeReferenceContext, codeReferenceSchema, type CodeReference } from "./code-reference.ts";

export type MemberId = string;

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
  members: TeamMember[] = [],
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
export type RunStage = "waiting" | "running" | "review" | "approved";

export type SteeringSource =
  | { kind: "workspace-annotation" }
  | { kind: "message"; messageId: string }
  | { kind: "message-thread"; messageId: string; steerId: string }
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
  id: string;
  clientId?: string;
  name: string;
  initials: string;
  body: string;
  role: "human" | "agent";
  memberId?: MemberId;
  annotations?: MessageAnnotation[];
  threadSteer?: { id: string; throughReplyId: string; replyCount: number; requestedBy: MemberId; requestedAt: number; status: "queued" | "steered" };
  status?: "error" | "streaming";
  codeReference?: CodeReference;
  time: string;
};

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
  durationMs?: number;
};

export type WorkspaceState = {
  status: "disconnected" | "ready" | "running" | "review" | "error";
  sandboxName?: string;
  agentSession?: {
    id: string;
    runtime: "codex";
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
  status: "restoring" | "unconfirmed";
};

export type AgentReply = {
  id: string;
  body: string;
  sequence: number;
  startedAt: number;
};

export type HiveRunResult = {
  snapshot?: { id: string; createdAt: number };
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

export type Annotation = {
  status: "open" | "queued" | "steered";
  text: string;
  queuedBy?: MemberId;
  queuedAt?: number;
  steeredBy?: MemberId;
  steeredAt?: number;
};

export type TaskSessionState = {
  sessionId: string;
  title: string;
  createdBy: MemberId;
  createdAt: number;
  version: number;
  revision: 1 | 2;
  stage: RunStage;
  messages: ChatMessage[];
  annotation: Annotation;
  steeringQueue: SteeringQueueItem[];
  activeSteer?: ActiveSteer;
  repository?: RepositoryState;
  workspace: WorkspaceState;
  updatedAt: number;
};

export type TaskSessionAction =
  | { type: "send-message"; actor: MemberId; body: string; clientId?: string }
  | { type: "annotate-code"; actor: MemberId; body: string; clientId: string; reference: CodeReference }
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
    }
  | {
      type: "annotate-message";
      actor: MemberId;
      messageId: string;
      body: string;
      clientId?: string;
    }
  | {
      type: "steer-message-annotation";
      actor: MemberId;
      messageId: string;
      annotationId: string;
    }
  | { type: "apply-next-steer"; actor: MemberId }
  | { type: "steer-thread"; actor: MemberId; messageId: string; throughReplyId: string }
  | { type: "remove-queued-steer"; actor: MemberId; steerId: string }
  | {
      type: "reorder-queued-steer";
      actor: MemberId;
      steerId: string;
      direction: "up" | "down";
    }
  | { type: "steer-agent"; actor: MemberId }
  | { type: "advance-run"; actor: MemberId }
  | { type: "reset"; actor: MemberId };

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
  options: { title?: string; createdBy?: MemberId } = {},
): TaskSessionState {
  return {
    sessionId,
    title: options.title?.trim() || "Untitled task",
    createdBy: options.createdBy ?? "hive-system",
    createdAt: now,
    version: 1,
    revision: 1,
    stage: "waiting",
    messages: [
      {
        id: "initial-1",
        name: "Hive",
        initials: "AI",
        body: "What should we accomplish? We can clarify the task first and attach a GitHub repository whenever the team is ready to work on code.",
        role: "agent",
        time: timeLabel(now),
      },
    ],
    annotation: {
      status: "open",
      text: "",
    },
    steeringQueue: [],
    workspace: {
      status: "disconnected",
      diff: "",
      files: [],
      commands: [],
      changedFiles: [],
    },
    updatedAt: now,
  };
}

function timeLabel(now: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

function appendAgentMessage(state: TaskSessionState, body: string, now: number): ChatMessage[] {
  return [
    ...state.messages,
    {
      id: `agent-${now}-${state.version + 1}`,
      name: "Hive",
      initials: "AI",
      body,
      role: "agent",
      time: timeLabel(now),
    },
  ];
}

export function isHiveRunActive(state: TaskSessionState): boolean {
  // Queued work can keep the task stage running after the execution has ended.
  return state.stage === "running" &&
    state.workspace.startedAt !== undefined &&
    state.workspace.completedAt === undefined;
}

function finishAgentReply(state: TaskSessionState, body: string, now: number): ChatMessage[] {
  const liveReply = state.workspace.liveReply;
  if (!liveReply) return appendAgentMessage(state, body, now);
  return [...state.messages, {
    id: liveReply.id,
    name: "Hive",
    initials: "AI",
    body: liveReply.body || body,
    role: "agent",
    time: timeLabel(liveReply.startedAt),
  }];
}

export function conversationMessages(state: TaskSessionState): ChatMessage[] {
  if (!state.workspace.liveReply?.body) return state.messages;
  const messages = finishAgentReply(state, "", state.updatedAt);
  return messages.map((message, index) => index === messages.length - 1
    ? { ...message, status: "streaming" }
    : message);
}

export function canApplyNextSteer(state: TaskSessionState): boolean {
  return !state.workspace.restore &&
    state.steeringQueue.length > 0 &&
    !state.activeSteer &&
    !isHiveRunActive(state);
}

export function canApproveChanges(state: TaskSessionState): boolean {
  return !state.workspace.restore &&
    Boolean(state.repository) &&
    state.stage === "review" &&
    state.workspace.status === "review" &&
    state.workspace.diff.trim().length > 0 &&
    state.steeringQueue.length === 0 &&
    !state.activeSteer;
}

export function didStartHiveRun(previous: TaskSessionState, next: TaskSessionState): boolean {
  return !isHiveRunActive(previous) && isHiveRunActive(next);
}

export function appendHiveReply(
  state: TaskSessionState,
  body: string,
  now = Date.now(),
  status?: ChatMessage["status"],
): TaskSessionState {
  return {
    ...state,
    activeSteer: undefined,
    stage:
      !state.repository && state.stage === "running"
        ? "waiting"
        : state.stage,
    workspace: !state.repository
      ? {
          ...state.workspace,
          status: "disconnected",
          startedAt: undefined,
          completedAt: now,
          error: undefined,
          liveReply: undefined,
        }
      : state.workspace,
    version: state.version + 1,
    messages: finishAgentReply(state, body, now).map((message, index, messages) =>
      index === messages.length - 1 && status ? { ...message, status } : message,
    ),
    updatedAt: now,
  };
}

export function reduceTaskSession(
  state: TaskSessionState,
  action: TaskSessionAction,
  now = Date.now(),
  members: TeamMember[] = [],
): TaskSessionState {
  const actor = resolveMember(action.actor, members);
  if (state.workspace.restore) return state;
  if (action.type === "reset") {
    const initialSession = createInitialTaskSessionState(now, state.sessionId, {
      title: state.title,
      createdBy: state.createdBy,
    });
    initialSession.createdAt = state.createdAt;
    initialSession.version = state.version + 1;
    if (!state.repository) return initialSession;
    return {
      ...initialSession,
      repository: state.repository,
      workspace: {
        status: "ready",
        agentSession: {
          id: createAgentSessionId(state.sessionId, now),
          runtime: "codex",
        },
        diff: "",
        files: [],
        commands: [],
        changedFiles: [],
      },
      messages: [
        {
          id: `agent-${now}-1`,
          name: "Hive",
          initials: "AI",
          body: `${state.repository.name} is connected. What should we work on?`,
          role: "agent",
          time: timeLabel(now),
        },
      ],
    };
  }

  if (action.type === "connect-repository") {
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
        agentSession:
          state.workspace.agentSession ?? {
            id: createAgentSessionId(state.sessionId, now),
            runtime: "codex",
          },
        sandboxName: state.workspace.sandboxName,
        diff: "",
        files: [],
        commands: [],
        changedFiles: [],
      },
      messages: appendAgentMessage(
        state,
        `${actor.shortName} connected ${repository.name}. Hive can now inspect and execute against the repository.`,
        now,
      ),
      updatedAt: now,
    };
  }

  if (action.type === "send-message") {
    const body = action.body.trim();
    if (!body) return state;
    if (action.clientId && state.messages.some((message) =>
      message.role === "human" && message.memberId === action.actor && message.clientId === action.clientId,
    )) return state;
    const member = actor;
    const messageId = `human-${now}-${state.version + 1}`;
    const addressesHive = !isDirectedAtTeammate(
      body,
      action.actor,
      members,
    );
    const startsRun = addressesHive &&
      !isHiveRunActive(state) && state.steeringQueue.length === 0;
    const queuesRun = addressesHive && !startsRun;
    return {
      ...state,
      version: state.version + 1,
      stage: startsRun ? "running" : state.stage,
      workspace: startsRun
        ? state.repository
          ? {
              ...state.workspace,
              status: "running",
              agentSession: state.workspace.agentSession ?? {
                id: createAgentSessionId(state.sessionId, now),
                runtime: "codex",
              },
              summary: undefined,
              error: undefined,
              startedAt: now,
              completedAt: undefined,
              commands: [],
            }
          : {
              ...state.workspace,
              status: "disconnected",
              startedAt: now,
              completedAt: undefined,
              error: undefined,
            }
        : state.workspace,
      steeringQueue: queuesRun
        ? [
            ...state.steeringQueue,
            {
              id: `steer-${now}-${state.version + 1}`,
              body,
              authorId: action.actor,
              queuedAt: now,
              source: { kind: "message", messageId },
              sourceLabel: `${member.shortName}'s message`,
            },
          ]
        : state.steeringQueue,
      messages: [
        ...state.messages,
        {
          id: messageId,
          clientId: action.clientId,
          name: member.name,
          initials: member.initials,
          body,
          role: "human",
          memberId: member.id,
          time: timeLabel(now),
        },
      ],
      updatedAt: now,
    };
  }

  if (action.type === "annotate-code") {
    const body = action.body.trim();
    const reference = codeReferenceSchema.safeParse(action.reference);
    if (!state.repository || !body || body.length > 500 || !reference.success) return state;
    if (state.messages.some((message) => message.memberId === action.actor && message.clientId === action.clientId)) return state;
    // A code reference is a discussion message with an ordinary annotation.
    // Promotion, authorship, idempotency and queueing use the existing path.
    return {
      ...state,
      version: state.version + 1,
      messages: [...state.messages, {
        id: `human-${now}-${state.version + 1}`,
        clientId: action.clientId,
        name: actor.name,
        initials: actor.initials,
        body: codeReferenceContext(reference.data),
        codeReference: reference.data,
        role: "human",
        memberId: actor.id,
        time: timeLabel(now),
        annotations: [{ id: `annotation-${now}-${state.version + 1}`, clientId: action.clientId, body, authorId: actor.id, createdAt: now, status: "open" }],
      }],
      updatedAt: now,
    };
  }

  if (action.type === "annotate-message") {
    const body = action.body.trim();
    const targetMessage = state.messages.find(
      (message) => message.id === action.messageId,
    );
    if (!body || body.length > 4000 || !targetMessage || targetMessage.status === "error" || targetMessage.status === "streaming") return state;
    if (action.clientId && targetMessage.annotations?.some((annotation) =>
      annotation.authorId === action.actor && annotation.clientId === action.clientId,
    )) return state;

    return {
      ...state,
      version: state.version + 1,
      messages: state.messages.map((message) =>
        message.id === action.messageId
          ? {
              ...message,
              annotations: [
                ...(message.annotations ?? []),
                {
                  id: `annotation-${now}-${state.version + 1}`,
                  clientId: action.clientId,
                  body,
                  authorId: action.actor,
                  createdAt: now,
                  status: "open" as const,
                },
              ],
            }
          : message,
      ),
      updatedAt: now,
    };
  }

  if (action.type === "steer-thread") {
    const parent = state.messages.find((message) => message.id === action.messageId);
    const replies = parent?.annotations ?? [];
    const throughIndex = replies.findIndex((reply) => reply.id === action.throughReplyId);
    if (!parent || throughIndex < 0 || replies.findIndex((reply) => reply.id === parent.threadSteer?.throughReplyId) >= throughIndex) return state;
    // The selected boundary is explicit: a reply arriving during the click does
    // not silently become part of the team's instruction. Content and authors
    // are always resolved on the server and frozen in the ordinary steer queue.
    const included = replies.slice(0, throughIndex + 1);
    const body = [
      "Steer using this complete thread. Authorship comes from saved team records.",
      "Consider the parent and all included replies together. If requirements conflict, ask for clarification; the latest reply is not automatically a team decision. Do not execute unrelated or later discussion.",
      JSON.stringify({ parent: { author: parent.name, body: parent.body }, replies: included.map((reply) => ({ author: reply.role === "agent" ? "Hive" : resolveMember(reply.authorId, members).name, role: reply.role ?? "human", body: reply.body })) }, null, 2),
    ].join("\n\n");
    if (body.length > 64_000) return state;
    const item: SteeringQueueItem = {
      id: `steer-${now}-${state.version + 1}`, body, authorId: actor.id, queuedAt: now,
      source: { kind: "message-thread", messageId: parent.id, steerId: `steer-${now}-${state.version + 1}` },
      sourceLabel: `Thread · ${included.length} ${included.length === 1 ? "reply" : "replies"}`,
    };
    const queued: TaskSessionState = {
      ...state, version: state.version + 1, updatedAt: now,
      messages: state.messages.map((message) => message.id === parent.id ? { ...message, threadSteer: { id: item.id, throughReplyId: action.throughReplyId, replyCount: included.length, requestedBy: actor.id, requestedAt: now, status: "queued" } } : message),
      steeringQueue: [...state.steeringQueue, item],
    };
    return !isHiveRunActive(state) && state.steeringQueue.length === 0
      ? reduceTaskSession(queued, { type: "apply-next-steer", actor: actor.id }, now, members)
      : queued;
  }

  if (action.type === "steer-message-annotation") {
    const targetAnnotation = state.messages
      .find((message) => message.id === action.messageId)
      ?.annotations?.find(
        (annotation) => annotation.id === action.annotationId,
      );
    if (targetAnnotation?.role === "agent") return state;
    if (!targetAnnotation || targetAnnotation.status !== "open") return state;

    if (isHiveRunActive(state) || state.steeringQueue.length > 0) {
      const queueItem: SteeringQueueItem = {
        id: `steer-${now}-${state.version + 1}`,
        body: targetAnnotation.body,
        authorId: action.actor,
        queuedAt: now,
        source: {
          kind: "message-annotation",
          messageId: action.messageId,
          annotationId: action.annotationId,
        },
        sourceLabel: `${
          state.messages.find((message) => message.id === action.messageId)
            ?.name ?? actor.shortName
        }'s message`,
      };
      return {
        ...state,
        version: state.version + 1,
        messages: state.messages.map((message) =>
          message.id === action.messageId
            ? {
                ...message,
                annotations: message.annotations?.map((annotation) =>
                  annotation.id === action.annotationId
                    ? {
                        ...annotation,
                        status: "queued" as const,
                        queuedBy: action.actor,
                        queuedAt: now,
                      }
                    : annotation,
                ),
              }
            : message,
        ),
        steeringQueue: [...state.steeringQueue, queueItem],
        updatedAt: now,
      };
    }

    return {
      ...state,
      version: state.version + 1,
      revision: 2,
      stage: "running",
      workspace: state.repository
        ? {
            ...state.workspace,
            status: "running",
            summary: undefined,
            error: undefined,
            startedAt: now,
            completedAt: undefined,
            commands: [],
          }
        : {
            ...state.workspace,
            status: "disconnected",
            startedAt: now,
            completedAt: undefined,
            error: undefined,
          },
      messages: state.messages.map((message) =>
        message.id === action.messageId
          ? {
              ...message,
              annotations: message.annotations?.map((annotation) =>
                annotation.id === action.annotationId
                  ? {
                      ...annotation,
                      status: "steered" as const,
                      steeredBy: action.actor,
                      steeredAt: now,
                    }
                  : annotation,
              ),
            }
          : message,
      ),
      updatedAt: now,
    };
  }

  if (action.type === "steer-agent") {
    if (
      state.annotation.status !== "open" ||
      !state.annotation.text.trim()
    ) return state;

    if (isHiveRunActive(state) || state.steeringQueue.length > 0) {
      return {
        ...state,
        version: state.version + 1,
        annotation: {
          ...state.annotation,
          status: "queued",
          queuedBy: action.actor,
          queuedAt: now,
        },
        steeringQueue: [
          ...state.steeringQueue,
          {
            id: `steer-${now}-${state.version + 1}`,
            body: state.annotation.text,
            authorId: action.actor,
            queuedAt: now,
            source: { kind: "workspace-annotation" },
            sourceLabel: "Preview annotation",
          },
        ],
        updatedAt: now,
      };
    }

    return {
      ...state,
      version: state.version + 1,
      revision: 2,
      stage: "running",
      workspace: state.repository
        ? {
            ...state.workspace,
            status: "running",
            summary: undefined,
            error: undefined,
            startedAt: now,
            completedAt: undefined,
            commands: [],
          }
        : {
            ...state.workspace,
            status: "disconnected",
            startedAt: now,
            completedAt: undefined,
            error: undefined,
          },
      annotation: {
        ...state.annotation,
        status: "steered",
        steeredBy: action.actor,
        steeredAt: now,
      },
      updatedAt: now,
    };
  }

  if (action.type === "apply-next-steer") {
    if (!canApplyNextSteer(state)) return state;
    const [nextSteer, ...remainingQueue] = state.steeringQueue;
    const nextSource = nextSteer.source;

    return {
      ...state,
      version: state.version + 1,
      stage: "running",
      workspace: {
        ...state.workspace,
        status: state.repository ? "running" : "disconnected",
        startedAt: now,
        completedAt: undefined,
        summary: undefined,
        error: undefined,
        commands: [],
      },
      annotation:
        nextSource.kind === "workspace-annotation"
          ? {
              ...state.annotation,
              status: "steered",
              steeredBy: nextSteer.authorId,
              steeredAt: now,
            }
          : state.annotation,
      messages: state.messages.map((message) =>
        nextSource.kind === "message-annotation" &&
        message.id === nextSource.messageId
          ? {
              ...message,
              annotations: message.annotations?.map((annotation) =>
                annotation.id === nextSource.annotationId
                  ? {
                      ...annotation,
                      status: "steered" as const,
                      steeredBy: nextSteer.authorId,
                      steeredAt: now,
                    }
                  : annotation,
              ),
            }
          : nextSource.kind === "message-thread" && message.threadSteer?.id === nextSource.steerId
            ? { ...message, threadSteer: { ...message.threadSteer, status: "steered" as const } }
            : message,
      ),
      steeringQueue: remainingQueue,
      activeSteer: { ...nextSteer, appliedAt: now },
      updatedAt: now,
    };
  }

  if (action.type === "remove-queued-steer") {
    const queuedSteer = state.steeringQueue.find(
      (item) => item.id === action.steerId,
    );
    if (!queuedSteer) return state;
    const queuedSource = queuedSteer.source;
    const steeringQueue = state.steeringQueue.filter((item) => item.id !== action.steerId);
    const queueDrained = state.repository && state.stage === "running" &&
      state.workspace.completedAt !== undefined && steeringQueue.length === 0;
    const hasChanges = state.workspace.diff.trim().length > 0;

    return {
      ...state,
      version: state.version + 1,
      stage: queueDrained ? hasChanges ? "review" : "waiting" : state.stage,
      workspace: queueDrained ? { ...state.workspace, status: hasChanges ? "review" : "ready" } : state.workspace,
      annotation:
        queuedSource.kind === "workspace-annotation"
          ? {
              ...state.annotation,
              status: "open",
              queuedBy: undefined,
              queuedAt: undefined,
            }
          : state.annotation,
      messages: state.messages.map((message) =>
        queuedSource.kind === "message-annotation" &&
        message.id === queuedSource.messageId
          ? {
              ...message,
              annotations: message.annotations?.map((annotation) =>
                annotation.id === queuedSource.annotationId
                  ? {
                      ...annotation,
                      status: "open" as const,
                      queuedBy: undefined,
                      queuedAt: undefined,
                    }
                  : annotation,
              ),
            }
          : queuedSource.kind === "message-thread" && message.threadSteer?.id === queuedSource.steerId
            ? { ...message, threadSteer: undefined }
            : message,
      ),
      steeringQueue,
      updatedAt: now,
    };
  }

  if (action.type === "reorder-queued-steer") {
    const currentIndex = state.steeringQueue.findIndex(
      (item) => item.id === action.steerId,
    );
    const nextIndex =
      action.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= state.steeringQueue.length
    ) return state;

    const steeringQueue = [...state.steeringQueue];
    [steeringQueue[currentIndex], steeringQueue[nextIndex]] = [
      steeringQueue[nextIndex],
      steeringQueue[currentIndex],
    ];
    return {
      ...state,
      version: state.version + 1,
      steeringQueue,
      updatedAt: now,
    };
  }

  if (action.type === "advance-run") {
    if (canApproveChanges(state)) {
      const member = actor;
      return {
        ...state,
        version: state.version + 1,
        stage: "approved",
        messages: appendAgentMessage(
          state,
          `${member.shortName} approved the current diff.`,
          now,
        ),
        updatedAt: now,
      };
    }
  }

  return state;
}

export function applyHiveRunResult(
  state: TaskSessionState,
  result: HiveRunResult,
  now = Date.now(),
): TaskSessionState {
  if (state.workspace.restore) return state;
  const hasQueuedSteer = state.steeringQueue.length > 0;
  const hasChanges = result.diff.trim().length > 0;
  return {
    ...state,
    version: state.version + 1,
    revision: 2,
    stage: hasQueuedSteer ? "running" : hasChanges ? "review" : "waiting",
    activeSteer: undefined,
    workspace: {
      status: hasQueuedSteer ? "running" : hasChanges ? "review" : "ready",
      sandboxName: result.sandboxName,
      agentSession: result.agentSession,
      summary: result.summary,
      diff: result.diff,
      files: result.files,
      commands: result.commands,
      changedFiles: result.changedFiles,
      startedAt: state.workspace.startedAt,
      completedAt: now,
      checkpoints: savedWorkspaceCheckpoints(state.workspace.checkpoints, result),
      lastRestore: state.workspace.lastRestore,
    },
    messages: finishAgentReply(state, result.summary, now),
    updatedAt: now,
  };
}

export function applyHiveRunError(
  state: TaskSessionState,
  message: string,
  now = Date.now(),
  checkpoint?: HiveSessionCheckpoint,
): TaskSessionState {
  if (state.workspace.restore) return state;
  return {
    ...state,
    version: state.version + 1,
    stage: "waiting",
    activeSteer: undefined,
    workspace: {
      ...state.workspace,
      sandboxName: checkpoint?.sandboxName ?? state.workspace.sandboxName,
      agentSession: checkpoint?.agentSession ?? state.workspace.agentSession,
      diff: checkpoint?.diff ?? state.workspace.diff,
      files: checkpoint?.files ?? state.workspace.files,
      commands: checkpoint?.commands ?? state.workspace.commands,
      changedFiles: checkpoint?.changedFiles ?? state.workspace.changedFiles,
      status: "error",
      error: message,
      completedAt: now,
      liveReply: undefined,
      checkpoints: checkpoint?.snapshot && checkpoint.agentSession?.resumeFrom && checkpoint.sandboxName && checkpoint.diff !== undefined && checkpoint.files && checkpoint.commands && checkpoint.changedFiles
        ? savedWorkspaceCheckpoints(state.workspace.checkpoints, { ...checkpoint, summary: message } as HiveRunResult, message)
        : state.workspace.checkpoints,
    },
    messages: [
      ...(state.workspace.liveReply?.body ? finishAgentReply(state, "", now) : state.messages),
      {
        id: `agent-${now}-${state.version + 1}`,
        name: "Hive",
        initials: "AI",
        body: message,
        role: "agent",
        status: "error",
        time: timeLabel(now),
      },
    ],
    updatedAt: now,
  };
}

function savedWorkspaceCheckpoints(previous: SavedWorkspaceCheckpoint[] = [], result: HiveRunResult, error?: string): SavedWorkspaceCheckpoint[] {
  const { snapshot, ...saved } = result;
  if (!snapshot || !result.agentSession.resumeFrom) return previous;
  return [{ ...snapshot, result: saved, ...(error ? { error } : {}) }, ...previous.filter((checkpoint) => checkpoint.id !== snapshot.id)].slice(0, WORKSPACE_CHECKPOINT_LIMIT);
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
  members: TeamMember[] = Object.values(memberDirectory),
) {
  const mention = body.trim().match(/^@([a-z0-9_-]+)\b/i)?.[1]?.toLowerCase();
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
