import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHivePrompt, buildHiveRunInput } from "./hive-prompt.ts";
import {
  appendHiveReply,
  createInitialTaskSessionState,
  reduceTaskSession,
  type TeamMember,
} from "../../lib/session/task-session.ts";

test("the shared Codex/Claude runtime instructions keep steered work in main, not the source Thread", () => {
  const skill = readFileSync(
    new URL("./codex/bridge/hive-collaboration/SKILL.md", import.meta.url),
    "utf8"
  );
  assert.match(
    skill,
    /Explicit steers hand the team's discussion back to the main conversation/
  );
  assert.match(skill, /report evidence in the main conversation/);
  assert.doesNotMatch(
    skill,
    /originating Thread when continuing a steered discussion|result returns to that thread/
  );
});

test("workspace events inform the agent without becoming the latest user request", () => {
  const session = createInitialTaskSessionState(1);
  session.messages = [
    {
      id: "human",
      role: "human",
      memberId: "spencer",
      name: "Spencer",
      initials: "SP",
      body: "Check the label",
      time: "",
    },
    {
      id: "restore-operation",
      event: "workspace-restored",
      role: "human",
      memberId: "spencer",
      name: "Spencer",
      initials: "SP",
      body: "Restored checkpoint",
      time: "",
    },
  ];
  const prompt = buildHivePrompt(session, "spencer");
  assert.match(prompt, /Workspace event, context only.*Restored checkpoint/);
  assert.ok(prompt.endsWith("[Spencer]: Check the label"));
  assert.match(prompt, /silently use any required skills/);
});

test("Codex receives attributed team context and an attributed active task", () => {
  const session = reduceTaskSession(
    appendHiveReply(
      reduceTaskSession(
        createInitialTaskSessionState(1),
        {
          type: "send-message",
          clientId: crypto.randomUUID(),
          actor: "spencer",
          body: "Prefer the compact menu",
        },
        2
      ),
      "Ready for the next request",
      2.5
    ),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Keep keyboard navigation",
    },
    3
  );

  const prompt = buildHivePrompt(session, "maya", "Do not remove focus styles");

  assert.match(prompt, /\[Spencer Zhao\]: Prefer the compact menu/);
  assert.match(prompt, /\[Maya Chen\]: Keep keyboard navigation/);
  assert.match(prompt, /Current teammate: Maya Chen/);
  assert.match(
    prompt,
    /Task to execute now:\n\n\[Maya Chen\]: Do not remove focus styles/
  );
});

test("pre-repository conversation frames intent as discussion, not execution", () => {
  const session = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Help us define the acceptance criteria",
    },
    2
  );

  const prompt = buildHivePrompt(
    session,
    "spencer",
    undefined,
    undefined,
    "planning"
  );

  assert.match(prompt, /Latest request to discuss:/);
  assert.doesNotMatch(prompt, /Task to execute now:/);
});

for (const mode of ["planning", "coding"] as const) {
  test(`${mode} includes the current message exactly once while retaining teammate context`, () => {
    let session = reduceTaskSession(
      createInitialTaskSessionState(1),
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor: "spencer",
        body: "Keep the earlier keyboard requirement",
      },
      2
    );
    session = appendHiveReply(session, "Previous agent explanation", 3);
    session = reduceTaskSession(
      session,
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor: "maya",
        body: "CURRENT_REQUEST_ONCE",
      },
      4
    );
    const prompt = buildHivePrompt(session, "maya", undefined, undefined, mode);
    assert.equal(prompt.split("CURRENT_REQUEST_ONCE").length - 1, 1);
    assert.match(
      prompt,
      /\[Spencer Zhao\]: Keep the earlier keyboard requirement/
    );
    assert.match(
      prompt,
      /Previous agent explanation/,
      "A fresh model context still needs the prior discussion"
    );
  });
}

test("resumed coding uses native agent history without reinserting its public replies", () => {
  let session = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Keep keyboard support",
    },
    2
  );
  session = appendHiveReply(
    session,
    "ALREADY_IN_NATIVE_HISTORY ".repeat(400),
    3
  );
  session = reduceTaskSession(
    session,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      body: "Continue the label fix",
    },
    4
  );
  session.workspace.agentSession = {
    id: "hive-codex-session",
    runtime: "codex",
    resumeFrom: {
      type: "resume-session",
      specificationVersion: "harness-v1",
      harnessId: "codex",
      data: {},
    },
  };
  const original = structuredClone(session);
  const prompt = buildHivePrompt(session, "maya");
  assert.doesNotMatch(prompt, /ALREADY_IN_NATIVE_HISTORY/);
  assert.match(prompt, /\[Spencer Zhao\]: Keep keyboard support/);
  assert.match(prompt, /\[Maya Chen\]: Continue the label fix/);
  assert.equal(prompt.split("Continue the label fix").length - 1, 1);
  assert.deepEqual(
    session,
    original,
    "Reducing the prompt must not alter the shared transcript or checkpoint"
  );
  assert.match(
    buildHivePrompt(session, "maya", undefined, undefined, "planning"),
    /ALREADY_IN_NATIVE_HISTORY/,
    "Planning does not resume native Codex history"
  );
});

