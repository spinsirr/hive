import {
  acceptCommand,
  startNextCommand,
  releaseCommandSource,
} from "./task-session-commands.ts";
import {
  type TeamMember,
  resolveMember,
  type SteeringQueueItem,
  type TaskSessionState,
  type TaskSessionAction,
} from "./task-session-state.ts";

export function answerQuestion(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "answer-question" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  const parent = state.messages.find(
    (message) => message.id === action.messageId
  );
  const question = parent?.interaction;
  const body = action.body.trim();
  if (
    !parent ||
    question?.kind !== "question" ||
    question.answer ||
    !body ||
    body.length > 4000 ||
    !members.some((member) => member.id === actor.id) ||
    (question.targetMemberId && question.targetMemberId !== actor.id)
  )
    return state;
  if (
    action.replyThreadId &&
    action.replyThreadId !== parent.id &&
    action.replyThreadId !== parent.threadId
  )
    return state;
  const replyThreadId = parent.threadId ?? action.replyThreadId;
  const replyId = `answer-${now}-${state.version + 1}`;
  const item: SteeringQueueItem = {
    id: `steer-${now}-${state.version + 1}`,
    authorId: actor.id,
    queuedAt: now,
    body: JSON.stringify({
      question: parent.body,
      answer: body,
      answeredBy: actor.name,
    }),
    source: {
      kind: "peer-response",
      messageId: parent.id,
      annotationId: replyId,
      replyThreadId,
    },
    sourceLabel: `Answer · ${actor.shortName}`,
  };
  const queued: TaskSessionState = {
    ...state,
    version: state.version + 1,
    updatedAt: now,
    messages: state.messages.map((message) =>
      message.id === parent.id
        ? {
            ...message,
            interaction: {
              ...question,
              answer: { replyId, by: actor.id, at: now },
            },
            annotations: [
              ...(message.annotations ?? []),
              {
                id: replyId,
                clientId: action.clientId,
                body,
                authorId: actor.id,
                createdAt: now,
                status: "queued",
                queuedBy: actor.id,
                queuedAt: now,
              },
            ],
          }
        : message
    ),
  };
  return acceptCommand(queued, item, now, members);
}

export function steerThread(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "steer-thread" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  const parent = state.messages.find(
    (message) => message.id === action.messageId
  );
  const replies = parent?.annotations ?? [];
  const throughIndex = replies.findIndex(
    (reply) => reply.id === action.throughReplyId
  );
  if (
    !parent ||
    throughIndex < 0 ||
    replies.findIndex(
      (reply) => reply.id === parent.threadSteer?.throughReplyId
    ) >= throughIndex
  )
    return state;
  const previousIndex = replies.findIndex(
    (reply) => reply.id === parent.threadSteer?.throughReplyId
  );
  if (
    replies
      .slice(0, throughIndex + 1)
      .some((reply) => reply.deliveryStatus === "streaming") ||
    !replies
      .slice(previousIndex + 1, throughIndex + 1)
      .some((reply) => reply.role !== "agent")
  )
    return state;
  // The selected boundary is explicit: a reply arriving during the click does
  // not silently become part of the team's instruction. Content and authors
  // are always resolved on the server and frozen in the ordinary steer queue.
  const included = replies.slice(0, throughIndex + 1);
  const boundaryAt = included.at(-1)!.createdAt;
  const questions = state.messages
    .filter(
      (message) =>
        message.threadId === parent.id &&
        message.interaction?.kind === "question" &&
        (message.createdAt ?? 0) <= boundaryAt
    )
    .map((message) => {
      const question = message.interaction!;
      const answer =
        question.kind === "question" &&
        question.answer &&
        question.answer.at <= boundaryAt
          ? message.annotations?.find(
              (reply) =>
                reply.id === question.answer?.replyId &&
                reply.status !== "queued"
            )
          : undefined;
      return {
        id: message.id,
        question: message.body,
        targetMemberId: question.targetMemberId,
        answer: answer
          ? {
              author: resolveMember(answer.authorId, members).name,
              body: answer.body,
            }
          : undefined,
      };
    });
  const body = [
    "Steer using this complete thread. Authorship comes from saved team records.",
    "Previously shared discussion is context, not a request to repeat finished work. Apply the new human feedback in the context of the whole thread.",
    "Consider the parent and all included replies together. If requirements conflict, ask for clarification; the latest reply is not automatically a team decision. Do not execute unrelated or later discussion.",
    JSON.stringify(
      {
        previouslySharedThrough: parent.threadSteer?.throughReplyId ?? null,
        parent: { author: parent.name, body: parent.body },
        replies: included.map((reply) => ({
          id: reply.id,
          author:
            reply.role === "agent"
              ? "Hive"
              : resolveMember(reply.authorId, members).name,
          role: reply.role ?? "human",
          body: reply.body,
        })),
        questions,
      },
      null,
      2
    ),
  ].join("\n\n");
  if (body.length > 64_000) return state;
  const item: SteeringQueueItem = {
    id: `steer-${now}-${state.version + 1}`,
    body,
    authorId: actor.id,
    queuedAt: now,
    source: {
      kind: "message-thread",
      messageId: parent.id,
      steerId: `steer-${now}-${state.version + 1}`,
      throughReplyId: action.throughReplyId,
    },
    sourceLabel: `Thread · ${included.length} ${included.length === 1 ? "reply" : "replies"}`,
  };
  const queued: TaskSessionState = {
    ...state,
    version: state.version + 1,
    updatedAt: now,
    messages: state.messages.map((message) =>
      message.id === parent.id
        ? {
            ...message,
            threadSteer: {
              id: item.id,
              throughReplyId: action.throughReplyId,
              replyCount: included.length,
              requestedBy: actor.id,
              requestedAt: now,
              status: "queued",
            },
          }
        : message
    ),
  };
  return acceptCommand(queued, item, now, members);
}

