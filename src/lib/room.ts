/**
 * The shared session is the product primitive: every teammate talks to the same
 * agent, sees the same run, and can turn an inline annotation into a steer.
 */

import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";

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
  body: string;
  authorId: MemberId;
  createdAt: number;
  status: "open" | "queued" | "steered";
  queuedBy?: MemberId;
  queuedAt?: number;
  steeredBy?: MemberId;
  steeredAt?: number;
};

export type ChatMessage = {
  id: string;
  name: string;
  initials: string;
  body: string;
  role: "human" | "agent";
  memberId?: MemberId;
  annotations?: MessageAnnotation[];
  status?: "error";
  time: string;
};

export type RepositoryState = {
  provider: "github-app";
  id: number;
  installationId: number;
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

export type WorkspaceFile = {
  path: string;
  content: string;
};

export type WorkspaceCommand = {
  command: string;
  output: string;
  exitCode: number;
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
};

export type HiveRunResult = {
  sandboxName: string;
  agentSession: NonNullable<WorkspaceState["agentSession"]>;
  summary: string;
  diff: string;
  files: WorkspaceFile[];
  commands: WorkspaceCommand[];
  changedFiles: string[];
};

export type HiveSessionCheckpoint = Pick<
  HiveRunResult,
  "sandboxName" | "agentSession"
>;

export type Annotation = {
  status: "open" | "queued" | "steered";
  text: string;
  queuedBy?: MemberId;
  queuedAt?: number;
  steeredBy?: MemberId;
  steeredAt?: number;
};

export type RoomState = {
  roomId: string;
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

export type RoomAction =
  | { type: "send-message"; actor: MemberId; body: string }
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
    }
  | {
      type: "steer-message-annotation";
      actor: MemberId;
      messageId: string;
      annotationId: string;
    }
  | { type: "apply-next-steer"; actor: MemberId }
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

export function createAgentSessionId(roomId: string, now = Date.now()) {
  const safeRoomId = roomId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 24);
  return `hive-${safeRoomId || "room"}-${now.toString(36)}`;
}

