import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHiveRunError,
  applyHiveRunResult,
  appendHiveReply,
  canApplyNextSteer,
  canSelectHarness,
  canSetCodingEffort,
  createInitialTaskSessionState,
  didStartHiveRun,
  isHiveRunActive,
  isHiveRunStalled,
  MESSAGE_BODY_LIMIT,
  reduceTaskSession,
  STALLED_RUN_AFTER_MS,
  type TaskSessionState,
} from "./task-session.ts";
import { isCodingEffort } from "../agents/coding-effort.ts";
import {
  codingModelOptions,
  CODEX_SUBSCRIPTION_MODEL,
} from "../agents/coding-models.ts";

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
    10
  );
}

function finishInspection(state: TaskSessionState, diff = "") {
  return applyHiveRunResult(
    state,
    {
      sandboxName: "hive-session-test",
      agentSession: state.workspace.agentSession!,
      summary: diff
        ? "Updated navigation."
        : "Inspected the repository; no changes.",
      diff,
      files: [],
      changedFiles: diff ? ["nav.tsx"] : [],
      commands: [{ command: "git status --short", output: "", exitCode: 0 }],
    },
    40
  );
}

test("a new task stays empty until a member sends the first message", () => {
  for (const title of ["", "Plan navigation"]) {
    const initial = createInitialTaskSessionState(1, "empty-task", {
      title,
      createdBy: "spencer",
    });
    assert.deepEqual(initial.messages, []);
    assert.equal(isHiveRunActive(initial), false);
    assert.equal(initial.workspace.agentSession, undefined);
    const running = reduceTaskSession(
      initial,
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor: "spencer",
        body: "Help us plan navigation",
      },
      2
    );
    assert.equal(running.messages.length, 1);
    assert.equal(running.messages[0].role, "human");
    assert.equal(running.messages[0].body, "Help us plan navigation");
    assert.equal(didStartHiveRun(initial, running), true);
    const replied = appendHiveReply(
      running,
      "Which routes should we cover?",
      3
    );
    assert.deepEqual(
      replied.messages.map((message) => message.role),
      ["human", "agent"]
    );
    assert.deepEqual(
      reduceTaskSession(replied, { type: "reset", actor: "spencer" }, 4)
        .messages,
      []
    );
  }
});

test("the team can select Claude before coding, then keep that engine through results and reset", () => {
  const selected = reduceTaskSession(
    connectedSession(),
    { type: "select-harness", actor: "spencer", runtime: "claude-code" },
    15
  );
  assert.equal(selected.workspace.agentSession?.runtime, "claude-code");
  assert.equal(canSelectHarness(selected), true);
  assert.equal(didStartHiveRun(connectedSession(), selected), false);
  const running = reduceTaskSession(
    selected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect files",
    },
    20
  );
  const finished = finishInspection(running);
  assert.equal(finished.workspace.agentSession?.runtime, "claude-code");
  for (const state of [
    running,
    finished,
    applyHiveRunError(running, "Fixture", 30),
  ]) {
    assert.equal(canSelectHarness(state), false);
    assert.equal(
      reduceTaskSession(
        state,
        { type: "select-harness", actor: "maya", runtime: "codex" },
        50
      ),
      state
    );
  }
  const reset = reduceTaskSession(
    finished,
    { type: "reset", actor: "spencer" },
    60
  );
  assert.equal(reset.workspace.agentSession?.runtime, "claude-code");
  assert.equal(canSelectHarness(reset), true);
  assert.notEqual(
    reset.workspace.agentSession?.id,
    finished.workspace.agentSession?.id
  );
});

test("selecting Claude before repository attachment does not reset discussion or start a run", () => {
  const initial = createInitialTaskSessionState(1);
  const selected = reduceTaskSession(
    initial,
    { type: "select-harness", actor: "spencer", runtime: "claude-code" },
    2
  );
  assert.deepEqual(selected.messages, initial.messages);
  assert.equal(selected.stage, "waiting");
  const action = {
    type: "connect-repository" as const,
    actor: "spencer",
    repositoryUrl: "https://github.com/example/repo",
    repositoryName: "example/repo",
    repositoryId: 1,
    repositoryBranch: "main",
    installationId: 2,
    visibility: "private" as const,
    githubUserId: 3,
    githubLogin: "spencer",
  };
  const connected = reduceTaskSession(selected, action, 3);
  assert.equal(
    connected.messages.at(-1)?.event,
    "repository-connected",
    "connection is an agent-readable operation receipt, not ordinary chat"
  );
  assert.equal(connected.workspace.agentSession?.runtime, "claude-code");
  assert.equal(
    connected.workspace.agentSession?.id,
    selected.workspace.agentSession?.id
  );
  assert.equal(
    reduceTaskSession(
      connected,
      { type: "select-harness", actor: "spencer", runtime: "claude-code" },
      4
    ),
    connected
  );
});

