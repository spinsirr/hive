// Purpose: a completed turn stays warm without inference credentials; messages
// extend only its current VM; expired snapshots retain the matching native context.
import assert from "node:assert/strict";
import { mock } from "node:test";
const vm = {
  sessionId: "vm-1",
  async extendTimeout(ms) {
    deadline += ms;
  },
};
let deadline = 1_800_000,
  status = "running",
  forwarding = true,
  stopped = 0;
const sandbox = {
  name: "hive-session-native-1",
  persistent: true,
  timeout: 1_800_000,
  tags: { session: "task-1" },
  keepLastSnapshots: { count: 3 },
  get status() {
    return status;
  },
  get expiresAt() {
    return new Date(deadline);
  },
  currentSession() {
    return vm;
  },
  async stop() {
    stopped++;
    status = "stopped";
  },
};
mock.module("@vercel/sandbox", {
  namedExports: {
    Sandbox: {
      async get(options) {
        assert.equal(
          options.resume,
          false,
          "discussion must never resume a closed VM"
        );
        return sandbox;
      },
    },
  },
});
const { createTaskEnvironment, refreshTaskEnvironment } =
  await import("../src/lib/task-environment.ts");
const task = {
  sessionId: "task-1",
  workspace: {
    sandboxName: sandbox.name,
    agentSession: { id: "native-1", runtime: "codex" },
  },
};
const environment = createTaskEnvironment(task, sandbox);
let startedFrom;
const harness = environment.wrap({
  async doStart(options) {
    startedFrom = options.resumeFrom;
    return {};
  },
});
const history = {
  type: "resume-session",
  harnessId: "codex",
  specificationVersion: "harness-v1",
  data: {
    threadId: "native-history",
    bridge: { token: "private", port: 4319 },
  },
};
await harness.doStart({
  sandboxSession: {
    id: sandbox.name,
    async setRequestTransformations(rules) {
      forwarding = rules.length > 0;
    },
  },
  resumeFrom: history,
});
assert.equal(
  startedFrom.data.bridge,
  undefined,
  "old process coordinates cannot survive a VM replacement"
);
assert.equal(startedFrom.data.threadId, "native-history");
const parked = await environment.park({
  async detach() {
    return history;
  },
});
assert.equal(
  stopped,
  0,
  "a completed turn no longer shuts down the environment"
);
assert.equal(
  forwarding,
  false,
  "an idle environment cannot spend subscription inference credits"
);
assert.equal(parked.environment.vmId, "vm-1");
assert.equal(parked.resumeFrom.data.threadId, "native-history");
task.workspace.environment = parked.environment;
await refreshTaskEnvironment(task, 600_000);
assert.equal(
  deadline,
  2_400_000,
  "a message at minute 10 moves shutdown to minute 40"
);
status = "stopped";
await refreshTaskEnvironment(task, 3_000_000);
assert.equal(
  status,
  "stopped",
  "ordinary discussion does not wake an expired environment"
);
assert.equal(deadline, 2_400_000);
console.log(
  "PASS: warm completion, credential removal, sliding 30-minute deadline, and no wake on discussion after expiry."
);
