// Opt-in integration check. Creates and drops only its own uniquely named local
// database; never uses .env.local, Neon, a real account, sandbox, or model.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once, on } from "node:events";
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
const notifications = [];
const clientQuery = Client.prototype.query;
Client.prototype.query = function (...args) {
  const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
  if (/pg_notify/i.test(text ?? "")) {
    const values = Array.isArray(args[1]) ? args[1] : args[0]?.values;
    notifications.push({ payloadBytes: Buffer.byteLength(values?.[1] ?? "") });
  }
  return clientQuery.apply(this, args);
};
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
const nextFrame = async (client, predicate = () => true) => {
  for await (const [data] of on(client, "message", { signal: AbortSignal.timeout(10_000) })) {
    const frame = JSON.parse(String(data));
    if (predicate(frame)) return frame;
  }
};
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
  // Allow the idle measurement and host scheduling delays; actual expiry is tested below.
  const fixtureExpiresAt = new Date(Date.now() + 10 * 60_000);
  for (const [index, member] of members.entries()) {
    await db.insert(users).values({ ...member, githubUserId: 101 + index, updatedAt: new Date() });
    await db.insert(authSessions).values({ tokenHash: createHash("sha256").update(tokens[index]).digest("hex"), userId: member.id, createdAt: new Date(), expiresAt: fixtureExpiresAt });
  }
  const session = await store.createTaskSession("Local egress regression", members[0]);
  await store.joinTaskSession(session.sessionId, members[1].id);
  const privateHistory = "private-native-history-fixture-".repeat(10_000);
  session.workspace.agentSession = { id: "fixture-codex", runtime: "codex", resumeFrom: { type: "resume-session", specificationVersion: "harness-v1", harnessId: "codex", data: { privateHistory } } };
  session.workspace.files = [{ path: "README.md", content: "Shared file evidence" }];
  session.workspace.diff = "+ Shared diff evidence";
  await db.update(taskSessions).set({ workspace: session.workspace }).where(eq(taskSessions.id, session.sessionId));

  async function connect(index) {
    assert.ok(Date.now() < fixtureExpiresAt.getTime(), "Local test identity expired while the host was paused; rerun this isolated fixture.");
    const response = await live(new NextRequest(`https://hive.test/api/sessions/${session.sessionId}/live`, { headers: { origin: "https://hive.test", cookie: `hive_session=${tokens[index]}` } }), { params: Promise.resolve({ sessionId: session.sessionId }) });
    const handle = upgrades.get(response);
    assert.equal(typeof handle, "function", "real auth must admit the fixture member");
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    server.on("connection", (socket) => { void handle(socket); });
    await waitFor(server, "listening");
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(client);
    const initial = nextFrame(client, (frame) => frame.type === "snapshot");
    await waitFor(client, "open");
    const frame = await initial;
    assert.equal(frame.type, "snapshot");
    assert.equal(frame.snapshot.session.workspace.diff, "+ Shared diff evidence");
    return client;
  }
  const viewers = await Promise.all([connect(0), connect(1)]);
  queries.length = 0;
  const changed = viewers.map((client) => nextFrame(client, (frame) => frame.type === "presence" && frame.presence.typingMembers.includes(members[0].id)));
  viewers[0].send(JSON.stringify({ type: "typing", typing: true }));
  const updates = await Promise.all(changed);
  console.log("Typing-change database result measurement:", measure());
  for (const frame of updates) {
    assert.equal(frame.type, "presence", "typing must not refresh the full task for every viewer");
    assert.deepEqual(frame.presence.activeMembers, members.map((member) => member.id));
    assert.deepEqual(frame.presence.typingMembers, [members[0].id]);
    assert.equal(JSON.stringify(frame).includes("workspace"), false);
  }
  assert.equal(measure().taskReads, 0, "presence must not read the task row, even if its public response is filtered later");
  assert.equal(queries.some(({ text }) => /task_session_presence/i.test(text)), false);
  console.log("PASS: typing through real authenticated WebSockets; no presence-table or full-task read.");

  queries.length = 0;
  notifications.length = 0;
  console.log("Measuring 31 seconds of idle connections, including native ping/pong and one instance renewal…");
  const idleStartedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 31_000));
  console.log("Idle measurement:", { elapsedMs: Date.now() - idleStartedAt, ...measure(), notifications: notifications.length, notificationPayloadBytes: notifications.reduce((sum, item) => sum + item.payloadBytes, 0) });
  assert.equal(queries.length, 0, "idle probes and unchanged renewal must not read/write any task, auth, or presence tables");
  assert.equal(notifications.length, 1, "one shared instance renewal, not one heartbeat per browser");
  console.log("PASS: idle viewers cause zero pooled table queries; only the bounded ephemeral NOTIFY renewal remains.");

  session.workspace.checkpoints = [{ id: "fixture-snapshot", createdAt: 1, result: { agentSession: session.workspace.agentSession, sandboxName: "fixture-sandbox", summary: "Retained checkpoint", diff: session.workspace.diff, files: session.workspace.files, commands: [], changedFiles: ["README.md"] } }];
  await db.update(taskSessions).set({ workspace: session.workspace }).where(eq(taskSessions.id, session.sessionId));
  queries.length = 0;
  const anotherTab = await connect(0);
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
  const remaining = nextFrame(viewers[0], (frame) => frame.type === "presence" && frame.presence.activeMembers.length === 1 && !frame.presence.typingMembers.length);
  await db.delete(taskSessionMembers).where(eq(taskSessionMembers.memberId, members[1].id));
  viewers[0].send(JSON.stringify({ type: "typing", typing: false }));
  assert.equal((await revoked)[0], 4401);
  assert.deepEqual((await remaining).presence.typingMembers, []);
  console.log("PASS: the real live route rechecks database membership on presence; a revoked viewer receives no update.");
  const tabRemains = nextFrame(anotherTab, (frame) => frame.type === "presence");
  viewers[0].close();
  assert.deepEqual((await tabRemains).presence.activeMembers, [members[0].id]);
  console.log("PASS: closing one real tab preserves the same account's remaining connection.");
  const expired = waitFor(anotherTab, "close");
  await db.update(authSessions).set({ expiresAt: new Date(0) }).where(eq(authSessions.userId, members[0].id));
  anotherTab.send(JSON.stringify({ type: "typing", typing: true }));
  assert.equal((await expired)[0], 4401);
  console.log("PASS: an expired real database login closes its existing socket before accepting typing.");

  // Agent capability checks use the same real store/route, not a mocked reader.
  const { createHiveToolToken } = await import("../src/lib/hive-tool-token.ts");
  const { POST: agentTool } = await import("../src/app/api/sessions/[sessionId]/agent-tools/route.ts");
  process.env.HIVE_INVITE_SECRET = "controlled-agent-tool-fixture-not-a-real-secret";
  delete process.env.MEM0_API_KEY;
  const toolScope = { sessionId: session.sessionId, memberId: members[0].id, runId: "fixture-active-run" };
  const toolWorkspace = { ...session.workspace, status: "running", liveReply: { id: toolScope.runId, body: "", sequence: 0, startedAt: Date.now() } };
  const toolMessage = { id: "fixture-human-message", role: "human", memberId: members[0].id, name: members[0].name, initials: members[0].initials, body: "Use pnpm for this repository.", time: "now" };
  await db.update(taskSessions).set({ stage: "running", workspace: toolWorkspace, messages: [toolMessage] }).where(eq(taskSessions.id, session.sessionId));
  queries.length = 0;
  const toolContext = await store.readHiveToolContext(toolScope);
  assert.equal(toolContext.members[0].name, members[0].name);
  assert.equal(toolContext.workspace.liveReply.id, toolScope.runId);
  assert.equal(toolContext.workspace.files, undefined);
  assert.equal(queries.some((item) => item.privateHistory), false);
  console.log("PASS: real tool-context SQL excludes file artifacts and private native history before transferring results.");

  const capability = createHiveToolToken(toolScope, process.env.HIVE_INVITE_SECRET);
  const call = (body, token = capability) => agentTool(new Request(`https://hive.test/api/sessions/${session.sessionId}/agent-tools`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ sessionId: session.sessionId }) });
  queries.length = 0;
  assert.equal((await call({}, "invalid")).status, 401);
  const foreign = createHiveToolToken({ ...toolScope, sessionId: "different-task" }, process.env.HIVE_INVITE_SECRET);
  assert.equal((await call({}, foreign)).status, 401);
  assert.equal((await call(" ".repeat(16_385))).status, 413);
  assert.equal(queries.length, 0, "invalid capabilities and oversized bodies must fail before querying Postgres");
  const rpc = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "reply_to_thread", arguments: { messageId: toolMessage.id, body: "Should pnpm also apply to CI?" } } };
  for (let retry = 0; retry < 2; retry++) {
    const response = await call(rpc);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.isError, undefined);
  }
  const afterReply = (await store.getTaskSessionSnapshot(session.sessionId)).session;
  assert.equal(afterReply.messages[0].annotations.length, 1, "a retried tool request must not post a second reply");
  assert.equal(afterReply.messages[0].annotations[0].role, "agent");
  assert.equal(afterReply.messages[0].annotations[0].authorId, "hive-agent");
  assert.equal(afterReply.stage, "running");
  assert.deepEqual(afterReply.steeringQueue, session.steeringQueue);
  assert.deepEqual(afterReply.workspace, toolWorkspace, "replying must not overwrite the active stream, checkpoints, or code artifacts");
  assert.equal(afterReply.version, toolContext.version + 1);
  console.log("PASS: real signed route stores one attributed Hive reply on retry, with no queue/run/history mutation.");
  const stale = createHiveToolToken({ ...toolScope, runId: "previous-run" }, process.env.HIVE_INVITE_SECRET);
  assert.equal((await (await call({ ...rpc, id: 8 }, stale)).json()).result.isError, true);
  await db.delete(taskSessionMembers).where(eq(taskSessionMembers.memberId, members[0].id));
  assert.equal((await (await call({ ...rpc, id: 9 })).json()).result.isError, true);
  assert.equal((await store.getTaskSessionSnapshot(session.sessionId)).session.messages[0].annotations.length, 1);
  console.log("PASS: ended-run and revoked-member capabilities cannot add another reply even before token expiry.");
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
