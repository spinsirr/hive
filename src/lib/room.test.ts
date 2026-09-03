import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHiveRunError,
  applyHiveRunResult,
  createInitialRoomState,
  reduceRoom,
  type RoomState,
} from "./room.ts";

function connectedRoom(): RoomState {
  return reduceRoom(
    createInitialRoomState(1),
    {
      type: "connect-repository",
      actor: "spencer",
      repositoryUrl: "https://github.com/spinsirr/hive.git",
      repositoryName: "spinsirr/hive",
      repositoryId: 1,
      repositoryBranch: "main",
      installationId: 2,
      visibility: "private",
      githubUserId: 3,
      githubLogin: "spinsirr",
    },
    10,
  );
}

test("team messages stay in discussion while Hive tasks start one shared run", () => {
  const connected = connectedRoom();
  const discussion = reduceRoom(
    connected,
    { type: "send-message", actor: "spencer", body: "@maya thoughts?" },
    20,
  );
  const task = reduceRoom(
    discussion,
    { type: "send-message", actor: "maya", body: "Inspect the navigation" },
    30,
  );

  assert.equal(discussion.stage, "waiting");
  assert.equal(discussion.workspace.status, "ready");
  assert.equal(task.stage, "running");
  assert.equal(task.workspace.status, "running");
  assert.equal(task.messages.at(-1)?.memberId, "maya");
});

test("an annotation created during a run waits for an explicit safe boundary", () => {
  const running = reduceRoom(
    connectedRoom(),
    { type: "send-message", actor: "spencer", body: "Update the menu" },
    20,
  );
  const sourceMessage = running.messages.at(-1);
  assert.ok(sourceMessage);

  const annotated = reduceRoom(
    running,
    {
      type: "annotate-message",
      actor: "maya",
      messageId: sourceMessage.id,
      body: "Keep the interaction keyboard accessible",
    },
    30,
  );
  const annotation = annotated.messages.at(-1)?.annotations?.[0];
  assert.ok(annotation);

  const queued = reduceRoom(
    annotated,
    {
      type: "steer-message-annotation",
      actor: "maya",
      messageId: sourceMessage.id,
      annotationId: annotation.id,
    },
    40,
  );

  assert.equal(queued.steeringQueue.length, 1);
  assert.equal(queued.activeSteer, undefined);
  assert.equal(
    queued.messages.at(-1)?.annotations?.[0]?.status,
    "queued",
  );

  const applied = reduceRoom(
    queued,
    { type: "apply-next-steer", actor: "spencer" },
    50,
  );
  assert.equal(applied.steeringQueue.length, 0);
  assert.equal(applied.activeSteer?.body, annotation.body);
  assert.equal(
    applied.messages.at(-1)?.annotations?.[0]?.status,
    "steered",
  );
});

test("a review annotation can start the next turn in the same Codex session", () => {
  const running = reduceRoom(
    connectedRoom(),
    { type: "send-message", actor: "spencer", body: "Update the menu" },
    20,
  );
  const sourceMessage = running.messages.at(-1);
  assert.ok(sourceMessage);
  const review = applyHiveRunResult(
    running,
    {
      sandboxName: "hive-room-test",
      agentSession: running.workspace.agentSession!,
      summary: "Updated the menu.",
      diff: "+ update",
      files: [],
      commands: [],
      changedFiles: ["nav.tsx"],
    },
    30,
  );
  const annotated = reduceRoom(
    review,
    {
      type: "annotate-message",
      actor: "maya",
      messageId: sourceMessage.id,
      body: "Keep the parent item expanded",
    },
    40,
  );
  const annotation = annotated.messages
    .find((message) => message.id === sourceMessage.id)
    ?.annotations?.[0];
  assert.ok(annotation);

  const steered = reduceRoom(
    annotated,
    {
      type: "steer-message-annotation",
      actor: "maya",
      messageId: sourceMessage.id,
      annotationId: annotation.id,
    },
    50,
  );

  assert.equal(steered.stage, "running");
  assert.equal(steered.workspace.status, "running");
  assert.equal(steered.workspace.agentSession?.id, review.workspace.agentSession?.id);
  assert.equal(
    steered.messages
      .find((message) => message.id === sourceMessage.id)
      ?.annotations?.[0]?.status,
    "steered",
  );
});

