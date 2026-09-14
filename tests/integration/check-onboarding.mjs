import { createTestDatabase } from "../helpers/test-database.mjs";
import { registerTestModules } from "../helpers/test-modules.mjs";
// Real route/auth/store behavior against a disposable, loopback-only Postgres DB.
// Only GitHub HTTP and the framework request-cookie boundary are doubled.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { generateKeyPairSync, randomUUID } from "node:crypto";

import { mock } from "node:test";

const database = createTestDatabase(
  process.env.HIVE_ONBOARDING_TEST_DATABASE_URL,
  "hive_onboarding_test"
);
const { pool } = database;
process.env.GITHUB_APP_CLIENT_ID = "fixture-client";
process.env.GITHUB_APP_CLIENT_SECRET =
  "onboarding-local-fixture-not-a-real-secret";
process.env.GITHUB_APP_CALLBACK_URL = "https://hive.test/api/github/callback";
process.env.GITHUB_APP_ID = "1";
process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey.export({ type: "pkcs8", format: "pem" });

const requestCookies = new AsyncLocalStorage();
registerTestModules({
  load(url, context, next) {
    if (url.endsWith(".css"))
      return {
        format: "module",
        shortCircuit: true,
        source: "export default {};",
      };
    return next(url, context);
  },
});
mock.module("next/headers.js", {
  namedExports: { cookies: async () => requestCookies.getStore() },
});
mock.module("@vercel/functions", {
  namedExports: {
    attachDatabasePool: () => {},
    experimental_upgradeWebSocket: () => {
      throw new Error("A stranger must not open the task's live connection.");
    },
  },
});

const people = {
  owner: { id: 101, login: "fixture-owner", name: "Owner", avatar_url: null },
  newcomer: {
    id: 202,
    login: "fixture-newcomer",
    name: "Newcomer",
    avatar_url: null,
  },
};
const githubRepositories = [
  {
    id: 701,
    full_name: "shared-org/owner-private",
    clone_url: "https://github.com/shared-org/owner-private.git",
    default_branch: "main",
    private: true,
  },
  {
    id: 702,
    full_name: "shared-org/newcomer-private",
    clone_url: "https://github.com/shared-org/newcomer-private.git",
    default_branch: "main",
    private: true,
  },
  {
    id: 703,
    full_name: "shared-org/unrelated-private",
    clone_url: "https://github.com/shared-org/unrelated-private.git",
    default_branch: "main",
    private: true,
  },
];
let githubDenied = false;
let repositoryRevoked = false;
globalThis.fetch = async (input, init) => {
  const endpoint = new URL(String(input));
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  if (endpoint.href === "https://github.com/login/oauth/access_token") {
    const { code } = JSON.parse(init.body);
    assert.ok(people[code], "only explicit fixture accounts may sign in");
    return Response.json({
      access_token: `fixture-${code}`,
      expires_in: 28_800,
    });
  }
  if (endpoint.href === "https://api.github.com/user") {
    const account = authorization.replace("Bearer fixture-", "");
    assert.ok(people[account]);
    return Response.json(people[account]);
  }
  if (endpoint.href === "https://api.github.com/app")
    return Response.json({ owner: { id: 101 } });
  if (endpoint.pathname === "/app/installations/9001/access_tokens")
    return Response.json({
      token: "fixture-installation",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      permissions: { contents: "read" },
      repository_selection: "all",
    });
  if (endpoint.pathname === "/installation/repositories")
    return Response.json({ total_count: 3, repositories: githubRepositories });
  if (endpoint.pathname === "/user/installations")
    return githubDenied
      ? Response.json({ message: "Bad credentials" }, { status: 401 })
      : Response.json({ total_count: 1, installations: [{ id: 9001 }] });
  if (endpoint.pathname === "/user/installations/9001/repositories") {
    const repositories = repositoryRevoked
      ? []
      : githubRepositories.filter(
          (repo) =>
            repo.id === (authorization === "Bearer fixture-owner" ? 701 : 702)
        );
    return Response.json({ total_count: repositories.length, repositories });
  }
  throw new Error(
    `External HTTP is forbidden in this fixture: ${endpoint.origin}${endpoint.pathname}`
  );
};

