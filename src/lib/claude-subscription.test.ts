import assert from "node:assert/strict";
import test from "node:test";
import { claudeSubscriptionToken } from "./claude-subscription.ts";
import {
  platformCodingModels,
  usesPlatformSubscriptions,
} from "./platform-models.ts";

const token = "sk-ant-oat01-fixture-only-never-a-real-secret";
test("accepts current and legacy official setup-token formats without accepting API keys", () => {
  for (const prefix of ["sk-ant-at01-", "sk-ant-oat01-"]) {
    const value = `${prefix}fixture-only-never-a-real-secret`;
    assert.equal(
      claudeSubscriptionToken({ HIVE_CLAUDE_OAUTH_TOKEN: value }),
      value
    );
  }
  for (const value of [
    "sk-ant-api03-fixture",
    "sk-ant-at99-fixture",
    "sk-ant-at01-invalid value",
  ]) {
    assert.throws(
      () => claudeSubscriptionToken({ HIVE_CLAUDE_OAUTH_TOKEN: value }),
      /Reconnect/
    );
  }
});
test("explicit platform credentials are independent of task, owner and repository", () => {
  assert.equal(
    claudeSubscriptionToken({ HIVE_CLAUDE_OAUTH_TOKEN: token }),
    token
  );
  assert.equal(
    claudeSubscriptionToken({
      HIVE_CLAUDE_OAUTH_TOKEN: token,
      HIVE_CLAUDE_SUBSCRIPTION_SCOPE: "obsolete-task-binding",
    }),
    token
  );
  assert.equal(claudeSubscriptionToken({}), undefined);
  assert.equal(
    claudeSubscriptionToken({
      CLAUDE_CODE_OAUTH_TOKEN: token,
      ANTHROPIC_API_KEY: "host-key",
    }),
    undefined
  );
  assert.throws(
    () =>
      claudeSubscriptionToken({
        HIVE_CLAUDE_OAUTH_TOKEN: "sk-ant-api03-wrong-type",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /sk-ant/);
      return true;
    }
  );
});

test("every task gets the same native model menu; missing credentials never select paid fallback", () => {
  for (const env of [
    { HIVE_CODEX_AUTH_SECRET: "configured" },
    { HIVE_CLAUDE_OAUTH_TOKEN: token },
  ]) {
    assert.equal(usesPlatformSubscriptions(env), true);
    const models = platformCodingModels({
      ...env,
      HIVE_CODEX_MODEL: "openai/gpt-5.1-codex-mini",
    });
    assert.ok(models.some((model) => model.modelId === "gpt-5.6-luna"));
    assert.ok(models.some((model) => model.modelId === "claude-opus-4-6"));
    assert.ok(models.every((model) => !model.modelId.includes("/")));
    assert.doesNotMatch(JSON.stringify(models), /configured|sk-ant/);
  }
  assert.equal(
    usesPlatformSubscriptions({ AI_GATEWAY_API_KEY: "api-only-installation" }),
    false
  );
});
