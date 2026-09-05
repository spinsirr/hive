/** Opt-in network diagnostic. Uses transient NOTIFY only; does not change task rows or call a model. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client } from "pg";
import { WebSocket, WebSocketServer } from "ws";

import { SessionEventHub } from "../src/lib/session-events.ts";
import { subscribeToTaskSession } from "../src/lib/session-live.ts";
import { createInitialTaskSessionState } from "../src/lib/task-session.ts";

const databaseUrl = process.env.DATABASE_URL_DIRECT;
if (!databaseUrl) throw new Error("Run with DATABASE_URL_DIRECT configured.");
const sessionId = `qa-live-${randomUUID().slice(0, 8)}`;
const session = createInitialTaskSessionState(Date.now(), sessionId);
session.workspace.liveReply = { id: "diagnostic-reply", body: "", sequence: 0, startedAt: Date.now() };
const url = new URL(databaseUrl);
if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
const publisher = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
const servers: WebSocketServer[] = [];
const clients: WebSocket[] = [];
let allowed = true;

async function connect(server: WebSocketServer) {
  const address = server.address() as AddressInfo;
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  clients.push(client);
  const initial = once(client, "message", { signal: AbortSignal.timeout(15_000) });
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
    server.on("connection", (socket) => void subscribeToTaskSession(socket, {
      sessionId,
      authorized: async () => allowed,
      snapshot: async () => ({ session, members: [], activeMembers: [], typingMembers: [] }),
      reply: async () => session.workspace.liveReply!,
      events: hub,
    }));
    await once(server, "listening");
  }
  const [first, second] = await Promise.all(servers.map(connect));
  assert.equal(first.initial.type, "snapshot");
  assert.equal(second.initial.type, "snapshot");
  const replies = [first, second].map(({ client }) => once(client, "message", { signal: AbortSignal.timeout(10_000) }));
  session.workspace.liveReply = { ...session.workspace.liveReply!, body: "共享的增量文字", sequence: 1 };
  await publisher.query("select pg_notify($1, $2)", ["hive_session_events", JSON.stringify({ sessionId, kind: "reply" })]);
  for (const [data] of await Promise.all(replies)) {
    assert.equal(JSON.parse(String(data)).reply.body, "共享的增量文字");
  }
  first.client.close();
  await once(first.client, "close");
  const recovered = await connect(servers[0]);
  assert.equal(recovered.initial.snapshot.session.workspace.liveReply.body, "共享的增量文字");
  assert.equal(recovered.initial.snapshot.session.workspace.liveReply.sequence, 1);

  allowed = false;
  const revoked = [recovered.client, second.client].map((client) => once(client, "close", { signal: AbortSignal.timeout(10_000) }));
  await publisher.query("select pg_notify($1, $2)", ["hive_session_events", JSON.stringify({ sessionId, kind: "reply" })]);
  for (const [code] of await Promise.all(revoked)) assert.equal(code, 4401);
  console.log("PASS: two independent Postgres listeners → two real WebSockets; reconnect snapshot; authorization recheck.");
  console.log("Diagnostic fixtures only. No task data changed; no model called; not a two-account production test.");
} finally {
  for (const client of clients) client.terminate();
  for (const server of servers) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await publisher.end();
}
