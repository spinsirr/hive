// Production runner/state, with only external Harness/Sandbox/GitHub services doubled.
import assert from "node:assert/strict";
import { mock } from "node:test";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
let subscription = false, fail = false, expectedResume;
let settings, stopped = 0, starts = 0;
let nativeSettings;
let explicitModel, explicitEffort;
mock.module("@ai-sdk/harness-claude-code", { namedExports: { createClaudeCode(value) {
  nativeSettings = value;
  return { harnessId: "claude-code", specificationVersion: "harness-v1" };
} } });
const resume = { type: "resume-session", harnessId: "claude-code", specificationVersion: "harness-v1", data: { claudeSessionId: "native-fixture-id" } };
const sandbox = {
  async run({ command }) {
    assert.doesNotMatch(command, /codex-sdk|harness-bootstrap\/codex/, "Claude must not repair or start Codex");
    return { exitCode: 0, stderr: "", stdout: command === "git rev-parse --show-toplevel" ? "/vercel/sandbox/repo\n" : "" };
  },
};
const persistent = { keepLastSnapshots: { count: 3 }, async stop() { stopped++; return { snapshot: { id: "saved-native-and-files", createdAt: 100, status: "created" } }; } };
mock.module("@vercel/sandbox", { namedExports: { Sandbox: { async getOrCreate() { starts++; return persistent; }, async get() { starts++; return persistent; } } } });
mock.module("@ai-sdk/sandbox-vercel", { namedExports: { createVercelSandbox() { return {}; } } });
mock.module(new URL("../src/lib/github-app.ts", import.meta.url).href, { namedExports: { async getRepositoryCloneCredentials() { return {}; } } });
mock.module("@ai-sdk/harness/agent", { namedExports: { HarnessAgent: class {
  constructor(value) {
    settings = value;
    assert.equal(value.harness.harnessId, "claude-code");
    const noEffort = explicitModel === "claude-haiku-4-5";
    assert.equal(nativeSettings.effort, noEffort ? undefined : explicitEffort ?? "medium", "Shared effort must reach Claude on new and resumed turns");
    assert.deepEqual(nativeSettings.thinking, { type: noEffort ? "disabled" : "adaptive" });
    assert.equal(value.model, explicitModel ?? (subscription ? "claude-sonnet-4-6" : "anthropic/claude-sonnet-4.6"));
    assert.ok(value.inactiveTools.includes("Agent"));
    assert.equal(value.skills[0].name, "hive-collaboration");
    assert.match(value.skills[0].content, /get_context/);
  }
  async createSession(options) {
    assert.equal(options.resumeFrom, expectedResume);
    await settings.sandboxConfig.onSession({ session: sandbox, sessionWorkDir: "/vercel/sandbox/repo" });
    return { async stop() { return resume; } };
  }
  async stream() {
    return { fullStream: (async function* () {
      yield { type: "text-delta", text: "Inspecting." };
      yield { type: "tool-call", toolCallId: "bash-1", toolName: "bash", input: { command: "fixture-command" } };
      const output = { exitCode: 1, stdout: "Exit code 7\nREAL_OUTPUT", stderr: "" };
      yield fail ? { type: "tool-error", toolCallId: "bash-1", toolName: "bash", error: output }
        : { type: "tool-result", toolCallId: "bash-1", toolName: "bash", output };
      if (fail) throw Object.assign(new Error("authentication_error (fixture)"), { statusCode: 401 });
      yield { type: "text-delta", text: " Finished." };
    })() };
  }
} } });