test("coding effort changes at idle boundaries without replacing native history or workspace", () => {
  const initial = connectedSession();
  const selected = reduceTaskSession(
    initial,
    { type: "set-coding-effort", actor: "spencer", effort: "medium" },
    15
  );
  assert.equal(selected.workspace.codingEffort, "medium");
  assert.deepEqual(
    { ...selected.workspace, codingEffort: undefined },
    { ...initial.workspace, codingEffort: undefined }
  );
  assert.equal(didStartHiveRun(initial, selected), false);
  const running = reduceTaskSession(
    selected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect files",
    },
    20
  );
  const finished = finishInspection(running);
  const high = reduceTaskSession(
    finished,
    { type: "set-coding-effort", actor: "maya", effort: "high" },
    50
  );
  assert.equal(finished.workspace.codingEffort, "medium");
  assert.equal(high.workspace.codingEffort, "high");
  assert.equal(high.workspace.agentSession, finished.workspace.agentSession);
  assert.equal(high.workspace.files, finished.workspace.files);
  assert.equal(high.messages, finished.messages);
  assert.equal(high.version, finished.version + 1);
  assert.equal(canSelectHarness(high), false);
  assert.equal(canSetCodingEffort(high), true);
  assert.equal(
    reduceTaskSession(
      high,
      { type: "set-coding-effort", actor: "maya", effort: "high" },
      55
    ),
    high
  );
  assert.equal(
    reduceTaskSession(high, { type: "reset", actor: "spencer" }, 60).workspace
      .codingEffort,
    "high"
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Check tests too",
    },
    25
  );
  for (const busy of [running, queued, finishInspection(queued)]) {
    assert.equal(canSetCodingEffort(busy), false);
    assert.equal(
      reduceTaskSession(
        busy,
        { type: "set-coding-effort", actor: "maya", effort: "high" },
        65
      ),
      busy
    );
  }
  for (const value of [undefined, null, "ultra", 1, {}, "HIGH"])
    assert.equal(isCodingEffort(value), false);
  for (const value of ["low", "medium", "high", "xhigh", "max"])
    assert.equal(isCodingEffort(value), true);
  assert.equal(
    reduceTaskSession(
      high,
      { type: "set-coding-effort", actor: "maya", effort: "max" },
      70
    ),
    high,
    "Mini does not acquire Max just because the transport recognizes it"
  );
});

