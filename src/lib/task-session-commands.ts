import {
  canApplyNextSteer,
  createAgentSessionId,
  isHiveRunActive,
  type SteeringQueueItem,
  type TaskSessionState,
  type TeamMember,
} from "./task-session-state.ts";

/** A queue item is an accepted command: frozen input, author, origin and reply destination. */
function commandSource(
  state: TaskSessionState,
  command: SteeringQueueItem,
  status: "open" | "queued" | "steered",
  now: number
) {
  const source = command.source;
  const timing =
    status === "steered"
      ? { steeredBy: command.authorId, steeredAt: now }
      : {
          queuedBy: status === "queued" ? command.authorId : undefined,
          queuedAt: status === "queued" ? now : undefined,
        };
  return {
    annotation:
      source.kind === "workspace-annotation"
        ? { ...state.annotation, status, ...timing }
        : state.annotation,
    messages: state.messages.map((message) => {
      switch (source.kind) {
        case "message-annotation":
        case "peer-response":
          return message.id === source.messageId
            ? {
                ...message,
                annotations: message.annotations?.map((annotation) =>
                  annotation.id === source.annotationId
                    ? { ...annotation, status, ...timing }
                    : annotation
                ),
              }
            : message;
        case "message-thread":
          return message.threadSteer?.id === source.steerId
            ? {
                ...message,
                threadSteer:
                  status === "open"
                    ? undefined
                    : { ...message.threadSteer, status },
              }
            : message;
        case "message":
        case "workspace-annotation":
          return message;
      }
    }),
  };
}

function beginCommand(
  state: TaskSessionState,
  command: SteeringQueueItem,
  now: number
): TaskSessionState {
  return {
    ...state,
    ...commandSource(state, command, "steered", now),
    stage: "running",
    revision:
      command.source.kind === "message-annotation" ||
      command.source.kind === "workspace-annotation"
        ? 2
        : state.revision,
    activeSteer: { ...command, appliedAt: now },
    workspace: {
      ...state.workspace,
      status: state.repository ? "running" : "disconnected",
      agentSession:
        state.workspace.agentSession ??
        (state.repository
          ? { id: createAgentSessionId(state.sessionId, now), runtime: "codex" }
          : undefined),
      startedAt: now,
      completedAt: undefined,
      summary: undefined,
      error: undefined,
      commands: [],
    },
    updatedAt: now,
  };
}

/** The caller has already recorded the contribution and advanced the version. */
export function acceptCommand(
  state: TaskSessionState,
  command: SteeringQueueItem,
  now: number,
  members: TeamMember[]
): TaskSessionState {
  if (
    !isHiveRunActive(state) &&
    !state.activeSteer &&
    state.steeringQueue.length === 0 &&
    (command.source.kind !== "peer-response" ||
      members.some((member) => member.id === command.authorId))
  ) {
    return beginCommand(state, command, now);
  }
  return {
    ...state,
    ...commandSource(state, command, "queued", now),
    steeringQueue: [...state.steeringQueue, command],
  };
}

export function startNextCommand(
  state: TaskSessionState,
  now: number,
  members: TeamMember[]
): TaskSessionState {
  if (!canApplyNextSteer(state)) return state;
  const [command, ...remaining] = state.steeringQueue;
  if (
    command.source.kind === "peer-response" &&
    !members.some((member) => member.id === command.authorId)
  )
    return state;
  return beginCommand(
    { ...state, version: state.version + 1, steeringQueue: remaining },
    command,
    now
  );
}

export function releaseCommandSource(
  state: TaskSessionState,
  command: SteeringQueueItem
) {
  return commandSource(state, command, "open", command.queuedAt);
}
