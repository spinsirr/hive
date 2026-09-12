import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleHiveMcp } from "./hive-mcp.ts";
import { createHiveMemory } from "./hive-memory.ts";
import { createInitialTaskSessionState, memberDirectory, reduceTaskSession, applyHiveRunResult, applyHiveRunError, conversationMessages, type TaskSessionState, type HiveRunResult } from "./task-session.ts";
import { buildHiveRunInput } from "./hive-prompt.ts";
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
        state = published.session;
        return { messageId: published.messageId };
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

test("teammate answer is saved once, queued while busy, and continued with authorship in the original thread", () => {
  const { session, messageId } = requestPeerInput(working(), scope, { key: "drafts", prompt: "Who can see drafts?", targetMemberId: "maya" }, members, 3);
  const action = { type: "answer-question", actor: "maya", messageId, body: "Only the author, until shared.", clientId: "answer-one" } as const;
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
  resumed.workspace.liveReply = { id: "run-two", threadId: messageId, body: "Checking access", sequence: 1, startedAt: 7 };
  assert.equal(conversationMessages(resumed).find((m) => m.id === messageId)?.annotations?.at(-1)?.body, "Checking access");
  const finished = applyHiveRunResult(resumed, { ...result(), summary: "Drafts are private until shared." }, 8);
  assert.equal(finished.messages.find((m) => m.id === messageId)?.annotations?.at(-1)?.body, "Drafts are private until shared.");
  assert.equal(finished.messages.some((m) => m.id === "run-two"), false, "result does not escape its thread");
});

function result(): HiveRunResult {
  return { sandboxName: "sandbox-test", agentSession: { id: "native-one", runtime: "codex" }, summary: "Waiting for the team decision.", diff: "", files: [], commands: [], changedFiles: [] };
}

test("review is bound to the completed run, not agent-supplied versions, and only a human can resolve current evidence", () => {
  const { session, messageId } = requestPeerInput(working(), scope, { kind: "review", key: "access", prompt: "Review draft access", targetMemberId: "maya" }, members, 3);
  const resolve = { type: "resolve-peer-review", actor: "maya", messageId, revision: "run-one" } as const;
  assert.equal(reduceTaskSession(session, resolve, 4, members), session, "cannot approve a running workspace");
  const ready = applyHiveRunResult(session, { ...result(), diff: "+ private drafts", changedFiles: ["access.ts"] }, 5);
  assert.equal(ready.messages.find((m) => m.id === messageId)?.interaction?.revision, "run-one");
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