test("model selection preserves native history, normalizes effort, and respects shared run boundaries", () => {
  const models = codingModelOptions(CODEX_SUBSCRIPTION_MODEL, true);
  const select = (state: TaskSessionState, modelId: string) =>
    reduceTaskSession(
      state,
      {
        type: "select-harness",
        runtime: "claude-code",
        actor: "maya",
        modelId,
      },
      50,
      [],
      models
    );
  let state = select(connectedSession(), "claude-sonnet-4-6");
  state = reduceTaskSession(
    state,
    {
      type: "set-coding-effort",
      actor: "maya",
      modelId: "claude-sonnet-4-6",
      effort: "max",
    },
    51,
    [],
    models
  );
  const running = reduceTaskSession(
    state,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect files",
    },
    52
  );
  const finished = finishInspection(running);
  const opus = select(finished, "claude-opus-4-6");
  assert.equal(opus.workspace.codingModel, "claude-opus-4-6");
  assert.equal(opus.workspace.codingEffort, "max");
  assert.equal(opus.workspace.agentSession, finished.workspace.agentSession);
  assert.equal(opus.messages, finished.messages);
  assert.equal(opus.workspace.files, finished.workspace.files);
  assert.equal(opus.version, finished.version + 1);
  assert.equal(select(opus, "claude-opus-4-6"), opus);
  assert.equal(select(opus, "untrusted-model"), opus);
  assert.equal(
    select(opus, "gpt-6-astra"),
    opus,
    "Runtime/model mismatch is rejected"
  );
  assert.equal(
    reduceTaskSession(
      opus,
      {
        type: "select-harness",
        actor: "maya",
        runtime: "codex",
        modelId: "gpt-6-astra",
      },
      55,
      [],
      models
    ),
    opus
  );
  const haiku = select(opus, "claude-haiku-4-5");
  assert.equal(haiku.workspace.codingEffort, undefined);
  assert.equal(
    reduceTaskSession(
      haiku,
      { type: "set-coding-effort", actor: "maya", effort: "high" },
      55,
      [],
      models
    ),
    haiku
  );
  assert.equal(
    reduceTaskSession(
      opus,
      {
        type: "set-coding-effort",
        actor: "maya",
        modelId: "claude-sonnet-4-6",
        effort: "low",
      },
      55,
      [],
      models
    ),
    opus,
    "A teammate's stale effort control cannot modify a different model"
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Check tests",
    },
    53
  );
  for (const busy of [running, queued, finishInspection(queued)])
    assert.equal(select(busy, "claude-opus-4-6"), busy);
  assert.equal(
    reduceTaskSession(opus, { type: "reset", actor: "maya" }, 60).workspace
      .codingModel,
    opus.workspace.codingModel
  );
});

test("a successful read-only run returns to waiting without approval", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect navigation only",
    },
    20
  );
  const finished = finishInspection(running);
  assert.equal(finished.stage, "waiting");
  assert.equal(finished.workspace.status, "ready");
  assert.equal(finished.workspace.commands[0]?.exitCode, 0);
});

test("the retired global approval action cannot change a task or its history", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update navigation",
    },
    20
  );
  const review = finishInspection(running, "+ keyboard support");
  const cases: TaskSessionState[] = [
    review,
    { ...review, workspace: { ...review.workspace, diff: " \n " } },
    {
      ...review,
      workspace: {
        ...review.workspace,
        status: "error",
        error: "Rate limit reached.",
      },
    },
    { ...review, repository: undefined },
    {
      ...review,
      steeringQueue: [
        {
          id: "pending",
          authorId: "maya",
          body: "Check focus",
          source: { kind: "message", messageId: "m1" },
          queuedAt: 45,
          sourceLabel: "Teammate message",
        },
      ],
    },
    {
      ...review,
      activeSteer: {
        id: "active",
        authorId: "maya",
        body: "Check focus",
        source: { kind: "message", messageId: "m1" },
        queuedAt: 35,
        appliedAt: 45,
        sourceLabel: "Teammate message",
      },
    },
  ];
  const retiredAction = JSON.parse('{"type":"advance-run","actor":"spencer"}');
  for (const state of cases) {
    assert.equal(reduceTaskSession(state, retiredAction, 50), state);
  }
});

test("removing the final steer after a read-only run returns to ready, not review", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect navigation only",
    },
    20
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Also check the footer",
    },
    30
  );
  const finished = finishInspection(queued);
  const removed = reduceTaskSession(
    finished,
    {
      type: "remove-queued-steer",
      actor: "maya",
      steerId: finished.steeringQueue[0].id,
    },
    50
  );
  assert.equal(removed.stage, "waiting");
  assert.equal(removed.workspace.status, "ready");
  assert.deepEqual(removed.workspace.commands, finished.workspace.commands);
});

test("retrying the same accepted message does not queue a second run", () => {
  const action = {
    type: "send-message" as const,
    actor: "spencer",
    body: "Inspect the navigation",
    clientId: "e7535baf-8d42-4e42-94a6-ce940a72da5f",
  };
  const running = reduceTaskSession(connectedSession(), action, 20);
  const retried = reduceTaskSession(running, action, 30);
  assert.deepEqual(retried, running);
  assert.equal(retried.steeringQueue.length, 0);
  assert.equal(didStartHiveRun(running, retried), false);
});

