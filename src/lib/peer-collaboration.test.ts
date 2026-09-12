import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleHiveMcp } from "./hive-mcp.ts";
import { createHiveMemory } from "./hive-memory.ts";
import { createInitialTaskSessionState, memberDirectory, reduceTaskSession, applyHiveRunResult, applyHiveRunError, conversationMessages, hiveReplyThreadId, type TaskSessionState, type HiveRunResult } from "./task-session.ts";
import { conversationTimelineMessages } from "./conversation-timeline.ts";
import { buildHivePrompt, buildHiveRunInput } from "./hive-prompt.ts";
import { requestPeerInput } from "./peer-collaboration.ts";
import { describeHiveContext } from "./hive-tool-context.ts";

const members = Object.values(memberDirectory);
const scope = { sessionId: "peer-test", runId: "run-one", memberId: "spencer" };

function working(): TaskSessionState {
  const initial = createInitialTaskSessionState(1, scope.sessionId);
  return { ...initial, stage: "running", workspace: { ...initial.workspace, status: "running", startedAt: 2, liveReply: { id: scope.runId, body: "", sequence: 0, startedAt: 2 } } };
}

test("agent can publish a question through its task tools, with choices and a named teammate", async () => {
  let state = working();
  const client = new Client({ name: "peer-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://hive.test/tools"), {
    fetch: (input, init) => handleHiveMcp(new Request(input, init), scope, {
      read: async () => ({ ...state, members }),
      reply: async () => { throw new Error("Use structured input"); },
      request: async (_scope, request) => {
        const { requestPeerInput } = await import("./peer-collaboration.ts");
        const published = requestPeerInput(state, scope, request, members, 3);
        const created = state !== published.session;
        state = published.session;
        return { messageId: published.messageId, created, status: "awaiting_answer" };
      },
    }, createHiveMemory(undefined)),
  }));
  try {
    const result = await client.callTool({ name: "request_input", arguments: { key: "scope", prompt: "Who can see drafts?", options: ["Team", "Author"], targetMemberId: "maya" } });
    assert.notEqual(result.isError, true);
    const question = state.messages.at(-1)!;
    assert.equal(question.body, "Who can see drafts?");
    assert.equal(question.interaction?.kind, "question");
    assert.equal(question.interaction?.targetMemberId, "maya");
    assert.equal(state.workspace.liveReply?.id, "run-one", "requesting input does not interrupt the active turn");
    await client.callTool({ name: "request_input", arguments: { key: "scope", prompt: "Who can see drafts?", options: ["Team", "Author"], targetMemberId: "maya" } });
    assert.equal(state.messages.filter((m) => m.interaction).length, 1, "retries do not duplicate the question");
  } finally { await client.close(); }
});

test("answering in an explicitly opened Thread continues there once with authorship", () => {
  const { session, messageId } = requestPeerInput(working(), scope, { key: "drafts", prompt: "Who can see drafts?", targetMemberId: "maya" }, members, 3);
  const action = { type: "answer-question", actor: "maya", messageId, replyThreadId: messageId, body: "Only the author, until shared.", clientId: "answer-one" } as const;
  const answered = reduceTaskSession(session, action, 4, members);
  assert.equal(answered.steeringQueue.length, 1);
  assert.equal(answered.messages.at(-1)?.annotations?.[0].authorId, "maya");
  assert.equal(reduceTaskSession(answered, action, 5, members), answered, "duplicate delivery has no second effect");
  assert.equal(reduceTaskSession(session, { ...action, actor: "spencer" }, 4, members), session, "a different teammate cannot answer a targeted question");
  const completed = applyHiveRunResult(answered, result(), 6);
  const resumed = reduceTaskSession(completed, { type: "apply-next-steer", actor: "spencer" }, 7, members);
  const input = buildHiveRunInput(resumed, { type: "apply-next-steer", actor: "spencer" }, members);
  assert.equal(input.actor, "maya");
  assert.match(input.steer!, /Only the author/);
  assert.match(input.steer!, /Maya Chen/);
  assert.equal(hiveReplyThreadId(resumed, { type: "apply-next-steer", actor: "spencer" }), messageId);
  resumed.workspace.liveReply = { id: "run-two", threadId: hiveReplyThreadId(resumed, action), body: "Checking access", sequence: 1, startedAt: 7 };
  assert.equal(conversationMessages(resumed).find((m) => m.id === messageId)?.annotations?.at(-1)?.body, "Checking access");
  const finished = applyHiveRunResult(resumed, { ...result(), summary: "Drafts are private until shared." }, 8);
  assert.equal(finished.messages.find((m) => m.id === messageId)?.annotations?.at(-1)?.body, "Drafts are private until shared.");
  assert.equal(finished.messages.some((m) => m.id === "run-two"), false, "result does not escape its thread");
});

