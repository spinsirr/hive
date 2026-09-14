import { acceptCommand } from "./task-session-commands.ts";
import {
  codeReferenceContext,
  codeReferenceSchema,
} from "../workspace/code-reference.ts";
import { taskTitleFromMessage } from "../tasks/task-title.ts";
import { canResolvePeerReview } from "../conversation/peer-collaboration.ts";
import {
  type TeamMember,
  canEditMessage,
  MessageEditError,
  MESSAGE_BODY_LIMIT,
  type TaskSessionState,
  type TaskSessionAction,
  timeLabel,
  isDirectedAtTeammate,
} from "./task-session-state.ts";

export function editMessage(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "edit-message" }>,
  now: number
): TaskSessionState {
  const message = state.messages.find((entry) => entry.id === action.messageId);
  if (!message)
    throw new MessageEditError(404, "This message is no longer available.");
  if (message.role !== "human" || message.memberId !== action.actor) {
    throw new MessageEditError(403, "You can only edit your own messages.");
  }
  if (message.codeReference)
    throw new MessageEditError(
      400,
      "Code selections are preserved as quoted evidence. Add a thread reply instead."
    );
  if (!canEditMessage(message, action.actor))
    throw new MessageEditError(
      400,
      "This message records a task operation and cannot be edited. Add a thread reply instead."
    );
  const body = action.body.trim();
  if (
    !body ||
    body.length > MESSAGE_BODY_LIMIT ||
    !Number.isSafeInteger(action.expectedRevision) ||
    action.expectedRevision < 0
  ) {
    throw new MessageEditError(
      400,
      "Enter a message of up to 8,000 characters and a valid revision."
    );
  }
  const queued = state.steeringQueue.find(
    (item) =>
      item.source.kind === "message" && item.source.messageId === message.id
  );
  if (queued?.id !== action.queuedSteerId) {
    throw new MessageEditError(
      409,
      "This message is no longer in the same queue. Reopen the editor to review its current state."
    );
  }
  // A retry after a lost acknowledgement is harmless and adds no duplicate revision.
  if (body === message.body) return state;
  if ((message.edits?.length ?? 0) !== action.expectedRevision) {
    throw new MessageEditError(
      409,
      "This message was edited elsewhere. Reopen the editor before saving again."
    );
  }
  return {
    ...state,
    messages: state.messages.map((entry) =>
      entry.id === message.id
        ? {
            ...entry,
            body,
            edits: [
              ...(entry.edits ?? []),
              { body: entry.body, replacedAt: now },
            ],
          }
        : entry
    ),
    // Whole-thread and annotation steers are already frozen and must stay unchanged.
    steeringQueue: state.steeringQueue.map((item) =>
      item.id === queued?.id ? { ...item, body } : item
    ),
    version: state.version + 1,
    updatedAt: now,
  };
}

export function sendMessage(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "send-message" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  const body = action.body.trim();
  if (!body || body.length > MESSAGE_BODY_LIMIT) return state;
  if (
    action.clientId &&
    state.messages.some(
      (message) =>
        message.role === "human" &&
        message.memberId === action.actor &&
        message.clientId === action.clientId
    )
  )
    return state;
  const member = actor;
  const messageId = `human-${now}-${state.version + 1}`;
  const addressesHive = !isDirectedAtTeammate(body, action.actor, members);
  const contributed: TaskSessionState = {
    ...state,
    title: state.title || taskTitleFromMessage(body),
    version: state.version + 1,
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
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
  return addressesHive
    ? acceptCommand(
        contributed,
        {
          id: `steer-${now}-${state.version + 1}`,
          body,
          authorId: action.actor,
          queuedAt: now,
          source: { kind: "message", messageId },
          sourceLabel: `${member.shortName}'s message`,
        },
        now,
        members
      )
    : contributed;
}

export function annotateCode(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "annotate-code" }>,
  now: number,
  actor: TeamMember
): TaskSessionState {
  const body = action.body.trim();
  const reference = codeReferenceSchema.safeParse(action.reference);
  if (!state.repository || !body || body.length > 500 || !reference.success)
    return state;
  if (
    state.messages.some(
      (message) =>
        message.memberId === action.actor &&
        message.clientId === action.clientId
    )
  )
    return state;
  // A code reference is a discussion message with an ordinary annotation.
  // Promotion, authorship, idempotency and queueing use the existing path.
  return {
    ...state,
    version: state.version + 1,
    messages: [
      ...state.messages,
      {
        id: `human-${now}-${state.version + 1}`,
        clientId: action.clientId,
        name: actor.name,
        initials: actor.initials,
        body: codeReferenceContext(reference.data),
        codeReference: reference.data,
        role: "human",
        memberId: actor.id,
        time: timeLabel(now),
        createdAt: now,
        annotations: [
          {
            id: `annotation-${now}-${state.version + 1}`,
            clientId: action.clientId,
            body,
            authorId: actor.id,
            createdAt: now,
            status: "open",
          },
        ],
      },
    ],
    updatedAt: now,
  };
}

export function annotateMessage(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "annotate-message" }>,
  now: number
): TaskSessionState {
  const body = action.body.trim();
  const targetMessage = state.messages.find(
    (message) => message.id === action.messageId
  );
  if (
    !body ||
    body.length > 4000 ||
    !targetMessage ||
    targetMessage.status === "error" ||
    targetMessage.status === "streaming"
  )
    return state;
  if (
    action.clientId &&
    targetMessage.annotations?.some(
      (annotation) =>
        annotation.authorId === action.actor &&
        annotation.clientId === action.clientId
    )
  )
    return state;

  return {
    ...state,
    version: state.version + 1,
    messages: state.messages.map((message) =>
      message.id === action.messageId
        ? {
            ...message,
            interaction:
              message.interaction?.kind === "review"
                ? { ...message.interaction, resolved: undefined }
                : message.interaction,
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
        : message
    ),
    updatedAt: now,
  };
}

export function resolvePeerReview(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "resolve-peer-review" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  const message = state.messages.find(
    (message) => message.id === action.messageId
  );
  if (
    !message ||
    !members.some((member) => member.id === actor.id) ||
    !canResolvePeerReview(state, message, actor.id, action.revision)
  )
    return state;
  return {
    ...state,
    version: state.version + 1,
    updatedAt: now,
    messages: state.messages.map((entry) =>
      entry.id === message.id && entry.interaction?.kind === "review"
        ? {
            ...entry,
            interaction: {
              ...entry.interaction,
              resolved: { by: actor.id, at: now },
            },
          }
        : entry
    ),
  };
}