test("a lost acknowledgement cannot repeat an already failed run", () => {
  const action = {
    type: "send-message" as const,
    actor: "spencer",
    body: "Inspect the navigation",
    clientId: "37ac24d8-2299-490a-93c9-2a66dc963e0e",
  };
  const running = reduceTaskSession(connectedSession(), action, 20);
  const failed = applyHiveRunError(running, "Rate limit reached.", 30);
  const retried = reduceTaskSession(failed, action, 40);
  assert.deepEqual(retried, failed);
  assert.equal(didStartHiveRun(failed, retried), false);
});

test("retrying the same annotation preserves one attributed comment", () => {
  const state = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "@maya thoughts?",
    },
    20
  );
  const messageId = state.messages.at(-1)!.id;
  const action = {
    type: "annotate-message" as const,
    actor: "maya",
    messageId,
    body: "Preserve the keyboard focus.",
    clientId: "07d00dd8-e4ab-4c8c-ac3a-6f3066b93cb1",
  };
  const annotated = reduceTaskSession(state, action, 30);
  assert.deepEqual(reduceTaskSession(annotated, action, 40), annotated);
});

test("identical text from different submissions or members remains independent", () => {
  const action = {
    type: "send-message" as const,
    actor: "spencer",
    body: "Inspect the navigation",
    clientId: "e7535baf-8d42-4e42-94a6-ce940a72da5f",
  };
  const first = reduceTaskSession(connectedSession(), action, 20);
  const teammate = reduceTaskSession(first, { ...action, actor: "maya" }, 30);
  const nextSubmission = reduceTaskSession(
    teammate,
    {
      ...action,
      clientId: "c48f2f52-d85f-4aaf-bf0b-4816ee18cb08",
    },
    40
  );
  assert.equal(nextSubmission.messages.length, first.messages.length + 2);
  assert.equal(nextSubmission.steeringQueue.length, 2);
});

test("team messages stay in discussion while Hive tasks start one shared run", () => {
  const connected = connectedSession();
  const discussion = reduceTaskSession(
    connected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "@maya thoughts?",
    },
    20
  );
  const task = reduceTaskSession(
    discussion,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Inspect the navigation",
    },
    30
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
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Help us define the acceptance criteria.",
    },
    2
  );

  assert.equal(running.stage, "running");
  assert.equal(running.repository, undefined);
  assert.equal(running.workspace.status, "disconnected");
  assert.equal(running.workspace.agentSession, undefined);
  assert.equal(running.workspace.startedAt, 2);

  const replied = appendHiveReply(
    running,
    "Let’s first define the active route behavior.",
    3
  );
  assert.equal(replied.stage, "waiting");
  assert.equal(replied.workspace.startedAt, undefined);
  assert.equal(replied.workspace.completedAt, 3);
});

test("attaching a repository preserves discussion but never treats the planning VM as a working copy", () => {
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
    4
  );

  assert.equal(connected.title, initial.title);
  assert.equal(connected.messages.length, initial.messages.length + 1);
  assert.notEqual(connected.workspace.agentSession?.id, "codex-existing");
  assert.equal(connected.workspace.sandboxName, undefined);

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
    5
  );
  assert.equal(ignoredReplacement.repository?.name, "team/project");
});

test("historically approved tasks remain open for discussion and another steer", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update navigation",
    },
    20
  );
  const finished = finishInspection(running, "+ keyboard support");
  assert.equal(isHiveRunActive(finished), false);
  const approved: TaskSessionState = { ...finished, stage: "approved" };
  const parent = approved.messages.at(-1)!;
  const discussed = reduceTaskSession(
    approved,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      messageId: parent.id,
      body: "Also check touch targets",
    },
    60
  );
  assert.equal(discussed.stage, "approved");
  assert.deepEqual(discussed.workspace, approved.workspace);
  const reply = discussed.messages.at(-1)!.annotations!.at(-1)!;
  assert.equal(reply.authorId, "maya");
  const steered = reduceTaskSession(
    discussed,
    {
      type: "steer-message-annotation",
      actor: "spencer",
      messageId: parent.id,
      annotationId: reply.id,
    },
    70
  );
  assert.equal(isHiveRunActive(steered), true);
  assert.equal(steered.sessionId, approved.sessionId);
  assert.equal(
    steered.workspace.agentSession!.id,
    approved.workspace.agentSession!.id
  );
  assert.ok(steered.messages.some((message) => message.id === parent.id));
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
    members
  );
  const discussion = reduceTaskSession(
    connected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: members[0].id,
      body: "@ghopper thoughts?",
    },
    20,
    members
  );

  assert.equal(discussion.stage, "waiting");
  assert.equal(discussion.messages.at(-1)?.name, "Ada Lovelace");
  assert.equal(discussion.messages.at(-1)?.memberId, "github-101");
});