for (const inThread of [false, true]) for (const busy of [false, true]) {
  test(`${busy ? "queued" : "immediate"} question answer preserves its ${inThread ? "existing Thread" : "main conversation"} destination`, () => {
    const initial = working();
    initial.messages.push({ id: "discussion-root", role: "human", name: "Spencer", initials: "SZ", body: "Discuss navigation", time: "12:00", createdAt: 1 });
    if (inThread) initial.workspace.liveReply!.threadId = "discussion-root";
    const requested = requestPeerInput(initial, scope, { key: "inline-destination", prompt: "Compact or spacious?", targetMemberId: "maya" }, members, 3);
    const question = requested.session.messages.find((message) => message.id === requested.messageId)!;
    assert.equal(question.threadId, inThread ? "discussion-root" : undefined);
    assert.equal(conversationTimelineMessages(requested.session.messages).some((message) => message.id === question.id), !inThread, "Thread questions never also appear in the main timeline");
    const session = busy ? requested.session : applyHiveRunResult(requested.session, result(), 4);
    const action = { type: "answer-question", actor: "maya", messageId: question.id, body: "Compact", clientId: "one-answer" } as const;
    assert.equal(reduceTaskSession(session, { ...action, replyThreadId: "another-task-or-thread" }, 5, members), session, "a client cannot redirect the answer to an unrelated Thread");
    let resumed = reduceTaskSession(session, action, 5, members);
    if (busy) resumed = reduceTaskSession(applyHiveRunResult(resumed, result(), 6), { type: "apply-next-steer", actor: "spencer" }, 7, members);
    const threadId = hiveReplyThreadId(resumed, action);
    assert.equal(threadId, inThread ? "discussion-root" : undefined);
    const input = buildHiveRunInput(resumed, action, members);
    assert.match(input.steer!, inThread ? /originating Thread discussion-root/ : /main conversation; do not create a Thread/);
    resumed.workspace.liveReply = { id: "answer-result", threadId, body: "Compact it is.", sequence: 1, startedAt: 7 };
    const live = conversationMessages(resumed);
    assert.equal(inThread ? live.find((message) => message.id === threadId)?.annotations?.at(-1)?.body : live.find((message) => message.id === "answer-result")?.body, "Compact it is.");
    const finished = applyHiveRunResult(resumed, { ...result(), summary: "Compact it is." }, 8);
    assert.equal(inThread ? finished.messages.find((message) => message.id === threadId)?.annotations?.at(-1)?.body : finished.messages.find((message) => message.id === "answer-result")?.body, "Compact it is.");
    if (inThread) assert.ok(!finished.messages.some((message) => message.id === "answer-result"), "no escaped duplicate main message");
  });
}

function result(): HiveRunResult {
  return { sandboxName: "sandbox-test", agentSession: { id: "native-one", runtime: "codex" }, summary: "Waiting for the team decision.", diff: "", files: [], commands: [], changedFiles: [] };
}