export function createInitialRoomState(
  now = Date.now(),
  roomId = "orbit-nav",
): RoomState {
  return {
    roomId,
    version: 1,
    revision: 1,
    stage: "waiting",
    messages: [
      {
        id: "initial-1",
        name: "Hive",
        initials: "AI",
        body: "Connect a GitHub repository, then ask me to inspect it, change files, and run its tests. Everyone in this room will see the same execution artifacts.",
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

function appendAgentMessage(state: RoomState, body: string, now: number): ChatMessage[] {
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

export function appendHiveReply(
  state: RoomState,
  body: string,
  now = Date.now(),
  status?: ChatMessage["status"],
): RoomState {
  return {
    ...state,
    version: state.version + 1,
    messages: [
      ...state.messages,
      {
        id: `agent-${now}-${state.version + 1}`,
        name: "Hive",
        initials: "AI",
        body,
        role: "agent",
        status,
        time: timeLabel(now),
      },
    ],
    updatedAt: now,
  };
}

export function reduceRoom(
  state: RoomState,
  action: RoomAction,
  now = Date.now(),
  members: TeamMember[] = [],
): RoomState {
  const actor = resolveMember(action.actor, members);
  if (action.type === "reset") {
    const initialRoom = createInitialRoomState(now, state.roomId);
    if (!state.repository) return initialRoom;
    return {
      ...initialRoom,
      repository: state.repository,
      workspace: {
        status: "ready",
        agentSession: {
          id: createAgentSessionId(state.roomId, now),
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
    const repository: RepositoryState = {
      provider: "github-app",
      id: action.repositoryId,
      installationId: action.installationId,
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
        agentSession: {
          id: createAgentSessionId(state.roomId, now),
          runtime: "codex",
        },
        diff: "",
        files: [],
        commands: [],
        changedFiles: [],
      },
      messages: appendAgentMessage(
        state,
        `${actor.shortName} connected ${repository.name} as @${repository.authorizedByGitHub.login}. Hive can now inspect and execute against the private repository.`,
        now,
      ),
      updatedAt: now,
    };
  }

  if (action.type === "send-message") {
    const body = action.body.trim();
    if (!body) return state;
    const member = actor;
    const messageId = `human-${now}-${state.version + 1}`;
    const addressesHive =
      Boolean(state.repository) &&
      !isDirectedAtTeammate(body, action.actor, members);
    const startsRun =
      addressesHive && state.stage !== "running";
    const queuesRun = addressesHive && state.stage === "running";
    return {
      ...state,
      version: state.version + 1,
      stage: startsRun ? "running" : state.stage,
      workspace: startsRun
        ? {
            ...state.workspace,
            status: "running",
            agentSession: state.workspace.agentSession ?? {
              id: createAgentSessionId(state.roomId, now),
              runtime: "codex",
            },
            summary: undefined,
            error: undefined,
            startedAt: now,
            completedAt: undefined,
            commands: [],
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

  if (action.type === "annotate-message") {
    const body = action.body.trim();
    const targetMessage = state.messages.find(
      (message) => message.id === action.messageId,
    );
    if (!body || !targetMessage || targetMessage.role !== "human") return state;

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

  if (action.type === "steer-message-annotation") {
    const targetAnnotation = state.messages
      .find((message) => message.id === action.messageId)
      ?.annotations?.find(
        (annotation) => annotation.id === action.annotationId,
      );
    if (!targetAnnotation || targetAnnotation.status !== "open") return state;

    if (state.stage === "running") {
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
      workspace: {
        ...state.workspace,
        status: "running",
        summary: undefined,
        error: undefined,
        startedAt: now,
        completedAt: undefined,
        commands: [],
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

    if (state.stage === "running") {
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
      workspace: {
        ...state.workspace,
        status: "running",
        summary: undefined,
        error: undefined,
        startedAt: now,
        completedAt: undefined,
        commands: [],
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
    if (
      state.stage !== "running" ||
      state.activeSteer ||
      state.steeringQueue.length === 0
    ) return state;
    const [nextSteer, ...remainingQueue] = state.steeringQueue;
    const nextSource = nextSteer.source;

    return {
      ...state,
      version: state.version + 1,
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

    return {
      ...state,
      version: state.version + 1,
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
          : message,
      ),
      steeringQueue: state.steeringQueue.filter(
        (item) => item.id !== action.steerId,
      ),
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
    if (state.stage === "review") {
      const member = actor;
      return {
        ...state,
        version: state.version + 1,
        stage: "approved",
        messages: appendAgentMessage(
          state,
          `${member.shortName} approved the shared diff. It is ready for the GitHub write layer to open a pull request.`,
          now,
        ),
        updatedAt: now,
      };
    }
  }

  return state;
}

export function applyHiveRunResult(
  state: RoomState,
  result: HiveRunResult,
  now = Date.now(),
): RoomState {
  const hasQueuedSteer = state.steeringQueue.length > 0;
  return {
    ...state,
    version: state.version + 1,
    revision: 2,
    stage: hasQueuedSteer ? "running" : "review",
    activeSteer: undefined,
    workspace: {
      status: hasQueuedSteer ? "running" : "review",
      sandboxName: result.sandboxName,
      agentSession: result.agentSession,
      summary: result.summary,
      diff: result.diff,
      files: result.files,
      commands: result.commands,
      changedFiles: result.changedFiles,
      startedAt: state.workspace.startedAt,
      completedAt: now,
    },
    messages: appendAgentMessage(state, result.summary, now),
    updatedAt: now,
  };
}

export function applyHiveRunError(
  state: RoomState,
  message: string,
  now = Date.now(),
  checkpoint?: HiveSessionCheckpoint,
): RoomState {
  return {
    ...state,
    version: state.version + 1,
    stage: "waiting",
    activeSteer: undefined,
    workspace: {
      ...state.workspace,
      sandboxName: checkpoint?.sandboxName ?? state.workspace.sandboxName,
      agentSession: checkpoint?.agentSession ?? state.workspace.agentSession,
      status: "error",
      error: message,
      completedAt: now,
    },
    messages: [
      ...state.messages,
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
