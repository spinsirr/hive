import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGitHubLoginUrl } from "./github-login-origin.ts";

const callback = "https://hive.example/api/github/callback";

test("alias login moves to the registered callback origin before creating a nonce", () => {
  const destination = canonicalGitHubLoginUrl(
    "https://deployment.example/api/github/login",
    callback
  );
  assert.equal(destination?.href, "https://hive.example/api/github/login");
  assert.equal(canonicalGitHubLoginUrl(destination.href, callback), null);
});

test("canonical login preserves invitation and repository-authorization parameters", () => {
  const request = new URL("https://deployment.example/api/github/login");
  request.searchParams.set(
    "return_to",
    "/sessions/team-task?invite=signed-fixture"
  );
  request.searchParams.set("installation_id", "123");
  request.searchParams.set("session_id", "team-task");
  const destination = canonicalGitHubLoginUrl(request.href, callback)!;
  assert.equal(
    destination.searchParams.get("return_to"),
    "/sessions/team-task?invite=signed-fixture"
  );
  assert.equal(destination.searchParams.get("installation_id"), "123");
  assert.equal(destination.searchParams.get("session_id"), "team-task");
});

test("neither an incoming hostname nor a return path controls the login destination", () => {
  const destination = canonicalGitHubLoginUrl(
    "https://untrusted.example/api/github/login?return_to=https://untrusted.example",
    callback
  )!;
  assert.equal(destination.origin, "https://hive.example");
  assert.throws(() =>
    canonicalGitHubLoginUrl("https://deployment.example/api/github/login", "")
  );
});

test("browser Host is used when NextRequest has normalized a loopback alias", () => {
  const destination = canonicalGitHubLoginUrl(
    "http://localhost:43124/api/github/login",
    "http://localhost:43124/api/github/callback",
    "127.0.0.1:43124"
  );
  assert.equal(destination?.href, "http://localhost:43124/api/github/login");
  assert.equal(
    canonicalGitHubLoginUrl(
      "https://hive.example/api/github/login",
      callback,
      "untrusted.example"
    )?.origin,
    "https://hive.example"
  );
});
