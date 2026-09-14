import assert from "node:assert/strict";
import { registerTestModules } from "../helpers/test-modules.mjs";

// Real anonymous routes; no server, login, code exchange or database reads.
process.env.DATABASE_URL =
  "postgresql://fixture@127.0.0.1:1/hive_oauth_fixture";
process.env.GITHUB_APP_CLIENT_ID = "fixture-client";
process.env.GITHUB_APP_CLIENT_SECRET = "local-oauth-fixture-not-a-secret";
process.env.GITHUB_APP_CALLBACK_URL =
  "http://localhost:43124/api/github/callback";
globalThis.fetch = async () => {
  throw new Error("OAuth-origin checks must not contact external services.");
};
registerTestModules();
const { NextRequest } = await import("next/server.js");
const { GET: login } = await import("../../src/app/api/github/login/route.ts");
const { GET: callback } =
  await import("../../src/app/api/github/callback/route.ts");

try {
  const canonical = new URL("http://localhost:43124");
  const returnTo = "/sessions/test-task?invite=fixture-invitation";
  const alias = new URL("http://127.0.0.1:43124/api/github/login");
  alias.searchParams.set("return_to", returnTo);
  const start = await login(
    new NextRequest(alias, { headers: { host: alias.host } })
  );
  const redirected = new URL(start.headers.get("location"));
  assert.equal(redirected.origin, canonical.origin);
  assert.equal(redirected.pathname, "/api/github/login");
  assert.equal(redirected.searchParams.get("return_to"), returnTo);
  assert.equal(
    start.headers.has("set-cookie"),
    false,
    "Do not strand a nonce on the alias host"
  );

  const authorize = await login(new NextRequest(redirected));
  const destination = new URL(authorize.headers.get("location"));
  assert.equal(destination.origin, "https://github.com");
  assert.equal(
    new URL(destination.searchParams.get("redirect_uri")).origin,
    canonical.origin
  );
  const cookie = authorize.headers.get("set-cookie");
  assert.ok(cookie?.includes("hive_github_oauth="));
  assert.ok(cookie?.includes("HttpOnly"));
  assert.ok(cookie?.toLowerCase().includes("samesite=lax"));
  assert.ok(
    !cookie?.toLowerCase().includes("domain="),
    "Keep the nonce host-only"
  );

  const denied = await callback(
    new NextRequest(
      new URL(
        "/api/github/callback?code=fixture-code&state=invalid-fixture",
        canonical
      )
    )
  );
  const retry = new URL(denied.headers.get("location"));
  assert.equal(retry.origin, canonical.origin);
  assert.equal(retry.pathname, "/");
  assert.equal(retry.searchParams.get("signin"), "retry");
  const cleared = denied.headers.get("set-cookie") ?? "";
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(!cleared.includes("hive_session="));
  console.log(
    "PASS: canonical login preserves invitations and host-only nonce; invalid callback clears it without granting a session."
  );
} finally {
  await globalThis.__hiveDatabasePool?.end();
}
