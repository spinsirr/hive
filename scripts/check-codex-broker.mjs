import assert from "node:assert/strict";
import { mock } from "node:test";

let settings;
mock.module("@ai-sdk/harness-codex", { namedExports: { createCodex(value) {
  settings = value;
  return { harnessId: "codex", async doStart() { return { id: "safe-session" }; } };
} } });
const { createHiveCodex } = await import("../src/lib/codex-harness.ts");
const auth = { accessToken: "PRIVATE_ACCESS_NEVER_IN_VM", chatgptAccountId: "operator-account" };
const harness = createHiveCodex({ auth: { AI_GATEWAY_API_KEY: "PAID_SECRET" }, reasoningEffort: "max" }, undefined, undefined, auth);
assert.deepEqual(settings.auth, {});
assert.doesNotMatch(JSON.stringify(settings), /PRIVATE_ACCESS|PAID_SECRET/);
const placeholder = settings.codexConfig.hive_subscription_tokens;
assert.equal(placeholder.chatgptAccountId, auth.chatgptAccountId);
assert.equal(placeholder.accessToken.split(".").length, 3);
await assert.rejects(harness.doStart({ sandboxSession: {} }), /credential brokering/);
let transformations;
const result = await harness.doStart({ sandboxSession: { async setRequestTransformations(value) { transformations = value; } } });
assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCESS/);
assert.equal(transformations.length, 4);
for (const rule of transformations) {
  assert.equal(rule.match.host, "chatgpt.com");
  assert.ok(rule.match.path.exact);
  assert.equal(rule.match.headers[0].value.exact, `Bearer ${placeholder.accessToken}`);
  assert.equal(rule.transform.headers.Authorization, `Bearer ${auth.accessToken}`);
  assert.equal(rule.transform.headers["ChatGPT-Account-Id"], auth.chatgptAccountId);
}
assert.ok(transformations.every(r => !/settings|accounts|tasks/.test(r.match.path.exact)));
console.log("PASS: Codex credentials only enter external egress rules; native settings carry a per-run placeholder, no paid credentials or account-management access.");