export function steerMessageAnnotation(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "steer-message-annotation" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  const targetAnnotation = state.messages
    .find((message) => message.id === action.messageId)
    ?.annotations?.find((annotation) => annotation.id === action.annotationId);
  if (targetAnnotation?.role === "agent") return state;
  if (!targetAnnotation || targetAnnotation.status !== "open") return state;

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
      state.messages.find((message) => message.id === action.messageId)?.name ??
      actor.shortName
    }'s message`,
  };
  return acceptCommand(
    { ...state, version: state.version + 1, updatedAt: now },
    queueItem,
    now,
    members
  );
}

export function steerAgent(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "steer-agent" }>,
  now: number,
  actor: TeamMember,
  members: TeamMember[]
): TaskSessionState {
  if (state.annotation.status !== "open" || !state.annotation.text.trim())
    return state;

  return acceptCommand(
    { ...state, version: state.version + 1, updatedAt: now },
    {
      id: `steer-${now}-${state.version + 1}`,
      body: state.annotation.text,
      authorId: action.actor,
      queuedAt: now,
      source: { kind: "workspace-annotation" },
      sourceLabel: "Preview annotation",
    },
    now,
    members
  );
}

export function applyNextSteer(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "apply-next-steer" }>,
  now: number,
  members: TeamMember[]
): TaskSessionState {
  return startNextCommand(state, now, members);
}

export function continuePeerResponse(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "continue-peer-response" }>,
  now: number,
  members: TeamMember[]
): TaskSessionState {
  const next = state.steeringQueue[0];
  if (
    !next ||
    next.id !== action.steerId ||
    next.source.kind !== "peer-response" ||
    state.workspace.status === "error" ||
    (state.workspace.lastRestore &&
      next.queuedAt <= state.workspace.lastRestore.at)
  )
    return state;
  return startNextCommand(state, now, members);
}

export function removeQueuedSteer(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "remove-queued-steer" }>,
  now: number
): TaskSessionState {
  const queuedSteer = state.steeringQueue.find(
    (item) => item.id === action.steerId
  );
  if (!queuedSteer) return state;
  const steeringQueue = state.steeringQueue.filter(
    (item) => item.id !== action.steerId
  );
  const queueDrained =
    state.repository &&
    state.stage === "running" &&
    state.workspace.completedAt !== undefined &&
    steeringQueue.length === 0;
  const hasChanges = state.workspace.diff.trim().length > 0;

  return {
    ...state,
    version: state.version + 1,
    stage: queueDrained ? (hasChanges ? "review" : "waiting") : state.stage,
    workspace: queueDrained
      ? { ...state.workspace, status: hasChanges ? "review" : "ready" }
      : state.workspace,
    ...releaseCommandSource(state, queuedSteer),
    steeringQueue,
    updatedAt: now,
  };
}

export function reorderQueuedSteer(
  state: TaskSessionState,
  action: Extract<TaskSessionAction, { type: "reorder-queued-steer" }>,
  now: number
): TaskSessionState {
  const currentIndex = state.steeringQueue.findIndex(
    (item) => item.id === action.steerId
  );
  const nextIndex =
    action.direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= state.steeringQueue.length
  )
    return state;

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
