// Contract with the external adapter/infra. Only dummy credentials; no services.
import assert from "node:assert/strict";
import { mock } from "node:test";

let nativeSettings;
mock.module("@ai-sdk/harness-claude-code", {
  namedExports: {
    createClaudeCode(settings) {
      nativeSettings = settings;
      return {
        harnessId: "claude-code",
        specificationVersion: "harness-v1",
        async doStart(options) {
          return { sessionId: options.sessionId };
        },
      };
    },
  },
});
const { createHiveClaude, claudeOAuthTransformations } =
  await import("../src/lib/claude-harness.ts");
const token = "sk-ant-oat01-dummy-only";
const gateway = "gateway-dummy-only";
for (const subscription of [false, true]) {
  const harness = createHiveClaude({
    gatewayAuth: { AI_GATEWAY_API_KEY: gateway },
    ...(subscription ? { subscriptionToken: token } : {}),
  });
  assert.equal(harness.harnessId, "claude-code");
  assert.doesNotMatch(
    JSON.stringify(nativeSettings),
    /sk-ant-oat01-dummy-only/
  );
  assert.equal(
    nativeSettings.env.CLAUDE_CODE_OAUTH_TOKEN.startsWith("sk-ant-oat01-hive-"),
    subscription
  );
  assert.deepEqual(
    nativeSettings.auth,
    subscription ? {} : { AI_GATEWAY_API_KEY: gateway }
  );
  assert.deepEqual(nativeSettings.thinking, { type: "disabled" });
  assert.equal(nativeSettings.effort, "low");
  if (subscription) {
    assert.equal("ANTHROPIC_API_KEY" in nativeSettings.env, false);
    assert.equal("ANTHROPIC_AUTH_TOKEN" in nativeSettings.env, false);
    await assert.rejects(
      harness.doStart({
        sessionId: "test",
        sandboxSession: {},
        resumeFrom: {
          data: {
            sandboxCredentialEnvironment: {
              ANTHROPIC_API_KEY: "old-gateway-placeholder",
            },
          },
        },
      }),
      /mixing credentials/
    );
  }
  const transformations = [];
  await assert.rejects(
    harness.doStart({ sandboxSession: {}, sessionId: "test" }),
    /credential brokering/
  );
  const session = await harness.doStart({
    sessionId: "test",
    sandboxSession: {
      async addRequestTransformations(rules) {
        transformations.push(...rules);
      },
    },
  });
  assert.equal(JSON.stringify(session).includes(token), false);
  assert.equal(transformations.length, subscription ? 2 : 0);
  for (const rule of transformations) {
    assert.equal(rule.match.host, "api.anthropic.com");
    assert.deepEqual(rule.match.method, ["POST"]);
    assert.equal(rule.transform.headers.Authorization, `Bearer ${token}`);
    assert.equal(
      rule.match.headers[0].value.exact,
      `Bearer ${nativeSettings.env.CLAUDE_CODE_OAUTH_TOKEN}`
    );
  }
}
for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
  createHiveClaude({ gatewayAuth: { AI_GATEWAY_API_KEY: gateway }, effort });
  assert.equal(nativeSettings.effort, effort);
  assert.deepEqual(nativeSettings.thinking, {
    type: effort === "low" ? "disabled" : "adaptive",
  });
}
createHiveClaude({
  gatewayAuth: {},
  subscriptionToken: token,
  supportsEffort: false,
  effort: "high",
});
assert.equal(
  "effort" in nativeSettings,
  false,
  "Haiku must not receive unsupported effort"
);
assert.deepEqual(nativeSettings.thinking, { type: "disabled" });
createHiveClaude({
  gatewayAuth: {},
  subscriptionToken: token,
  adaptiveRequired: true,
  effort: "low",
});
assert.equal(nativeSettings.effort, "low");
assert.deepEqual(
  nativeSettings.thinking,
  { type: "adaptive" },
  "Fable cannot disable thinking, even at Low"
);
assert.deepEqual(
  claudeOAuthTransformations(token, "dummy").map((rule) => rule.match.path),
  [{ exact: "/v1/messages" }, { exact: "/v1/messages/count_tokens" }]
);
console.log(
  "PASS: Claude uses explicit auth, scopes OAuth injection to model endpoints, and fails closed without external credential brokering."
);