test("answer continuation preserves a discussion-only request instead of requiring file inspection", () => {
  const initial = working();
  initial.messages.push({ id: "layout-request", memberId: "spencer", name: "Spencer Zhao", initials: "SZ", role: "human", time: "12:00", body: "Ask me whether I prefer compact or spacious. Do not inspect or change files yet." });
  const requested = requestPeerInput(initial, scope, { key: "layout", prompt: "Compact or spacious?", targetMemberId: "spencer" }, members, 3);
  const answered = reduceTaskSession(requested.session, { type: "answer-question", actor: "spencer", messageId: requested.messageId, body: "Compact", clientId: "layout-answer" }, 4, members);
  const idle = applyHiveRunResult(answered, result(), 5);
  const action = { type: "apply-next-steer", actor: "spencer" } as const;
  const resumed = reduceTaskSession(idle, action, 6, members);
  const input = buildHiveRunInput(resumed, action, members);
  const prompt = buildHivePrompt(resumed, input.actor, input.steer, input.actorName);
  assert.match(prompt, /Do not inspect or change files yet/);
  assert.match(input.steer!, /Preserve the original request's scope and restrictions/);
  assert.match(input.steer!, /Only inspect current files if/);
  assert.doesNotMatch(input.steer!, /Inspect current files first/);
  assert.match(input.steer!, /Do not call request_input again/);
  assert.equal(resumed.activeSteer?.source?.kind, "peer-response");
});

test("steering discussion on an unanswered question cannot create the same question in a later run", () => {
  const request = { key: "close_tab_after_use", prompt: "After using the tab, should we close it?", targetMemberId: "maya", options: ["YES", "NO"] };
  const first = requestPeerInput(working(), scope, request, members, 3);
  const idle = applyHiveRunResult(first.session, result(), 4);
  const discussion = reduceTaskSession(idle, { type: "annotate-message", actor: "spencer", messageId: first.messageId, body: "I think we should do it. Any thoughts?", clientId: "opinion" }, 5, members);
  assert.equal(discussion.stage, idle.stage, "an ordinary reply must not wake the agent");
  assert.equal(discussion.steeringQueue.length, 0);
  const annotationId = discussion.messages.find((m) => m.id === first.messageId)!.annotations![0].id;
  const action = { type: "steer-message-annotation", actor: "spencer", messageId: first.messageId, annotationId } as const;
  const continued = reduceTaskSession(discussion, action, 6, members);
  const later = { ...continued, workspace: { ...continued.workspace, liveReply: { id: "discussion-run", threadId: first.messageId, body: "", sequence: 0, startedAt: 6 } } };
  const repeated = requestPeerInput(later, { ...scope, runId: "discussion-run" }, request, members, 7);
  assert.equal(repeated.messageId, first.messageId, "the stable question key must survive native run boundaries");
  assert.equal(repeated.session, later, "reusing the pending question must not publish an update or enqueue work");
  assert.equal(repeated.session.messages.filter((m) => m.interaction?.kind === "question").length, 1);
  const input = buildHiveRunInput(later, action, members);
  assert.match(input.steer!, /Existing question state/);
  assert.match(input.steer!, /"key":"close_tab_after_use"/);
  assert.match(input.steer!, /"targetMemberId":"maya"/);
  assert.match(input.steer!, /"status":"awaiting_answer"/);
  assert.match(input.steer!, /Do not call request_input again/);
  assert.equal(input.memoryQuery, "I think we should do it. Any thoughts?");
  // The original card still belongs to its designated human, not the commenter.
  const wrongAnswer = { type: "answer-question", actor: "spencer", messageId: first.messageId, body: "YES", clientId: "wrong-answer" } as const;
  assert.equal(reduceTaskSession(repeated.session, wrongAnswer, 8, members), repeated.session);
  const answered = reduceTaskSession(repeated.session, { ...wrongAnswer, actor: "maya", clientId: "real-answer" }, 8, members);
  assert.equal(answered.steeringQueue.length, 1);
  const afterAnswer = requestPeerInput(answered, { ...scope, runId: "discussion-run" }, request, members, 9);
  assert.equal(afterAnswer.session, answered, "an answered decision cannot be reopened by retrying its key");
  assert.throws(() => requestPeerInput(later, { ...scope, runId: "discussion-run" }, { ...request, targetMemberId: "spencer" }, members, 9), /key already used/);
  assert.throws(() => requestPeerInput(later, { ...scope, runId: "discussion-run" }, { ...request, prompt: "A different decision?" }, members, 9), /key already used/);
  assert.throws(() => requestPeerInput(later, { ...scope, runId: "discussion-run" }, { ...request, options: ["MAYBE"] }, members, 9), /key already used/);
  assert.equal(requestPeerInput(later, { ...scope, runId: "discussion-run" }, { ...request, key: "new-decision", prompt: "A different decision?" }, members, 9).session.messages.filter((m) => m.interaction?.kind === "question").length, 2);
});

test("review keys still produce a new revision-bound review in a later run", () => {
  const request = { kind: "review" as const, key: "access", prompt: "Review access", targetMemberId: "maya" };
  const first = requestPeerInput(working(), scope, request, members, 3);
  const ready = applyHiveRunResult(first.session, result(), 4);
  const next = reduceTaskSession(ready, { type: "send-message", actor: "spencer", body: "Implement the next change" }, 5, members);
  next.workspace.liveReply = { id: "next-change", body: "", sequence: 0, startedAt: 5 };
  const second = requestPeerInput(next, { ...scope, runId: "next-change" }, request, members, 6);
  assert.notEqual(second.messageId, first.messageId);
  assert.equal(second.session.messages.at(-1)?.interaction?.runId, "next-change");
});

test("question metadata survives the discussion window without exposing queued answers", () => {
  const first = requestPeerInput(working(), scope, { key: "decision", prompt: "A decision?", targetMemberId: "maya" }, members, 3);
  const answered = reduceTaskSession(first.session, { type: "answer-question", actor: "maya", messageId: first.messageId, body: "QUEUED_PRIVATE_ANSWER", clientId: "once" }, 4, members);
  for (let index = 0; index < 15; index++) answered.messages.push({ id: `later-${index}`, name: "Hive", initials: "H", body: "Later context", role: "agent", time: "12:00" });
  const context = describeHiveContext({ ...answered, members });
  assert.deepEqual(context.questions, [{ messageId: first.messageId, threadId: null, key: "decision", targetMemberId: "maya", status: "answered" }]);
  assert.doesNotMatch(JSON.stringify(context), /QUEUED_PRIVATE_ANSWER/);
});

test("review is bound to the completed run, not agent-supplied versions, and only a human can resolve current evidence", () => {
  const { session, messageId } = requestPeerInput(working(), scope, { kind: "review", key: "access", prompt: "Review draft access", targetMemberId: "maya" }, members, 3);
  const resolve = { type: "resolve-peer-review", actor: "maya", messageId, revision: "run-one" } as const;
  assert.equal(reduceTaskSession(session, resolve, 4, members), session, "cannot approve a running workspace");
  const ready = applyHiveRunResult(session, { ...result(), diff: "+ private drafts", changedFiles: ["access.ts"] }, 5);
  assert.equal(ready.messages.find((m) => m.id === messageId)?.interaction?.revision, "run-one");
  for (const actor of ["spencer", "maya"]) {
    const retiredApproval = JSON.parse(JSON.stringify({ type: "advance-run", actor }));
    assert.equal(reduceTaskSession(ready, retiredApproval, 6, members), ready, "neither reviewer nor teammate can bypass the review through global approval");
  }
  assert.equal(reduceTaskSession(ready, { ...resolve, actor: "spencer" }, 6, members), ready);
  assert.equal(reduceTaskSession(ready, { ...resolve, revision: "stale" }, 6, members), ready);
  const resolved = reduceTaskSession(ready, resolve, 6, members);
  assert.equal(resolved.messages.find((m) => m.id === messageId)?.interaction?.resolved?.by, "maya");
  assert.equal(reduceTaskSession(resolved, resolve, 7, members), resolved);
  assert.notEqual(resolved.stage, "approved", "thread resolution is not a PR or workspace approval");
  const discussion = reduceTaskSession(ready, { type: "annotate-message", actor: "maya", messageId, body: "Check shared drafts too", clientId: "feedback-one" }, 6, members);
  assert.equal(reduceTaskSession(discussion, resolve, 7, members), discussion, "unaddressed discussion cannot be silently resolved");
  const replyId = discussion.messages.find((m) => m.id === messageId)!.annotations!.at(-1)!.id;
  const revised = reduceTaskSession(discussion, { type: "steer-thread", actor: "maya", messageId, throughReplyId: replyId }, 8, members);
  revised.workspace.liveReply = { id: "run-two", threadId: messageId, body: "", sequence: 0, startedAt: 8 };
  const verify = applyHiveRunResult(revised, { ...result(), diff: "+ private and shared drafts" }, 9);
  assert.equal(verify.messages.find((m) => m.id === messageId)?.interaction?.revision, "run-two");
  assert.equal(reduceTaskSession(verify, resolve, 10, members), verify, "an old review cannot approve the revision");
  assert.equal(reduceTaskSession(verify, { ...resolve, revision: "run-two" }, 10, members).messages.find((m) => m.id === messageId)?.interaction?.resolved?.by, "maya");
});

test("interrupted runs preserve the answer and thread, but cannot auto-continue or expose a ready review", () => {
  const { session, messageId } = requestPeerInput(working(), scope, { kind: "review", key: "review", prompt: "Check access" }, members, 3);
  const failed = applyHiveRunError(session, "Run timed out", 4);
  assert.equal(failed.messages.find((m) => m.id === messageId)?.interaction?.status, "unavailable");
  const question = requestPeerInput(working(), scope, { key: "decision", prompt: "Team or private?" }, members, 3);
  const answered = reduceTaskSession(question.session, { type: "answer-question", actor: "maya", messageId: question.messageId, body: "Private", clientId: "one" }, 4, members);
  const lost = applyHiveRunError(answered, "Run timed out", 5);
  assert.equal(lost.steeringQueue.length, 1);
  assert.equal(reduceTaskSession(lost, { type: "continue-peer-response", actor: "maya", steerId: lost.steeringQueue[0].id }, 6, members), lost);
  const resumed = reduceTaskSession(lost, { type: "apply-next-steer", actor: "maya" }, 7, members);
  resumed.workspace.liveReply = { id: "continuation", threadId: question.messageId, body: "Checking…", sequence: 1, startedAt: 7 };
  const interrupted = applyHiveRunError(resumed, "Sandbox disconnected", 8);
  assert.equal(interrupted.messages.find((m) => m.id === question.messageId)?.annotations?.at(-1)?.deliveryStatus, "error");
  assert.equal(interrupted.messages.find((m) => m.id === question.messageId)?.annotations?.at(-1)?.body, "Sandbox disconnected");
});

test("automatic continuation cannot consume a different queue item, run revoked input, or replay a restored queue", () => {
  const question = requestPeerInput(working(), scope, { key: "decision", prompt: "Team or private?" }, members, 3);
  const answered = reduceTaskSession(question.session, { type: "answer-question", actor: "maya", messageId: question.messageId, body: "Private", clientId: "one" }, 4, members);
  const idle = applyHiveRunResult(answered, result(), 5);
  const action = { type: "continue-peer-response", actor: "spencer", steerId: idle.steeringQueue[0].id } as const;
  assert.equal(reduceTaskSession(idle, { ...action, steerId: "old-queue-item" }, 6, members), idle);
  assert.equal(reduceTaskSession(idle, action, 6, [memberDirectory.spencer]), idle, "removed answer author cannot direct another run");
  const restored = { ...idle, workspace: { ...idle.workspace, lastRestore: { id: "restore-one", snapshotId: "snapshot-one", by: "spencer", at: 6 } } };
  assert.equal(reduceTaskSession(restored, action, 7, members), restored);
  const queuedContext = { ...answered, members };
  // The currently running agent may know that an answer arrived, but must not
  // execute its queued contents through a read-only context call.
  assert.doesNotMatch(JSON.stringify(describeHiveContext(queuedContext)), /Private/);
});

test("review completion covers only the feedback captured by that run, not a later queued thread", () => {
  const requested = requestPeerInput(working(), scope, { kind: "review", key: "review", prompt: "Check drafts" }, members, 3);
  let state = applyHiveRunResult(requested.session, result(), 4);
  const messageId = requested.messageId;
  state = reduceTaskSession(state, { type: "annotate-message", actor: "maya", messageId, body: "Check author access", clientId: "first" }, 5, members);
  const first = state.messages.find((m) => m.id === messageId)!.annotations!.at(-1)!.id;
  state = reduceTaskSession(state, { type: "steer-thread", actor: "maya", messageId, throughReplyId: first }, 6, members);
  state.workspace.liveReply = { id: "feedback-run", threadId: messageId, body: "", sequence: 0, startedAt: 6 };
  state = reduceTaskSession(state, { type: "annotate-message", actor: "spencer", messageId, body: "Also check links", clientId: "later" }, 7, members);
  const later = state.messages.find((m) => m.id === messageId)!.annotations!.at(-1)!.id;
  state = reduceTaskSession(state, { type: "steer-thread", actor: "spencer", messageId, throughReplyId: later }, 8, members);
  state = applyHiveRunResult(state, result(), 9);
  const removed = reduceTaskSession(state, { type: "remove-queued-steer", actor: "spencer", steerId: state.steeringQueue[0].id }, 10, members);
  assert.equal(reduceTaskSession(removed, { type: "resolve-peer-review", actor: "maya", messageId, revision: "feedback-run" }, 11, members), removed, "removing later queued feedback does not mean Hive addressed it");
});