test("an annotation created during a run waits for an explicit safe boundary", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update the menu",
    },
    20
  );
  const sourceMessage = running.messages.at(-1);
  assert.ok(sourceMessage);

  const annotated = reduceTaskSession(
    running,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      messageId: sourceMessage.id,
      body: "Keep the interaction keyboard accessible",
    },
    30
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
    40
  );

  assert.equal(queued.steeringQueue.length, 1);
  assert.equal(queued.activeSteer?.source.kind, "message");
  assert.equal(queued.messages.at(-1)?.annotations?.[0]?.status, "queued");

  const premature = reduceTaskSession(
    queued,
    { type: "apply-next-steer", actor: "spencer" },
    45
  );
  assert.equal(
    premature,
    queued,
    "The current run must finish before a queued steer starts"
  );

  const finished = applyHiveRunResult(
    queued,
    {
      sandboxName: "hive-session-test",
      agentSession: queued.workspace.agentSession!,
      summary: "Updated the menu.",
      diff: "+ update",
      files: [],
      commands: [],
      changedFiles: ["nav.tsx"],
    },
    48
  );
  const applied = reduceTaskSession(
    finished,
    { type: "apply-next-steer", actor: "spencer" },
    50
  );
  assert.equal(applied.steeringQueue.length, 0);
  assert.equal(applied.activeSteer?.body, annotation.body);
  assert.equal(
    applied.messages.find((message) => message.id === sourceMessage.id)
      ?.annotations?.[0]?.status,
    "steered"
  );
});

test("a failed run releases the next queued steer without losing its author or context", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect the navigation",
    },
    20
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Keep keyboard navigation intact",
    },
    30
  );
  const failed = applyHiveRunError(queued, "Rate limit reached", 40);
  const applied = reduceTaskSession(
    failed,
    { type: "apply-next-steer", actor: "spencer" },
    50
  );

  assert.equal(applied.activeSteer?.body, "Keep keyboard navigation intact");
  assert.equal(applied.activeSteer?.authorId, "maya");
  assert.equal(applied.steeringQueue.length, 0);
  assert.equal(applied.stage, "running");
  assert.equal(applied.workspace.startedAt, 50);
  assert.equal(applied.workspace.completedAt, undefined);
  assert.equal(applied.workspace.error, undefined);
  assert.equal(
    applied.workspace.agentSession?.id,
    running.workspace.agentSession?.id
  );
  assert.deepEqual(applied.messages, failed.messages);
});

test("messages arriving after a failed run stay behind the existing queue", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect navigation",
    },
    20
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Keep keyboard navigation",
    },
    30
  );
  const failed = applyHiveRunError(queued, "Rate limit reached", 40);
  const later = reduceTaskSession(
    failed,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Also check focus styling",
    },
    50
  );

  assert.deepEqual(
    later.steeringQueue.map((item) => item.body),
    ["Keep keyboard navigation", "Also check focus styling"]
  );
  assert.equal(isHiveRunActive(later), false);
  assert.equal(canApplyNextSteer(later), true);
  const applied = reduceTaskSession(
    later,
    { type: "apply-next-steer", actor: "spencer" },
    60
  );
  assert.equal(applied.activeSteer?.body, "Keep keyboard navigation");
  assert.equal(applied.steeringQueue[0]?.body, "Also check focus styling");
  assert.equal(canApplyNextSteer(applied), false);
});

test("two messages in the same millisecond grant only one run start", () => {
  const connected = connectedSession();
  const first = reduceTaskSession(
    connected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Inspect navigation",
    },
    20
  );
  const second = reduceTaskSession(
    first,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Keep keyboard navigation",
    },
    20
  );

  assert.deepEqual(
    [didStartHiveRun(connected, first), didStartHiveRun(first, second)],
    [true, false]
  );
  assert.equal(second.steeringQueue.length, 1);
  const rejected = reduceTaskSession(
    second,
    { type: "apply-next-steer", actor: "maya" },
    20
  );
  assert.equal(didStartHiveRun(second, rejected), false);
});