test("applying another teammate's queued annotation does not transfer its authorship", () => {
  const running = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "spencer",
      body: "Check the accessible label",
    },
    2
  );
  const message = running.messages.at(-1)!;
  const annotated = reduceTaskSession(
    running,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "maya",
      messageId: message.id,
      body: "Preserve the annotation author's name when queued",
    },
    3
  );
  const annotation = annotated.messages.at(-1)!.annotations![0];
  const queued = reduceTaskSession(
    annotated,
    {
      type: "steer-message-annotation",
      actor: "maya",
      messageId: message.id,
      annotationId: annotation.id,
    },
    4
  );
  const finished = appendHiveReply(queued, "The check completed", 5);
  const applied = reduceTaskSession(
    finished,
    {
      type: "apply-next-steer",
      actor: "spencer",
    },
    6
  );

  assert.equal(applied.activeSteer?.authorId, "maya");
  const input = buildHiveRunInput(
    applied,
    { type: "apply-next-steer", actor: "spencer" },
    []
  );
  const prompt = buildHivePrompt(
    applied,
    input.actor,
    input.steer,
    input.actorName
  );
  assert.equal(input.actor, "maya");
  assert.match(prompt, /Annotation author: Maya Chen/);
  assert.match(prompt, /Parent message author: Spencer Zhao/);
  assert.match(prompt, /Steer requested by: Maya Chen/);
  assert.match(prompt, /Run started by: Spencer Zhao/);
  assert.match(prompt, /Preserve the annotation author's name when queued/);
});

const githubMembers: TeamMember[] = [
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
    githubLogin: "grace",
  },
  {
    id: "github-303",
    name: "Linus",
    shortName: "Linus",
    initials: "LI",
    githubLogin: "linus",
  },
];

for (const queued of [false, true]) {
  test(`${queued ? "queued" : "immediate"} steering distinguishes a GitHub annotation author, promoter, and parent author`, () => {
    let session = reduceTaskSession(
      createInitialTaskSessionState(1),
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor: "github-101",
        body: "Check the queue label",
      },
      2,
      githubMembers
    );
    const message = session.messages.at(-1)!;
    if (!queued) session = appendHiveReply(session, "Ready for review", 3);
    session = reduceTaskSession(
      session,
      {
        type: "annotate-message",
        clientId: crypto.randomUUID(),
        actor: "github-202",
        messageId: message.id,
        body: "Keep the annotation author's name",
      },
      4,
      githubMembers
    );
    const annotation = session.messages.find((item) => item.id === message.id)!
      .annotations![0];
    const promote = {
      type: "steer-message-annotation" as const,
      actor: "github-303",
      messageId: message.id,
      annotationId: annotation.id,
    };
    session = reduceTaskSession(session, promote, 5, githubMembers);
    const apply = { type: "apply-next-steer" as const, actor: "github-101" };
    if (queued) {
      session = appendHiveReply(session, "The preceding check completed", 6);
      session = reduceTaskSession(session, apply, 7, githubMembers);
    }

    const input = buildHiveRunInput(
      session,
      queued ? apply : promote,
      githubMembers
    );
    assert.equal(
      input.memoryQuery,
      "Keep the annotation author's name",
      "Memory search must not upload the parent message or earlier thread replies"
    );
    assert.equal(
      input.actor,
      "github-303",
      "Execution remains attributed to the teammate who requested the steer"
    );
    assert.match(input.steer!, /Annotation author: Grace Hopper/);
    assert.match(input.steer!, /Steer requested by: Linus/);
    assert.match(input.steer!, /Parent message author: Ada Lovelace/);
    assert.match(
      input.steer!,
      /Parent message \(context only\):\nCheck the queue label/
    );
    assert.doesNotMatch(input.steer!, /Source: Ada/);
    for (const mode of ["coding", "planning"] as const) {
      const prompt = buildHivePrompt(
        session,
        input.actor,
        input.steer,
        input.actorName,
        mode
      );
      assert.match(prompt, /Annotation author: Grace Hopper/);
      assert.match(
        prompt,
        /Annotation to execute:\nKeep the annotation author's name/
      );
    }
  });
}

