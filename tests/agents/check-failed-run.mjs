import { taskExecution } from "../../src/lib/session/task-execution.ts";
import { registerTestModules } from "../helpers/test-modules.mjs";
// Deterministic runner regression: external services are doubles; Hive's runner,
// stream handling, and task-state transition are the production implementations.
// Run with: node --experimental-test-module-mocks tests/agents/check-failed-run.mjs
import assert from "node:assert/strict";

import { mock } from "node:test";

registerTestModules();

const diff =
  "diff --git a/nav.tsx b/nav.tsx\n--- a/nav.tsx\n+++ b/nav.tsx\n@@ -1 +1 @@\n-export const label = 'Steer';\n+export const label = 'Queue steer';\n";
const content = "export const label = 'Queue steer';\n";
const command = {
  command: "pnpm test",
  output: { exitCode: 0, output: "1 test passed", status: "completed" },
};
const checkpoint = {
  type: "resume-session",
  harnessId: "codex",
  specificationVersion: "harness-v1",
  data: { threadId: "failed-run-fixture" },
};
const rateLimit = new Error(
  "exceeded retry limit, last status: 429 Too Many Requests"
);
// The deployed pre-recall native configuration is intentionally pinned here:
// changing it makes the installed Codex adapter restart an existing thread.
const resumeSafeInstructions =
  "You are Hive's Codex execution engine, shared by a small software team. Work only inside the connected repository and never claim an action you did not perform. Preserve teammate attribution in the prompt, but treat the latest labeled task as the instruction to execute. Inspect relevant files before editing and make the smallest coherent change that satisfies the request. Run the most relevant available checks after editing. Do not commit, push, deploy, access secrets, alter git history, or leave the repository working directory. If intent is ambiguous, inspect enough context to ask one precise question instead of guessing. Finish with a concise summary naming the files changed and checks actually run.";
let scenario;
let memoryQueries = [];
let sandboxStopped = false;
let cloneError, sandboxLookupError, expectedResume;
let cloneCalls = 0,
  sandboxGets = 0,
  sandboxCreates = 0,
  agentStarts = 0;
const cloneCredentials = {
  username: "x-access-token",
  password: "fixture-clone-token",
};
const sandbox = {
  async run({ command }) {
    assert.equal(
      sandboxStopped,
      false,
      "Read artifacts before stopping the caller-owned sandbox"
    );
    if (
      command.startsWith("git diff") &&
      scenario.artifactFailure === "unavailable"
    )
      throw new Error("Sandbox unavailable (fixture)");
    if (
      command.startsWith("git diff") &&
      scenario.artifactFailure === "git-error"
    ) {
      return {
        exitCode: 128,
        stdout: "",
        stderr: "fatal: repository unavailable (fixture)",
      };
    }
    const stdout =
      command === "git rev-parse --show-toplevel"
        ? "/vercel/sandbox/hive\n"
        : command.includes("--diff-filter=D")
          ? ""
          : command.startsWith("git diff --name-only")
            ? "nav.tsx\0"
            : command.startsWith("git diff --no-ext-diff")
              ? diff
              : "";
    return { exitCode: 0, stdout, stderr: "" };
  },
  async readTextFile() {
    return content;
  },
};

