import assert from "node:assert/strict";
import test from "node:test";
import { finalizeSubagents, type HiveSubagent } from "./hive-subagents.ts";
import {
  appendHiveReply,
  conversationMessages,
  createInitialTaskSessionState,
} from "../session/task-session.ts";
import {
  receiveAgentReply,
  receiveTaskSessionSnapshot,
} from "../session/task-session-snapshot.ts";
import type { TaskSessionSnapshot } from "../session/task-session-contract.ts";

const task: HiveSubagent = {
  id: "610b5182-9342-4f44-9864-82cfeee5a14d",
  runId: "run-one",
  kind: "research",
  task: "Inspect queue boundaries",
  status: "running",
  startedAt: 1,
  result: "",
};
function fixture(): TaskSessionSnapshot {
  const session = createInitialTaskSessionState(1, "subagent-qa");
  session.workspace.liveReply = {
    id: "run-one",
    body: "",
    sequence: 0,
    startedAt: 1,
    subagents: [task],
    subagentSequence: 1,
  };
  return { session, members: [], activeMembers: [], typingMembers: [] };
}
test("subagents appear before parent text, survive completion, and do not become extra authors", () => {
  const state = fixture().session;
  const messages = conversationMessages(state);
  assert.equal(messages.at(-1)?.id, "run-one");
  assert.equal(messages.at(-1)?.role, "agent");
  assert.equal(messages.at(-1)?.subagents?.[0].status, "running");
  state.workspace.liveReply!.subagents = [
    { ...task, status: "completed", result: "Evidence: src/queue.ts:12" },
  ];
  const finished = appendHiveReply(state, "Here is the combined result.", 10);
  assert.equal(
    finished.messages.at(-1)?.subagents?.[0].result,
    "Evidence: src/queue.ts:12"
  );
  assert.equal(finished.workspace.liveReply, undefined);
});
test("an ended/lost parent never leaves a false completed or forever-running child", () => {
  assert.equal(finalizeSubagents([task])?.[0].status, "unconfirmed");
  assert.equal(task.status, "running", "preserve immutable input");
  assert.equal(
    finalizeSubagents([{ ...task, status: "stopped" }])?.[0].status,
    "stopped"
  );
});
test("independent text and subagent sequences merge without rolling each other back", () => {
  let current = fixture();
  const initial = current.session.workspace.liveReply!;
  current = receiveAgentReply(current, "subagent-qa", {
    ...initial,
    body: "Latest text",
    sequence: 2,
  });
  current = receiveAgentReply(current, "subagent-qa", {
    ...initial,
    subagents: [{ ...task, status: "completed", result: "Finding" }],
    subagentSequence: 2,
  });
  assert.equal(current.session.workspace.liveReply?.body, "Latest text");
  assert.equal(
    current.session.workspace.liveReply?.subagents?.[0].status,
    "completed"
  );
  const merged = receiveTaskSessionSnapshot(current, fixture());
  assert.equal(merged.session.workspace.liveReply?.body, "Latest text");
  assert.equal(
    merged.session.workspace.liveReply?.subagents?.[0].status,
    "completed"
  );
  assert.equal(
    receiveAgentReply(current, "subagent-qa", {
      ...initial,
      id: "old-run",
      subagentSequence: 999,
    }),
    current
  );
  const ended = {
    ...current,
    session: appendHiveReply(current.session, "Done", 10),
  };
  assert.equal(
    receiveAgentReply(ended, "subagent-qa", {
      ...initial,
      subagentSequence: 999,
    }),
    ended
  );
});
