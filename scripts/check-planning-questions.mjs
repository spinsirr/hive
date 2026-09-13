// Purpose: without a repository, use the production MCP definition and reducers
// to ask inline, save exactly one designated answer, and continue once.
// Only persistence and provider transport are replaced; no production writes.
import assert from "node:assert/strict";
import { connectHiveConversationTools } from "../src/lib/hive-conversation-tools.ts";
import { handleHiveMcp } from "../src/lib/hive-mcp.ts";
import { createHiveMemory } from "../src/lib/hive-memory.ts";
import {
  createInitialTaskSessionState,
  reduceTaskSession,
  appendHiveReply,
  memberDirectory,
} from "../src/lib/task-session.ts";
import { requestPeerInput } from "../src/lib/peer-collaboration.ts";
import { conversationTimelineMessages } from "../src/lib/conversation-timeline.ts";

const members = [memberDirectory.spencer, memberDirectory.maya];
const scope = {
  sessionId: "planning-questions",
  memberId: "spencer",
  runId: "run-question",
};
let state = reduceTaskSession(
  createInitialTaskSessionState(1, scope.sessionId),
  { type: "send-message", actor: "spencer", body: "Ask Maya about spacing" },
  2,
  members
);
state.workspace.liveReply = {
  id: scope.runId,
  body: "",
  startedAt: 2,
  sequence: 0,
};
const realFetch = globalThis.fetch;
const toolNames = [];
let availableTools;
globalThis.fetch = async (url, init) => {
  assert.equal(
    String(url),
    "https://hive.test/api/sessions/planning-questions/agent-tools"
  );
  const request = new Request(url, init);
  assert.equal(request.headers.get("authorization"), "Bearer fixture");
  const body = await request.clone().json();
  if (body.method === "tools/call") toolNames.push(body.params.name);
  const response = await handleHiveMcp(
    request,
    scope,
    {
      read: async () => ({ ...state, members }),
      reply: async () => {
        throw new Error("Asking must not create a Thread");
      },
      request: async (received, input) => {
        const published = requestPeerInput(state, received, input, members, 3);
        const created = published.session !== state;
        state = published.session;
        return {
          messageId: published.messageId,
          created,
          status: "awaiting_answer",
        };
      },
      control: async () => {
        throw new Error("Planning must not delegate repository work");
      },
    },
    createHiveMemory(undefined)
  );
  if (body.method === "tools/list")
    availableTools = (await response.clone().json()).result.tools
      .map((tool) => tool.name)
      .sort();
  return response;
};
let connection;
try {
  connection = await connectHiveConversationTools({
    url: "https://hive.test/api/sessions/planning-questions/agent-tools",
    token: "fixture",
  });
  assert.deepEqual(Object.keys(connection.tools).sort(), [
    "get_context",
    "reply_to_thread",
    "request_input",
  ]);
  assert.deepEqual(
    availableTools,
    ["get_context", "reply_to_thread", "request_input"],
    "the native MCP endpoint also exposes conversation-only capabilities before repository attachment"
  );
  const options = {
    toolCallId: "test",
    messages: [],
    abortSignal: new AbortController().signal,
  };
  const context = await connection.tools.get_context.execute({}, options);
  assert.match(JSON.stringify(context), /Maya/);
  const input = {
    key: "spacing",
    prompt: "Compact or comfortable?",
    targetMemberId: "maya",
    options: ["Compact", "Comfortable"],
  };
  await connection.tools.request_input.execute(input, options);
  await connection.tools.request_input.execute(input, options);
  const question = state.messages.find((message) => message.interaction);
  assert.equal(
    state.messages.filter((message) => message.interaction).length,
    1
  );
  assert.equal(question.threadId, undefined);
  assert.equal(question.annotations, undefined);
  state = appendHiveReply(state, "", 4);
  assert.deepEqual(
    conversationTimelineMessages(state.messages).map((message) => message.id),
    [state.messages[0].id, question.id],
    "the question is the reply, without a generated greeting or empty bubble"
  );
  const answer = {
    type: "answer-question",
    actor: "maya",
    messageId: question.id,
    body: "Compact",
    clientId: "test-answer",
  };
  const wrongActor = reduceTaskSession(
    state,
    { ...answer, actor: "spencer" },
    5,
    members
  );
  assert.equal(wrongActor, state);
  state = reduceTaskSession(state, answer, 6, members);
  assert.equal(
    state.messages.find((message) => message.id === question.id).interaction
      .answer.by,
    "maya"
  );
  assert.equal(state.steeringQueue.length, 0);
  assert.equal(
    state.activeSteer.source.kind,
    "peer-response",
    "an idle task starts exactly one answer continuation"
  );
  assert.equal(state.stage, "running");
  assert.equal(
    reduceTaskSession(state, answer, 7, members),
    state,
    "duplicate answer does not queue a second turn"
  );
  assert.deepEqual(toolNames, [
    "get_context",
    "request_input",
    "request_input",
  ]);
  console.log(
    "PASS: no-repository question uses shared MCP schema and inline state, has no extra reply/Thread, and accepts one designated answer."
  );
} finally {
  await connection?.close();
  globalThis.fetch = realFetch;
}
