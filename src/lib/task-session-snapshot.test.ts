import assert from "node:assert/strict";
import test from "node:test";

import {
  appendHiveReply,
  createInitialTaskSessionState,
  memberDirectory,
  reduceTaskSession,
} from "./task-session.ts";
import {
  publicTaskSessionSnapshot,
  receiveAgentReply,
  receiveTaskSessionSnapshot,
} from "./task-session-snapshot.ts";
import type { PrivateTaskSessionSnapshot as TaskSessionSnapshot } from "./task-session-contract.ts";
import { codingModelOptions, CODEX_GATEWAY_MODEL } from "./coding-models.ts";

function snapshot(sessionId = "shared-task"): TaskSessionSnapshot {
  return {
    session: createInitialTaskSessionState(1, sessionId),
    members: [],
    activeMembers: [],
    typingMembers: [],
  };
}

test("team archive and restore reach clients through public snapshots without stale state reopening a task", () => {
  const before = snapshot();
  const members = Object.values(memberDirectory);
  const archived = publicTaskSessionSnapshot({
    ...before,
    session: reduceTaskSession(
      before.session,
      { type: "archive-task", actor: members[0].id },
      2,
      members
    ),
  });
  assert.ok(receiveTaskSessionSnapshot(before, archived).session.archived);
  assert.equal(receiveTaskSessionSnapshot(archived, before), archived);
  const restored = publicTaskSessionSnapshot({
    ...archived,
    session: reduceTaskSession(
      archived.session,
      { type: "restore-task", actor: members[1].id },
      3,
      members
    ),
  });
  assert.equal(
    receiveTaskSessionSnapshot(archived, restored).session.archived,
    undefined
  );
  assert.equal(receiveTaskSessionSnapshot(restored, archived), restored);
});

test("late reconnect snapshots and action responses cannot roll back team messages", async () => {
  const before = snapshot();
  const after = {
    ...before,
    session: reduceTaskSession(
      before.session,
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor: "spencer",
        body: "Fix the navigation",
      },
      2
    ),
  };

  for (const source of ["reconnect", "action", "websocket"]) {
    let current = before;
    let deliverOld!: (value: TaskSessionSnapshot) => void;
    const pendingOldResponse = new Promise<TaskSessionSnapshot>((resolve) => {
      deliverOld = resolve;
    }).then((incoming) => {
      current = receiveTaskSessionSnapshot(current, incoming);
    });
    current = receiveTaskSessionSnapshot(current, after);
    deliverOld(before);
    await pendingOldResponse;
    assert.deepEqual(current.session.messages, after.session.messages, source);
    assert.equal(current.session.stage, "running", source);
  }
});

test("response checkpoints cannot roll back text or advance past unseen team actions", () => {
  const current = snapshot();
  current.session.workspace.liveReply = {
    id: "run-1",
    body: "Hello",
    sequence: 1,
    startedAt: 2,
  };
  const reply = {
    ...current.session.workspace.liveReply,
    body: "Hello team",
    sequence: 2,
  };
  const streamed = receiveAgentReply(current, "shared-task", reply);
  assert.equal(
    streamed.session.version,
    current.session.version,
    "reply sequence is not the task version"
  );
  assert.equal(streamed.session.workspace.liveReply?.body, "Hello team");
  assert.equal(
    receiveAgentReply(
      streamed,
      "shared-task",
      current.session.workspace.liveReply
    ),
    streamed
  );
  assert.equal(receiveAgentReply(streamed, "another-task", reply), streamed);
  assert.equal(
    receiveAgentReply(streamed, "shared-task", {
      ...reply,
      id: "old-run",
      sequence: 99,
    }),
    streamed
  );

  const queuedSnapshot = {
    ...current,
    session: { ...current.session, version: current.session.version + 1 },
  };
  const received = receiveTaskSessionSnapshot(streamed, queuedSnapshot);
  assert.equal(received.session.version, queuedSnapshot.session.version);
  assert.equal(
    received.session.workspace.liveReply?.sequence,
    2,
    "a concurrent team action must preserve newer reply text"
  );
});