test("a queued message remains the selected task even after its author sends something newer", () => {
  let session = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "github-101",
      body: "Check the existing diff",
    },
    2,
    githubMembers
  );
  session = reduceTaskSession(
    session,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "github-202",
      body: "First: check author names",
    },
    3,
    githubMembers
  );
  session = reduceTaskSession(
    session,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "github-202",
      body: "Second: check keyboard labels",
    },
    4,
    githubMembers
  );
  session = appendHiveReply(session, "The existing diff is retained", 5);
  const action = { type: "apply-next-steer" as const, actor: "github-101" };
  session = reduceTaskSession(session, action, 6, githubMembers);
  const input = buildHiveRunInput(session, action, githubMembers);
  assert.equal(input.actorName, "Grace Hopper");
  assert.equal(
    input.memoryQuery,
    "First: check author names",
    "Recall must follow the selected queued request, not a newer message"
  );
  assert.match(input.steer!, /Message author: Grace Hopper/);
  assert.match(input.steer!, /Message to execute:\nFirst: check author names/);
  assert.doesNotMatch(input.steer!, /Second:/);
  for (const mode of ["coding", "planning"] as const) {
    const prompt = buildHivePrompt(
      session,
      input.actor,
      input.steer,
      input.actorName,
      mode
    );
    assert.ok(
      prompt.endsWith("Message to execute:\nFirst: check author names")
    );
    assert.doesNotMatch(
      prompt,
      /Second: check keyboard labels/,
      "Pending work must not enter the active model context"
    );
  }
});

test("unpromoted comments are not injected as executable steering", () => {
  let session = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "github-101",
      body: "Discuss the label",
    },
    2,
    githubMembers
  );
  const message = session.messages.at(-1)!;
  session = reduceTaskSession(
    session,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "github-202",
      messageId: message.id,
      body: "Do not execute this discussion",
    },
    3,
    githubMembers
  );
  const input = buildHiveRunInput(
    session,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "github-101",
      body: message.body,
    },
    githubMembers
  );
  assert.equal(input.memoryQuery, "Discuss the label");
  assert.equal(input.steer, undefined);
  assert.doesNotMatch(
    buildHivePrompt(session, input.actor, input.steer, input.actorName),
    /Do not execute this discussion/
  );
});

test("a missing steering source cannot silently become another task", () => {
  assert.throws(
    () =>
      buildHiveRunInput(
        createInitialTaskSessionState(1),
        {
          type: "steer-message-annotation",
          actor: "github-101",
          messageId: "missing",
          annotationId: "missing",
        },
        githubMembers
      ),
    /accepted command is no longer available/
  );
  assert.throws(
    () =>
      buildHiveRunInput(
        createInitialTaskSessionState(1),
        {
          type: "apply-next-steer",
          actor: "github-101",
        },
        githubMembers
      ),
    /accepted command is no longer available/i
  );
});

test("whole-thread memory recall uses the task title rather than uploading the discussion", () => {
  let session = reduceTaskSession(
    createInitialTaskSessionState(1, "thread-recall", {
      title: "Improve keyboard navigation",
    }),
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor: "github-101",
      body: "PARENT_CONTEXT_NOT_A_MEMORY_QUERY",
    },
    2,
    githubMembers
  );
  session = appendHiveReply(session, "Ready for discussion", 3);
  const parent = session.messages.find((message) => message.role === "human")!;
  session = reduceTaskSession(
    session,
    {
      type: "annotate-message",
      clientId: crypto.randomUUID(),
      actor: "github-202",
      messageId: parent.id,
      body: "THREAD_REPLY_NOT_A_MEMORY_QUERY",
    },
    4,
    githubMembers
  );
  const action = {
    type: "steer-thread" as const,
    actor: "github-101",
    messageId: parent.id,
    throughReplyId: session.messages.find(
      (message) => message.id === parent.id
    )!.annotations![0].id,
  };
  session = reduceTaskSession(session, action, 5, githubMembers);
  const input = buildHiveRunInput(session, action, githubMembers);
  assert.equal(input.memoryQuery, "Improve keyboard navigation");
  assert.match(input.steer!, /PARENT_CONTEXT_NOT_A_MEMORY_QUERY/);
  assert.match(input.steer!, /THREAD_REPLY_NOT_A_MEMORY_QUERY/);
});