const persistentSandbox = {
  name: "hive-session-fixture",
  persistent: true,
  timeout: 1_800_000,
  tags: { session: "failed-run" },
  expiresAt: new Date(Date.now() + 1_800_000),
  currentSession: () => ({ sessionId: "fixture-vm" }),
  keepLastSnapshots: { count: 3 },
  async stop() {
    sandboxStopped = true;
    return {
      snapshot: { id: "snap-run-fixture", status: "created", createdAt: 50 },
    };
  },
};
mock.module("@vercel/sandbox", {
  namedExports: {
    Sandbox: {
      async getOrCreate(options) {
        sandboxCreates++;
        assert.equal(options.source.username, cloneCredentials.username);
        assert.equal(
          options.source.password,
          cloneCredentials.password,
          "New private clones must still use repository credentials"
        );
        return persistentSandbox;
      },
      async get() {
        sandboxGets++;
        if (sandboxLookupError) throw sandboxLookupError;
        return persistentSandbox;
      },
    },
  },
});
mock.module("@ai-sdk/sandbox-vercel", {
  namedExports: {
    createVercelSandbox() {
      return {};
    },
  },
});
mock.module("@ai-sdk/harness-codex", {
  namedExports: {
    createCodex(settings) {
      assert.equal(
        settings.reasoningEffort,
        scenario.effort ?? "low",
        "Shared effort must reach Codex, not just the UI"
      );
      return {
        async doStart() {
          return {};
        },
      };
    },
  },
});
mock.module(
  new URL("../../src/server/auth/github-app.ts", import.meta.url).href,
  {
    namedExports: {
      async getRepositoryCloneCredentials(repository) {
        cloneCalls++;
        assert.equal(repository.id, 1);
        assert.equal(repository.installationId, 1);
        if (cloneError) throw cloneError;
        return cloneCredentials;
      },
    },
  }
);
mock.module("@ai-sdk/harness/agent", {
  namedExports: {
    HarnessAgent: class {
      constructor(settings) {
        assert.equal(
          settings.model,
          scenario.modelOverride ?? "openai/gpt-5.1-codex-mini",
          "The coding default and explicit model override must reach the harness"
        );
        this.settings = settings;
      }
      async createSession(options) {
        agentStarts++;
        assert.equal(
          options.resumeFrom,
          expectedResume,
          "Resume the same native context, never replace it with a new session"
        );
        await this.settings.sandboxConfig.onSession({
          session: sandbox,
          sessionWorkDir: "/vercel/sandbox/hive",
        });
        await this.settings.harness.doStart({
          sandboxSession: {
            id: persistentSandbox.name,
            async setRequestTransformations() {},
          },
        });
        return {
          async stop() {
            if (scenario.checkpointFailure)
              throw new Error("Checkpoint unavailable (fixture)");
            return checkpoint;
          },
          async detach() {
            return checkpoint;
          },
        };
      }
      async stream({ prompt }) {
        // Match the public prepareCall contract; the installed SDK lifecycle is
        // exercised separately by check-memory-recall.mjs.
        const prepared = (await this.settings.prepareCall?.({
          prompt,
          model: this.settings.model,
          instructions: this.settings.instructions,
        })) ?? { prompt };
        if (scenario.memoryRecall) {
          assert.match(prepared.prompt, /RUNNER_MEMORY_CONVENTION/);
          assert.match(prepared.prompt, /Fixture Teammate/);
          assert.equal(
            prepared.instructions,
            resumeSafeInstructions,
            "Memory enrichment must not change the native thread configuration"
          );
          assert.doesNotMatch(
            prepared.instructions,
            /RUNNER_MEMORY_CONVENTION/
          );
        }
        return {
          fullStream: (async function* () {
            yield {
              type: "text-delta",
              text: "The test passed; checking the diff.",
            };
            yield {
              type: "tool-call",
              toolCallId: "test-1",
              toolName: "bash",
              input: { command: command.command },
            };
            yield {
              type: "tool-result",
              toolCallId: "test-1",
              toolName: "bash",
              input: { command: command.command },
              output: command.output,
            };
            yield {
              type: "tool-call",
              toolCallId: "test-2",
              toolName: "bash",
              input: { command: "pnpm typecheck" },
            };
            if (!scenario.fail || scenario.missingExitCode) {
              yield {
                type: "tool-result",
                toolCallId: "test-2",
                toolName: "bash",
                input: { command: "pnpm typecheck" },
                output: {
                  exitCode: scenario.missingExitCode ? null : 0,
                  output: scenario.missingExitCode
                    ? "Interrupted"
                    : "Type check passed",
                  status: "completed",
                },
              };
            }
            if (scenario.throwStream) throw rateLimit;
            if (scenario.fail) yield { type: "error", error: rateLimit };
          })(),
          text: Promise.resolve("Updated the label; both checks passed."),
        };
      }
    },
  },
});

const { runHiveCodingTask } =
  await import("../../src/server/agents/hive-runner.ts");
const { HiveAgentError } =
  await import("../../src/server/agents/hive-agent.ts");
const { repositoryMemoryId } =
  await import("../../src/server/agents/memory/hive-memory.ts");