test("late stream packets never resurrect a finished reply", () => {
  const current = snapshot();
  assert.equal(
    receiveAgentReply(current, "shared-task", {
      id: "old",
      body: "late",
      sequence: 9,
      startedAt: 1,
    }),
    current
  );
});

test("same-version presence updates still refresh without changing the transcript", () => {
  const before = snapshot();
  const incoming = {
    ...before,
    activeMembers: ["spencer"],
    typingMembers: ["spencer"],
  };
  assert.deepEqual(receiveTaskSessionSnapshot(before, incoming), incoming);
});

test("shared coding effort survives public snapshots, reconnects, and stale updates", () => {
  const before = snapshot();
  const after = publicTaskSessionSnapshot({
    ...before,
    session: reduceTaskSession(
      before.session,
      { type: "set-coding-effort", actor: "spencer", effort: "high" },
      2
    ),
  });
  assert.equal(after.session.workspace.codingEffort, "high");
  assert.equal(
    receiveTaskSessionSnapshot(before, after).session.workspace.codingEffort,
    "high"
  );
  assert.equal(
    receiveTaskSessionSnapshot(after, before).session.workspace.codingEffort,
    "high"
  );
});

test("model selection and display metadata survive public projection, reconnect and stale updates", () => {
  const before = snapshot();
  const models = codingModelOptions(CODEX_GATEWAY_MODEL, true);
  const session = reduceTaskSession(
    before.session,
    {
      type: "select-harness",
      actor: "spencer",
      runtime: "claude-code",
      modelId: "claude-fable-5",
    },
    2,
    [],
    models
  );
  const after = publicTaskSessionSnapshot({
    ...before,
    session,
    codingModels: models,
  });
  assert.deepEqual(after.codingModels, models);
  assert.equal(after.session.workspace.codingModel, "claude-fable-5");
  assert.deepEqual(
    receiveTaskSessionSnapshot(before, after).codingModels,
    models
  );
  assert.equal(
    receiveTaskSessionSnapshot(before, after).session.workspace.codingModel,
    "claude-fable-5"
  );
  assert.equal(
    receiveTaskSessionSnapshot(after, before).session.workspace.codingModel,
    "claude-fable-5"
  );
});

test("a late response from another task never replaces the current task", () => {
  const current = snapshot("current-task");
  const other = snapshot("other-task");
  other.session.version = 100;
  assert.equal(receiveTaskSessionSnapshot(current, other), current);
});

test("reset advances the synchronization version even without an attached repository", () => {
  const before = snapshot();
  const asked = reduceTaskSession(
    before.session,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Discuss the task",
    },
    2
  );
  assert.equal(
    reduceTaskSession(asked, { type: "reset", actor: "spencer" }, 3),
    asked,
    "a planning turn in progress blocks reset"
  );
  const changed = appendHiveReply(asked, "Let us define the outcome first.", 3);
  const reset = reduceTaskSession(
    changed,
    { type: "reset", actor: "spencer" },
    4
  );
  assert.equal(reset.version, changed.version + 1);
  assert.equal(
    receiveTaskSessionSnapshot(
      { ...before, session: changed },
      { ...before, session: reset }
    ).session,
    reset
  );
});

test("page and API snapshots preserve history but never serialize the Codex checkpoint", () => {
  const stored = snapshot();
  stored.session.workspace.agentSession = {
    id: "hive-codex-session",
    runtime: "codex",
    resumeFrom: {
      type: "resume-session",
      specificationVersion: "harness-v1",
      harnessId: "codex",
      data: { privateCheckpoint: "server-only-checkpoint-fixture" },
    },
  };
  const projected = publicTaskSessionSnapshot(stored);
  assert.deepEqual(projected.session.messages, stored.session.messages);
  assert.deepEqual(projected.session.workspace.agentSession, {
    id: "hive-codex-session",
    runtime: "codex",
  });
  assert.equal(
    JSON.stringify(projected).includes("server-only-checkpoint-fixture"),
    false
  );
  assert.ok(
    stored.session.workspace.agentSession.resumeFrom,
    "projection must not mutate stored recovery state"
  );
});