const { runHiveCodingTask } = await import("../src/lib/hive-runner.ts");
const { createInitialTaskSessionState, reduceTaskSession, applyHiveRunResult, applyHiveRunError } = await import("../src/lib/task-session.ts");
const { HiveAgentError } = await import("../src/lib/hive-agent.ts");
const { publicTaskSessionSnapshot } = await import("../src/lib/task-session-snapshot.ts");
const { codingModelOptions } = await import("../src/lib/coding-models.ts");
const saved = { HIVE_CLAUDE_SUBSCRIPTION_SCOPE: process.env.HIVE_CLAUDE_SUBSCRIPTION_SCOPE, HIVE_CLAUDE_OAUTH_TOKEN: process.env.HIVE_CLAUDE_OAUTH_TOKEN, MEM0_API_KEY: process.env.MEM0_API_KEY };
try {
  delete process.env.MEM0_API_KEY;
  for (subscription of [false, true]) {
    for (fail of [false, true]) {
      expectedResume = undefined;
      delete process.env.HIVE_CLAUDE_SUBSCRIPTION_SCOPE;
      delete process.env.HIVE_CLAUDE_OAUTH_TOKEN;
      let task = createInitialTaskSessionState(1, "claude-test", { createdBy: "owner" });
      task = reduceTaskSession(task, { type: "select-harness", runtime: "claude-code", actor: "owner" }, 2);
      task = reduceTaskSession(task, { type: "connect-repository", actor: "owner", repositoryUrl: "https://github.com/example/repo", repositoryId: 42, repositoryName: "example/repo", repositoryBranch: "main", visibility: "private", installationId: 1, githubUserId: 1, githubLogin: "owner" }, 3);
      task = reduceTaskSession(task, { type: "set-coding-effort", actor: "owner", effort: "medium" }, 3);
      task = reduceTaskSession(task, { type: "send-message", actor: "owner", body: "Inspect only" }, 4);
      if (subscription) {
        process.env.HIVE_CLAUDE_SUBSCRIPTION_SCOPE = JSON.stringify({ sessionId: task.sessionId, ownerId: "owner", repositoryId: 42 });
        process.env.HIVE_CLAUDE_OAUTH_TOKEN = "sk-ant-oat01-fixture-not-real";
      }
      const publicText = [];
      let result;
      try { result = await runHiveCodingTask(task, "owner", undefined, { onText: body => publicText.push(body) }); }
      catch (error) {
        assert.equal(fail, true);
        assert.ok(error instanceof HiveAgentError);
        if (subscription) assert.equal(error.message, "Reconnect the Claude subscription.");
        result = error.checkpoint;
        task = applyHiveRunError(task, error.message, 5, error.checkpoint);
      }
      assert.equal(result.agentSession.runtime, "claude-code");
      assert.equal(result.agentSession.resumeFrom, resume);
      assert.equal(result.agentSession.authentication, subscription ? "claude-subscription" : "gateway");
      assert.equal(result.snapshot.id, "saved-native-and-files");
      assert.equal(result.commands[0].exitCode, null, "Never display a synthesized Claude 0/1 as the true process exit code");
      assert.equal(result.commands[0].resultReceived, true);
      assert.equal(result.commands[0].output, "Exit code 7\nREAL_OUTPUT");
      assert.deepEqual(publicText, fail ? ["Inspecting."] : ["Inspecting.", "Inspecting. Finished."]);
      if (!fail) task = applyHiveRunResult(task, result, 5);
      const publicState = publicTaskSessionSnapshot({ session: task, members: [], activeMembers: [], typingMembers: [] });
      assert.doesNotMatch(JSON.stringify(publicState), /native-fixture-id|sk-ant-oat01-fixture|claude-subscription/);
      expectedResume = resume;
      if (!fail) await runHiveCodingTask(task, "owner");
      if (subscription) {
        delete process.env.HIVE_CLAUDE_OAUTH_TOKEN;
        delete process.env.HIVE_CLAUDE_SUBSCRIPTION_SCOPE;
        const before = starts;
        process.env.HIVE_CODEX_AUTH_SECRET = "fixture-platform-secret";
        await assert.rejects(runHiveCodingTask(task, "owner"), /Reconnect the Claude subscription/);
        delete process.env.HIVE_CODEX_AUTH_SECRET;
        assert.equal(starts, before, "An auth change must never replay the task using a different account");
      }
    }
  }
  assert.equal(stopped, 6);
  subscription = true; fail = false; expectedResume = undefined;
  const nativeModels = codingModelOptions("gpt-5.6-luna", true);
  let task = createInitialTaskSessionState(1, "claude-models", { createdBy: "owner" });
  task = reduceTaskSession(task, { type: "select-harness", runtime: "claude-code", actor: "owner" }, 2);
  task = reduceTaskSession(task, { type: "connect-repository", actor: "owner", repositoryUrl: "https://github.com/example/repo", repositoryId: 42, repositoryName: "example/repo", repositoryBranch: "main", visibility: "private", installationId: 1, githubUserId: 1, githubLogin: "owner" }, 3);
  process.env.HIVE_CLAUDE_SUBSCRIPTION_SCOPE = JSON.stringify({ sessionId: task.sessionId, ownerId: "owner", repositoryId: 42 });
  process.env.HIVE_CLAUDE_OAUTH_TOKEN = "sk-ant-oat01-fixture-not-real";
  for (const [modelId, effort] of [["claude-opus-4-6", "max"], ["claude-fable-5", "low"], ["claude-fable-5", "xhigh"], ["claude-haiku-4-5", undefined]]) {
    explicitModel = modelId; explicitEffort = effort;
    const history = task.workspace.agentSession;
    task = reduceTaskSession(task, { type: "select-harness", runtime: "claude-code", modelId, actor: "owner" }, 4, [], nativeModels);
    assert.equal(task.workspace.agentSession, history, "Same engine keeps native history when the model changes");
    if (effort) task = reduceTaskSession(task, { type: "set-coding-effort", effort, modelId, actor: "owner" }, 5, [], nativeModels);
    const result = await runHiveCodingTask(task, "owner");
    task = applyHiveRunResult(task, result, 6);
    assert.equal(task.workspace.codingModel, modelId, "A successful checkpoint must retain the selected model");
    expectedResume = resume;
  }
  const before = starts;
  task.workspace.codingModel = "claude-fable-5-1";
  await assert.rejects(runHiveCodingTask(task, "owner"), /Choose a model available/);
  task.workspace.codingModel = "claude-opus-4-6";
  task.workspace.codingEffort = "xhigh";
  await assert.rejects(runHiveCodingTask(task, "owner"), /supported effort/);
  assert.equal(starts, before, "Unsupported model/effort must be rejected before starting a sandbox");
  assert.equal(stopped, 10);
  console.log("PASS: Opus Max, Fable Low/Extra high and Haiku reach the native runtime without losing resume state; invalid selections never start work.");
  console.log("PASS: Claude shares the runner, streams only public text, preserves file/native checkpoints after success or failure, resumes exactly and never silently changes authentication.");
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
