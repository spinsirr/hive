// Real React hook and state transitions; no model calls.
import assert from "node:assert/strict";
import { registerTestModules } from "../helpers/test-modules.mjs";
import { createDomFixture } from "../helpers/test-dom.mjs";
const dom = createDomFixture("<!doctype html><html><body></body></html>", {
  url: "https://hive.test",
});
registerTestModules();
const { StrictMode, createElement } = await import("react");
const { renderHook, cleanup } = await import("@testing-library/react");
const { useQueuedContinuation } =
  await import("../../src/hooks/use-queued-continuation.ts");
const {
  createInitialTaskSessionState,
  memberDirectory,
  reduceTaskSession,
  applyHiveRunResult,
} = await import("../../src/lib/session/task-session.ts");
const members = Object.values(memberDirectory);
let state = reduceTaskSession(
  createInitialTaskSessionState(1, "qa-auto-queue"),
  { type: "send-message", actor: "spencer", body: "Hello", clientId: "first" },
  2,
  members
);
state = reduceTaskSession(
  state,
  {
    type: "send-message",
    actor: "maya",
    body: "How many people are online?",
    clientId: "second",
  },
  3,
  members
);
const result = {
  sandboxName: "fixture",
  summary: "Hello",
  diff: "",
  files: [],
  commands: [],
  changedFiles: [],
};
const calls = [];
const dispatch = async (action) => {
  calls.push(action);
  return null;
};
try {
  const view = renderHook(
    ({ session, disconnected }) =>
      useQueuedContinuation(session, disconnected, dispatch),
    {
      initialProps: { session: state, disconnected: false },
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    }
  );
  assert.equal(calls.length, 0, "running task does not start pending input");
  state = applyHiveRunResult(state, result, 4);
  view.rerender({ session: state, disconnected: false });
  assert.deepEqual(
    calls,
    [{ type: "continue-queued-steer", steerId: state.steeringQueue[0].id }],
    "successful completion automatically submits the ordinary queued message"
  );
  view.rerender({ session: { ...state }, disconnected: false });
  assert.equal(calls.length, 1, "no repeated dispatch from unrelated updates");
  view.rerender({ session: state, disconnected: true });
  assert.equal(calls.length, 1);
  view.rerender({ session: state, disconnected: false });
  assert.equal(calls.length, 2, "reconnect retries an unconfirmed head safely");
  cleanup();
  for (const session of [
    { ...state, workspace: { ...state.workspace, error: "Test run failed" } },
    {
      ...state,
      workspace: {
        ...state.workspace,
        lastRestore: { id: "r", snapshotId: "s", by: "spencer", at: 5 },
      },
    },
  ]) {
    renderHook(() => useQueuedContinuation(session, false, dispatch));
    assert.equal(calls.length, 2, "error and restored history remain paused");
    cleanup();
  }
  console.log(
    "PASS: ordinary queued input auto-continues once, waits while running, retries on reconnect, and pauses on error/restore."
  );
} finally {
  cleanup();
  dom.close();
}
