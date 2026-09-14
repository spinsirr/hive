import { createTestDatabase } from "./test-database.mjs";
import { registerTestModules } from "./test-modules.mjs";
// Real Postgres + task commands + MCP. Only a uniquely named disposable local DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const database = createTestDatabase(
  process.env.HIVE_PEER_TEST_DATABASE_URL,
  "hive_peer_test"
);
delete process.env.VERCEL;
delete process.env.MEM0_API_KEY;

globalThis.fetch = async () => {
  throw new Error("No external services in this acceptance check");
};
registerTestModules();

let client;
try {
  await database.start();
  const store = await import("../src/lib/task-session-store.ts");
  const { db } = await import("../src/db/index.ts");
  const { users } = await import("../src/db/schema.ts");
  const { memberDirectory } = await import("../src/lib/task-session.ts");
  const { handleHiveMcp } = await import("../src/lib/hive-mcp.ts");
  const members = Object.values(memberDirectory);
  await db.insert(users).values(
    members.map((member, index) => ({
      ...member,
      githubUserId: 100 + index,
      githubLogin: member.id,
      updatedAt: new Date(),
    }))
  );
  const unnamed = await store.createTaskSession("", members[0]);
  assert.equal(unnamed.title, "");
  assert.equal(unnamed.stage, "waiting");
  assert.equal(unnamed.workspace.liveReply, undefined);
  assert.equal(unnamed.workspace.agentSession, undefined);
  await store.joinTaskSession(unnamed.sessionId, members[1].id);
  const starts = await Promise.all(
    members.map((member, index) =>
      store.applyTaskSessionAction(
        unnamed.sessionId,
        {
          type: "send-message",
          actor: member.id,
          body: ["Polish the Settings menu", "Review keyboard navigation"][
            index
          ],
          clientId: randomUUID(),
        },
        member
      )
    )
  );
  assert.equal(starts.filter((start) => start.startedRun).length, 1);
  const named = (await store.getPublicTaskSessionSnapshot(unnamed.sessionId))
    .session;
  assert.ok(
    ["Polish the Settings menu", "Review keyboard navigation"].includes(
      named.title
    )
  );
  assert.equal(
    named.title,
    named.messages.find((message) => message.role === "human").body,
    "the first committed message names the task once"
  );
  assert.equal(named.sessionId, unnamed.sessionId);
  const manual = await store.applyTaskSessionAction(
    unnamed.sessionId,
    {
      type: "rename-task",
      actor: members[1].id,
      title: "Team navigation review",
    },
    members[1]
  );
  assert.equal(
    manual.startedRun,
    false,
    "renaming during a run does not start another run"
  );
  assert.equal(manual.snapshot.session.title, "Team navigation review");
  assert.deepEqual(manual.snapshot.session.workspace, named.workspace);
  assert.deepEqual(manual.snapshot.session.messages, named.messages);
  assert.deepEqual(manual.snapshot.session.steeringQueue, named.steeringQueue);
  await store.checkpointAgentReply(
    unnamed.sessionId,
    named.workspace.liveReply.id,
    "Working on navigation",
    1
  );
  await store.appendHiveReply(unnamed.sessionId, "Navigation inspected", {
    forReplyId: named.workspace.liveReply.id,
  });
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(unnamed.sessionId)).session.title,
    "Team navigation review",
    "run completion must not overwrite a concurrent rename"
  );
  assert.equal(
    (await store.listTaskSessions(members[0].id)).find(
      (task) => task.id === unnamed.sessionId
    ).title,
    "Team navigation review"
  );
  const renameFirst = await store.createTaskSession("", members[0]);
  await Promise.all([
    store.applyTaskSessionAction(
      renameFirst.sessionId,
      { type: "rename-task", actor: members[0].id, title: "Untitled task" },
      members[0]
    ),
    store.applyTaskSessionAction(
      renameFirst.sessionId,
      {
        type: "send-message",
        actor: members[0].id,
        body: "Do not overwrite my name",
        clientId: randomUUID(),
      },
      members[0]
    ),
  ]);
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(renameFirst.sessionId)).session
      .title,
    "Untitled task",
    "a manual name wins regardless of which concurrent write arrived first"
  );
  await assert.rejects(
    store.applyTaskSessionAction(
      renameFirst.sessionId,
      { type: "rename-task", actor: members[1].id, title: "Foreign" },
      members[1]
    ),
    store.TaskSessionAccessError
  );
  console.log(
    "PASS: unnamed creation, concurrent first-message naming, manual rename during a run, stable task ID/list title and cross-task isolation."
  );
  const queuedMessageId = named.steeringQueue[0].id;
  const queueResult = {
    sandboxName: "fixture",
    summary: "First request complete",
    diff: "",
    files: [],
    commands: [],
    changedFiles: [],
  };
  await store.appendHiveReply(unnamed.sessionId, queueResult.summary, {
    forReplyId: named.workspace.liveReply.id,
    runResult: queueResult,
  });
  const messageContinuations = await Promise.all(
    members.map((actor) =>
      store.applyTaskSessionAction(
        unnamed.sessionId,
        {
          type: "continue-queued-steer",
          actor: actor.id,
          steerId: queuedMessageId,
        },
        actor
      )
    )
  );
  assert.equal(
    messageContinuations.filter((item) => item.startedRun).length,
    1,
    "two clients automatically continue an ordinary message only once"
  );
  const autoMessage = (
    await store.getPublicTaskSessionSnapshot(unnamed.sessionId)
  ).session;
  assert.equal(autoMessage.activeSteer.id, queuedMessageId);
  assert.equal(autoMessage.steeringQueue.length, 0);
  await store.appendHiveReply(unnamed.sessionId, "Queued message complete", {
    forReplyId: autoMessage.workspace.liveReply.id,
    runResult: queueResult,
  });
  const staleMessage = await store.applyTaskSessionAction(
    unnamed.sessionId,
    {
      type: "continue-queued-steer",
      actor: members[0].id,
      steerId: queuedMessageId,
    },
    members[0]
  );
  assert.equal(
    staleMessage.startedRun,
    false,
    "late continuation never starts another run"
  );
  console.log(
    "PASS: real Postgres grants queued-message continuation once across concurrent clients."
  );
  const task = await store.createTaskSession(
    "Peer collaboration acceptance",
    members[0]
  );
  await store.joinTaskSession(task.sessionId, members[1].id);
  const start = await store.applyTaskSessionAction(
    task.sessionId,
    {
      type: "send-message",
      actor: members[0].id,
      body: "Ask the team about draft access",
      clientId: randomUUID(),
    },
    members[0]
  );
  assert.equal(start.startedRun, true);
  const scope = {
    sessionId: task.sessionId,
    memberId: members[0].id,
    runId: start.snapshot.session.workspace.liveReply.id,
  };
  client = new Client({ name: "acceptance", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
      fetch: (input, init) =>
        handleHiveMcp(new Request(input, init), scope, {
          read: store.readHiveToolContext,
          reply: store.appendHiveToolReply,
          request: store.createHivePeerRequest,
        }),
    })
  );
  const ask = await client.callTool({
    name: "request_input",
    arguments: {
      key: "drafts",
      prompt: "Who can see drafts?",
      options: ["Author", "Team"],
    },
  });
  assert.notEqual(ask.isError, true);
  const messageId = JSON.parse(ask.content[0].text).messageId;
  const answers = await Promise.all(
    members.map((actor) =>
      store.applyTaskSessionAction(
        task.sessionId,
        {
          type: "answer-question",
          actor: actor.id,
          messageId,
          body: actor.id === "maya" ? "Author only" : "Team",
          clientId: randomUUID(),
        },
        actor
      )
    )
  );
  assert.ok(answers.every((answer) => !answer.startedRun));
  let snapshot = await store.getPublicTaskSessionSnapshot(task.sessionId);
  assert.equal(snapshot.session.steeringQueue.length, 1);
  assert.equal(
    snapshot.session.messages.find((m) => m.id === messageId).annotations
      .length,
    1
  );
  const queueId = snapshot.session.steeringQueue[0].id;
  const runResult = {
    sandboxName: "fixture",
    agentSession: { id: "native-fixture", runtime: "codex" },
    summary: "Ready to continue",
    diff: "",
    files: [],
    commands: [],
    changedFiles: [],
  };
  await store.appendHiveReply(task.sessionId, runResult.summary, {
    forReplyId: scope.runId,
    runResult,
  });
  const continuations = await Promise.all(
    members.map((actor) =>
      store.applyTaskSessionAction(
        task.sessionId,
        { type: "continue-queued-steer", actor: actor.id, steerId: queueId },
        actor
      )
    )
  );
  assert.equal(
    continuations.filter((item) => item.startedRun).length,
    1,
    "two clients receive only one execution grant"
  );
  snapshot = await store.getPublicTaskSessionSnapshot(task.sessionId);
  const continuationId = snapshot.session.workspace.liveReply.id;
  assert.equal(
    snapshot.session.workspace.liveReply.threadId,
    undefined,
    "an inline answer does not create a Thread"
  );
  assert.equal(snapshot.session.workspace.agentSession.id, "native-fixture");
  await store.checkpointAgentReply(
    task.sessionId,
    continuationId,
    "Checking the answer",
    1
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(task.sessionId)).session.workspace
      .liveReply.body,
    "Checking the answer"
  );
  await store.appendHiveReply(task.sessionId, "Applied the team answer", {
    forReplyId: continuationId,
    runResult: { ...runResult, summary: "Applied the team answer" },
  });
  const finished = await store.getPublicTaskSessionSnapshot(task.sessionId);
  assert.equal(
    finished.session.messages.find((m) => m.id === continuationId).body,
    "Applied the team answer"
  );
  assert.equal(finished.session.steeringQueue.length, 0);
  await assert.rejects(
    store.createHivePeerRequest(scope, { key: "late", prompt: "Stale run" })
  );
  // Questions work before attachment. Reviewing files, unlike asking a
  // question, requires a connected repository (fixture only; no GitHub calls).
  await store.applyTaskSessionAction(
    task.sessionId,
    {
      type: "connect-repository",
      actor: members[0].id,
      repositoryUrl: "https://github.com/example/fixture",
      repositoryId: 42,
      repositoryName: "example/fixture",
      repositoryBranch: "main",
      visibility: "public",
      installationId: 1,
      githubUserId: 100,
      githubLogin: members[0].id,
    },
    members[0]
  );
  const reviewRun = await store.applyTaskSessionAction(
    task.sessionId,
    {
      type: "send-message",
      actor: members[0].id,
      body: "Prepare a review",
      clientId: randomUUID(),
    },
    members[0]
  );
  const reviewScope = {
    ...scope,
    runId: reviewRun.snapshot.session.workspace.liveReply.id,
  };
  await client.close();
  client = new Client({ name: "review-acceptance", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
      fetch: (input, init) =>
        handleHiveMcp(new Request(input, init), reviewScope, {
          read: store.readHiveToolContext,
          reply: store.appendHiveToolReply,
          request: store.createHivePeerRequest,
        }),
    })
  );
  const reviewReceipt = await client.callTool({
    name: "request_review",
    arguments: {
      key: "access",
      prompt: "Review access checks",
      targetMemberId: members[0].id,
    },
  });
  assert.notEqual(reviewReceipt.isError, true);
  const reviewId = JSON.parse(reviewReceipt.content[0].text).messageId;
  await store.appendHiveReply(task.sessionId, "Access checks ready", {
    forReplyId: reviewScope.runId,
    runResult: {
      ...runResult,
      summary: "Access checks ready",
      diff: "+ require access",
      changedFiles: ["access.ts"],
    },
  });
  const beforeReview = await store.getPublicTaskSessionSnapshot(task.sessionId);
  const resolveReview = {
    type: "resolve-peer-review",
    actor: members[0].id,
    messageId: reviewId,
    revision: reviewScope.runId,
  };
  await store.applyTaskSessionAction(
    task.sessionId,
    { ...resolveReview, actor: members[1].id },
    members[1]
  );
  await store.applyTaskSessionAction(
    task.sessionId,
    { ...resolveReview, revision: "stale" },
    members[0]
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(task.sessionId)).session.version,
    beforeReview.session.version
  );
  await Promise.all(
    [1, 2].map(() =>
      store.applyTaskSessionAction(task.sessionId, resolveReview, members[0])
    )
  );
  const resolved = await store.getPublicTaskSessionSnapshot(task.sessionId);
  assert.equal(resolved.session.version, beforeReview.session.version + 1);
  assert.equal(
    resolved.session.messages.find((m) => m.id === reviewId).interaction
      .resolved.by,
    members[0].id
  );
  const foreign = await store.createTaskSession(
    "Private other task",
    members[0]
  );
  await assert.rejects(
    store.applyTaskSessionAction(
      foreign.sessionId,
      {
        type: "answer-question",
        actor: members[1].id,
        messageId,
        body: "Foreign",
        clientId: randomUUID(),
      },
      members[1]
    ),
    store.TaskSessionAccessError
  );
  const before = (await store.getPublicTaskSessionSnapshot(foreign.sessionId))
    .session.version;
  await store.applyTaskSessionAction(
    foreign.sessionId,
    {
      type: "answer-question",
      actor: members[0].id,
      messageId,
      body: "Cross-task ID",
      clientId: randomUUID(),
    },
    members[0]
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(foreign.sessionId)).session
      .version,
    before
  );
  console.log(
    "PASS: real MCP → Postgres inline question → concurrent answers → one main-conversation continuation; reconnect read, stale run and cross-task denial."
  );
  console.log(
    "PASS: real MCP review request → completed evidence → assigned reviewer; stale version and duplicate resolution are no-ops."
  );
  // Thread discussion never invokes an agent, even when addressed to Hive.
  // Explicit Steer admits main work directly, including queued continuations.
  for (const mode of ["reply", "thread", "queued-reply", "queued-thread"]) {
    const discussion = await store.createTaskSession(
      `Ordinary thread ${mode}`,
      members[0]
    );
    await store.joinTaskSession(discussion.sessionId, members[1].id);
    const parentRun = await store.applyTaskSessionAction(
      discussion.sessionId,
      {
        type: "send-message",
        actor: members[0].id,
        body: "Inspect the settings",
        clientId: randomUUID(),
      },
      members[0]
    );
    const parentId = parentRun.snapshot.session.workspace.liveReply.id;
    await store.appendHiveReply(discussion.sessionId, runResult.summary, {
      forReplyId: parentId,
      runResult,
    });
    const beforeComment = (
      await store.getPublicTaskSessionSnapshot(discussion.sessionId)
    ).session;
    const commentBody =
      "@Hive explain the tradeoffs here, keeping all keyboard navigation behavior intact.";
    const comment = await store.applyTaskSessionAction(
      discussion.sessionId,
      {
        type: "annotate-message",
        actor: members[1].id,
        messageId: parentId,
        body: commentBody,
        clientId: randomUUID(),
      },
      members[1]
    );
    assert.equal(
      comment.startedRun,
      false,
      "mentioning Hive in discussion does not grant execution"
    );
    const afterComment = (
      await store.getPublicTaskSessionSnapshot(discussion.sessionId)
    ).session;
    assert.deepEqual(
      afterComment.workspace,
      beforeComment.workspace,
      "discussion does not create or alter agent state"
    );
    assert.deepEqual(
      comment.snapshot.session.steeringQueue,
      beforeComment.steeringQueue
    );
    const replyId = comment.snapshot.session.messages
      .find((message) => message.id === parentId)
      .annotations.at(-1).id;
    let busyRun;
    if (mode.startsWith("queued")) {
      busyRun = await store.applyTaskSessionAction(
        discussion.sessionId,
        {
          type: "send-message",
          actor: members[0].id,
          body: "Other work first",
          clientId: randomUUID(),
        },
        members[0]
      );
      assert.equal(
        busyRun.snapshot.session.workspace.liveReply.threadId,
        undefined,
        "ordinary main messages stay in the main conversation"
      );
    }
    const action = mode.endsWith("thread")
      ? {
          type: "steer-thread",
          actor: members[0].id,
          messageId: parentId,
          throughReplyId: replyId,
        }
      : {
          type: "steer-message-annotation",
          actor: members[0].id,
          messageId: parentId,
          annotationId: replyId,
        };
    await Promise.all(
      [1, 2].map(() =>
        store.applyTaskSessionAction(discussion.sessionId, action, members[0])
      )
    );
    if (busyRun) {
      await store.appendHiveReply(discussion.sessionId, runResult.summary, {
        forReplyId: busyRun.snapshot.session.workspace.liveReply.id,
        runResult,
      });
      const grants = await Promise.all(
        members.map((member) =>
          store.applyTaskSessionAction(
            discussion.sessionId,
            { type: "apply-next-steer", actor: member.id },
            member
          )
        )
      );
      assert.equal(grants.filter((grant) => grant.startedRun).length, 1);
    }
    const active = (
      await store.getPublicTaskSessionSnapshot(discussion.sessionId)
    ).session;
    assert.equal(
      active.workspace.liveReply.threadId,
      undefined,
      `${mode}: Steer hands work back to the main conversation`
    );
    assert.ok(
      active.activeSteer.body.includes(commentBody),
      "Steer preserves the full reply, without a generated summary"
    );
    const activeId = active.workspace.liveReply.id;
    await store.checkpointAgentReply(
      discussion.sessionId,
      activeId,
      "Considering the tradeoffs",
      1
    );
    await store.appendHiveReply(discussion.sessionId, "Thread result", {
      forReplyId: activeId,
      runResult: { ...runResult, summary: "Thread result" },
    });
    const done = (
      await store.getPublicTaskSessionSnapshot(discussion.sessionId)
    ).session;
    assert.deepEqual(
      done.messages.map((message) => message.id),
      [...active.messages.map((message) => message.id), activeId]
    );
    const replies = done.messages.find(
      (message) => message.id === parentId
    ).annotations;
    assert.equal(
      replies[0].authorId,
      members[1].id,
      "steering does not transfer authorship to the promoter"
    );
    assert.deepEqual(
      replies,
      active.messages.find((message) => message.id === parentId).annotations
    );
    assert.equal(done.messages.at(-1).id, activeId);
    assert.equal(done.messages.at(-1).body, "Thread result");
    assert.equal(done.messages.at(-1).role, "agent");
  }
  console.log(
    "PASS: ordinary Thread single/whole and immediate/queued steers finish once in the main conversation without altering the human discussion."
  );
  // Model results below are fixtures. This checks real storage/admission/context
  // wiring only; the live acceptance separately verifies the model's decision.
  const { buildHiveRunInput, buildHivePrompt } =
    await import("../src/lib/hive-prompt.ts");
  for (const queued of [false, true]) {
    const task = await store.createTaskSession(
      `Repeated Steer after main decision ${queued}`,
      members[0]
    );
    await store.joinTaskSession(task.sessionId, members[1].id);
    await store.applyTaskSessionAction(
      task.sessionId,
      {
        type: "connect-repository",
        actor: members[0].id,
        repositoryUrl: "https://github.com/example/fixture",
        repositoryId: 42,
        repositoryName: "example/fixture",
        repositoryBranch: "main",
        visibility: "public",
        installationId: 1,
        githubUserId: 100,
        githubLogin: members[0].id,
      },
      members[0]
    );
    const act = (action) =>
      store.applyTaskSessionAction(
        task.sessionId,
        { actor: members[0].id, ...action },
        members[0]
      );
    const initial = await act({
      type: "send-message",
      body: "Create the settings prototype",
      clientId: randomUUID(),
    });
    const rootId = initial.snapshot.session.messages.find(
      (message) => message.role === "human"
    ).id;
    await store.appendHiveReply(task.sessionId, "Prototype ready", {
      forReplyId: initial.snapshot.session.workspace.liveReply.id,
      runResult,
    });
    const blue = await act({
      type: "annotate-message",
      messageId: rootId,
      body: "Use blue for the color.",
      clientId: randomUUID(),
    });
    const firstBoundary = blue.snapshot.session.messages
      .find((message) => message.id === rootId)
      .annotations.at(-1).id;
    const first = await act({
      type: "steer-thread",
      messageId: rootId,
      throughReplyId: firstBoundary,
    });
    assert.equal(first.startedRun, true);
    await store.appendHiveReply(task.sessionId, "The color is blue.", {
      forReplyId: first.snapshot.session.workspace.liveReply.id,
      runResult,
    });
    const main = await act({
      type: "send-message",
      body: "Change the color to black. This replaces the earlier color choice.",
      clientId: randomUUID(),
    });
    const currentResult = {
      ...runResult,
      summary: "The color is black.",
      files: [
        { path: "hive-steer-qa.json", content: '{"color":"black","radius":0}' },
      ],
      agentSession: {
        ...runResult.agentSession,
        resumeFrom: {
          type: "resume-session",
          specificationVersion: "harness-v1",
          harnessId: "codex",
          data: { checkpoint: "AFTER_MAIN_BLACK_DECISION" },
        },
      },
    };
    const finishMain = () =>
      store.appendHiveReply(task.sessionId, currentResult.summary, {
        forReplyId: main.snapshot.session.workspace.liveReply.id,
        runResult: currentResult,
      });
    if (!queued) await finishMain();
    const radius = await act({
      type: "annotate-message",
      messageId: rootId,
      body: "Set the radius to 12.",
      clientId: randomUUID(),
    });
    assert.equal(radius.startedRun, false);
    const secondBoundary = radius.snapshot.session.messages
      .find((message) => message.id === rootId)
      .annotations.at(-1).id;
    const secondAction = {
      type: "steer-thread",
      messageId: rootId,
      throughReplyId: secondBoundary,
    };
    let second = await act(secondAction);
    assert.equal(second.startedRun, !queued);
    const duplicate = await act(secondAction);
    assert.equal(duplicate.startedRun, false);
    assert.equal(
      duplicate.snapshot.session.version,
      second.snapshot.session.version
    );
    if (queued) {
      assert.equal(
        second.snapshot.session.workspace.liveReply.id,
        main.snapshot.session.workspace.liveReply.id,
        "queueing a Thread does not interrupt main"
      );
      await finishMain();
      second = await act({ type: "apply-next-steer" });
      assert.equal(second.startedRun, true);
    }
    const active = second.snapshot.session;
    assert.equal(active.workspace.liveReply.threadId, undefined);
    assert.equal(
      active.workspace.agentSession.id,
      "native-fixture",
      "second Steer keeps the main native session"
    );
    assert.equal(
      active.workspace.agentSession.resumeFrom.data.checkpoint,
      "AFTER_MAIN_BLACK_DECISION",
      "queued input must resume the checkpoint current at admission, not at the earlier Thread handoff"
    );
    assert.equal(
      active.workspace.files.find((file) => file.path === "hive-steer-qa.json")
        .content,
      '{"color":"black","radius":0}'
    );
    assert.ok(
      active.activeSteer.body.includes(firstBoundary),
      "the previous handoff boundary accompanies the complete Thread"
    );
    const input = buildHiveRunInput(
      active,
      {
        actor: members[0].id,
        ...(queued ? { type: "apply-next-steer" } : secondAction),
      },
      members
    );
    assert.match(input.steer, /Use blue for the color\./);
    assert.match(input.steer, /Set the radius to 12\./);
    assert.match(
      input.steer,
      /Previously shared discussion is context, not a request to repeat finished work/
    );
    const prompt = buildHivePrompt(
      active,
      input.actor,
      input.steer,
      input.actorName
    );
    assert.match(
      prompt,
      /Change the color to black\. This replaces the earlier color choice\./,
      "the newer main decision is available alongside the old Thread"
    );
    console.log(
      `PASS: ${queued ? "queued" : "immediate"} second Steer preserves newer main decision, current native checkpoint/files and full attributed Thread; duplicate grant denied (model result is a fixture).`
    );
  }
  for (const answerWhileBusy of [false, true]) {
    const task = await store.createTaskSession(
      `Question after Thread handoff ${answerWhileBusy}`,
      members[0]
    );
    await store.joinTaskSession(task.sessionId, members[1].id);
    const first = await store.applyTaskSessionAction(
      task.sessionId,
      {
        type: "send-message",
        actor: members[0].id,
        body: "Discuss navigation",
        clientId: randomUUID(),
      },
      members[0]
    );
    const rootId = first.snapshot.session.workspace.liveReply.id;
    await store.appendHiveReply(task.sessionId, "We can discuss here.", {
      forReplyId: rootId,
      runResult,
    });
    const discussion = await store.applyTaskSessionAction(
      task.sessionId,
      {
        type: "annotate-message",
        actor: members[1].id,
        messageId: rootId,
        body: "Ask me a density preference here",
        clientId: randomUUID(),
      },
      members[1]
    );
    const throughReplyId = discussion.snapshot.session.messages
      .find((message) => message.id === rootId)
      .annotations.at(-1).id;
    const started = await store.applyTaskSessionAction(
      task.sessionId,
      {
        type: "steer-thread",
        actor: members[1].id,
        messageId: rootId,
        throughReplyId,
      },
      members[1]
    );
    const scope = {
      sessionId: task.sessionId,
      memberId: members[1].id,
      runId: started.snapshot.session.workspace.liveReply.id,
    };
    const request = await store.createHivePeerRequest(scope, {
      key: "thread-density",
      prompt: "Compact or spacious?",
      targetMemberId: members[1].id,
      options: ["Compact", "Spacious"],
    });
    const question = (
      await store.getPublicTaskSessionSnapshot(task.sessionId)
    ).session.messages.find((message) => message.id === request.messageId);
    assert.equal(
      question.threadId,
      undefined,
      "questions raised after Steer belong to main, not the source discussion"
    );
    const posted = await store.appendHiveToolReply(
      scope,
      rootId,
      "One contribution to this existing discussion.",
      "nested-reply"
    );
    assert.equal(
      posted.messageId,
      rootId,
      "a deliberate tool contribution retains its explicit destination"
    );
    const retried = await store.appendHiveToolReply(
      scope,
      rootId,
      "One contribution to this existing discussion.",
      "nested-reply"
    );
    assert.deepEqual(
      retried,
      posted,
      "retries cannot duplicate a deliberate tool reply"
    );
    const postedState = (
      await store.getPublicTaskSessionSnapshot(task.sessionId)
    ).session;
    assert.ok(
      !postedState.messages.find((message) => message.id === question.id)
        .annotations?.length
    );
    assert.equal(
      postedState.messages
        .find((message) => message.id === rootId)
        .annotations.filter((reply) => reply.id === posted.replyId).length,
      1
    );
    if (!answerWhileBusy)
      await store.appendHiveReply(task.sessionId, "Question ready.", {
        forReplyId: scope.runId,
        runResult,
      });
    const answers = await Promise.all(
      [1, 2].map(() =>
        store.applyTaskSessionAction(
          task.sessionId,
          {
            type: "answer-question",
            actor: members[1].id,
            messageId: question.id,
            body: "Compact",
            clientId: randomUUID(),
          },
          members[1]
        )
      )
    );
    assert.equal(
      answers.filter((answer) => answer.startedRun).length,
      answerWhileBusy ? 0 : 1
    );
    if (answerWhileBusy) {
      await store.appendHiveReply(task.sessionId, "Question ready.", {
        forReplyId: scope.runId,
        runResult,
      });
      const pending = (await store.getPublicTaskSessionSnapshot(task.sessionId))
        .session.steeringQueue[0];
      await store.applyTaskSessionAction(
        task.sessionId,
        {
          type: "continue-queued-steer",
          actor: members[0].id,
          steerId: pending.id,
        },
        members[0]
      );
    }
    const resumed = (await store.getPublicTaskSessionSnapshot(task.sessionId))
      .session;
    assert.equal(
      resumed.workspace.liveReply.threadId,
      undefined,
      "answer continuation remains in the main conversation"
    );
    await store.checkpointAgentReply(
      task.sessionId,
      resumed.workspace.liveReply.id,
      "Compact it is.",
      1
    );
    await store.appendHiveReply(task.sessionId, "Compact it is.", {
      forReplyId: resumed.workspace.liveReply.id,
      runResult: { ...runResult, summary: "Compact it is." },
    });
    const finished = (await store.getPublicTaskSessionSnapshot(task.sessionId))
      .session;
    assert.deepEqual(
      finished.messages.find((message) => message.id === rootId).annotations,
      postedState.messages.find((message) => message.id === rootId).annotations
    );
    assert.equal(
      finished.messages.filter(
        (message) => message.id === resumed.workspace.liveReply.id
      ).length,
      1,
      "one main reply"
    );
    assert.equal(
      finished.messages.find(
        (message) => message.id === resumed.workspace.liveReply.id
      ).body,
      "Compact it is."
    );
  }
  console.log(
    "PASS: questions after Steer, concurrent answers and immediate/queued continuation stay in main without duplicating the source discussion."
  );
  // Archive is a shared task state, serialized with run admission and recovery.
  const archive = { type: "archive-task", actor: members[0].id };
  const archived = await store.applyTaskSessionAction(
    task.sessionId,
    archive,
    members[0]
  );
  assert.equal(archived.startedRun, false);
  assert.equal(archived.snapshot.session.archived.by, members[0].id);
  assert.ok(
    (await store.listTaskSessions(members[1].id)).find(
      (row) => row.id === task.sessionId
    ).archived
  );
  await Promise.all(
    members.map((member) =>
      store.applyTaskSessionAction(
        task.sessionId,
        { ...archive, actor: member.id },
        member
      )
    )
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(task.sessionId)).session.version,
    archived.snapshot.session.version
  );
  for (const member of members) {
    await assert.rejects(
      store.applyTaskSessionAction(
        task.sessionId,
        { type: "send-message", actor: member.id, body: "Late message" },
        member
      ),
      /archived/
    );
    await assert.rejects(
      store.applyTaskSessionAction(
        task.sessionId,
        {
          type: "annotate-message",
          actor: member.id,
          messageId,
          body: "Late reply",
        },
        member
      ),
      /archived/
    );
    await assert.rejects(
      store.startTaskWorkspaceRestore(
        task.sessionId,
        {
          id: randomUUID(),
          snapshotId: "old",
          version: archived.snapshot.session.version,
        },
        member
      ),
      /archived/
    );
  }
  await assert.rejects(
    store.withTaskSubagentControl(task.sessionId, async () => {
      throw new Error("Must not reach sandbox");
    }),
    /archived/
  );
  assert.ok(
    await store.withTaskWorkspaceRead(
      task.sessionId,
      async (session) => session.archived
    ),
    "archived files remain readable"
  );
  await store.appendHiveReply(task.sessionId, "Late unscoped writer");
  assert.deepEqual(
    (await store.getTaskSessionSnapshot(task.sessionId)).session,
    archived.snapshot.session
  );
  await assert.rejects(
    store.applyTaskSessionAction(
      foreign.sessionId,
      { ...archive, actor: members[1].id },
      members[1]
    ),
    store.TaskSessionAccessError
  );
  const reopened = await store.applyTaskSessionAction(
    task.sessionId,
    { type: "restore-task", actor: members[1].id },
    members[1]
  );
  assert.equal(reopened.startedRun, false);
  assert.equal(reopened.snapshot.session.archived, undefined);
  assert.deepEqual(
    reopened.snapshot.session.workspace,
    archived.snapshot.session.workspace
  );
  assert.deepEqual(
    reopened.snapshot.session.messages,
    archived.snapshot.session.messages
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    const race = await store.createTaskSession(
      `Archive race ${attempt}`,
      members[0]
    );
    const calls = [
      () => store.applyTaskSessionAction(race.sessionId, archive, members[0]),
      () =>
        store.applyTaskSessionAction(
          race.sessionId,
          { type: "send-message", actor: members[0].id, body: "Start now" },
          members[0]
        ),
    ];
    if (attempt % 2) calls.reverse();
    const outcomes = await Promise.allSettled(calls.map((call) => call()));
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      1
    );
    const winner = (await store.getPublicTaskSessionSnapshot(race.sessionId))
      .session;
    assert.notEqual(
      Boolean(winner.archived),
      winner.stage === "running",
      "never archive a running task"
    );
  }
  console.log(
    "PASS: real database team archive, teammate restore, read-only services, non-member denial, idempotency and simultaneous run/archive admission."
  );

  // The live failure crossed turns: an explicitly steered opinion caused the
  // same request_input key to publish a second question under a new run ID.
  const repeatTask = await store.createTaskSession(
    "Cross-turn question identity",
    members[0]
  );
  await store.joinTaskSession(repeatTask.sessionId, members[1].id);
  const repeatStart = await store.applyTaskSessionAction(
    repeatTask.sessionId,
    {
      type: "send-message",
      actor: members[0].id,
      body: "Ask my teammate whether to close the tab",
      clientId: randomUUID(),
    },
    members[0]
  );
  const repeatScope = {
    sessionId: repeatTask.sessionId,
    memberId: members[0].id,
    runId: repeatStart.snapshot.session.workspace.liveReply.id,
  };
  const repeatRequest = {
    key: "close_tab_after_use",
    prompt: "After using the tab, should we close it?",
    options: ["YES", "NO"],
    targetMemberId: members[1].id,
  };
  const original = await store.createHivePeerRequest(
    repeatScope,
    repeatRequest
  );
  assert.equal(original.created, true);
  assert.equal(original.status, "awaiting_answer");
  await store.appendHiveReply(
    repeatTask.sessionId,
    "Waiting for the decision",
    { forReplyId: repeatScope.runId, runResult }
  );
  const commented = await store.applyTaskSessionAction(
    repeatTask.sessionId,
    {
      type: "annotate-message",
      actor: members[0].id,
      messageId: original.messageId,
      body: "I think we should do it. Any thoughts?",
      clientId: randomUUID(),
    },
    members[0]
  );
  assert.equal(commented.startedRun, false);
  const opinionId = commented.snapshot.session.messages
    .find((message) => message.id === original.messageId)
    .annotations.at(-1).id;
  const discuss = {
    type: "steer-message-annotation",
    actor: members[0].id,
    messageId: original.messageId,
    annotationId: opinionId,
  };
  const steering = await Promise.all(
    [1, 2].map(() =>
      store.applyTaskSessionAction(repeatTask.sessionId, discuss, members[0])
    )
  );
  assert.equal(
    steering.filter((item) => item.startedRun).length,
    1,
    "two clients steering one opinion still grant only one run"
  );
  const newRun = (
    await store.getPublicTaskSessionSnapshot(repeatTask.sessionId)
  ).session.workspace.liveReply;
  repeatScope.runId = newRun.id;
  assert.equal(
    newRun.threadId,
    undefined,
    "steering an opinion returns work to main without duplicating its question"
  );
  const beforeRepeat = (
    await store.getPublicTaskSessionSnapshot(repeatTask.sessionId)
  ).session.version;
  const repeated = await Promise.all(
    [1, 2].map(() => store.createHivePeerRequest(repeatScope, repeatRequest))
  );
  assert.ok(
    repeated.every(
      (receipt) =>
        receipt.messageId === original.messageId &&
        !receipt.created &&
        receipt.status === "awaiting_answer"
    )
  );
  const afterRepeat = (
    await store.getPublicTaskSessionSnapshot(repeatTask.sessionId)
  ).session;
  assert.equal(
    afterRepeat.version,
    beforeRepeat,
    "duplicate question calls do not publish task updates"
  );
  assert.equal(
    afterRepeat.messages.filter(
      (message) => message.interaction?.kind === "question"
    ).length,
    1
  );
  assert.equal(afterRepeat.steeringQueue.length, 0);
  await client.close();
  client = new Client({ name: "cross-turn-question", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
      fetch: (input, init) =>
        handleHiveMcp(new Request(input, init), repeatScope, {
          read: store.readHiveToolContext,
          reply: store.appendHiveToolReply,
          request: store.createHivePeerRequest,
        }),
    })
  );
  const reusedTool = await client.callTool({
    name: "request_input",
    arguments: repeatRequest,
  });
  assert.notEqual(reusedTool.isError, true);
  assert.deepEqual(JSON.parse(reusedTool.content[0].text), {
    messageId: original.messageId,
    created: false,
    status: "awaiting_answer",
  });
  await store.appendHiveReply(
    repeatTask.sessionId,
    "Discussed the opinion, no new question",
    { forReplyId: repeatScope.runId, runResult }
  );
  const finalAnswers = await Promise.all(
    [1, 2].map(() =>
      store.applyTaskSessionAction(
        repeatTask.sessionId,
        {
          type: "answer-question",
          actor: members[1].id,
          messageId: original.messageId,
          replyThreadId: original.messageId,
          body: "YES",
          clientId: randomUUID(),
        },
        members[1]
      )
    )
  );
  assert.equal(
    finalAnswers.filter((item) => item.startedRun).length,
    1,
    "the original question answer continues exactly once"
  );
  const afterAnswer = (
    await store.getPublicTaskSessionSnapshot(repeatTask.sessionId)
  ).session;
  assert.equal(afterAnswer.workspace.liveReply.threadId, original.messageId);
  repeatScope.runId = afterAnswer.workspace.liveReply.id;
  assert.deepEqual(
    await store.createHivePeerRequest(repeatScope, repeatRequest),
    { messageId: original.messageId, created: false, status: "answered" }
  );
  assert.equal(
    (await store.getPublicTaskSessionSnapshot(repeatTask.sessionId)).session
      .version,
    afterAnswer.version
  );
  console.log(
    "PASS: real store and MCP reuse one task-scoped question across steered discussion turns, concurrent calls and answer continuation; no duplicate card, task update or execution grant."
  );
} finally {
  await client?.close();
  await database.close();
}
