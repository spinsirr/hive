import { registerTestModules } from "../helpers/test-modules.mjs";
// Purpose: confirm completed recovery promptly, keep confirming after a lost
// status response, and never turn a status check into a second restore.
import assert from "node:assert/strict";

import { mock } from "node:test";
import { createDomFixture } from "../helpers/test-dom.mjs";

const dom = createDomFixture("<!doctype html><html><body></body></html>", {
  url: "https://hive.test",
});
registerTestModules();
const { createElement: h } = await import("react");
const { act, renderHook, cleanup } = await import("@testing-library/react");
const { HiveClientContext } =
  await import("../../src/components/hive/hive-client.tsx");
const { useWorkspaceRecovery } =
  await import("../../src/hooks/use-workspace-recovery.ts");
mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
const requests = [],
  received = [],
  deferred = [];
let next = "pending";
const client = {
  reload() {},
  async request(_path, init) {
    requests.push(JSON.parse(init.body));
    if (next === "deferred") {
      const pending = Promise.withResolvers();
      deferred.push({ ...pending, signal: init.signal });
      return pending.promise;
    }
    if (next === "timeout")
      throw new DOMException("transport timeout", "TimeoutError");
    return next === "confirmed"
      ? Response.json({ confirmed: true })
      : Response.json({ pending: true }, { status: 202 });
  },
};
const restore = {
  id: "restore",
  snapshotId: "snap",
  startedAt: 1000,
  retryAfter: 91_000,
  status: "unconfirmed",
  by: { id: "owner" },
};
const wrapper = ({ children }) =>
  h(HiveClientContext, { value: client }, children);
const tick = async (ms) =>
  act(async () => {
    mock.timers.tick(ms);
  });
try {
  const view = renderHook(
    ({ revision, pending }) =>
      useWorkspaceRecovery("task", revision, pending, (value) =>
        received.push(value)
      ),
    { wrapper, initialProps: { revision: 1, pending: restore } }
  );
  await tick(3000);
  assert.equal(
    requests.length,
    1,
    "read-only confirmation begins well before the 90-second write retry boundary"
  );
  assert.equal(requests[0].mode, "check");
  assert.match(view.result.current.notice, /Checking automatically/);
  view.rerender({ revision: 2, pending: { ...restore } });
  next = "timeout";
  await tick(10_000);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].version,
    2,
    "use the latest revision without restarting the recovery loop"
  );
  assert.match(view.result.current.notice, /Checking again automatically/);
  next = "confirmed";
  await tick(10_000);
  assert.equal(
    received.length,
    1,
    "a transient timeout does not strand the disabled composer"
  );
  assert.ok(Date.now() < restore.retryAfter);
  view.rerender({ revision: 3, pending: undefined });
  await tick(200_000);
  assert.equal(requests.length, 3, "confirmation stops all polling");
  assert.ok(requests.every((request) => request.mode === "check"));
  cleanup();
  requests.length = 0;
  next = "pending";
  const exhausted = renderHook(
    ({ revision }) => useWorkspaceRecovery("task", revision, restore, () => {}),
    { wrapper, initialProps: { revision: 1 } }
  );
  await tick(3000);
  for (let attempt = 2; attempt <= 18; attempt++) {
    exhausted.rerender({ revision: attempt });
    await tick(10_000);
  }
  assert.equal(requests.length, 18);
  assert.match(exhausted.result.current.notice, /Check status again/);
  await tick(200_000);
  assert.equal(
    requests.length,
    18,
    "Ordinary revisions cannot reset the automatic retry budget"
  );
  await act(async () => exhausted.result.current.check());
  assert.equal(
    requests.length,
    19,
    "Manual confirmation restarts an exhausted budget"
  );
  assert.equal(requests[18].version, 18);
  cleanup();

  requests.length = 0;
  received.length = 0;
  next = "deferred";
  const pending = renderHook(
    ({ taskId, operation }) =>
      useWorkspaceRecovery(taskId, 1, operation, (value) =>
        received.push(value)
      ),
    { wrapper, initialProps: { taskId: "task", operation: restore } }
  );
  await tick(3000);
  assert.equal(pending.result.current.checking, true);
  await act(async () => pending.result.current.check());
  assert.equal(
    deferred[0].signal.aborted,
    true,
    "Manual checks cancel the previous invocation"
  );
  await act(async () => deferred[0].resolve(Response.json({ stale: true })));
  assert.equal(
    received.length,
    0,
    "A canceled check cannot publish a late confirmation"
  );
  await act(async () =>
    deferred[1].resolve(Response.json({ confirmed: true }))
  );
  assert.deepEqual(received, [{ confirmed: true }]);
  assert.equal(pending.result.current.checking, false);
  await tick(200_000);
  assert.equal(
    requests.length,
    2,
    "Confirmed actors stop without waiting for the parent to clear restore state"
  );

  pending.rerender({ taskId: "task", operation: { ...restore, id: "second" } });
  await tick(3000);
  pending.rerender({
    taskId: "other-task",
    operation: { ...restore, id: "second" },
  });
  assert.equal(
    deferred[2].signal.aborted,
    true,
    "Switching tasks cancels the old task's check"
  );
  await tick(3000);
  pending.rerender({
    taskId: "other-task",
    operation: { ...restore, id: "third" },
  });
  assert.equal(
    deferred[3].signal.aborted,
    true,
    "A new restore cancels the previous restore's check"
  );
  await tick(3000);
  pending.unmount();
  assert.equal(
    deferred[4].signal.aborted,
    true,
    "Unmount cancels the active check"
  );
  await act(async () => {
    for (const check of deferred.slice(2))
      check.resolve(Response.json({ stale: true }));
  });
  await tick(200_000);
  assert.equal(requests.length, 5);
  assert.equal(
    received.length,
    1,
    "Late results from old operations cannot update the task"
  );
  assert.ok(requests.every((request) => request.mode === "check"));
  console.log(
    "PASS: recovery retries are bounded, manual checks restart the budget, and cancellation prevents stale confirmations without retrying writes."
  );
} finally {
  cleanup();
  mock.timers.reset();
  dom.close();
}
