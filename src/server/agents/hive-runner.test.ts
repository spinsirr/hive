import assert from "node:assert/strict";
import test from "node:test";

import {
  isRepositoryWorkingCopy,
  resolvePersistentSandboxName,
} from "../workspace/hive-sandbox.ts";

function sessionWithSandboxName(sandboxName?: string) {
  return {
    workspace: {
      status: "ready" as const,
      sandboxName,
      diff: "",
      files: [],
      commands: [],
      changedFiles: [],
    },
  };
}

test("new Codex sessions receive a dedicated persistent session sandbox", () => {
  assert.equal(
    resolvePersistentSandboxName(sessionWithSandboxName(), "session-1"),
    "hive-session-session-1"
  );
});

test("a saved session sandbox identity is reused across turns", () => {
  assert.equal(
    resolvePersistentSandboxName(
      sessionWithSandboxName("hive-session-session-1"),
      "session-1"
    ),
    "hive-session-session-1"
  );
});

test("a previously successful Harness sandbox remains resumable", () => {
  assert.equal(
    resolvePersistentSandboxName(
      sessionWithSandboxName("ai-sdk-harness-session-session-1"),
      "session-1"
    ),
    "ai-sdk-harness-session-session-1"
  );
});

test("unrelated legacy workspace names are not treated as Codex history", () => {
  assert.equal(
    resolvePersistentSandboxName(
      sessionWithSandboxName("hive-orbit-nav-legacy"),
      "session-1"
    ),
    "hive-session-session-1"
  );
});

test("a parent git repository does not satisfy the session workdir guard", () => {
  assert.equal(
    isRepositoryWorkingCopy("/vercel/sandbox/hive", "/vercel/sandbox\n"),
    false
  );
  assert.equal(
    isRepositoryWorkingCopy("/vercel/sandbox/hive", "/vercel/sandbox/hive\n"),
    true
  );
});