try {
  await database.start();
  const { NextRequest } = await import("next/server.js");
  const { GET: login } =
    await import("../../src/app/api/github/login/route.ts");
  const { GET: callback } =
    await import("../../src/app/api/github/callback/route.ts");
  const { getSessionMember } =
    await import("../../src/server/auth/auth-session.ts");
  const store = await import("../../src/server/sessions/task-session-store.ts");
  const { createTaskSession } = await import("../../src/app/actions.ts");
  const signIn = async (account, returnTo = "/") => {
    const start = await login(
      new NextRequest(
        `https://hive.test/api/github/login?return_to=${encodeURIComponent(returnTo)}`
      )
    );
    const state = new URL(start.headers.get("location")).searchParams.get(
      "state"
    );
    const response = await callback(
      new NextRequest(
        `https://hive.test/api/github/callback?code=${account}&state=${encodeURIComponent(state)}`,
        {
          headers: {
            cookie: `hive_github_oauth=${start.cookies.get("hive_github_oauth").value}`,
          },
        }
      )
    );
    assert.equal(response.status, 307);
    assert.equal(
      new URL(response.headers.get("location")).pathname +
        new URL(response.headers.get("location")).search,
      returnTo
    );
    const token = response.cookies.get("hive_session")?.value;
    assert.ok(token);
    return { token, response, member: await getSessionMember(token) };
  };

  const owner = await signIn("owner");
  const privateTask = await store.createTaskSession(
    "Owner's existing private task",
    owner.member
  );
  const newcomer = await signIn("newcomer");
  assert.equal(newcomer.member.githubLogin, "fixture-newcomer");
  assert.deepEqual(await store.listTaskSessions(newcomer.member.id), []);
  console.log(
    "PASS: first GitHub login needs no invitation and starts with an empty, isolated dashboard."
  );

  const untouched = await store.getPublicTaskSessionSnapshot(
    privateTask.sessionId
  );
  await assert.rejects(
    store.applyTaskSessionAction(
      privateTask.sessionId,
      {
        type: "send-message",
        actor: newcomer.member.id,
        body: "Must not enter another task",
        clientId: randomUUID(),
      },
      newcomer.member
    ),
    /access to this task/i
  );
  await assert.rejects(
    store.applyTaskSessionAction(
      privateTask.sessionId,
      {
        type: "send-message",
        actor: owner.member.id,
        body: "Must not impersonate the owner",
        clientId: randomUUID(),
      },
      newcomer.member
    ),
    /access to this task/i
  );
  await assert.rejects(
    store.applyTaskSessionAction(privateTask.sessionId, {
      type: "send-message",
      actor: owner.member.id,
      body: "An actor ID alone is not an authenticated identity",
      clientId: randomUUID(),
    }),
    /access to this task/i
  );
  await assert.rejects(
    store.startTaskWorkspaceRestore(
      privateTask.sessionId,
      {
        id: randomUUID(),
        snapshotId: "foreign-checkpoint",
        version: privateTask.version,
      },
      newcomer.member
    ),
    /access to this task/i
  );
  assert.deepEqual(
    await store.getPublicTaskSessionSnapshot(privateTask.sessionId),
    untouched
  );
  console.log(
    "PASS: task writes enforce membership at the storage boundary, not just the HTTP route."
  );

  const form = new FormData();
  form.set("creator", owner.member.id); // The server must ignore caller-supplied identity.
  const cookieJar = { get: (name) => newcomer.response.cookies.get(name) };
  let taskPath;
  await assert.rejects(
    requestCookies.run(cookieJar, () => createTaskSession(form)),
    (error) => {
      assert.equal(error.message, "NEXT_REDIRECT");
      taskPath = error.digest.split(";")[2];
      return true;
    }
  );
  const ownTasks = await store.listTaskSessions(newcomer.member.id);
  assert.equal(ownTasks.length, 1);
  assert.equal(taskPath, `/sessions/${ownTasks[0].id}`);
  assert.equal(
    ownTasks[0].title,
    "",
    "creation needs no manually supplied title"
  );
  assert.equal(ownTasks[0].repository, null);
  const newSession = (await store.getPublicTaskSessionSnapshot(ownTasks[0].id))
    .session;
  assert.deepEqual(
    newSession.messages,
    [],
    "authenticated creation starts an empty conversation, not a fabricated agent reply"
  );
  assert.equal(newSession.stage, "waiting");
  assert.equal(
    await store.isTaskSessionMember(ownTasks[0].id, owner.member.id),
    false
  );
  await assert.rejects(
    requestCookies.run({ get: () => undefined }, () => createTaskSession(form)),
    /Unauthorized/
  );
  console.log(
    "PASS: a first-time account creates its own task; creator spoofing and anonymous creation are denied."
  );

  // Seed the retired fields in this disposable DB: no production rows are rewritten.
  await pool.query(
    "UPDATE task_sessions SET lifecycle = 'completed', completed_at = to_timestamp(1) WHERE id = $1",
    [ownTasks[0].id]
  );

  // An old global installation row must never grant a fresh signup repository access.
  const { db } = await import("../../src/db/index.ts");
  const { githubInstallations } = await import("../../src/db/schema.ts");
  await db
    .insert(githubInstallations)
    .values({ id: 9001, installedBy: owner.member.id });
  const { GET: repositories, POST: attach } =
    await import("../../src/app/api/github/repositories/route.ts");
  const browserCookie = (signedIn) =>
    signedIn.response.cookies
      .getAll()
      .filter(({ value }) => value)
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
  const list = await repositories(
    new NextRequest(
      `https://hive.test/api/github/repositories?session_id=${ownTasks[0].id}`,
      { headers: { cookie: browserCookie(newcomer) } }
    )
  );
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).repositories.map(({ name }) => name),
    ["shared-org/newcomer-private"]
  );
  console.log(
    "PASS: repository listing uses the signed-in GitHub account's permissions, not the App-wide installation permissions."
  );

  const crossOrigin = await attach(
    new NextRequest(
      `https://hive.test/api/github/repositories?session_id=${privateTask.sessionId}`,
      {
        method: "POST",
        headers: {
          origin: "https://another-site.example",
          cookie: browserCookie(owner),
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({ repositoryId: 701 }),
      }
    )
  );
  assert.equal(
    crossOrigin.status,
    403,
    "another site must not attach a repository using the viewer's cookies"
  );

  const attachRequest = (signedIn, id, taskId = ownTasks[0].id) =>
    attach(
      new NextRequest(
        `https://hive.test/api/github/repositories?session_id=${taskId}`,
        {
          method: "POST",
          headers: {
            origin: "https://hive.test",
            cookie: browserCookie(signedIn),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repositoryId: id,
            installationId: 9001,
            actor: owner.member.id,
            repositoryUrl: githubRepositories[0].clone_url,
          }),
        }
      )
    );
  for (const id of [701, 703, 9999])
    assert.equal((await attachRequest(newcomer, id)).status, 403);
  assert.equal(
    (await attachRequest(newcomer, 702, privateTask.sessionId)).status,
    404
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(ownTasks[0].id)).session
      .repository,
    undefined
  );
  repositoryRevoked = true;
  assert.equal(
    (await attachRequest(newcomer, 702)).status,
    403,
    "attach rechecks GitHub after the picker was loaded"
  );
  repositoryRevoked = false;
  githubDenied = true;
  assert.equal((await attachRequest(newcomer, 702)).status, 409);
  githubDenied = false;
  assert.equal((await attachRequest(newcomer, 702)).status, 200);
  const attached = (await store.getPublicTaskSessionSnapshot(ownTasks[0].id))
    .session.repository;
  assert.equal(attached.name, "shared-org/newcomer-private");
  assert.equal(attached.connectedBy, newcomer.member.id);
  assert.equal(attached.authorizedByGitHub.login, "fixture-newcomer");
  assert.equal((await attachRequest(newcomer, 702)).status, 409);
  console.log(
    "PASS: forged/revoked repositories and foreign tasks cannot be attached; a valid attachment retains the authenticated author."
  );

  const { GET: snapshot, POST: action } =
    await import("../../src/app/api/sessions/[sessionId]/route.ts");
  const { GET: files } =
    await import("../../src/app/api/sessions/[sessionId]/files/route.ts");
  const { GET: checkpoints, POST: restore } =
    await import("../../src/app/api/sessions/[sessionId]/checkpoints/route.ts");
  const { GET: live } =
    await import("../../src/app/api/sessions/[sessionId]/live/route.ts");
  const ownContext = { params: Promise.resolve({ sessionId: ownTasks[0].id }) };
  const ownUrl = `https://hive.test/api/sessions/${ownTasks[0].id}`;
  const ownHeaders = {
    cookie: browserCookie(newcomer),
    origin: "https://hive.test",
    "Content-Type": "application/json",
  };
  const ownSnapshot = await (
    await snapshot(new NextRequest(ownUrl, { headers: ownHeaders }), ownContext)
  ).json();
  for (const origin of ["https://untrusted.hive.test", undefined]) {
    const headers = new Headers(ownHeaders);
    if (origin) headers.set("origin", origin);
    else headers.delete("origin");
    const rejected = await action(
      new NextRequest(ownUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "annotate-message",
          messageId: ownSnapshot.session.messages[0].id,
          body: "Must not be submitted by another origin",
          clientId: randomUUID(),
        }),
      }),
      ownContext
    );
    assert.equal(rejected.status, 403);
  }
  assert.deepEqual(
    (
      await (
        await snapshot(
          new NextRequest(ownUrl, { headers: ownHeaders }),
          ownContext
        )
      ).json()
    ).session,
    ownSnapshot.session
  );
  console.log(
    "PASS: even a valid login cannot mutate tasks through a foreign or missing browser origin."
  );
  assert.equal("lifecycle" in ownSnapshot.session, false);
  assert.equal("completedAt" in ownSnapshot.session, false);
  assert.ok(
    (await store.listTaskSessions(newcomer.member.id)).some(
      (task) => task.id === ownTasks[0].id
    )
  );
  for (const type of ["complete-session", "reopen-session", "advance-run"]) {
    const retired = await action(
      new NextRequest(ownUrl, {
        method: "POST",
        headers: ownHeaders,
        body: JSON.stringify({ type }),
      }),
      ownContext
    );
    assert.equal(
      retired.status,
      400,
      "Retired actions must not silently change the task"
    );
  }
  const discussed = await action(
    new NextRequest(ownUrl, {
      method: "POST",
      headers: ownHeaders,
      body: JSON.stringify({
        type: "annotate-message",
        messageId: ownSnapshot.session.messages[0].id,
        body: "Continue reviewing this task",
        clientId: randomUUID(),
        actor: owner.member.id,
      }),
    }),
    ownContext
  );
  assert.equal(discussed.status, 200);
  const discussion = (await discussed.json()).session;
  assert.equal(discussion.stage, ownSnapshot.session.stage);
  assert.equal(discussion.version, ownSnapshot.session.version + 1);
  assert.equal(
    discussion.messages[0].annotations.at(-1).authorId,
    newcomer.member.id
  );
  assert.equal(
    discussion.messages[0].annotations.at(-1).body,
    "Continue reviewing this task"
  );
  assert.deepEqual(discussion.workspace, ownSnapshot.session.workspace);
  const legacy = await pool.query(
    "SELECT lifecycle, completed_at FROM task_sessions WHERE id = $1",
    [ownTasks[0].id]
  );
  assert.equal(legacy.rows[0].lifecycle, "completed");
  assert.equal(legacy.rows[0].completed_at.getTime(), 1000);
  console.log(
    "PASS: retired completion fields do not hide or lock a task; repository attach and attributed discussion work without rewriting historical values, while old actions are rejected."
  );

  for (const title of [null, "", " ", "x".repeat(121)]) {
    const invalid = await action(
      new NextRequest(ownUrl, {
        method: "POST",
        headers: ownHeaders,
        body: JSON.stringify({ type: "rename-task", title }),
      }),
      ownContext
    );
    assert.equal(invalid.status, 400);
  }
  const renamedResponse = await action(
    new NextRequest(ownUrl, {
      method: "POST",
      headers: ownHeaders,
      body: JSON.stringify({
        type: "rename-task",
        title: "  My task name  ",
        actor: owner.member.id,
      }),
    }),
    ownContext
  );
  assert.equal(renamedResponse.status, 200);
  const renamedSession = (await renamedResponse.json()).session;
  assert.equal(renamedSession.title, "My task name");
  assert.equal(renamedSession.sessionId, ownTasks[0].id);
  assert.deepEqual(renamedSession.messages, discussion.messages);
  assert.deepEqual(renamedSession.workspace, discussion.workspace);
  assert.equal(
    (await store.listTaskSessions(newcomer.member.id)).find(
      (task) => task.id === ownTasks[0].id
    ).title,
    "My task name"
  );
  const forbiddenRename = await action(
    new NextRequest(ownUrl, {
      method: "POST",
      headers: { ...ownHeaders, cookie: browserCookie(owner) },
      body: JSON.stringify({ type: "rename-task", title: "Foreign rename" }),
    }),
    ownContext
  );
  assert.equal(forbiddenRename.status, 401);
  console.log(
    "PASS: unnamed creation and authenticated rename keep the link, conversation and workspace stable; invalid names and foreign members are denied."
  );

  const foreignContext = {
    params: Promise.resolve({ sessionId: privateTask.sessionId }),
  };
  for (const [suffix, handler, method] of [
    ["", snapshot, "GET"],
    ["", action, "POST"],
    ["/files?kind=directory", files, "GET"],
    ["/checkpoints", checkpoints, "GET"],
    ["/checkpoints", restore, "POST"],
    ["/live", live, "GET"],
  ]) {
    const denied = await handler(
      new NextRequest(
        `https://hive.test/api/sessions/${privateTask.sessionId}${suffix}`,
        {
          method,
          headers: {
            cookie: browserCookie(newcomer),
            origin: "https://hive.test",
            "Content-Type": "application/json",
          },
          ...(method === "POST"
            ? {
                body: JSON.stringify({ type: "reset", actor: owner.member.id }),
              }
            : {}),
        }
      ),
      foreignContext
    );
    assert.ok(
      [401, 403, 404].includes(denied.status),
      `${suffix || "/task"} must deny non-members`
    );
    assert.doesNotMatch(await denied.text(), /Owner's existing private task/);
  }
  console.log(
    "PASS: task content, mutations, files, checkpoints, restore and live connections reject a signed-in non-member."
  );

  const { default: SessionPage } =
    await import("../../src/app/sessions/[sessionId]/page.tsx");
  const { createSessionInviteToken } =
    await import("../../src/server/sessions/session-invite.ts");
  const visitTask = (invite) =>
    requestCookies.run(cookieJar, () =>
      SessionPage({
        ...foreignContext,
        searchParams: Promise.resolve({ invite }),
      })
    );
  for (const invite of [
    undefined,
    "forged",
    ["ambiguous", "invitation"],
    createSessionInviteToken(ownTasks[0].id),
  ]) {
    await assert.rejects(visitTask(invite), /NEXT_HTTP_ERROR_FALLBACK;404/);
  }
  await visitTask(createSessionInviteToken(privateTask.sessionId));
  assert.equal((await store.listTaskSessions(newcomer.member.id)).length, 2);
  const shared = await snapshot(
    new NextRequest(`https://hive.test/api/sessions/${privateTask.sessionId}`, {
      headers: { cookie: browserCookie(newcomer) },
    }),
    foreignContext
  );
  assert.equal(shared.status, 200);
  const afterInvite = await repositories(
    new NextRequest(
      `https://hive.test/api/github/repositories?session_id=${privateTask.sessionId}`,
      { headers: { cookie: browserCookie(newcomer) } }
    )
  );
  assert.deepEqual(
    (await afterInvite.json()).repositories.map(({ id }) => id),
    [702]
  );
  console.log(
    "PASS: only a valid task invitation admits a teammate; joining still does not inherit the inviter's GitHub permissions."
  );

  const sharedUrl = `https://hive.test/api/sessions/${privateTask.sessionId}`;
  const sharedAction = (signedIn, payload) =>
    action(
      new NextRequest(sharedUrl, {
        method: "POST",
        headers: {
          cookie: browserCookie(signedIn),
          origin: "https://hive.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
      foreignContext
    );
  const sharedDiscussion = await sharedAction(owner, {
    type: "send-message",
    body: "@fixture-newcomer Please review this task with me",
    clientId: randomUUID(),
  });
  assert.equal(sharedDiscussion.status, 200);
  const beforeArchive = (await sharedDiscussion.json()).session;
  assert.equal(
    beforeArchive.stage,
    "waiting",
    "a teammate discussion does not run the agent"
  );
  assert.equal(
    beforeArchive.messages[0].role,
    "human",
    "archive checks use a real discussion, not a seeded greeting"
  );
  const archiveResponse = await sharedAction(owner, {
    type: "archive-task",
    actor: newcomer.member.id,
  });
  assert.equal(archiveResponse.status, 200);
  const archiveSnapshot = (await archiveResponse.json()).session;
  assert.equal(
    archiveSnapshot.archived.by,
    owner.member.id,
    "archive attribution comes from auth, not payload"
  );
  const readonly = await snapshot(
    new NextRequest(sharedUrl, {
      headers: { cookie: browserCookie(newcomer) },
    }),
    foreignContext
  );
  assert.equal(readonly.status, 200);
  assert.deepEqual(
    (await readonly.json()).session.archived,
    archiveSnapshot.archived
  );
  for (const signedIn of [owner, newcomer]) {
    for (const payload of [
      { type: "reset" },
      { type: "send-message", body: "Late send", clientId: randomUUID() },
      {
        type: "annotate-message",
        messageId: archiveSnapshot.messages[0].id,
        body: "Late discussion",
        clientId: randomUUID(),
      },
    ]) {
      const rejected = await sharedAction(signedIn, payload);
      assert.equal(rejected.status, 409);
      assert.match((await rejected.json()).error, /archived/);
    }
    const rejectedRepo = await attachRequest(
      signedIn,
      signedIn === owner ? 701 : 702,
      privateTask.sessionId
    );
    assert.equal(rejectedRepo.status, 409);
    assert.match((await rejectedRepo.json()).error, /archived/);
    const rejectedRollback = await restore(
      new NextRequest(`${sharedUrl}/checkpoints`, {
        method: "POST",
        headers: {
          cookie: browserCookie(signedIn),
          origin: "https://hive.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: randomUUID(),
          snapshotId: "old",
          version: archiveSnapshot.version,
        }),
      }),
      foreignContext
    );
    assert.equal(rejectedRollback.status, 409);
  }
  assert.equal(
    (await sharedAction(newcomer, { type: "restore-task" })).status,
    200
  );
  const unarchived = await store.getPublicTaskSessionSnapshot(
    privateTask.sessionId
  );
  assert.equal(unarchived.session.archived, undefined);
  assert.deepEqual(unarchived.session.workspace, archiveSnapshot.workspace);
  assert.deepEqual(unarchived.session.messages, archiveSnapshot.messages);
  console.log(
    "PASS: authenticated archive API, shared read access, HTTP 409 for archived writes/repository attach/rollback, and teammate restore without execution."
  );

  // Exercise the actual row locks and durable recovery journal, without a VM.
  const { applyHiveRunResult } =
    await import("../../src/lib/session/task-session.ts");
  let recoveryState = unarchived.session;
  for (const turn of [1, 2]) {
    recoveryState = applyHiveRunResult(recoveryState, {
      snapshot: { id: `restore-store-${turn}`, createdAt: turn },
      sandboxName: "restore-store-sandbox",
      agentSession: {
        id: "restore-store-agent",
        runtime: "codex",
        resumeFrom: {
          type: "resume-session",
          specificationVersion: "harness-v1",
          harnessId: "codex",
          data: { privateCheckpoint: turn },
        },
      },
      summary: `Turn ${turn}`,
      diff: `+ turn ${turn}`,
      files: [{ path: "qa.txt", content: `turn ${turn}` }],
      commands: [],
      changedFiles: ["qa.txt"],
    });
  }
  await pool.query(
    "UPDATE task_sessions SET workspace = $2, version = $3, stage = $4 WHERE id = $1",
    [
      privateTask.sessionId,
      recoveryState.workspace,
      recoveryState.version,
      recoveryState.stage,
    ]
  );
  const restoreRequest = {
    id: randomUUID(),
    snapshotId: "restore-store-1",
    version: recoveryState.version,
  };
  const starts = await Promise.allSettled(
    [owner, newcomer].map(({ member }) =>
      store.startTaskWorkspaceRestore(
        privateTask.sessionId,
        restoreRequest,
        member
      )
    )
  );
  assert.equal(
    starts.filter(({ status }) => status === "fulfilled").length,
    1,
    "only one member can claim the restore"
  );
  const firstRestore = starts.find(({ status }) => status === "fulfilled").value
    .session.workspace.restore;
  await store.recordTaskWorkspaceRestoreSource(
    privateTask.sessionId,
    restoreRequest.id,
    firstRestore.startedAt,
    "original-vm"
  );
  await store.finishTaskWorkspaceRestore(
    privateTask.sessionId,
    restoreRequest.id,
    false,
    firstRestore.startedAt
  );
  assert.equal(
    (await store.getTaskSessionSnapshot(privateTask.sessionId)).session
      .workspace.restore.sourceSessionId,
    "original-vm"
  );
  mock.timers.enable({ apis: ["Date"], now: firstRestore.retryAfter + 1 });
  try {
    const retry = await store.startTaskWorkspaceRestore(
      privateTask.sessionId,
      restoreRequest,
      newcomer.member
    );
    const attempt = retry.session.workspace.restore;
    assert.equal(attempt.sourceSessionId, "original-vm");
    assert.equal(
      attempt.by.id,
      firstRestore.by.id,
      "a teammate retry preserves the original attribution"
    );
    await assert.rejects(
      store.recordTaskWorkspaceRestoreSource(
        privateTask.sessionId,
        restoreRequest.id,
        firstRestore.startedAt,
        "wrong-vm"
      ),
      /attempt changed/
    );
    for (const confirmed of [true, false]) {
      await assert.rejects(
        store.finishTaskWorkspaceRestore(
          privateTask.sessionId,
          restoreRequest.id,
          confirmed,
          firstRestore.startedAt
        ),
        /attempt changed/
      );
    }
    const [confirmed, duplicate] = await Promise.all([
      store.finishTaskWorkspaceRestore(
        privateTask.sessionId,
        restoreRequest.id,
        true,
        attempt.startedAt
      ),
      store.finishTaskWorkspaceRestore(
        privateTask.sessionId,
        restoreRequest.id,
        true,
        attempt.startedAt
      ),
    ]);
    for (const snapshot of [confirmed, duplicate]) {
      assert.equal(snapshot.session.workspace.restore, undefined);
      assert.equal(snapshot.session.workspace.diff, "+ turn 1");
      assert.equal(
        snapshot.session.messages.filter(
          ({ id }) => id === `restore-${restoreRequest.id}`
        ).length,
        1
      );
      assert.doesNotMatch(JSON.stringify(snapshot), /privateCheckpoint/);
    }
    assert.equal(
      (await store.getTaskSessionSnapshot(privateTask.sessionId)).session
        .workspace.agentSession.resumeFrom.data.privateCheckpoint,
      1
    );
  } finally {
    mock.timers.reset();
  }
  console.log(
    "PASS: concurrent restore claims are serialized, VM evidence survives a retry, stale workers cannot finish it, and concurrent confirmations restore files/context exactly once."
  );

  // Seed a pending run through the store without executing a model, then use the real HTTP actions.
  const pending = await store.applyTaskSessionAction(
    privateTask.sessionId,
    {
      type: "send-message",
      actor: owner.member.id,
      body: "Fixture run in progress",
      clientId: randomUUID(),
    },
    owner.member
  );
  const queued = await store.applyTaskSessionAction(
    privateTask.sessionId,
    {
      type: "send-message",
      actor: newcomer.member.id,
      body: "Check keyboard focus",
      clientId: randomUUID(),
    },
    newcomer.member
  );
  const editable = queued.snapshot.session.messages.at(-1);
  const queuedSteerId = queued.snapshot.session.steeringQueue[0].id;
  const editPayload = {
    type: "edit-message",
    messageId: editable.id,
    body: "Check keyboard focus and Escape",
    expectedRevision: 0,
    queuedSteerId,
  };
  const editRequest = (signedIn, payload) =>
    action(
      new NextRequest(
        `https://hive.test/api/sessions/${privateTask.sessionId}`,
        {
          method: "POST",
          headers: {
            cookie: browserCookie(signedIn),
            origin: "https://hive.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      ),
      foreignContext
    );
  assert.equal(
    (await editRequest(owner, { ...editPayload, actor: newcomer.member.id }))
      .status,
    403,
    "A member cannot impersonate a message author"
  );
  for (const invalid of [
    { ...editPayload, body: " " },
    { ...editPayload, body: "x".repeat(8_001) },
    { ...editPayload, expectedRevision: -1 },
    { ...editPayload, queuedSteerId: 123 },
  ]) {
    assert.equal((await editRequest(newcomer, invalid)).status, 400);
  }
  const editedResponse = await editRequest(newcomer, {
    ...editPayload,
    actor: owner.member.id,
  });
  assert.equal(editedResponse.status, 200);
  const edited = (await editedResponse.json()).session;
  assert.equal(edited.messages.at(-1).body, "Check keyboard focus and Escape");
  assert.equal(edited.messages.at(-1).memberId, newcomer.member.id);
  assert.equal(edited.messages.at(-1).edits[0].body, "Check keyboard focus");
  assert.equal(edited.steeringQueue[0].body, "Check keyboard focus and Escape");
  const savedWorkspace = (
    await store.getTaskSessionSnapshot(privateTask.sessionId)
  ).session.workspace;
  assert.deepEqual(
    savedWorkspace,
    queued.snapshot.session.workspace,
    "Edits preserve the active run and private checkpoint context"
  );
  assert.doesNotMatch(
    JSON.stringify(edited.workspace),
    /privateCheckpoint|resumeFrom/,
    "Edit responses retain the public snapshot boundary"
  );
  assert.equal(
    edited.workspace.liveReply.id,
    savedWorkspace.liveReply.id,
    "The client still observes the same run"
  );
  assert.equal(
    (await editRequest(newcomer, editPayload)).status,
    200,
    "Retrying the same edit is idempotent"
  );
  const otherViewer = await snapshot(
    new NextRequest(`https://hive.test/api/sessions/${privateTask.sessionId}`, {
      headers: { cookie: browserCookie(owner) },
    }),
    foreignContext
  );
  assert.deepEqual(
    (await otherViewer.json()).session.messages.at(-1),
    edited.messages.at(-1)
  );
  const racing = await Promise.all(
    ["First browser", "Second browser"].map((body) =>
      editRequest(newcomer, { ...editPayload, expectedRevision: 1, body })
    )
  );
  assert.deepEqual(
    racing.map((response) => response.status).sort(),
    [200, 409],
    "The row lock admits exactly one revision"
  );
  assert.equal(
    (await editRequest(newcomer, { ...editPayload, body: "Stale browser" }))
      .status,
    409
  );
  await store.appendHiveReply(privateTask.sessionId, "Fixture run completed", {
    forReplyId: pending.snapshot.session.workspace.liveReply.id,
  });
  const applied = await store.applyTaskSessionAction(
    privateTask.sessionId,
    { type: "apply-next-steer", actor: owner.member.id },
    owner.member
  );
  const frozen = applied.snapshot.session.activeSteer.body;
  assert.equal(
    (
      await editRequest(newcomer, {
        ...editPayload,
        expectedRevision: 2,
        body: "Too late to edit the queue",
      })
    ).status,
    409
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(privateTask.sessionId)).session
      .activeSteer.body,
    frozen
  );
  console.log(
    "PASS: authenticated message editing enforces authorship, validates input, persists history, synchronizes snapshots, serializes competing edits and rejects edits after dequeue without any model calls."
  );

  const repositoryUrl = `https://hive.test/api/github/repositories?session_id=${ownTasks[0].id}`;
  const repositoryCookie = newcomer.response.cookies.get("hive_github_user");
  assert.ok(repositoryCookie.httpOnly);
  assert.ok(repositoryCookie.secure);
  assert.equal(repositoryCookie.sameSite, "lax");
  assert.equal(repositoryCookie.path, "/api/github");
  assert.doesNotMatch(repositoryCookie.value, /fixture-newcomer/);
  for (const encrypted of [
    undefined,
    `${repositoryCookie.value}tampered`,
    owner.response.cookies.get("hive_github_user").value,
  ]) {
    const response = await repositories(
      new NextRequest(repositoryUrl, {
        headers: {
          cookie: `hive_session=${newcomer.token}${encrypted ? `; hive_github_user=${encrypted}` : ""}`,
        },
      })
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).needsAuthorization, true);
  }
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    mock.timers.tick(9 * 60 * 60 * 1000);
    const expired = await repositories(
      new NextRequest(repositoryUrl, {
        headers: { cookie: browserCookie(newcomer) },
      })
    );
    assert.equal(expired.status, 409);
    assert.equal((await expired.json()).needsAuthorization, true);
    assert.ok(
      await getSessionMember(newcomer.token),
      "GitHub expiry does not delete the independent Hive login"
    );
  } finally {
    mock.timers.reset();
  }
  console.log(
    "PASS: missing, tampered, expired and cross-account GitHub credentials fail closed with a reconnect path."
  );

  const { POST: logout } =
    await import("../../src/app/api/auth/logout/route.ts");
  const loggedOut = await logout(
    new NextRequest("https://hive.test/api/auth/logout", {
      method: "POST",
      headers: { cookie: browserCookie(newcomer) },
    })
  );
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.cookies.get("hive_github_user").maxAge, 0);
  assert.equal(await getSessionMember(newcomer.token), null);
  assert.ok(await getSessionMember(owner.token));
  console.log(
    "PASS: logout revokes this login and clears GitHub access without signing out another account."
  );
} finally {
  await database.close();
}
