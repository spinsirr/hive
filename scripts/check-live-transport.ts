/** Opt-in network diagnostic. Uses transient NOTIFY only; does not change task rows or call a model. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once, on } from "node:events";
import type { AddressInfo } from "node:net";
import { Client } from "pg";
import { WebSocket, WebSocketServer } from "ws";

import { SessionEventHub } from "../src/lib/session-events.ts";
import { subscribeToTaskSession } from "../src/lib/session-live.ts";
import { createInitialTaskSessionState } from "../src/lib/task-session.ts";
import type { LivePresence } from "../src/lib/session-presence.ts";

const databaseUrl = process.env.DATABASE_URL_DIRECT;
if (!databaseUrl) throw new Error("Run with DATABASE_URL_DIRECT configured.");
const sessionId = `qa-live-${randomUUID().slice(0, 8)}`;
const session = createInitialTaskSessionState(Date.now(), sessionId);
session.workspace.liveReply = {
  id: "diagnostic-reply",
  body: "",
  sequence: 0,
  startedAt: Date.now(),
};
const url = new URL(databaseUrl);
if (url.searchParams.get("sslmode") === "require")
  url.searchParams.set("sslmode", "verify-full");
// SessionEventHub reads DATABASE_URL; use the same database as the publisher.
process.env.DATABASE_URL = url.toString();
const publisher = new Client({
  connectionString: url.toString(),
  connectionTimeoutMillis: 10_000,
});
const servers: WebSocketServer[] = [];
const clients: WebSocket[] = [];
let allowed = true;
// Delay the real relay slightly: the final leave must flush before its listener closes.
const clientQuery = Client.prototype.query;
Client.prototype.query = function (
  this: Client,
  ...args: Parameters<Client["query"]>
) {
  if (typeof args[0] === "string" && args[0].includes("pg_notify")) {
    return new Promise<void>((resolve) => setTimeout(resolve, 25)).then(() =>
      clientQuery.apply(this, args)
    );
  }
  return clientQuery.apply(this, args);
} as Client["query"];
const latestPresence = new Map<WebSocket, LivePresence>();
async function nextFrame(
  client: WebSocket,
  type: string,
  matches: (presence: LivePresence) => boolean = () => true
) {
  for await (const [data] of on(client, "message", {
    signal: AbortSignal.timeout(10_000),
  })) {
    const frame = JSON.parse(String(data));
    if (frame.type === type && (type !== "presence" || matches(frame.presence)))
      return frame;
  }
  throw new Error("Socket closed before its update.");
}

async function connect(server: WebSocketServer) {
  const address = server.address() as AddressInfo;
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  clients.push(client);
  client.on("message", (data) => {
    const frame = JSON.parse(String(data));
    if (frame.type === "snapshot") latestPresence.set(client, frame.snapshot);
    if (frame.type === "presence") latestPresence.set(client, frame.presence);
  });
  const initial = once(client, "message", {
    signal: AbortSignal.timeout(15_000),
  });
  await once(client, "open", { signal: AbortSignal.timeout(15_000) });
  const [data] = await initial;
  return { client, initial: JSON.parse(String(data)) };
}

try {
  await publisher.connect();
  for (let i = 0; i < 2; i++) {
    const hub = new SessionEventHub(); // Deliberately independent LISTEN connections; no shared in-memory fanout.
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    server.on(
      "connection",
      (socket) =>
        void subscribeToTaskSession(socket, {
          sessionId,
          memberId: `github-${101 + i}`,
          authorized: async () => allowed,
          snapshot: async () => ({
            session,
            members: [],
            activeMembers: [],
            typingMembers: [],
          }),
          reply: async () => session.workspace.liveReply!,
          events: hub,
        })
    );
    await once(server, "listening");
  }
  const [first, second] = await Promise.all(servers.map(connect));
  assert.equal(first.initial.type, "snapshot");
  assert.equal(second.initial.type, "snapshot");
  for (const { client } of [first, second]) {
    if (latestPresence.get(client)?.activeMembers.length !== 2)
      await nextFrame(
        client,
        "presence",
        (presence) => presence.activeMembers.length === 2
      );
    assert.deepEqual(latestPresence.get(client)?.activeMembers, [
      "github-101",
      "github-102",
    ]);
  }
  const typing = [first, second].map(({ client }) =>
    nextFrame(client, "presence", (presence) =>
      presence.typingMembers.includes("github-101")
    )
  );
  first.client.send(JSON.stringify({ type: "typing", typing: true }));
  await Promise.all(typing);
  console.log(
    "PASS: independent instances exchange presence and attributed typing through real Postgres NOTIFY."
  );
  const replies = [first, second].map(({ client }) =>
    nextFrame(client, "reply")
  );
  session.workspace.liveReply = {
    ...session.workspace.liveReply,
    body: "共享的增量文字",
    sequence: 1,
  };
  await publisher.query("select pg_notify($1, $2)", [
    "hive_session_events",
    JSON.stringify({ sessionId, kind: "reply" }),
  ]);
  for (const frame of await Promise.all(replies)) {
    assert.equal(frame.reply.body, "共享的增量文字");
  }
  const left = nextFrame(
    second.client,
    "presence",
    (presence) => !presence.activeMembers.includes("github-101")
  );
  first.client.close();
  await once(first.client, "close");
  await left;
  const rejoined = nextFrame(second.client, "presence", (presence) =>
    presence.activeMembers.includes("github-101")
  );
  const recovered = await connect(servers[0]);
  await rejoined;
  assert.equal(
    recovered.initial.snapshot.session.workspace.liveReply.body,
    "共享的增量文字"
  );
  assert.equal(
    recovered.initial.snapshot.session.workspace.liveReply.sequence,
    1
  );

  allowed = false;
  const revoked = [recovered.client, second.client].map((client) =>
    once(client, "close", { signal: AbortSignal.timeout(10_000) })
  );
  await publisher.query("select pg_notify($1, $2)", [
    "hive_session_events",
    JSON.stringify({ sessionId, kind: "reply" }),
  ]);
  for (const [code] of await Promise.all(revoked)) assert.equal(code, 4401);
  console.log(
    "PASS: two independent Postgres listeners → two real WebSockets; reconnect snapshot; authorization recheck."
  );
  console.log(
    "Diagnostic fixtures only. No task data changed; no model called; not a two-account production test."
  );
} finally {
  for (const client of clients) client.terminate();
  for (const server of servers) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await publisher.end();
}
