import { createTestDatabase } from "../helpers/test-database.mjs";
import { registerTestModules } from "../helpers/test-modules.mjs";
// Real Postgres and the host-only vault; no OAuth, Neon or model calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { mock } from "node:test";
import { eq } from "drizzle-orm";

import {
  codexAccountHash,
  sealCodexAuth,
  openCodexAuth,
} from "../../src/server/agents/codex/codex-subscription-credentials.ts";
import { readFile } from "node:fs/promises";

const database = createTestDatabase(
  process.env.HIVE_AUTH_TEST_DATABASE_URL,
  "hive_auth_test"
);
globalThis.fetch = async () => {
  throw new Error("External HTTP is forbidden in this fixture.");
};

process.env.HIVE_INVITE_SECRET = "auth-fixture-secret-".repeat(4);
process.env.HIVE_CODEX_AUTH_SECRET = "vault-fixture-secret-".repeat(4);

registerTestModules();
mock.module("@vercel/functions", { namedExports: { attachDatabasePool() {} } });
let refreshCalls = 0,
  refresh;
mock.module(
  new URL(
    "../../src/server/agents/codex/codex-subscription-refresh.ts",
    import.meta.url
  ).href,
  {
    namedExports: {
      async refreshCodexSubscription(auth) {
        refreshCalls++;
        return refresh(auth);
      },
    },
  }
);

