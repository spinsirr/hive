// Real route/auth/store behavior against a disposable, loopback-only Postgres DB.
// Only GitHub HTTP and the framework request-cookie boundary are doubled.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createFixturePool } from "./fixture-pool.mjs";
import { transpileModule, JsxEmit, ModuleKind } from "typescript";

const configured = process.env.HIVE_ONBOARDING_TEST_DATABASE_URL;
if (!configured) throw new Error("Set HIVE_ONBOARDING_TEST_DATABASE_URL to a local Postgres server.");
const url = new URL(configured);
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search) {
  throw new Error("Onboarding checks only accept loopback Postgres with no query overrides, never Neon.");
}
const databaseName = `hive_onboarding_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url.toString() });
url.pathname = `/${databaseName}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_URL_DIRECT = url.toString();
process.env.GITHUB_APP_CLIENT_ID = "fixture-client";
process.env.GITHUB_APP_CLIENT_SECRET = "onboarding-local-fixture-not-a-real-secret";
process.env.GITHUB_APP_CALLBACK_URL = "https://hive.test/api/github/callback";
process.env.GITHUB_APP_ID = "1";
process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const { pool, closePool } = createFixturePool({ connectionString: url.toString(), max: 5 });
globalThis.__hiveDatabasePool = pool;
const requestCookies = new AsyncLocalStorage();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next("next/dist/compiled/server-only/empty.js", context);
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier === "next/headers") return next("next/headers.js", context);
  if (specifier === "next/navigation") return next("next/navigation.js", context);
  if (["next/link", "next/dynamic", "next/image"].includes(specifier)) return next(`${specifier}.js`, context);
  if (specifier === "@/db") return next(new URL("../src/db/index.ts", import.meta.url).href, context);
  if (specifier.startsWith("@/")) {
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    const target = ["", ".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((candidate) => existsSync(candidate));
    return next(target?.href ?? specifier, context);
  }
  if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
    const base = new URL(specifier, context.parentURL);
    const target = ["", ".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((candidate) => existsSync(candidate));
    return next(target?.href ?? specifier, context);
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", shortCircuit: true, source: "export default {};" };
  if (!url.endsWith(".tsx")) return next(url, context);
  return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
mock.module("next/headers.js", { namedExports: { cookies: async () => requestCookies.getStore() } });
mock.module("@vercel/functions", { namedExports: {
  attachDatabasePool: () => {},
  experimental_upgradeWebSocket: () => { throw new Error("A stranger must not open the task's live connection."); },
} });

const people = {
  owner: { id: 101, login: "fixture-owner", name: "Owner", avatar_url: null },
  newcomer: { id: 202, login: "fixture-newcomer", name: "Newcomer", avatar_url: null },
};
const githubRepositories = [
  { id: 701, full_name: "shared-org/owner-private", clone_url: "https://github.com/shared-org/owner-private.git", default_branch: "main", private: true },
  { id: 702, full_name: "shared-org/newcomer-private", clone_url: "https://github.com/shared-org/newcomer-private.git", default_branch: "main", private: true },
  { id: 703, full_name: "shared-org/unrelated-private", clone_url: "https://github.com/shared-org/unrelated-private.git", default_branch: "main", private: true },
];
let githubDenied = false;
let repositoryRevoked = false;
globalThis.fetch = async (input, init) => {
  const endpoint = new URL(String(input));
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  if (endpoint.href === "https://github.com/login/oauth/access_token") {
    const { code } = JSON.parse(init.body);
    assert.ok(people[code], "only explicit fixture accounts may sign in");
    return Response.json({ access_token: `fixture-${code}`, expires_in: 28_800 });
  }
  if (endpoint.href === "https://api.github.com/user") {
    const account = authorization.replace("Bearer fixture-", "");
    assert.ok(people[account]);
    return Response.json(people[account]);
  }
  if (endpoint.href === "https://api.github.com/app") return Response.json({ owner: { id: 101 } });
  if (endpoint.pathname === "/app/installations/9001/access_tokens") return Response.json({ token: "fixture-installation", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { contents: "read" }, repository_selection: "all" });
  if (endpoint.pathname === "/installation/repositories") return Response.json({ total_count: 3, repositories: githubRepositories });
  if (endpoint.pathname === "/user/installations") return githubDenied
    ? Response.json({ message: "Bad credentials" }, { status: 401 })
    : Response.json({ total_count: 1, installations: [{ id: 9001 }] });
  if (endpoint.pathname === "/user/installations/9001/repositories") {
    const repositories = repositoryRevoked ? [] : githubRepositories.filter((repo) => repo.id === (authorization === "Bearer fixture-owner" ? 701 : 702));
    return Response.json({ total_count: repositories.length, repositories });
  }
  throw new Error(`External HTTP is forbidden in this fixture: ${endpoint.origin}${endpoint.pathname}`);
};

let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const { NextRequest } = await import("next/server.js");
  const { GET: login } = await import("../src/app/api/github/login/route.ts");
  const { GET: callback } = await import("../src/app/api/github/callback/route.ts");
  const { getSessionMember } = await import("../src/lib/auth-session.ts");
  const store = await import("../src/lib/task-session-store.ts");
  const { createTaskSession } = await import("../src/app/actions.ts");
  const signIn = async (account, returnTo = "/") => {
    const start = await login(new NextRequest(`https://hive.test/api/github/login?return_to=${encodeURIComponent(returnTo)}`));
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const response = await callback(new NextRequest(`https://hive.test/api/github/callback?code=${account}&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `hive_github_oauth=${start.cookies.get("hive_github_oauth").value}` },
    }));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location")).pathname + new URL(response.headers.get("location")).search, returnTo);
    const token = response.cookies.get("hive_session")?.value;
    assert.ok(token);
    return { token, response, member: await getSessionMember(token) };
  };

  const owner = await signIn("owner");
  const privateTask = await store.createTaskSession("Owner's existing private task", owner.member);
  const newcomer = await signIn("newcomer");
  assert.equal(newcomer.member.githubLogin, "fixture-newcomer");
  assert.deepEqual(await store.listTaskSessions(newcomer.member.id), []);
  console.log("PASS: first GitHub login needs no invitation and starts with an empty, isolated dashboard.");

  const form = new FormData();
  form.set("title", "Newcomer's first task");
  form.set("creator", owner.member.id); // The server must ignore caller-supplied identity.
  const cookieJar = { get: (name) => newcomer.response.cookies.get(name) };
  let taskPath;
  await assert.rejects(requestCookies.run(cookieJar, () => createTaskSession(form)), (error) => {
    assert.equal(error.message, "NEXT_REDIRECT");
    taskPath = error.digest.split(";")[2];
    return true;
  });
  const ownTasks = await store.listTaskSessions(newcomer.member.id);
  assert.equal(ownTasks.length, 1);
  assert.equal(taskPath, `/sessions/${ownTasks[0].id}`);
  assert.equal(ownTasks[0].title, "Newcomer's first task");
  assert.equal(ownTasks[0].repository, null);
  assert.equal(await store.isTaskSessionMember(ownTasks[0].id, owner.member.id), false);
  await assert.rejects(requestCookies.run({ get: () => undefined }, () => createTaskSession(form)), /Unauthorized/);
  console.log("PASS: a first-time account creates its own task; creator spoofing and anonymous creation are denied.");

  // Seed the retired fields in this disposable DB: no production rows are rewritten.
  await pool.query("UPDATE task_sessions SET lifecycle = 'completed', completed_at = to_timestamp(1) WHERE id = $1", [ownTasks[0].id]);

  // An old global installation row must never grant a fresh signup repository access.
  const { db } = await import("../src/db/index.ts");
  const { githubInstallations } = await import("../src/db/schema.ts");
  await db.insert(githubInstallations).values({ id: 9001, installedBy: owner.member.id });
  const { GET: repositories, POST: attach } = await import("../src/app/api/github/repositories/route.ts");
  const browserCookie = (signedIn) => signedIn.response.cookies.getAll().filter(({ value }) => value).map(({ name, value }) => `${name}=${value}`).join("; ");
  const list = await repositories(new NextRequest(`https://hive.test/api/github/repositories?session_id=${ownTasks[0].id}`, { headers: { cookie: browserCookie(newcomer) } }));
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).repositories.map(({ name }) => name), ["shared-org/newcomer-private"]);
  console.log("PASS: repository listing uses the signed-in GitHub account's permissions, not the App-wide installation permissions.");

  const crossOrigin = await attach(new NextRequest(`https://hive.test/api/github/repositories?session_id=${privateTask.sessionId}`, {
    method: "POST", headers: { origin: "https://another-site.example", cookie: browserCookie(owner), "Content-Type": "text/plain" },
    body: JSON.stringify({ repositoryId: 701 }),
  }));
  assert.equal(crossOrigin.status, 403, "another site must not attach a repository using the viewer's cookies");

  const attachRequest = (signedIn, id, taskId = ownTasks[0].id) => attach(new NextRequest(`https://hive.test/api/github/repositories?session_id=${taskId}`, {
    method: "POST", headers: { origin: "https://hive.test", cookie: browserCookie(signedIn), "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryId: id, installationId: 9001, actor: owner.member.id, repositoryUrl: githubRepositories[0].clone_url }),
  }));
  for (const id of [701, 703, 9999]) assert.equal((await attachRequest(newcomer, id)).status, 403);
  assert.equal((await attachRequest(newcomer, 702, privateTask.sessionId)).status, 404);
  assert.equal((await store.getPublicTaskSessionSnapshot(ownTasks[0].id)).session.repository, undefined);
  repositoryRevoked = true;
  assert.equal((await attachRequest(newcomer, 702)).status, 403, "attach rechecks GitHub after the picker was loaded");
  repositoryRevoked = false;
  githubDenied = true;
  assert.equal((await attachRequest(newcomer, 702)).status, 409);
  githubDenied = false;
  assert.equal((await attachRequest(newcomer, 702)).status, 200);
  const attached = (await store.getPublicTaskSessionSnapshot(ownTasks[0].id)).session.repository;
  assert.equal(attached.name, "shared-org/newcomer-private");
  assert.equal(attached.connectedBy, newcomer.member.id);
  assert.equal(attached.authorizedByGitHub.login, "fixture-newcomer");
  assert.equal((await attachRequest(newcomer, 702)).status, 409);
  console.log("PASS: forged/revoked repositories and foreign tasks cannot be attached; a valid attachment retains the authenticated author.");

  const { GET: snapshot, POST: action } = await import("../src/app/api/sessions/[sessionId]/route.ts");
  const { GET: files } = await import("../src/app/api/sessions/[sessionId]/files/route.ts");
  const { GET: checkpoints, POST: restore } = await import("../src/app/api/sessions/[sessionId]/checkpoints/route.ts");
  const { GET: live } = await import("../src/app/api/sessions/[sessionId]/live/route.ts");
  const ownContext = { params: Promise.resolve({ sessionId: ownTasks[0].id }) };
  const ownUrl = `https://hive.test/api/sessions/${ownTasks[0].id}`;
  const ownHeaders = { cookie: browserCookie(newcomer), origin: "https://hive.test", "Content-Type": "application/json" };
  const ownSnapshot = await (await snapshot(new NextRequest(ownUrl, { headers: ownHeaders }), ownContext)).json();
  assert.equal("lifecycle" in ownSnapshot.session, false);
  assert.equal("completedAt" in ownSnapshot.session, false);
  assert.ok((await store.listTaskSessions(newcomer.member.id)).some((task) => task.id === ownTasks[0].id));
  for (const type of ["complete-session", "reopen-session"]) {
    const retired = await action(new NextRequest(ownUrl, { method: "POST", headers: ownHeaders, body: JSON.stringify({ type }) }), ownContext);
    assert.equal(retired.status, 400, "Retired actions must not silently change the task");
  }
  const discussed = await action(new NextRequest(ownUrl, {
    method: "POST", headers: ownHeaders,
    body: JSON.stringify({ type: "annotate-message", messageId: ownSnapshot.session.messages[0].id, body: "Continue reviewing this task", clientId: randomUUID(), actor: owner.member.id }),
  }), ownContext);
  assert.equal(discussed.status, 200);
  const discussion = (await discussed.json()).session;
  assert.equal(discussion.stage, ownSnapshot.session.stage);
  assert.equal(discussion.version, ownSnapshot.session.version + 1);
  assert.equal(discussion.messages[0].annotations.at(-1).authorId, newcomer.member.id);
  assert.equal(discussion.messages[0].annotations.at(-1).body, "Continue reviewing this task");
  assert.deepEqual(discussion.workspace, ownSnapshot.session.workspace);
  const legacy = await pool.query("SELECT lifecycle, completed_at FROM task_sessions WHERE id = $1", [ownTasks[0].id]);
  assert.equal(legacy.rows[0].lifecycle, "completed");
  assert.equal(legacy.rows[0].completed_at.getTime(), 1000);
  console.log("PASS: retired completion fields do not hide or lock a task; repository attach and attributed discussion work without rewriting historical values, while old actions are rejected.");

  const foreignContext = { params: Promise.resolve({ sessionId: privateTask.sessionId }) };
  for (const [suffix, handler, method] of [["", snapshot, "GET"], ["", action, "POST"], ["/files?kind=directory", files, "GET"], ["/checkpoints", checkpoints, "GET"], ["/checkpoints", restore, "POST"], ["/live", live, "GET"]]) {
    const denied = await handler(new NextRequest(`https://hive.test/api/sessions/${privateTask.sessionId}${suffix}`, {
      method, headers: { cookie: browserCookie(newcomer), origin: "https://hive.test", "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ type: "advance-run", actor: owner.member.id }) } : {}),
    }), foreignContext);
    assert.ok([401, 403, 404].includes(denied.status), `${suffix || "/task"} must deny non-members`);
    assert.doesNotMatch(await denied.text(), /Owner's existing private task/);
  }
  console.log("PASS: task content, mutations, files, checkpoints, restore and live connections reject a signed-in non-member.");

  const { default: SessionPage } = await import("../src/app/sessions/[sessionId]/page.tsx");
  const { createSessionInviteToken } = await import("../src/lib/session-invite.ts");
  const visitTask = (invite) => requestCookies.run(cookieJar, () => SessionPage({ ...foreignContext, searchParams: Promise.resolve({ invite }) }));
  for (const invite of [undefined, "forged", ["ambiguous", "invitation"], createSessionInviteToken(ownTasks[0].id)]) {
    await assert.rejects(visitTask(invite), /NEXT_HTTP_ERROR_FALLBACK;404/);
  }
  await visitTask(createSessionInviteToken(privateTask.sessionId));
  assert.equal((await store.listTaskSessions(newcomer.member.id)).length, 2);
  const shared = await snapshot(new NextRequest(`https://hive.test/api/sessions/${privateTask.sessionId}`, { headers: { cookie: browserCookie(newcomer) } }), foreignContext);
  assert.equal(shared.status, 200);
  const afterInvite = await repositories(new NextRequest(`https://hive.test/api/github/repositories?session_id=${privateTask.sessionId}`, { headers: { cookie: browserCookie(newcomer) } }));
  assert.deepEqual((await afterInvite.json()).repositories.map(({ id }) => id), [702]);
  console.log("PASS: only a valid task invitation admits a teammate; joining still does not inherit the inviter's GitHub permissions.");

  const repositoryUrl = `https://hive.test/api/github/repositories?session_id=${ownTasks[0].id}`;
  const repositoryCookie = newcomer.response.cookies.get("hive_github_user");
  assert.ok(repositoryCookie.httpOnly);
  assert.ok(repositoryCookie.secure);
  assert.equal(repositoryCookie.sameSite, "lax");
  assert.equal(repositoryCookie.path, "/api/github");
  assert.doesNotMatch(repositoryCookie.value, /fixture-newcomer/);
  for (const encrypted of [undefined, `${repositoryCookie.value}tampered`, owner.response.cookies.get("hive_github_user").value]) {
    const response = await repositories(new NextRequest(repositoryUrl, { headers: { cookie: `hive_session=${newcomer.token}${encrypted ? `; hive_github_user=${encrypted}` : ""}` } }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).needsAuthorization, true);
  }
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    mock.timers.tick(9 * 60 * 60 * 1000);
    const expired = await repositories(new NextRequest(repositoryUrl, { headers: { cookie: browserCookie(newcomer) } }));
    assert.equal(expired.status, 409);
    assert.equal((await expired.json()).needsAuthorization, true);
    assert.ok(await getSessionMember(newcomer.token), "GitHub expiry does not delete the independent Hive login");
  } finally { mock.timers.reset(); }
  console.log("PASS: missing, tampered, expired and cross-account GitHub credentials fail closed with a reconnect path.");

  const { POST: logout } = await import("../src/app/api/auth/logout/route.ts");
  const loggedOut = await logout(new NextRequest("https://hive.test/api/auth/logout", { method: "POST", headers: { cookie: browserCookie(newcomer) } }));
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.cookies.get("hive_github_user").maxAge, 0);
  assert.equal(await getSessionMember(newcomer.token), null);
  assert.ok(await getSessionMember(owner.token));
  console.log("PASS: logout revokes this login and clears GitHub access without signing out another account.");
} finally {
  await closePool();
  // Pool shutdown can precede socket close; FORCE would kill those closing clients.
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
