import assert from "node:assert/strict";
import test from "node:test";

import { resolvePersistentSandboxName } from "./hive-session.ts";

function roomWithSandboxName(sandboxName?: string) {
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

test("new Codex sessions receive a dedicated persistent room sandbox", () => {
  assert.equal(
    resolvePersistentSandboxName(roomWithSandboxName(), "session-1"),
    "hive-room-session-1",
  );
});

test("a saved room sandbox identity is reused across turns", () => {
  assert.equal(
    resolvePersistentSandboxName(
      roomWithSandboxName("hive-room-session-1"),
      "session-1",
    ),
    "hive-room-session-1",
  );
});

test("a previously successful Harness sandbox remains resumable", () => {
  assert.equal(
    resolvePersistentSandboxName(
      roomWithSandboxName("ai-sdk-harness-session-session-1"),
      "session-1",
    ),
    "ai-sdk-harness-session-session-1",
  );
});

test("unrelated legacy workspace names are not treated as Codex history", () => {
  assert.equal(
    resolvePersistentSandboxName(
      roomWithSandboxName("hive-orbit-nav-legacy"),
      "session-1",
    ),
    "hive-room-session-1",
  );
});
