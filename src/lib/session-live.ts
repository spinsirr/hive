import type { WebSocket } from "ws";
import type { SessionEventHub, SessionEventKind } from "./session-events.ts";
import type { AgentReply } from "./task-session.ts";
import type { TaskSessionPresence, TaskSessionSnapshot } from "./task-session-store.ts";
import { publicTaskSessionSnapshot } from "./task-session-snapshot.ts";

/** Own a read-only socket, its database subscription, and bounded reconnect lifetime together. */
export async function subscribeToTaskSession(socket: Pick<WebSocket, "close" | "send" | "bufferedAmount" | "readyState"> & {
  on: (event: "close" | "error" | "message", listener: () => void) => unknown;
}, source: {
  sessionId: string;
  authorized: () => Promise<boolean>;
  snapshot: () => Promise<TaskSessionSnapshot>;
  reply: () => Promise<AgentReply | null>;
  presence: () => Promise<TaskSessionPresence>;
  events: Pick<SessionEventHub, "subscribe">;
}) {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<SessionEventKind>();
  let reading = false;

  function cleanup() {
    stopped = true;
    clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = undefined;
  }
  function close(code = 1012) {
    cleanup();
    socket.close(code);
  }
  // Install handlers synchronously: a browser can leave while LISTEN is still connecting.
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  socket.on("message", () => close(1008));

  async function drain() {
    if (reading || stopped) return;
    reading = true;
    try {
      while (pending.size && !stopped) {
        const kind = pending.has("snapshot") ? "snapshot" : pending.has("reply") ? "reply" : "presence";
        // A snapshot subsumes both deltas. Reply and presence must never replace
        // each other, including notifications arriving while a read is in flight.
        if (kind === "snapshot") pending.clear();
        else pending.delete(kind);
        if (!await source.authorized()) { close(4401); return; }
        const event = kind === "snapshot"
          ? { type: "snapshot", snapshot: publicTaskSessionSnapshot(await source.snapshot()) }
          : kind === "reply"
            ? { type: "reply", sessionId: source.sessionId, reply: await source.reply() }
            : { type: "presence", sessionId: source.sessionId, presence: await source.presence() };
        if (stopped || socket.readyState !== 1) return;
        if (socket.bufferedAmount > 1_048_576) { close(1013); return; }
        socket.send(JSON.stringify(event));
      }
    } catch {
      close(1011);
    } finally {
      reading = false;
    }
  }
  function refresh(kind: SessionEventKind) {
    if (kind === "snapshot") pending.clear();
    if (!pending.has("snapshot")) pending.add(kind);
    void drain();
  }
  try {
    unsubscribe = await source.events.subscribe({
      sessionId: source.sessionId, onChange: refresh, onDisconnect: () => close(),
    });
    if (stopped) { unsubscribe(); unsubscribe = undefined; return; }
    // Listen, then read: a commit between these two operations cannot be missed.
    refresh("snapshot");
    timer = setTimeout(() => close(), 270_000);
  } catch {
    close(1011);
  }
}