try {
  await database.start();
  const { db } = await import("../../src/db/index.ts");
  const { taskSessions, taskSessionMembers, users, codexSubscriptions } =
    await import("../../src/db/schema.ts");
  const { createUserSession } =
    await import("../../src/server/auth/auth-session.ts");
  const store = await import("../../src/server/sessions/task-session-store.ts");
  const { readCodexSubscription, SubscriptionAccessDenied } =
    await import("../../src/server/agents/codex/codex-subscription-store.ts");
  await assert.rejects(
    readFile(
      new URL(
        "../../src/app/api/sessions/[sessionId]/codex-auth/route.ts",
        import.meta.url
      )
    ),
    { code: "ENOENT" },
    "No runtime HTTP route may return a platform account token"
  );
  const [owner, teammate, outsider] = await Promise.all(
    [991, 992, 993].map((id) =>
      createUserSession({ id, login: `auth-${id}`, name: `Auth ${id}` })
    )
  );
  const session = await store.createTaskSession(
    "Credential boundary fixture",
    owner.member
  );
  const id = session.sessionId;
  await store.joinTaskSession(id, teammate.member.id);
  await store.applyTaskSessionAction(
    id,
    {
      type: "connect-repository",
      actor: owner.member.id,
      installationId: 1,
      repositoryId: 42,
      repositoryUrl: "https://github.com/fixture/private.git",
      repositoryName: "fixture/private",
      repositoryBranch: "main",
      visibility: "private",
      githubUserId: 991,
      githubLogin: owner.member.githubLogin,
    },
    owner.member
  );
  const run = await store.applyTaskSessionAction(
    id,
    {
      type: "send-message",
      actor: owner.member.id,
      body: "Inspect only",
      clientId: randomUUID(),
    },
    owner.member
  );
  const original = run.snapshot.session;
  const scope = {
    sessionId: id,
    memberId: owner.member.id,
    runId: original.workspace.liveReply.id,
  };
  const auth = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      access_token: `fixture.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString("base64url")}.signature`,
      refresh_token: "PRIVATE_REFRESH",
      id_token: "PRIVATE_ID",
      account_id: "ACCOUNT_FIXTURE",
    },
    last_refresh: new Date().toISOString(),
  };
  const binding = {
    accountHash: codexAccountHash(auth),
    sessionId: id,
    ownerId: owner.member.id,
    repositoryId: 42,
  };
  const envelope = await sealCodexAuth(
    auth,
    binding,
    process.env.HIVE_CODEX_AUTH_SECRET
  );
  const readBinding = async () =>
    (await db.select().from(codexSubscriptions))[0];
  const call = (overrides = {}) =>
    readCodexSubscription({ ...scope, ...overrides });
  await assert.rejects(call(), /Reconnect/);
  await db
    .insert(codexSubscriptions)
    .values({ ...binding, encryptedAuth: envelope });
  const body = await call();
  assert.deepEqual(Object.keys(body).sort(), [
    "accessToken",
    "chatgptAccountId",
    "model",
  ]);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_REFRESH|PRIVATE_ID/);
  assert.ok(await call({ memberId: teammate.member.id }));
  for (const memberId of ["", "invalid", outsider.member.id])
    await assert.rejects(call({ memberId }), SubscriptionAccessDenied);
  await assert.rejects(call({ runId: "old-run" }), SubscriptionAccessDenied);
  // Account identity no longer restricts repository/owner. A no-repo task can plan.
  for (const repository of [
    null,
    { ...original.repository, id: 43 },
    { ...original.repository, visibility: "public" },
  ]) {
    await db
      .update(taskSessions)
      .set({ repository })
      .where(eq(taskSessions.id, id));
    assert.ok(await call());
  }
  await db
    .update(taskSessions)
    .set({ repository: original.repository, createdBy: outsider.member.id })
    .where(eq(taskSessions.id, id));
  assert.ok(await call());
  await db
    .update(taskSessions)
    .set({
      createdBy: owner.member.id,
      stage: "running",
      workspace: { ...original.workspace, completedAt: Date.now() },
    })
    .where(eq(taskSessions.id, id));
  await assert.rejects(call(), SubscriptionAccessDenied);
  await db
    .update(taskSessions)
    .set({
      stage: "running",
      workspace: { ...original.workspace, restore: { status: "running" } },
    })
    .where(eq(taskSessions.id, id));
  await assert.rejects(call(), SubscriptionAccessDenied);
  await db
    .update(taskSessions)
    .set({ workspace: original.workspace })
    .where(eq(taskSessions.id, id));
  assert.equal(
    refreshCalls,
    0,
    "Cached access does not refresh or contact native auth"
  );
  console.log(
    "PASS: current task membership/run/restore checks remain; operator identity does not grant another task's access."
  );

  const second = await store.createTaskSession(
    "Another user's own task",
    outsider.member
  );
  const secondRun = await store.applyTaskSessionAction(
    second.sessionId,
    {
      type: "send-message",
      actor: outsider.member.id,
      body: "Plan only",
      clientId: randomUUID(),
    },
    outsider.member
  );
  const secondScope = {
    sessionId: second.sessionId,
    memberId: outsider.member.id,
    runId: secondRun.snapshot.session.workspace.liveReply.id,
  };
  assert.ok(await readCodexSubscription(secondScope));
  await assert.rejects(
    readCodexSubscription({ ...secondScope, memberId: owner.member.id }),
    SubscriptionAccessDenied
  );
  assert.deepEqual(
    (await store.getTaskSessionSnapshot(second.sessionId)).codingModels,
    (await store.getTaskSessionSnapshot(id)).codingModels
  );

  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const fresh = {
    ...auth,
    tokens: { ...auth.tokens, refresh_token: "ROTATED_REFRESH" },
  };
  refresh = async () => {
    entered.resolve();
    await release.promise;
    return fresh;
  };
  const first = readCodexSubscription(scope, true);
  await entered.promise;
  await assert.rejects(
    readCodexSubscription(secondScope, true),
    /refresh|reconnect/
  );
  assert.equal(refreshCalls, 1);
  release.resolve();
  await first;
  const row = await readBinding();
  assert.equal(row.refreshLock, null);
  assert.equal(
    (
      await openCodexAuth(
        row.encryptedAuth,
        binding,
        process.env.HIVE_CODEX_AUTH_SECRET
      )
    ).tokens.refresh_token,
    "ROTATED_REFRESH"
  );
  assert.notEqual(row.encryptedAuth, envelope);
  console.log(
    "PASS: concurrent refresh is serialized and the latest native credential is written back encrypted."
  );

  refresh = async () => {
    await db
      .update(taskSessions)
      .set({
        stage: "running",
        workspace: { ...original.workspace, completedAt: Date.now() },
      })
      .where(eq(taskSessions.id, id));
    return fresh;
  };
  await assert.rejects(
    readCodexSubscription(scope, true),
    SubscriptionAccessDenied
  );
  await db
    .update(taskSessions)
    .set({ workspace: original.workspace })
    .where(eq(taskSessions.id, id));
  refresh = async () => {
    await db
      .update(taskSessions)
      .set({ repository: { ...original.repository, id: 99 } })
      .where(eq(taskSessions.id, id));
    return fresh;
  };
  await assert.rejects(
    readCodexSubscription(scope, true),
    SubscriptionAccessDenied
  );
  await db
    .update(taskSessions)
    .set({ repository: original.repository })
    .where(eq(taskSessions.id, id));
  refresh = async () => {
    await db
      .delete(taskSessionMembers)
      .where(eq(taskSessionMembers.memberId, teammate.member.id));
    return fresh;
  };
  await assert.rejects(
    readCodexSubscription({ ...scope, memberId: teammate.member.id }, true),
    SubscriptionAccessDenied
  );
  refresh = async () => {
    throw new Error("Uncertain native refresh failure PRIVATE_REFRESH");
  };
  await assert.rejects(readCodexSubscription(scope, true), /Uncertain/);
  assert.ok((await readBinding()).refreshLock);
  const count = refreshCalls;
  await assert.rejects(call(), /reconnect|refresh/);
  assert.equal(
    refreshCalls,
    count,
    "Never retry an old token after uncertain refresh/write-back"
  );
  assert.doesNotMatch(
    JSON.stringify(await store.getTaskSessionSnapshot(id)),
    /PRIVATE_REFRESH|ROTATED_REFRESH|PRIVATE_ID|ACCOUNT_FIXTURE|encryptedAuth/
  );
  await db.delete(taskSessions).where(eq(taskSessions.id, id));
  await db.delete(users).where(eq(users.id, owner.member.id));
  assert.ok(
    await readBinding(),
    "Deleting enrolling task/user must not cascade-delete platform credentials"
  );
  await assert.rejects(call(), SubscriptionAccessDenied);
  await db.update(codexSubscriptions).set({ refreshLock: null });
  assert.ok(
    await readCodexSubscription(secondScope),
    "Other users' own tasks still use the same platform account"
  );
  console.log(
    "PASS: access is rechecked after refresh; uncertain failure stays fenced without token replay; shared snapshots contain no vault data."
  );
} finally {
  await database.close();
}
