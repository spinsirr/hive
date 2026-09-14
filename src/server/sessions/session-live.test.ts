import type { LivePresence } from "../../lib/session/task-session-contract.ts";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";
import type { SessionEventKind } from "./session-events.ts";

import { LIVE_PING_MS, subscribeToTaskSession } from "./session-live.ts";

import { createInitialTaskSessionState } from "../../lib/session/task-session.ts";

class Socket extends EventEmitter {
  readyState: WebSocket["readyState"] = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closeCode?: number;
  pings = 0;
  terminated = false;
  ping() {
    this.pings++;
  }
  terminate() {
    this.terminated = true;
    this.close();
  }
  send(data: unknown) {
    this.sent.push(String(data));
  }
  close(code?: number) {
    this.closeCode = code;
    this.readyState = 3;
    this.emit("close");
  }
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture() {
  const socket = new Socket();
  const session = createInitialTaskSessionState(1, "live-test");
  session.workspace.agentSession = {
    id: "codex-id",
    runtime: "codex",
    resumeFrom: {
      type: "resume-session",
      specificationVersion: "harness-v1",
      harnessId: "codex",
      data: { secret: "private-checkpoint" },
    },
  };
  const reply = {
    id: "reply-1",
    body: "Streaming text",
    startedAt: 2,
    sequence: 1,
  };
  let allowed = true;
  let unsubscribed = 0;
  let change: (kind: SessionEventKind) => void = () => undefined;
  let onPresence: (presence: LivePresence) => void = () => undefined;
  const typing: boolean[] = [];
  const source = {
    sessionId: session.sessionId,
    memberId: "github-101",
    authorized: async () => allowed,
    snapshot: async () => ({
      session,
      members: [],
      activeMembers: [],
      typingMembers: [],
    }),
    reply: async () => reply,
    events: {
      subscribe: async (listener: {
        onChange: typeof change;
        onPresence: typeof onPresence;
      }) => {
        change = listener.onChange;
        onPresence = listener.onPresence;
        return {
          unsubscribe: () => {
            unsubscribed++;
          },
          setTyping: (value: boolean) => {
            typing.push(value);
          },
        };
      },
    },
  };
  return {
    socket,
    source,
    typing,
    change: (kind: SessionEventKind | "presence") =>
      kind === "presence"
        ? onPresence({ activeMembers: ["github-101"], typingMembers: [] })
        : change(kind),
    revoke: () => {
      allowed = false;
    },
    unsubscribed: () => unsubscribed,
  };
}

test("the live socket sends a public snapshot and lightweight reply updates, and cleans up once", async () => {
  const f = fixture();
  await subscribeToTaskSession(f.socket, f.source);
  await settle();
  assert.equal(JSON.parse(f.socket.sent[0]).type, "snapshot");
  assert.ok(!f.socket.sent[0].includes("private-checkpoint"));
  f.change("reply");
  await settle();
  assert.deepEqual(JSON.parse(f.socket.sent[1]), {
    type: "reply",
    sessionId: "live-test",
    reply: await f.source.reply(),
  });
  assert.ok(!f.socket.sent[1].includes("workspace"));
  f.socket.close();
  f.socket.emit("error", new Error("late socket error"));
  assert.equal(f.unsubscribed(), 1);
});

test("revoked membership closes the existing socket before sending another update", async () => {
  const f = fixture();
  await subscribeToTaskSession(f.socket, f.source);
  await settle();
  f.revoke();
  f.change("reply");
  await settle();
  assert.equal(f.socket.closeCode, 4401);
  assert.equal(f.socket.sent.length, 1);
  assert.equal(f.unsubscribed(), 1);
});

test("the subscription never treats a browser message as agent work", async () => {
  const f = fixture();
  await subscribeToTaskSession(f.socket, f.source);
  f.socket.emit(
    "message",
    JSON.stringify({
      type: "send-message",
      clientId: crypto.randomUUID(),
      body: "start another run",
    })
  );
  assert.equal(f.socket.closeCode, 1008);
  assert.equal(f.unsubscribed(), 1);
});

test("leaving during database setup releases the late subscription", async () => {
  const f = fixture();
  let ready!: () => void;
  let released = false;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  f.source.events.subscribe = async () => {
    await waiting;
    return {
      unsubscribe: () => {
        released = true;
      },
      setTyping: () => {},
    };
  };
  const connected = subscribeToTaskSession(f.socket, f.source);
  f.socket.close();
  ready();
  await connected;
  assert.equal(released, true);
  assert.equal(f.socket.sent.length, 0);
});

test("leaving during authorization does not start a snapshot read afterwards", async () => {
  const f = fixture();
  let allow!: (allowed: boolean) => void;
  let reads = 0;
  const snapshot = await f.source.snapshot();
  f.source.authorized = () =>
    new Promise((resolve) => {
      allow = resolve;
    });
  f.source.snapshot = async () => {
    reads++;
    return snapshot;
  };
  await subscribeToTaskSession(f.socket, f.source);
  f.socket.close();
  allow(true);
  await settle();
  assert.equal(reads, 0);
  assert.equal(f.socket.sent.length, 0);
  assert.equal(f.unsubscribed(), 1);
});

test("slow viewers reconnect instead of accumulating unlimited output", async () => {
  const f = fixture();
  f.socket.bufferedAmount = 2_000_000;
  await subscribeToTaskSession(f.socket, f.source);
  await settle();
  assert.equal(f.socket.closeCode, 1013);
  assert.equal(f.socket.sent.length, 0);
});

test("presence and reply notifications during a slow snapshot both reach the viewer", async () => {
  const f = fixture();
  const snapshot = await f.source.snapshot();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.source.snapshot = async () => {
    await waiting;
    return snapshot;
  };
  try {
    await subscribeToTaskSession(f.socket, f.source);
    await settle();
    f.change("reply");
    f.change("presence");
    f.change("presence");
    release();
    await settle();
    assert.deepEqual(
      f.socket.sent.map((data) => JSON.parse(data).type),
      ["snapshot", "reply", "presence"]
    );
  } finally {
    release();
    f.socket.close();
  }
});

test("a queued full snapshot subsumes pending deltas without redundant task reads", async () => {
  const f = fixture();
  const snapshot = await f.source.snapshot();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.source.snapshot = async () => {
    await waiting;
    return snapshot;
  };
  try {
    await subscribeToTaskSession(f.socket, f.source);
    await settle();
    f.change("presence");
    f.change("reply");
    f.change("snapshot");
    f.change("reply");
    f.change("presence");
    release();
    await settle();
    assert.deepEqual(
      f.socket.sent.map((data) => JSON.parse(data).type),
      ["snapshot", "snapshot"]
    );
  } finally {
    release();
    f.socket.close();
  }
});

test("presence notifications still recheck membership before reading or sending", async () => {
  const f = fixture();
  try {
    await subscribeToTaskSession(f.socket, f.source);
    await settle();
    f.revoke();
    f.change("presence");
    await settle();
    assert.equal(f.socket.closeCode, 4401);
    assert.equal(f.socket.sent.length, 1);
  } finally {
    f.socket.close();
  }
});

test("typing is the only accepted browser input and is attributed to the authenticated connection", async () => {
  const f = fixture();
  try {
    await subscribeToTaskSession(f.socket, f.source);
    await settle();
    f.socket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "typing", typing: true })),
      false
    );
    await settle();
    assert.deepEqual(f.typing, [true]);
    f.socket.emit("message", JSON.stringify({ type: "typing", typing: true }));
    await settle();
    assert.deepEqual(
      f.typing,
      [true],
      "unchanged input does not touch presence again"
    );
    f.socket.emit(
      "message",
      JSON.stringify({ type: "typing", typing: false, actor: "github-102" })
    );
    assert.equal(f.socket.closeCode, 1008);
  } finally {
    f.socket.close();
  }
});

test("revoked members cannot publish typing", async () => {
  const f = fixture();
  try {
    await subscribeToTaskSession(f.socket, f.source);
    await settle();
    f.revoke();
    f.socket.emit("message", JSON.stringify({ type: "typing", typing: true }));
    await settle();
    assert.equal(f.socket.closeCode, 4401);
    assert.deepEqual(f.typing, []);
  } finally {
    f.socket.close();
  }
});

test("idle socket probes neither authorize nor read task data; a missed pong releases presence", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const f = fixture();
  let reads = 0;
  f.source.authorized = async () => {
    reads++;
    return true;
  };
  try {
    await subscribeToTaskSession(f.socket, f.source);
    await settle();
    const before = reads;
    t.mock.timers.tick(LIVE_PING_MS);
    assert.equal(f.socket.pings, 1);
    f.socket.emit("pong");
    t.mock.timers.tick(LIVE_PING_MS);
    assert.equal(f.socket.pings, 2);
    assert.equal(reads, before);
    assert.equal(f.socket.sent.length, 1);
    t.mock.timers.tick(LIVE_PING_MS);
    assert.equal(f.socket.terminated, true);
    assert.equal(f.unsubscribed(), 1);
  } finally {
    f.socket.close();
  }
});
