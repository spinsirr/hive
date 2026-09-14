import assert from "node:assert/strict";
import test from "node:test";
import {
  createHiveToolToken,
  hiveToolEndpoint,
  verifyHiveToolToken,
} from "./hive-tool-token.ts";
import { signSessionInvite } from "../../sessions/session-invite-token.ts";

const scope = { sessionId: "task-one", runId: "run-one", memberId: "github-1" };
const secret = "isolated-test-signing-secret";

test("agent capability is bound to a task, actor, run and five-minute lifetime", () => {
  const token = createHiveToolToken(scope, secret, 1000);
  assert.deepEqual(verifyHiveToolToken(token, "task-one", secret, 1001), scope);
  assert.equal(verifyHiveToolToken(token, "task-two", secret, 1001), null);
  assert.equal(
    verifyHiveToolToken(token, "task-one", "different-secret", 1001),
    null
  );
  assert.equal(verifyHiveToolToken(token, "task-one", secret, 301000), null);
  assert.equal(
    verifyHiveToolToken(token + ".extra", "task-one", secret, 1001),
    null
  );
  const payload = Buffer.from(
    JSON.stringify({
      ...scope,
      sessionId: "task-two",
      audience: "hive-agent-tools",
      expiresAt: 301000,
    })
  ).toString("base64url");
  assert.equal(
    verifyHiveToolToken(
      payload + "." + token.split(".")[1],
      "task-two",
      secret,
      1001
    ),
    null
  );
  assert.equal(
    verifyHiveToolToken(
      signSessionInvite("task-one", secret, 1000),
      "task-one",
      secret,
      1001
    ),
    null
  );
});

test("tool destination uses trusted deployment origin and only permits HTTP for loopback", () => {
  assert.equal(
    hiveToolEndpoint("task-one", "https://hive.example/api/github/callback"),
    "https://hive.example/api/sessions/task-one/agent-tools"
  );
  assert.equal(
    hiveToolEndpoint("task-one", "http://127.0.0.1:3000/api/github/callback"),
    "http://127.0.0.1:3000/api/sessions/task-one/agent-tools"
  );
  assert.throws(() =>
    hiveToolEndpoint("task-one", "http://public.example/api/github/callback")
  );
});
