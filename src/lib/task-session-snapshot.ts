import type { TaskSessionSnapshot } from "./task-session-store.ts";

/** The same public projection is used by the initial page and live updates. */
export function publicTaskSessionSnapshot(snapshot: TaskSessionSnapshot): TaskSessionSnapshot {
  const session = snapshot.session.workspace.agentSession;
  return {
    ...snapshot,
    session: {
      ...snapshot.session,
      workspace: {
        ...snapshot.session.workspace,
        agentSession: session
          ? { id: session.id, runtime: session.runtime }
          : undefined,
      },
    },
  };
}

export function receiveTaskSessionSnapshot(
  current: TaskSessionSnapshot,
  incoming: TaskSessionSnapshot,
): TaskSessionSnapshot {
  // Polls, mutations, and another tab may finish in a different order.
  if (
    incoming.session.sessionId !== current.session.sessionId ||
    incoming.session.version < current.session.version
  ) return current;
  return incoming;
}
