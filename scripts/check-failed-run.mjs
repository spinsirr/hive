// Deterministic runner regression: external services are doubles; Hive's runner,
// stream handling, and task-state transition are the production implementations.
// Run with: node --experimental-test-module-mocks scripts/check-failed-run.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const diff = "diff --git a/nav.tsx b/nav.tsx\n--- a/nav.tsx\n+++ b/nav.tsx\n@@ -1 +1 @@\n-export const label = 'Steer';\n+export const label = 'Queue steer';\n";
const content = "export const label = 'Queue steer';\n";
const command = { command: "pnpm test", output: { exitCode: 0, output: "1 test passed", status: "completed" } };
const checkpoint = { type: "resume-session", harnessId: "codex", specificationVersion: "harness-v1", data: { threadId: "failed-run-fixture" } };
const rateLimit = new Error("exceeded retry limit, last status: 429 Too Many Requests");
let scenario;
let sandboxStopped = false;
const sandbox = {
  async run({ command }) {
    assert.equal(sandboxStopped, false, "Read artifacts before stopping the caller-owned sandbox");
    if (command.startsWith("git diff") && scenario.artifactFailure === "unavailable") throw new Error("Sandbox unavailable (fixture)");
    if (command.startsWith("git diff") && scenario.artifactFailure === "git-error") {
      return { exitCode: 128, stdout: "", stderr: "fatal: repository unavailable (fixture)" };
    }
    const stdout = command === "git rev-parse --show-toplevel"
      ? "/vercel/sandbox/hive\n"
      : command.startsWith("git diff --name-only")
        ? "nav.tsx\n"
        : command.startsWith("git diff --no-ext-diff") ? diff : "";
    return { exitCode: 0, stdout, stderr: "" };
  },
  async readTextFile() { return content; },
};

mock.module("@vercel/sandbox", { namedExports: {
  Sandbox: { async getOrCreate() { return { async stop() { sandboxStopped = true; } }; } },
} });
mock.module("@ai-sdk/sandbox-vercel", { namedExports: { createVercelSandbox() { return {}; } } });
mock.module("@ai-sdk/harness-codex", { namedExports: { createCodex() { return {}; } } });
mock.module(new URL("../src/lib/github-app.ts", import.meta.url).href, {
  namedExports: { async getRepositoryCloneCredentials() { return {}; } },
});
mock.module("@ai-sdk/harness/agent", { namedExports: {
  HarnessAgent: class {
    constructor(settings) { this.settings = settings; }
    async createSession() {
      await this.settings.sandboxConfig.onSession({ session: sandbox, sessionWorkDir: "/vercel/sandbox/hive" });
      return { async stop() {
        if (scenario.checkpointFailure) throw new Error("Checkpoint unavailable (fixture)");
        return checkpoint;
      } };
    }
    async stream() {
      return {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "The test passed; checking the diff." };
          yield { type: "tool-call", toolCallId: "test-1", toolName: "bash", input: { command: command.command } };
          yield { type: "tool-result", toolCallId: "test-1", toolName: "bash", input: { command: command.command }, output: command.output };
          yield { type: "tool-call", toolCallId: "test-2", toolName: "bash", input: { command: "pnpm typecheck" } };
          if (!scenario.fail || scenario.missingExitCode) {
            yield { type: "tool-result", toolCallId: "test-2", toolName: "bash", input: { command: "pnpm typecheck" }, output: {
              exitCode: scenario.missingExitCode ? null : 0,
              output: scenario.missingExitCode ? "Interrupted" : "Type check passed", status: "completed",
            } };
          }
          if (scenario.throwStream) throw rateLimit;
          if (scenario.fail) yield { type: "error", error: rateLimit };
        })(),
        text: Promise.resolve("Updated the label; both checks passed."),
      };
    }
  },
} });

const { runHiveCodingTask } = await import("../src/lib/hive-runner.ts");
const { HiveAgentError } = await import("../src/lib/hive-agent.ts");
const { applyHiveRunError, applyHiveRunResult, createInitialTaskSessionState, reduceTaskSession, canApproveChanges } = await import("../src/lib/task-session.ts");
const connected = reduceTaskSession(createInitialTaskSessionState(10, "failed-run"), {
  type: "connect-repository", actor: "spencer", repositoryUrl: "https://github.com/example/hive",
  repositoryName: "example/hive", repositoryId: 1, repositoryBranch: "main", installationId: 1,
  visibility: "private", githubUserId: 1, githubLogin: "example",
}, 20);
const running = reduceTaskSession(connected, { type: "send-message", actor: "spencer", body: "Fix the steer label." }, 30);
const previousSnapshot = {
  diff: "previous diff snapshot",
  files: [{ path: "previous.ts", content: "previous snapshot" }],
  changedFiles: ["previous.ts"],
};
for (const options of [
  { name: "provider error after a completed command", fail: true },
  { name: "stream throws after a completed command", fail: true, throwStream: true },
  { name: "missing exit code is incomplete, never passed", fail: true, missingExitCode: true },
  { name: "unreachable sandbox preserves earlier snapshots and current commands", fail: true, artifactFailure: "unavailable" },
  { name: "git error is not displayed as a code diff", fail: true, artifactFailure: "git-error" },
  { name: "checkpoint failure still retains command and file evidence", fail: true, checkpointFailure: true },
  { name: "normal completion still retains all commands and reviewable files", fail: false },
]) {
  scenario = options;
  sandboxStopped = false;
  const initial = { ...running, workspace: { ...running.workspace, ...previousSnapshot } };
  const publicText = [];
  let failure;
  let result;
  try {
    result = await runHiveCodingTask(initial, "spencer", undefined, { onText(body) { publicText.push(body); } });
  } catch (error) {
    failure = error;
  }
  if (options.fail) {
    assert.ok(failure instanceof HiveAgentError, options.name);
    assert.equal(failure.cause, rateLimit, "Secondary snapshot errors must not replace the original run error");
  } else {
    assert.equal(failure, undefined);
  }
  const state = options.fail
    ? applyHiveRunError(initial, failure.message, 40, failure.checkpoint)
    : applyHiveRunResult(initial, result, 40);
  assert.equal(state.workspace.status, options.fail ? "error" : "review");
  assert.equal(canApproveChanges(state), !options.fail);
  assert.deepEqual(state.workspace.agentSession.resumeFrom, options.checkpointFailure ? initial.workspace.agentSession.resumeFrom : checkpoint);
  assert.equal(state.workspace.diff, options.artifactFailure ? previousSnapshot.diff : diff.trimEnd(), "Files / Diff must retain available changes without inserting an error as code");
  assert.deepEqual(state.workspace.files, options.artifactFailure ? previousSnapshot.files : [{ path: "nav.tsx", content }]);
  assert.deepEqual(state.workspace.changedFiles, options.artifactFailure ? previousSnapshot.changedFiles : ["nav.tsx"]);
  assert.equal(state.workspace.commands.length, 2);
  assert.equal(state.workspace.commands[0]?.command, "pnpm test", "Runs must retain completed commands before the failure");
  assert.equal(state.workspace.commands[0]?.exitCode, 0);
  assert.equal(state.workspace.commands[0]?.output, "1 test passed");
  assert.equal(state.workspace.commands[1]?.exitCode, options.fail ? null : 0);
  assert.deepEqual(publicText, ["The test passed; checking the diff."], "Tool results must stay out of the chat");
  assert.equal(sandboxStopped, true);
  console.log(`PASS: ${options.name}`);
}
