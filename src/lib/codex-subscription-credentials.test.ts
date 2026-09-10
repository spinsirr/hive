import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManagedCodexAuth, codexAccountHash, sealCodexAuth, openCodexAuth, codexAuthNeedsRefresh, externalCodexTokens } from "./codex-subscription-credentials.ts";

const now = Date.now();
const auth = parseManagedCodexAuth({ auth_mode: "chatgpt", OPENAI_API_KEY: null,
  tokens: { access_token: `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 3600 })).toString("base64url")}.signature`, refresh_token: "private-refresh", id_token: "private-id-token", account_id: "fixture-account" },
  last_refresh: new Date(now).toISOString(),
});
const binding = { accountHash: codexAccountHash(auth), sessionId: "task", ownerId: "owner", repositoryId: 42 };
test("credential envelope is encrypted and bound to task, owner, repository and account", async () => {
  const secret = "s".repeat(64);
  const sealed = await sealCodexAuth(auth, binding, secret);
  assert.doesNotMatch(sealed, /private-refresh|private-id-token|fixture-account/);
  assert.deepEqual(await openCodexAuth(sealed, binding, secret), auth);
  for (const changed of [{ ownerId: "outsider" }, { sessionId: "other" }, { repositoryId: 43 }, { accountHash: "other" }]) await assert.rejects(openCodexAuth(sealed, { ...binding, ...changed }, secret));
  await assert.rejects(openCodexAuth(sealed, binding, "x".repeat(64)));
  await assert.rejects(sealCodexAuth(auth, binding, "short"));
});
test("only short-lived access data reaches the native task process", () => {
  assert.deepEqual(Object.keys(externalCodexTokens(auth)), ["accessToken", "chatgptAccountId"]);
  assert.doesNotMatch(JSON.stringify(externalCodexTokens(auth)), /private-refresh|private-id-token/);
  assert.equal(codexAuthNeedsRefresh(auth, now), false);
  assert.equal(codexAuthNeedsRefresh(auth, now + 3500_000), true);
  assert.equal(codexAuthNeedsRefresh({ ...auth, last_refresh: "invalid" }), true);
  assert.throws(() => parseManagedCodexAuth({ auth_mode: "apikey", OPENAI_API_KEY: "secret" }), /managed Codex/);
});
