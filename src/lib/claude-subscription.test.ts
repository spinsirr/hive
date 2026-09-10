import assert from "node:assert/strict";
import test from "node:test";
import { claudeSubscriptionToken } from "./claude-subscription.ts";
import { createInitialTaskSessionState, reduceTaskSession } from "./task-session.ts";

const initial = createInitialTaskSessionState(1, "claude-test", { createdBy: "owner", title: "Claude test" });
const task = reduceTaskSession(initial, {
  type: "connect-repository", actor: "owner", repositoryId: 42, repositoryUrl: "https://github.com/example/private.git",
  repositoryName: "example/private", repositoryBranch: "main", visibility: "private", installationId: 5,
  githubUserId: 1, githubLogin: "owner",
}, 2);
const token = "sk-ant-oat01-fixture-only-never-a-real-secret";
const config = { HIVE_CLAUDE_OAUTH_TOKEN: token, HIVE_CLAUDE_SUBSCRIPTION_SCOPE: JSON.stringify({ sessionId: task.sessionId, ownerId: "owner", repositoryId: 42 }) };

test("only the explicitly bound private owner task receives a Claude credential", () => {
  assert.equal(claudeSubscriptionToken(task, config), token);
  assert.equal(claudeSubscriptionToken({ ...task, sessionId: "someone-else" }, config), undefined);
  assert.equal(claudeSubscriptionToken(task, {}), undefined);
  assert.equal(claudeSubscriptionToken(task, { CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: "host-key" }), undefined, "Never discover another application's login");
  assert.throws(() => claudeSubscriptionToken({ ...task, createdBy: "someone-else" }, config), /not authorized/);
  assert.throws(() => claudeSubscriptionToken({ ...task, repository: undefined }, config), /not authorized/);
  assert.throws(() => claudeSubscriptionToken({ ...task, repository: { ...task.repository!, id: 43 } }, config), /not authorized/);
  assert.throws(() => claudeSubscriptionToken({ ...task, repository: { ...task.repository!, visibility: "public" } }, config), /not authorized/);
});

test("bad subscription configuration fails closed without printing credential values", () => {
  for (const env of [
    { HIVE_CLAUDE_OAUTH_TOKEN: token },
    { ...config, HIVE_CLAUDE_SUBSCRIPTION_SCOPE: token },
    { ...config, HIVE_CLAUDE_OAUTH_TOKEN: undefined },
    { ...config, HIVE_CLAUDE_OAUTH_TOKEN: "sk-ant-api03-wrong-credential-type" },
  ]) assert.throws(() => claudeSubscriptionToken(task, env), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /sk-ant/);
    return true;
  });
});