const {
  applyHiveRunError,
  applyHiveRunResult,
  createInitialTaskSessionState,
  reduceTaskSession,
} = await import("../../src/lib/session/task-session.ts");
const connected = reduceTaskSession(
  createInitialTaskSessionState(10, "failed-run"),
  {
    type: "connect-repository",
    actor: "spencer",
    repositoryUrl: "https://github.com/example/hive",
    repositoryName: "example/hive",
    repositoryId: 1,
    repositoryBranch: "main",
    installationId: 1,
    visibility: "private",
    githubUserId: 1,
    githubLogin: "example",
  },
  20
);
const running = reduceTaskSession(
  connected,
  { type: "send-message", actor: "spencer", body: "Fix the steer label." },
  30
);
const previousSnapshot = {
  diff: "previous diff snapshot",
  files: [{ path: "previous.ts", content: "previous snapshot" }],
  changedFiles: ["previous.ts"],
};
for (const options of [
  { name: "provider error after a completed command", fail: true },
  {
    name: "stream throws after a completed command",
    fail: true,
    throwStream: true,
  },
  {
    name: "missing exit code is incomplete, never passed",
    fail: true,
    missingExitCode: true,
  },
  {
    name: "unreachable sandbox preserves earlier snapshots and current commands",
    fail: true,
    artifactFailure: "unavailable",
  },
  {
    name: "git error is not displayed as a code diff",
    fail: true,
    artifactFailure: "git-error",
  },
  {
    name: "checkpoint failure still retains command and file evidence",
    fail: true,
    checkpointFailure: true,
  },
  {
    name: "normal completion still retains all commands and reviewable files",
    fail: false,
  },
  {
    name: "medium effort reaches the Codex harness",
    fail: false,
    effort: "medium",
  },
  {
    name: "high effort reaches the Codex harness",
    fail: false,
    effort: "high",
  },
  {
    name: "an explicit coding model overrides the free-tier coding default",
    fail: false,
    modelOverride: "openai/controlled-model-override",
  },
  {
    name: "the coding runner supplies server-owned repository recall before the native prompt",
    fail: false,
    memoryRecall: true,
  },
]) {
  scenario = options;
  // This standalone controlled runner never contacts the selected model.
  process.env.HIVE_CODEX_MODEL = options.modelOverride ?? "";
  process.env.MEM0_API_KEY = options.memoryRecall
    ? "fixture-not-a-real-key"
    : "";
  memoryQueries = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(
      url,
      "https://api.mem0.ai/v3/memories/search/",
      "Automatic recall must never write or call another service"
    );
    memoryQueries.push(JSON.parse(String(init.body)));
    return Response.json({
      results: [
        {
          id: "m1",
          memory: "RUNNER_MEMORY_CONVENTION",
          metadata: {
            hive_scope: repositoryMemoryId({
              installationId: 1,
              repositoryId: 1,
            }),
            author_name: "Fixture Teammate",
          },
        },
      ],
    });
  };
  sandboxStopped = false;
  const initial = {
    ...running,
    workspace: {
      ...running.workspace,
      codingEffort: options.effort,
      ...previousSnapshot,
    },
  };
  const publicText = [];
  let failure;
  let result;
  try {
    result = await runHiveCodingTask(initial, "spencer", undefined, {
      memoryQuery: "Fix the steer label.",
      onText(body) {
        publicText.push(body);
      },
    });
  } catch (error) {
    failure = error;
  }
  if (options.fail) {
    assert.ok(failure instanceof HiveAgentError, options.name);
    assert.equal(
      failure.cause,
      rateLimit,
      "Secondary snapshot errors must not replace the original run error"
    );
  } else {
    assert.equal(failure, undefined);
  }
  const state = options.fail
    ? applyHiveRunError(initial, failure.message, 40, failure.checkpoint)
    : applyHiveRunResult(initial, result, 40);
  assert.equal(
    taskExecution(state).kind,
    options.fail ? "failed" : "completed"
  );
  assert.deepEqual(
    state.workspace.agentSession.resumeFrom,
    options.checkpointFailure
      ? initial.workspace.agentSession.resumeFrom
      : checkpoint
  );
  assert.equal(
    state.workspace.diff,
    options.artifactFailure ? previousSnapshot.diff : diff,
    "Files / Diff must retain available changes without inserting an error as code"
  );
  assert.deepEqual(
    state.workspace.files,
    options.artifactFailure
      ? previousSnapshot.files
      : [{ path: "nav.tsx", content }]
  );
  assert.deepEqual(
    state.workspace.changedFiles,
    options.artifactFailure ? previousSnapshot.changedFiles : ["nav.tsx"]
  );
  assert.equal(state.workspace.commands.length, 2);
  assert.equal(
    state.workspace.commands[0]?.command,
    "pnpm test",
    "Runs must retain completed commands before the failure"
  );
  assert.equal(state.workspace.commands[0]?.exitCode, 0);
  assert.equal(state.workspace.commands[0]?.output, "1 test passed");
  assert.equal(state.workspace.commands[1]?.exitCode, options.fail ? null : 0);
  assert.deepEqual(
    publicText,
    ["The test passed; checking the diff."],
    "Tool results must stay out of the chat"
  );
  assert.equal(
    sandboxStopped,
    options.fail,
    "successful turns remain warm; failed turns stop and preserve recovery evidence"
  );
  assert.deepEqual(
    memoryQueries,
    options.memoryRecall
      ? [
          {
            query: "Fix the steer label.",
            filters: {
              AND: [
                {
                  user_id: repositoryMemoryId({
                    installationId: 1,
                    repositoryId: 1,
                  }),
                },
                { app_id: "hive" },
              ],
            },
            top_k: 3,
            rerank: false,
          },
        ]
      : []
  );
  console.log(`PASS: ${options.name}`);
}

