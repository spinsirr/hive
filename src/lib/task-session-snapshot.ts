import type { TaskSessionSnapshot } from "./task-session-store.ts";
import type { AgentReply } from "./task-session.ts";

function mergeReply(previous: AgentReply, incoming: AgentReply): AgentReply {
  const text = previous.sequence > incoming.sequence ? previous : incoming;
  const agents =
    (previous.subagentSequence ?? 0) > (incoming.subagentSequence ?? 0)
      ? previous
      : incoming;
  return {
    ...text,
    subagents: agents.subagents,
    subagentSequence: agents.subagentSequence,
  };
}

/** The same public projection is used by the initial page and live updates. */
export function publicTaskSessionSnapshot(
  snapshot: TaskSessionSnapshot
): TaskSessionSnapshot {
  const session = snapshot.session.workspace.agentSession;
  return {
    ...snapshot,
    session: {
      ...snapshot.session,
      workspace: {
        ...snapshot.session.workspace,
        // Saved snapshots include private native-harness recovery data. The
        // checkpoint endpoint exposes only task-scoped display metadata.
        checkpoints: undefined,
        idleCheckpoint: undefined,
        agentSession: session
          ? { id: session.id, runtime: session.runtime }
          : undefined,
      },
    },
  };
}

export function receiveTaskSessionSnapshot(
  current: TaskSessionSnapshot,
  incoming: TaskSessionSnapshot
): TaskSessionSnapshot {
  // Mutations, reconnect snapshots, and response checkpoints can arrive out of order.
  if (
    incoming.session.sessionId !== current.session.sessionId ||
    incoming.session.version < current.session.version
  )
    return current;
  const previousReply = current.session.workspace.liveReply;
  const nextReply = incoming.session.workspace.liveReply;
  if (previousReply && nextReply?.id === previousReply.id) {
    return {
      ...incoming,
      session: {
        ...incoming.session,
        workspace: {
          ...incoming.session.workspace,
          liveReply: mergeReply(previousReply, nextReply),
        },
      },
    };
  }
  return incoming;
}

export function receiveAgentReply(
  current: TaskSessionSnapshot,
  sessionId: string,
  reply: AgentReply | null
) {
  const previous = current.session.workspace.liveReply;
  if (
    sessionId !== current.session.sessionId ||
    !reply ||
    reply.id !== previous?.id ||
    (reply.sequence <= previous.sequence &&
      (reply.subagentSequence ?? 0) <= (previous.subagentSequence ?? 0))
  )
    return current;
  return {
    ...current,
    session: {
      ...current.session,
      workspace: {
        ...current.session.workspace,
        liveReply: mergeReply(previous, reply),
      },
    },
  };
}
