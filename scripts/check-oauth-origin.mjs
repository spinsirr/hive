import assert from "node:assert/strict";

// Run against an isolated Next build with fixture credentials and this callback:
// GITHUB_APP_CALLBACK_URL=http://localhost:43124/api/github/callback
// No code exchange, account creation, model call, or credential output occurs.
const alias = new URL("http://127.0.0.1:43124");
const canonical = new URL("http://localhost:43124");
const returnTo = "/sessions/test-task?invite=fixture-invitation";
const login = new URL("/api/github/login", alias);
login.searchParams.set("return_to", returnTo);

const start = await fetch(login, { redirect: "manual" });
const redirected = new URL(start.headers.get("location"));
assert.equal(
  redirected.origin,
  canonical.origin,
  "Canonicalize before leaving for GitHub"
);
assert.equal(redirected.pathname, "/api/github/login");
assert.equal(redirected.searchParams.get("return_to"), returnTo);
assert.equal(
  start.headers.has("set-cookie"),
  false,
  "Do not strand a nonce on the alias host"
);

const authorize = await fetch(redirected, { redirect: "manual" });
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

console.log(
  "PASS: alias → canonical login → GitHub; invitation preserved; host-only nonce on callback origin."
);

const denied = await fetch(
  new URL(
    "/api/github/callback?code=fixture-code&state=invalid-fixture",
    canonical
  ),
  { redirect: "manual" }
);
const retry = new URL(denied.headers.get("location"));
assert.equal(retry.origin, canonical.origin);
assert.equal(retry.pathname, "/");
assert.equal(retry.searchParams.get("signin"), "retry");
const clearedCookie = denied.headers.get("set-cookie") ?? "";
assert.ok(clearedCookie.includes("Max-Age=0"));
assert.ok(!clearedCookie.includes("hive_session="));
const retryPage = await fetch(retry);
assert.match(await retryPage.text(), /try signing in again/);
console.log(
  "PASS: invalid callback stays denied, clears the nonce, and renders a retry page without issuing a login session."
);