// Reproduce the production GitHub 500 at the real runner boundary. A saved
// native session must not depend on credentials used only by fresh git clones.
const { displayHiveErrorMessage } =
  await import("../../src/lib/agents/hive-error-copy.ts");
const repositoryFailureCopy =
  "Couldn't get GitHub repository access. The agent hasn't started. Try again.";
scenario = { fail: false };
process.env.HIVE_CODEX_MODEL = "";
process.env.MEM0_API_KEY = "";
globalThis.fetch = async () => {
  throw new Error("This regression must not access the network");
};
const resumed = {
  ...running,
  workspace: {
    ...running.workspace,
    ...previousSnapshot,
    agentSession: { ...running.workspace.agentSession, resumeFrom: checkpoint },
  },
};
expectedResume = checkpoint;
cloneError = Object.assign(
  new Error("GitHub token endpoint failed; fixture-private-details"),
  {
    status: 500,
    response: { headers: { "x-github-request-id": "FIXTURE-500" } },
  }
);
cloneCalls = sandboxGets = sandboxCreates = agentStarts = 0;
sandboxStopped = false;
const continued = await runHiveCodingTask(resumed, "spencer");
assert.equal(
  cloneCalls,
  0,
  "GitHub token failure must not block an existing task"
);
assert.equal(sandboxGets, 1);
assert.equal(sandboxCreates, 0);
assert.equal(agentStarts, 1);
assert.equal(continued.agentSession.resumeFrom, checkpoint);
assert.equal(sandboxStopped, false);
console.log(
  "PASS: resumed task runs once with its saved native context and no clone-credential request, even when GitHub token issuance fails"
);

sandboxLookupError = new Error("Existing sandbox is unavailable (fixture)");
await assert.rejects(runHiveCodingTask(resumed, "spencer"), (error) => {
  assert.equal(error.cause, sandboxLookupError);
  return true;
});
assert.equal(cloneCalls, 0);
assert.equal(
  sandboxCreates,
  0,
  "A failed resume must never fall back to cloning a replacement workspace"
);
assert.equal(agentStarts, 1);
sandboxLookupError = undefined;
console.log(
  "PASS: failed environment lookup preserves the resume boundary without recloning or rerunning"
);

expectedResume = undefined;
for (const status of [500, 401, 403]) {
  cloneError = Object.assign(new Error("fixture-private-details"), {
    status,
    response: { headers: { "x-github-request-id": `FIXTURE-${status}` } },
  });
  cloneCalls = sandboxGets = sandboxCreates = agentStarts = 0;
  await assert.rejects(runHiveCodingTask(running, "spencer"), (error) => {
    assert.ok(error instanceof HiveAgentError);
    assert.equal(
      error.cause,
      cloneError,
      "Keep the original GitHub request ID available to server diagnostics"
    );
    assert.equal(error.message, repositoryFailureCopy);
    assert.equal(
      displayHiveErrorMessage(error.message),
      repositoryFailureCopy,
      "The UI must preserve the failure stage instead of displaying a generic/model-auth error"
    );
    const state = applyHiveRunError(
      running,
      error.message,
      40,
      error.checkpoint
    );
    assert.equal(taskExecution(state).kind, "failed");
    assert.equal(
      state.workspace.liveReply,
      undefined,
      "Credential failure must release the running state"
    );
    assert.doesNotMatch(
      JSON.stringify(state),
      /fixture-private-details|FIXTURE-|fixture-clone-token/
    );
    return true;
  });
  assert.equal(cloneCalls, 1, "No retry loop on credential failure");
  assert.equal(
    sandboxGets + sandboxCreates + agentStarts,
    0,
    "Do not start anything or use broader credentials after clone authentication fails"
  );
  console.log(
    `PASS: fresh task GitHub ${status} fails once before Agent start, with safe repository-specific UI copy`
  );
}
cloneError = undefined;
cloneCalls = sandboxGets = sandboxCreates = agentStarts = 0;
await runHiveCodingTask(running, "spencer");
assert.equal(cloneCalls, 1);
assert.equal(sandboxCreates, 1);
assert.equal(sandboxGets, 0);
assert.equal(agentStarts, 1);
console.log(
  "PASS: fresh task still supplies repository-scoped clone credentials and starts once"
);