test("planning turns release queued steers after success as well as failure", () => {
  const running = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Define the task",
    },
    20
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Include keyboard acceptance criteria",
    },
    30
  );
  const replied = appendHiveReply(
    queued,
    "The task is a navigation update.",
    40
  );
  assert.equal(canApplyNextSteer(replied), true);
  const applied = reduceTaskSession(
    replied,
    { type: "apply-next-steer", actor: "spencer" },
    50
  );
  assert.equal(isHiveRunActive(applied), true);
  const finished = appendHiveReply(
    applied,
    "Keyboard behavior is included.",
    60
  );
  assert.equal(isHiveRunActive(finished), false);
  assert.equal(finished.activeSteer, undefined);
});

test("a review annotation can start the next turn in the same Codex session", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update the menu",
    },
    20
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
    30
  );
  const annotated = reduceTaskSession(
    review,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      messageId: sourceMessage.id,
      body: "Keep the parent item expanded",
    },
    40
  );
  const annotation = annotated.messages.find(
    (message) => message.id === sourceMessage.id
  )?.annotations?.[0];
  assert.ok(annotation);

  const steered = reduceTaskSession(
    annotated,
    {
      type: "steer-message-annotation",
      actor: "maya",
      messageId: sourceMessage.id,
      annotationId: annotation.id,
    },
    50
  );

  assert.equal(steered.stage, "running");
  assert.equal(steered.workspace.status, "running");
  assert.equal(
    steered.workspace.agentSession?.id,
    review.workspace.agentSession?.id
  );
  assert.equal(
    steered.messages.find((message) => message.id === sourceMessage.id)
      ?.annotations?.[0]?.status,
    "steered"
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
    30
  );

  assert.equal(completed.stage, "running");
  assert.equal(completed.workspace.status, "running");
  assert.equal(completed.workspace.changedFiles[0], "nav.tsx");
});

test("removing the final pending steer after a completed run returns to review", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update the menu",
    },
    20
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Check focus styling",
    },
    30
  );
  const finished = applyHiveRunResult(
    queued,
    {
      sandboxName: "hive-test",
      agentSession: running.workspace.agentSession!,
      summary: "Updated the menu",
      diff: "+ update",
      files: [],
      commands: [],
      changedFiles: ["nav.tsx"],
    },
    40
  );
  const removed = reduceTaskSession(
    finished,
    {
      type: "remove-queued-steer",
      actor: "maya",
      steerId: finished.steeringQueue[0].id,
    },
    50
  );
  assert.equal(removed.stage, "review");
  assert.equal(removed.workspace.status, "review");
  assert.equal(removed.workspace.diff, "+ update");
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
  const reset = reduceTaskSession(
    session,
    { type: "reset", actor: "maya" },
    40
  );

  assert.equal(reset.version, session.version + 1);
  assert.equal(reset.repository?.name, "spinsirr/hive");
  assert.equal(reset.stage, "waiting");
  assert.equal(reset.workspace.status, "ready");
  assert.deepEqual(reset.workspace.changedFiles, []);
  assert.deepEqual(
    reset.messages,
    [],
    "reset does not insert another greeting for the connected repository"
  );
  assert.notEqual(
    reset.workspace.agentSession?.id,
    session.workspace.agentSession?.id
  );
});

test("a second task sent during a run joins the attributed steering queue", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update the menu",
    },
    20
  );
  const sessionId = running.workspace.agentSession?.id;
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Keep it compact",
    },
    30
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

test("reset needs an idle task: never during a run, an applied steer, or with queued input", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update navigation",
    },
    20
  );
  assert.equal(
    reduceTaskSession(running, { type: "reset", actor: "maya" }, 30),
    running,
    "an active run blocks reset"
  );
  const queued = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Also the footer",
    },
    31
  );
  const finished = finishInspection(queued);
  assert.equal(isHiveRunActive(finished), false);
  assert.equal(
    reduceTaskSession(finished, { type: "reset", actor: "maya" }, 40),
    finished,
    "queued input blocks reset"
  );
  const applied = reduceTaskSession(
    finished,
    { type: "apply-next-steer", actor: "spencer" },
    50
  );
  assert.ok(applied.activeSteer);
  assert.equal(
    reduceTaskSession(applied, { type: "reset", actor: "maya" }, 60),
    applied,
    "an applied steer blocks reset"
  );
  const idle = finishInspection(
    reduceTaskSession(
      connectedSession(),
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor: "spencer",
        body: "Inspect",
      },
      20
    )
  );
  assert.notEqual(
    reduceTaskSession(idle, { type: "reset", actor: "maya" }, 70),
    idle,
    "an idle task can still be reset"
  );
});

