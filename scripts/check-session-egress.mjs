// Opt-in integration check. Creates and drops only its own uniquely named local
// database; never uses .env.local, Neon, a real account, sandbox, or model.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { Client, Pool } from "pg";
import { WebSocket, WebSocketServer } from "ws";

const configured = process.env.HIVE_EGRESS_TEST_DATABASE_URL;
if (!configured) throw new Error("Set HIVE_EGRESS_TEST_DATABASE_URL to a local disposable Postgres server.");
const url = new URL(configured);
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search) {
  throw new Error("This check only accepts loopback Postgres with no query overrides, never Neon.");
}
globalThis.fetch = async () => { throw new Error("External HTTP services are forbidden in the egress fixture."); };
const databaseName = `hive_egress_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url.toString() });
url.pathname = `/${databaseName}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_URL_DIRECT = url.toString();
const pool = new Pool({ connectionString: url.toString(), max: 5 });
globalThis.__hiveDatabasePool = pool;
const queries = [];
const query = pool.query.bind(pool);
pool.query = async (...args) => {
  const result = await query(...args);
  queries.push({
    text: typeof args[0] === "string" ? args[0] : args[0].text,
    bytes: Buffer.byteLength(JSON.stringify(result.rows)),
    privateHistory: JSON.stringify(result.rows).includes("private-native-history-fixture"),
  });
  return result;
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next("next/dist/compiled/server-only/empty.js", context);
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier === "@/db") return next(new URL("../src/db/index.ts", import.meta.url).href, context);
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const upgrades = new WeakMap();
mock.module("@vercel/functions", { namedExports: {
  attachDatabasePool: () => {},
  experimental_upgradeWebSocket: (handler) => { const response = new Response(null); upgrades.set(response, handler); return response; },
} });

const servers = [], clients = [];
let created = false;
const waitFor = (target, event) => once(target, event, { signal: AbortSignal.timeout(10_000) });
const nextFrame = (client) => waitFor(client, "message").then(([data]) => JSON.parse(String(data)));
function measure() {
  return {
    taskReads: queries.filter(({ text }) => /from "task_sessions"/i.test(text)).length,
    decodedResultBytes: queries.reduce((total, item) => total + item.bytes, 0),
  };
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const { db } = await import("../src/db/index.ts");
  const { users, authSessions, taskSessions, taskSessionMembers } = await import("../src/db/schema.ts");
  const store = await import("../src/lib/task-session-store.ts");
  const { GET: live } = await import("../src/app/api/sessions/[sessionId]/live/route.ts");
  const { NextRequest } = await import("next/server.js");
  const members = [101, 102].map((id) => ({ id: `github-${id}`, name: `Member ${id}`, shortName: `Member ${id}`, initials: String(id), githubLogin: `member-${id}` }));
  const tokens = members.map(() => randomUUID());
  for (const [index, member] of members.entries()) {
    await db.insert(users).values({ ...member, githubUserId: 101 + index, updatedAt: new Date() });
    await db.insert(authSessions).values({ tokenHash: createHash("sha256").update(tokens[index]).digest("hex"), userId: member.id, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
  }
  const session = await store.createTaskSession("Local egress regression", members[0]);
  await store.joinTaskSession(session.sessionId, members[1].id);
  const privateHistory = "private-native-history-fixture-".repeat(10_000);
  session.workspace.agentSession = { id: "fixture-codex", runtime: "codex", resumeFrom: { type: "resume-session", specificationVersion: "harness-v1", harnessId: "codex", data: { privateHistory } } };
  session.workspace.files = [{ path: "README.md", content: "Shared file evidence" }];
  session.workspace.diff = "+ Shared diff evidence";
  await db.update(taskSessions).set({ workspace: session.workspace }).where(eq(taskSessions.id, session.sessionId));

  async function connect(index) {
    const response = await live(new NextRequest(`https://hive.test/api/sessions/${session.sessionId}/live`, { headers: { origin: "https://hive.test", cookie: `hive_session=${tokens[index]}` } }), { params: Promise.resolve({ sessionId: session.sessionId }) });
    const handle = upgrades.get(response);
    assert.equal(typeof handle, "function", "real auth must admit the fixture member");
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    server.on("connection", (socket) => { void handle(socket); });
    await waitFor(server, "listening");
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(client);
    const initial = nextFrame(client);
    await waitFor(client, "open");
    const frame = await initial;
    assert.equal(frame.type, "snapshot");
    assert.equal(frame.snapshot.session.workspace.diff, "+ Shared diff evidence");
    return client;
  }
  const viewers = await Promise.all([connect(0), connect(1)]);
  queries.length = 0;
  const changed = viewers.map(nextFrame);
  await store.heartbeat(session.sessionId, members[0].id, true);
  const updates = await Promise.all(changed);
  console.log("Heartbeat database result measurement:", measure());
  for (const frame of updates) {
    assert.equal(frame.type, "presence", "idle heartbeats must not refresh the full task for every viewer");
    assert.deepEqual(frame.presence.activeMembers, [members[0].id]);
    assert.deepEqual(frame.presence.typingMembers, [members[0].id]);
    assert.equal(JSON.stringify(frame).includes("workspace"), false);
  }
  assert.equal(measure().taskReads, 0, "presence must not read the task row, even if its public response is filtered later");
  console.log("PASS: real heartbeat → Postgres NOTIFY → two authenticated live-route WebSockets; no full-task read.");

  session.workspace.checkpoints = [{ id: "fixture-snapshot", createdAt: 1, result: { agentSession: session.workspace.agentSession, sandboxName: "fixture-sandbox", summary: "Retained checkpoint", diff: session.workspace.diff, files: session.workspace.files, commands: [], changedFiles: ["README.md"] } }];
  await db.update(taskSessions).set({ workspace: session.workspace }).where(eq(taskSessions.id, session.sessionId));
  queries.length = 0;
  await connect(0);
  console.log("Reconnect database result measurement:", measure());
  assert.equal(queries.some((item) => item.privateHistory), false, "public snapshot SQL must remove native history before it leaves Postgres, not after fetching it");
  const stored = await store.getTaskSessionSnapshot(session.sessionId);
  assert.equal(stored.session.workspace.agentSession.resumeFrom.data.privateHistory, privateHistory, "internal recovery readers must retain the original native context");
  assert.equal(stored.session.workspace.checkpoints[0].result.agentSession.resumeFrom.data.privateHistory, privateHistory, "paired rollback still needs its private native context");
  const empty = await store.createTaskSession("Empty workspace projection", members[0]);
  const publicEmpty = await store.getPublicTaskSessionSnapshot(empty.sessionId);
  assert.deepEqual(publicEmpty.session.workspace.files, []);
  assert.equal(publicEmpty.session.workspace.agentSession, undefined);
  console.log("PASS: reconnect fetches public data only; the separate recovery read retains native history.");

  const revoked = waitFor(viewers[1], "close");
  const remaining = nextFrame(viewers[0]);
  await db.delete(taskSessionMembers).where(eq(taskSessionMembers.memberId, members[1].id));
  await store.heartbeat(session.sessionId, members[0].id, false);
  assert.equal((await revoked)[0], 4401);
  assert.deepEqual((await remaining).presence.typingMembers, []);
  console.log("PASS: the real live route rechecks database membership on presence; a revoked viewer receives no update.");
} finally {
  for (const client of clients) client.terminate();
  for (const server of servers) {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
