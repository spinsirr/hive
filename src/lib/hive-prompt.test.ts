import assert from "node:assert/strict";
import test from "node:test";

import { buildHivePrompt, buildHiveRunInput } from "./hive-prompt.ts";
import { appendHiveReply, createInitialTaskSessionState, reduceTaskSession, type TeamMember } from "./task-session.ts";

test("Codex receives attributed team context and an attributed active task", () => {
  const session = reduceTaskSession(
    reduceTaskSession(
      createInitialTaskSessionState(1),
      { type: "send-message", actor: "spencer", body: "Prefer the compact menu" },
      2,
    ),
    { type: "send-message", actor: "maya", body: "Keep keyboard navigation" },
    3,
  );

  const prompt = buildHivePrompt(session, "maya", "Do not remove focus styles");

  assert.match(prompt, /\[Spencer Zhao\]: Prefer the compact menu/);
  assert.match(prompt, /\[Maya Chen\]: Keep keyboard navigation/);
  assert.match(prompt, /Current teammate: Maya Chen/);
  assert.match(prompt, /Task to execute now:\n\n\[Maya Chen\]: Do not remove focus styles/);
});

test("pre-repository conversation frames intent as discussion, not execution", () => {
  const session = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      actor: "spencer",
      body: "Help us define the acceptance criteria",
    },
    2,
  );

  const prompt = buildHivePrompt(
    session,
    "spencer",
    undefined,
    undefined,
    "planning",
  );

  assert.match(prompt, /Latest request to discuss:/);
  assert.doesNotMatch(prompt, /Task to execute now:/);
});

for (const mode of ["planning", "coding"] as const) {
  test(`${mode} includes the current message exactly once while retaining teammate context`, () => {
    let session = reduceTaskSession(createInitialTaskSessionState(1), {
      type: "send-message", actor: "spencer", body: "Keep the earlier keyboard requirement",
    }, 2);
    session = appendHiveReply(session, "Previous agent explanation", 3);
    session = reduceTaskSession(session, {
      type: "send-message", actor: "maya", body: "CURRENT_REQUEST_ONCE",
    }, 4);
    const prompt = buildHivePrompt(session, "maya", undefined, undefined, mode);
    assert.equal(prompt.split("CURRENT_REQUEST_ONCE").length - 1, 1);
    assert.match(prompt, /\[Spencer Zhao\]: Keep the earlier keyboard requirement/);
    assert.match(prompt, /Previous agent explanation/, "A fresh model context still needs the prior discussion");
  });
}

test("resumed coding uses native agent history without reinserting its public replies", () => {
  let session = reduceTaskSession(createInitialTaskSessionState(1), {
    type: "send-message", actor: "spencer", body: "Keep keyboard support",
  }, 2);
  session = appendHiveReply(session, "ALREADY_IN_NATIVE_HISTORY ".repeat(400), 3);
  session = reduceTaskSession(session, {
    type: "send-message", actor: "maya", body: "Continue the label fix",
  }, 4);
  session.workspace.agentSession = {
    id: "hive-codex-session", runtime: "codex",
    resumeFrom: { type: "resume-session", specificationVersion: "harness-v1", harnessId: "codex", data: {} },
  };
  const original = structuredClone(session);
  const prompt = buildHivePrompt(session, "maya");
  assert.doesNotMatch(prompt, /ALREADY_IN_NATIVE_HISTORY/);
  assert.match(prompt, /\[Spencer Zhao\]: Keep keyboard support/);
  assert.match(prompt, /\[Maya Chen\]: Continue the label fix/);
  assert.equal(prompt.split("Continue the label fix").length - 1, 1);
  assert.deepEqual(session, original, "Reducing the prompt must not alter the shared transcript or checkpoint");
  assert.match(buildHivePrompt(session, "maya", undefined, undefined, "planning"), /ALREADY_IN_NATIVE_HISTORY/, "Planning does not resume native Codex history");
});