test("a run that outlives its request can be marked lost without losing discussion or the queue", () => {
  let running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Long task",
    },
    20
  );
  running = reduceTaskSession(
    running,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Queued follow-up",
    },
    25
  );
  running = {
    ...running,
    workspace: {
      ...running.workspace,
      liveReply: { id: "reply", body: "Partial", sequence: 1, startedAt: 20 },
    },
  };
  const early = 20 + STALLED_RUN_AFTER_MS - 1;
  assert.equal(isHiveRunStalled(running, early), false);
  assert.equal(
    reduceTaskSession(
      running,
      { type: "recover-stalled-run", actor: "maya" },
      early
    ),
    running,
    "a live request must not be declared lost"
  );
  const late = 20 + STALLED_RUN_AFTER_MS;
  assert.equal(isHiveRunStalled(running, late), true);
  const recovered = reduceTaskSession(
    running,
    { type: "recover-stalled-run", actor: "maya" },
    late
  );
  assert.equal(isHiveRunActive(recovered), false);
  assert.equal(recovered.workspace.status, "error");
  assert.equal(recovered.workspace.liveReply, undefined);
  assert.equal(
    recovered.workspace.agentSession?.id,
    running.workspace.agentSession?.id,
    "native identity survives"
  );
  assert.deepEqual(
    recovered.steeringQueue,
    running.steeringQueue,
    "queued steers are kept, not applied"
  );
  assert.equal(canApplyNextSteer(recovered), true);
  assert.ok(
    recovered.messages.some(
      (message) => message.id === "reply" && message.body === "Partial"
    ),
    "partial output is kept"
  );
  const notice = recovered.messages.at(-1)!;
  assert.equal(notice.status, "error");
  assert.match(notice.body, /execution process was lost/);
  assert.match(notice.body, /Maya marked the run as lost/);
  assert.equal(
    reduceTaskSession(
      recovered,
      { type: "recover-stalled-run", actor: "maya" },
      late + 1
    ),
    recovered,
    "a recovered task is not lost twice"
  );
  const retried = reduceTaskSession(
    recovered,
    { type: "apply-next-steer", actor: "spencer" },
    late + 2
  );
  assert.equal(retried.activeSteer?.body, "Queued follow-up");
});

test("conversation messages carry a machine timestamp alongside the legacy label", () => {
  const running = reduceTaskSession(
    connectedSession(),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Update navigation",
    },
    20
  );
  assert.equal(running.messages.at(-1)?.createdAt, 20);
  assert.equal(
    running.messages.at(-2)?.createdAt,
    10,
    "the repository-connected notice"
  );
  assert.equal(
    finishInspection(running, "+ change").messages.at(-1)?.createdAt,
    40
  );
  assert.equal(
    applyHiveRunError(running, "boom", 45).messages.at(-1)?.createdAt,
    45
  );
  const streamed = {
    ...running,
    workspace: {
      ...running.workspace,
      liveReply: { id: "reply", body: "Partial", sequence: 1, startedAt: 22 },
    },
  };
  assert.equal(
    finishInspection(streamed).messages.at(-1)?.createdAt,
    22,
    "a streamed reply keeps the time it started"
  );
});

test("oversized conversation messages are ignored rather than stored or executed", () => {
  const connected = connectedSession();
  const tooLong = reduceTaskSession(
    connected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "x".repeat(MESSAGE_BODY_LIMIT + 1),
    },
    20
  );
  assert.equal(tooLong, connected);
  const atLimit = reduceTaskSession(
    connected,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "x".repeat(MESSAGE_BODY_LIMIT),
    },
    20
  );
  assert.equal(atLimit.messages.at(-1)?.body.length, MESSAGE_BODY_LIMIT);
  assert.equal(isHiveRunActive(atLimit), true);
});