test("a completed run stays running when another steer is queued", () => {
  const running = {
    ...connectedRoom(),
    stage: "running" as const,
    steeringQueue: [
      {
        id: "steer-1",
        body: "Use the compact variant",
        authorId: "maya" as const,
        queuedAt: 20,
        source: { kind: "workspace-annotation" as const },
        sourceLabel: "Preview annotation",
      },
    ],
  };
  const completed = applyHiveRunResult(
    running,
    {
      sandboxName: "hive-test",
      agentSession: running.workspace.agentSession!,
      summary: "Updated the navigation.",
      diff: "+ compact",
      files: [],
      commands: [],
      changedFiles: ["nav.tsx"],
    },
    30,
  );

  assert.equal(completed.stage, "running");
  assert.equal(completed.workspace.status, "running");
  assert.equal(completed.workspace.changedFiles[0], "nav.tsx");
});

test("reset preserves the repository but clears run artifacts", () => {
  const connected = connectedRoom();
  const room = {
    ...connected,
    stage: "review" as const,
    workspace: {
      ...connected.workspace,
      status: "review" as const,
      diff: "+ change",
      files: [{ path: "nav.tsx", content: "change" }],
      commands: [{ command: "pnpm test", output: "ok", exitCode: 0 }],
      changedFiles: ["nav.tsx"],
    },
  };
  const reset = reduceRoom(room, { type: "reset", actor: "maya" }, 40);

  assert.equal(reset.repository?.name, "spinsirr/hive");
  assert.equal(reset.stage, "waiting");
  assert.equal(reset.workspace.status, "ready");
  assert.deepEqual(reset.workspace.changedFiles, []);
  assert.equal(reset.messages.length, 1);
  assert.notEqual(
    reset.workspace.agentSession?.id,
    room.workspace.agentSession?.id,
  );
});

test("a second task sent during a run joins the attributed steering queue", () => {
  const running = reduceRoom(
    connectedRoom(),
    { type: "send-message", actor: "spencer", body: "Update the menu" },
    20,
  );
  const sessionId = running.workspace.agentSession?.id;
  const queued = reduceRoom(
    running,
    { type: "send-message", actor: "maya", body: "Keep it compact" },
    30,
  );

  assert.equal(queued.stage, "running");
  assert.equal(queued.workspace.startedAt, 20);
  assert.equal(queued.workspace.agentSession?.id, sessionId);
  assert.equal(queued.steeringQueue.length, 1);
  assert.equal(queued.steeringQueue[0]?.authorId, "maya");
  assert.equal(queued.steeringQueue[0]?.body, "Keep it compact");
  assert.equal(queued.steeringQueue[0]?.source.kind, "message");
});

test("a failed start preserves the Codex session identity", () => {
  const connected = connectedRoom();
  const originalSessionId = connected.workspace.agentSession?.id;
  const failed = applyHiveRunError(connected, "failed", 50);

  assert.equal(failed.workspace.agentSession?.runtime, "codex");
  assert.equal(failed.workspace.agentSession?.id, originalSessionId);
  assert.equal(failed.workspace.agentSession?.resumeFrom, undefined);
});

test("a transient error preserves a resumable Codex session", () => {
  const connected = connectedRoom();
  const resumeFrom = {
    type: "resume-session" as const,
    harnessId: "codex",
    specificationVersion: "harness-v1" as const,
    data: { threadId: "thread-1" },
  };
  const resumable: RoomState = {
    ...connected,
    workspace: {
      ...connected.workspace,
      agentSession: {
        id: "hive-existing",
        runtime: "codex",
        resumeFrom,
      },
    },
  };

  const failed = applyHiveRunError(resumable, "failed", 70);

  assert.equal(failed.workspace.agentSession?.id, "hive-existing");
  assert.deepEqual(failed.workspace.agentSession?.resumeFrom, resumeFrom);
});

test("a failed turn persists the latest Codex checkpoint", () => {
  const connected = connectedRoom();
  const resumeFrom = {
    type: "resume-session" as const,
    harnessId: "codex",
    specificationVersion: "harness-v1" as const,
    data: { threadId: "thread-after-rate-limit" },
  };
  const failed = applyHiveRunError(connected, "rate limited", 80, {
    sandboxName: "hive-room-durable",
    agentSession: {
      id: connected.workspace.agentSession!.id,
      runtime: "codex",
      resumeFrom,
    },
  });

  assert.equal(failed.workspace.sandboxName, "hive-room-durable");
  assert.deepEqual(failed.workspace.agentSession?.resumeFrom, resumeFrom);
});