test("applying another teammate's queued annotation does not transfer its authorship", () => {
  const running = reduceTaskSession(createInitialTaskSessionState(1), {
    type: "send-message", actor: "spencer", body: "Check the accessible label",
  }, 2);
  const message = running.messages.at(-1)!;
  const annotated = reduceTaskSession(running, {
    type: "annotate-message", actor: "maya", messageId: message.id,
    body: "Preserve the annotation author's name when queued",
  }, 3);
  const annotation = annotated.messages.at(-1)!.annotations![0];
  const queued = reduceTaskSession(annotated, {
    type: "steer-message-annotation", actor: "maya", messageId: message.id,
    annotationId: annotation.id,
  }, 4);
  const finished = appendHiveReply(queued, "The check completed", 5);
  const applied = reduceTaskSession(finished, {
    type: "apply-next-steer", actor: "spencer",
  }, 6);

  assert.equal(applied.activeSteer?.authorId, "maya");
  const input = buildHiveRunInput(applied, { type: "apply-next-steer", actor: "spencer" }, []);
  const prompt = buildHivePrompt(applied, input.actor, input.steer, input.actorName);
  assert.equal(input.actor, "maya");
  assert.match(prompt, /Annotation author: Maya Chen/);
  assert.match(prompt, /Parent message author: Spencer Zhao/);
  assert.match(prompt, /Steer requested by: Maya Chen/);
  assert.match(prompt, /Run started by: Spencer Zhao/);
  assert.match(prompt, /Preserve the annotation author's name when queued/);
});

const githubMembers: TeamMember[] = [
  { id: "github-101", name: "Ada Lovelace", shortName: "Ada", initials: "AL", githubLogin: "ada" },
  { id: "github-202", name: "Grace Hopper", shortName: "Grace", initials: "GH", githubLogin: "grace" },
  { id: "github-303", name: "Linus", shortName: "Linus", initials: "LI", githubLogin: "linus" },
];

for (const queued of [false, true]) {
  test(`${queued ? "queued" : "immediate"} steering distinguishes a GitHub annotation author, promoter, and parent author`, () => {
    let session = reduceTaskSession(createInitialTaskSessionState(1), {
      type: "send-message", actor: "github-101", body: "Check the queue label",
    }, 2, githubMembers);
    const message = session.messages.at(-1)!;
    if (!queued) session = appendHiveReply(session, "Ready for review", 3);
    session = reduceTaskSession(session, {
      type: "annotate-message", actor: "github-202", messageId: message.id,
      body: "Keep the annotation author's name",
    }, 4, githubMembers);
    const annotation = session.messages.find((item) => item.id === message.id)!.annotations![0];
    const promote = {
      type: "steer-message-annotation" as const, actor: "github-303",
      messageId: message.id, annotationId: annotation.id,
    };
    session = reduceTaskSession(session, promote, 5, githubMembers);
    const apply = { type: "apply-next-steer" as const, actor: "github-101" };
    if (queued) {
      session = appendHiveReply(session, "The preceding check completed", 6);
      session = reduceTaskSession(session, apply, 7, githubMembers);
    }

    const input = buildHiveRunInput(session, queued ? apply : promote, githubMembers);
    assert.equal(input.actor, "github-303", "Execution remains attributed to the teammate who requested the steer");
    assert.match(input.steer!, /Annotation author: Grace Hopper/);
    assert.match(input.steer!, /Steer requested by: Linus/);
    assert.match(input.steer!, /Parent message author: Ada Lovelace/);
    assert.match(input.steer!, /Parent message \(context only\):\nCheck the queue label/);
    assert.doesNotMatch(input.steer!, /Source: Ada/);
    for (const mode of ["coding", "planning"] as const) {
      const prompt = buildHivePrompt(session, input.actor, input.steer, input.actorName, mode);
      assert.match(prompt, /Annotation author: Grace Hopper/);
      assert.match(prompt, /Annotation to execute:\nKeep the annotation author's name/);
    }
  });
}

test("a queued message remains the selected task even after its author sends something newer", () => {
  let session = reduceTaskSession(createInitialTaskSessionState(1), {
    type: "send-message", actor: "github-101", body: "Check the existing diff",
  }, 2, githubMembers);
  session = reduceTaskSession(session, {
    type: "send-message", actor: "github-202", body: "First: check author names",
  }, 3, githubMembers);
  session = reduceTaskSession(session, {
    type: "send-message", actor: "github-202", body: "Second: check keyboard labels",
  }, 4, githubMembers);
  session = appendHiveReply(session, "The existing diff is retained", 5);
  const action = { type: "apply-next-steer" as const, actor: "github-101" };
  session = reduceTaskSession(session, action, 6, githubMembers);
  const input = buildHiveRunInput(session, action, githubMembers);
  assert.equal(input.actorName, "Grace Hopper");
  assert.match(input.steer!, /Message author: Grace Hopper/);
  assert.match(input.steer!, /Message to execute:\nFirst: check author names/);
  assert.doesNotMatch(input.steer!, /Second:/);
  for (const mode of ["coding", "planning"] as const) {
    const prompt = buildHivePrompt(session, input.actor, input.steer, input.actorName, mode);
    assert.ok(prompt.endsWith("Message to execute:\nFirst: check author names"));
  }
});

test("unpromoted comments are not injected as executable steering", () => {
  let session = reduceTaskSession(createInitialTaskSessionState(1), {
    type: "send-message", actor: "github-101", body: "Discuss the label",
  }, 2, githubMembers);
  const message = session.messages.at(-1)!;
  session = reduceTaskSession(session, {
    type: "annotate-message", actor: "github-202", messageId: message.id, body: "Do not execute this discussion",
  }, 3, githubMembers);
  const input = buildHiveRunInput(session, { type: "send-message", actor: "github-101", body: message.body }, githubMembers);
  assert.equal(input.steer, undefined);
  assert.doesNotMatch(buildHivePrompt(session, input.actor, input.steer, input.actorName), /Do not execute this discussion/);
});

test("a missing steering source cannot silently become another task", () => {
  assert.throws(() => buildHiveRunInput(createInitialTaskSessionState(1), {
    type: "steer-message-annotation", actor: "github-101", messageId: "missing", annotationId: "missing",
  }, githubMembers), /steered annotation is no longer available/);
});
