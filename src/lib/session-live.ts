import type { WebSocket } from "ws";
import type { SessionEventHub, SessionEventKind } from "./session-events.ts";
import type { AgentReply } from "./task-session.ts";
import type { TaskSessionSnapshot } from "./task-session-store.ts";
import { publicTaskSessionSnapshot } from "./task-session-snapshot.ts";
import type { LivePresence } from "./session-presence.ts";
import type { MemberId } from "./task-session.ts";

export const LIVE_PING_MS = 20_000;

/** The socket owns presence; browser input may update typing, never execute agent work. */
export async function subscribeToTaskSession(socket: Pick<WebSocket, "close" | "send" | "bufferedAmount" | "readyState" | "ping" | "terminate"> & {
  on: (event: "close" | "error" | "message" | "pong", listener: (data?: unknown, isBinary?: boolean) => void) => unknown;
}, source: {
  sessionId: string;
  memberId: MemberId;
  authorized: () => Promise<boolean>;
  snapshot: () => Promise<TaskSessionSnapshot>;
  reply: () => Promise<AgentReply | null>;
  events: Pick<SessionEventHub, "subscribe">;
}) {
  let stopped = false;
  let subscription: Awaited<ReturnType<SessionEventHub["subscribe"]>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let probe: ReturnType<typeof setInterval> | undefined;
  let alive = true;
  let presence: LivePresence = { activeMembers: [], typingMembers: [] };
  let latestTyping = false;
  let appliedTyping = false;
  let updatingTyping = false;
  const pending = new Set<SessionEventKind | "presence">();
  let reading = false;

  function cleanup() {
    stopped = true;
    clearTimeout(timer);
    clearInterval(probe);
    subscription?.unsubscribe();
    subscription = undefined;
  }
  function close(code = 1012) {
    cleanup();
    socket.close(code);
  }
  // Install handlers synchronously: a browser can leave while LISTEN is still connecting.
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  socket.on("pong", () => { alive = true; });
  socket.on("message", (data, isBinary) => {
    if (stopped) return;
    try {
      const body = String(data);
      if (isBinary || Buffer.byteLength(body) > 128) { close(1008); return; }
      const event = JSON.parse(body);
      if (!event || event.type !== "typing" || typeof event.typing !== "boolean" || Object.keys(event).length !== 2) {
        close(1008); return;
      }
      latestTyping = event.typing;
      void updateTyping();
    } catch { close(1008); }
  });

  async function updateTyping() {
    if (updatingTyping || !subscription || stopped) return;
    updatingTyping = true;
    try {
      while (!stopped && subscription && appliedTyping !== latestTyping) {
        if (!await source.authorized()) { close(4401); return; }
        if (stopped || !subscription) return;
        appliedTyping = latestTyping;
        subscription.setTyping(appliedTyping);
      }
    } catch { close(1011); }
    finally { updatingTyping = false; }
  }

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
        if (stopped) return;
        const event = kind === "snapshot"
          ? { type: "snapshot", snapshot: { ...publicTaskSessionSnapshot(await source.snapshot()), ...presence } }
          : kind === "reply"
            ? { type: "reply", sessionId: source.sessionId, reply: await source.reply() }
            : { type: "presence", sessionId: source.sessionId, presence };
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
  function refresh(kind: SessionEventKind | "presence") {
    if (kind === "snapshot") pending.clear();
    if (!pending.has("snapshot")) pending.add(kind);
    void drain();
  }
  try {
    subscription = await source.events.subscribe({
      sessionId: source.sessionId, memberId: source.memberId, onChange: refresh, onDisconnect: () => close(),
      onPresence: (next) => {
        presence = next;
        if (subscription) refresh("presence");
      },
    });
    if (stopped) { subscription.unsubscribe(); subscription = undefined; return; }
    // Listen, then read: a commit between these two operations cannot be missed.
    refresh("snapshot");
    void updateTyping();
    // Native WebSocket control frames: browsers answer automatically, with no HTTP or SQL.
    probe = setInterval(() => {
      if (!alive) { cleanup(); socket.terminate(); return; }
      alive = false;
      try { socket.ping(); } catch { cleanup(); socket.terminate(); }
    }, LIVE_PING_MS);
    timer = setTimeout(() => close(), 270_000);
  } catch {
    close(1011);
  }
}
