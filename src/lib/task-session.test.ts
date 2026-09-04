import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHiveRunError,
  applyHiveRunResult,
  appendHiveReply,
  createInitialTaskSessionState,
  reduceTaskSession,
  type TaskSessionState,
} from "./task-session.ts";

function connectedSession(): TaskSessionState {
  return reduceTaskSession(
    createInitialTaskSessionState(1),
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
  const connected = connectedSession();
  const discussion = reduceTaskSession(
    connected,
    { type: "send-message", actor: "spencer", body: "@maya thoughts?" },
    20,
  );
  const task = reduceTaskSession(
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

test("a task can begin with Hive before a repository is attached", () => {
  const initial = createInitialTaskSessionState(1, "clarify-task", {
    title: "Clarify navigation behavior",
    createdBy: "spencer",
  });
  const running = reduceTaskSession(
    initial,
    { type: "send-message", actor: "spencer", body: "Help us define the acceptance criteria." },
    2,
  );

  assert.equal(running.stage, "running");
  assert.equal(running.repository, undefined);
  assert.equal(running.workspace.status, "disconnected");
  assert.equal(running.workspace.agentSession, undefined);
  assert.equal(running.workspace.startedAt, 2);

  const replied = appendHiveReply(running, "Let’s first define the active route behavior.", 3);
  assert.equal(replied.stage, "waiting");
  assert.equal(replied.workspace.startedAt, undefined);
  assert.equal(replied.workspace.completedAt, 3);
});

test("attaching a repository preserves the task transcript and existing Codex identity", () => {
  const initial = createInitialTaskSessionState(1, "late-repo", {
    title: "Fix the secondary navigation",
    createdBy: "spencer",
  });
  const withRuntime = {
    ...initial,
    workspace: {
      ...initial.workspace,
      agentSession: { id: "codex-existing", runtime: "codex" as const },
      sandboxName: "hive-session-codex-existing",
    },
  };
  const connected = reduceTaskSession(
    withRuntime,
    {
      type: "connect-repository",
      actor: "spencer",
      repositoryUrl: "https://github.com/team/project.git",
      repositoryName: "team/project",
      repositoryId: 42,
      repositoryBranch: "main",
      installationId: 7,
      visibility: "private",
      githubUserId: 10,
      githubLogin: "spencer",
    },
    4,
  );

  assert.equal(connected.title, initial.title);
  assert.equal(connected.messages.length, initial.messages.length + 1);
  assert.equal(connected.workspace.agentSession?.id, "codex-existing");
  assert.equal(connected.workspace.sandboxName, "hive-session-codex-existing");

  const ignoredReplacement = reduceTaskSession(
    connected,
    {
      type: "connect-repository",
      actor: "spencer",
      repositoryUrl: "https://github.com/team/other.git",
      repositoryName: "team/other",
      repositoryId: 43,
      repositoryBranch: "main",
      installationId: 7,
      visibility: "private",
      githubUserId: 10,
      githubLogin: "spencer",
    },
    5,
  );
  assert.equal(ignoredReplacement.repository?.name, "team/project");
});

test("a completed task is immutable until a teammate reopens it", () => {
  const initial = createInitialTaskSessionState(1, "completed-task", {
    title: "Finish navigation polish",
    createdBy: "spencer",
  });
  const completed = reduceTaskSession(
    initial,
    { type: "complete-session", actor: "spencer" },
    2,
  );
  assert.equal(completed.lifecycle, "completed");
  assert.equal(completed.completedAt, 2);

  const ignored = reduceTaskSession(
    completed,
    { type: "send-message", actor: "spencer", body: "One more thing" },
    3,
  );
  assert.equal(ignored.messages.length, completed.messages.length);

  const reopened = reduceTaskSession(
    completed,
    { type: "reopen-session", actor: "spencer" },
    4,
  );
  assert.equal(reopened.lifecycle, "active");
  assert.equal(reopened.completedAt, undefined);
});

test("authenticated GitHub members keep real attribution and mentions human-only", () => {
  const members = [
    {
      id: "github-101",
      name: "Ada Lovelace",
      shortName: "Ada",
      initials: "AL",
      githubLogin: "ada",
    },
    {
      id: "github-202",
      name: "Grace Hopper",
      shortName: "Grace",
      initials: "GH",
      githubLogin: "ghopper",
    },
  ];
  const connected = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "connect-repository",
      actor: members[0].id,
      repositoryUrl: "https://github.com/team/project.git",
      repositoryName: "team/project",
      repositoryId: 1,
      repositoryBranch: "main",
      installationId: 2,
      visibility: "private",
      githubUserId: 101,
      githubLogin: "ada",
    },
    10,
    members,
  );
  const discussion = reduceTaskSession(
    connected,
    { type: "send-message", actor: members[0].id, body: "@ghopper thoughts?" },
    20,
    members,
  );

  assert.equal(discussion.stage, "waiting");
  assert.equal(discussion.messages.at(-1)?.name, "Ada Lovelace");
  assert.equal(discussion.messages.at(-1)?.memberId, "github-101");
});

test("an annotation created during a run waits for an explicit safe boundary", () => {
  const running = reduceTaskSession(
    connectedSession(),
    { type: "send-message", actor: "spencer", body: "Update the menu" },
    20,
  );
  const sourceMessage = running.messages.at(-1);
  assert.ok(sourceMessage);

  const annotated = reduceTaskSession(
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

  const queued = reduceTaskSession(
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

  const applied = reduceTaskSession(
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
  const running = reduceTaskSession(
    connectedSession(),
    { type: "send-message", actor: "spencer", body: "Update the menu" },
    20,
  );
  const sourceMessage = running.messages.at(-1);
  assert.ok(sourceMessage);
  const review = applyHiveRunResult(
    running,
    {
      sandboxName: "hive-session-test",
      agentSession: running.workspace.agentSession!,
      summary: "Updated the menu.",
      diff: "+ update",
      files: [],
      commands: [],
      changedFiles: ["nav.tsx"],
    },
    30,
  );
  const annotated = reduceTaskSession(
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

  const steered = reduceTaskSession(
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
    ...connectedSession(),
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
  const connected = connectedSession();
  const session = {
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
  const reset = reduceTaskSession(session, { type: "reset", actor: "maya" }, 40);

  assert.equal(reset.repository?.name, "spinsirr/hive");
  assert.equal(reset.stage, "waiting");
  assert.equal(reset.workspace.status, "ready");
  assert.deepEqual(reset.workspace.changedFiles, []);
  assert.equal(reset.messages.length, 1);
  assert.notEqual(
    reset.workspace.agentSession?.id,
    session.workspace.agentSession?.id,
  );
});

test("a second task sent during a run joins the attributed steering queue", () => {
  const running = reduceTaskSession(
    connectedSession(),
    { type: "send-message", actor: "spencer", body: "Update the menu" },
    20,
  );
  const sessionId = running.workspace.agentSession?.id;
  const queued = reduceTaskSession(
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
  const connected = connectedSession();
  const originalSessionId = connected.workspace.agentSession?.id;
  const failed = applyHiveRunError(connected, "failed", 50);

  assert.equal(failed.workspace.agentSession?.runtime, "codex");
  assert.equal(failed.workspace.agentSession?.id, originalSessionId);
  assert.equal(failed.workspace.agentSession?.resumeFrom, undefined);
});

test("a transient error preserves a resumable Codex session", () => {
  const connected = connectedSession();
  const resumeFrom = {
    type: "resume-session" as const,
    harnessId: "codex",
    specificationVersion: "harness-v1" as const,
    data: { threadId: "thread-1" },
  };
  const resumable: TaskSessionState = {
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
  const connected = connectedSession();
  const resumeFrom = {
    type: "resume-session" as const,
    harnessId: "codex",
    specificationVersion: "harness-v1" as const,
    data: { threadId: "thread-after-rate-limit" },
  };
  const failed = applyHiveRunError(connected, "rate limited", 80, {
    sandboxName: "hive-session-durable",
    agentSession: {
      id: connected.workspace.agentSession!.id,
      runtime: "codex",
      resumeFrom,
    },
  });

  assert.equal(failed.workspace.sandboxName, "hive-session-durable");
  assert.deepEqual(failed.workspace.agentSession?.resumeFrom, resumeFrom);
});
