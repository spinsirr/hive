import { registerTestModules } from "../helpers/test-modules.mjs";
import assert from "node:assert/strict";
import { mock } from "node:test";

registerTestModules();
let admitted = true,
  member = { id: "github-101" },
  foreign = false,
  rejectStop = false;
const calls = [];
const { createInitialTaskSessionState } =
  await import("../../src/lib/session/task-session.ts");
const session = createInitialTaskSessionState(1, "subagent-qa");
session.repository = { url: "https://github.com/example/repo", connectedAt: 1 };
session.workspace = {
  ...session.workspace,
  startedAt: 1,
  liveReply: { id: "active-run", body: "", sequence: 0, startedAt: 1 },
};
const task = {
  id: "dc064a02-7cff-4874-9f70-4a0f936958c3",
  runId: "active-run",
  kind: "review",
  task: "Inspect the diff",
  status: "stopping",
  startedAt: 1,
  result: "",
};
await mock.module(
  new URL("../../src/server/auth/auth-session.ts", import.meta.url).href,
  {
    namedExports: {
      HIVE_SESSION_COOKIE: "hive_session",
      getSessionMember: async () => member,
    },
  }
);
await mock.module(
  new URL("../../src/server/sessions/task-session-store.ts", import.meta.url)
    .href,
  {
    namedExports: {
      isTaskSessionMember: async (id) => admitted && id === session.sessionId,
      withTaskSubagentControl: async (_id, read) => read(session),
    },
  }
);
await mock.module("@vercel/sandbox", {
  namedExports: {
    Sandbox: {
      get: async (input) => {
        calls.push({ type: "get", input });
        return {
          tags: { session: foreign ? "other-task" : session.sessionId },
          runCommand: async (input) => {
            calls.push({ type: "control", input });
            assert.equal(input.cmd, "node");
            assert.deepEqual(JSON.parse(input.env.HIVE_CONTROL_INPUT), {
              action: "stop",
              id: task.id,
            });
            assert.match(input.env.HIVE_CONTROL, /^[0-9a-f]{64}$/);
            assert.ok(
              !input.args.join(" ").includes(input.env.HIVE_CONTROL),
              "Never put control credentials in argv"
            );
            return {
              exitCode: rejectStop ? 1 : 0,
              stdout: async () => JSON.stringify({ result: task }),
            };
          },
        };
      },
    },
  },
});
const previousSecret = process.env.HIVE_INVITE_SECRET;
process.env.HIVE_INVITE_SECRET = "isolated-subagent-test-secret";
try {
  const { NextRequest } = await import("next/server.js");
  const { POST } =
    await import("../../src/app/api/sessions/[sessionId]/subagents/route.ts");
  const { subagentCapability } =
    await import("../../src/server/agents/tools/subagent-control.ts");
  assert.notEqual(
    subagentCapability("one", "run", "fixture"),
    subagentCapability("two", "run", "fixture")
  );
  assert.notEqual(
    subagentCapability("one", "run", "fixture"),
    subagentCapability("one", "other-run", "fixture")
  );
  const request = (
    body = { id: task.id, runId: "active-run" },
    origin = "https://hive.test"
  ) =>
    POST(
      new NextRequest("https://hive.test/api/sessions/subagent-qa/subagents", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ sessionId: session.sessionId }) }
    );
  member = null;
  assert.equal((await request()).status, 401);
  member = { id: "github-101" };
  admitted = false;
  assert.equal((await request()).status, 401);
  admitted = true;
  assert.equal((await request(undefined, "https://foreign.test")).status, 403);
  assert.equal(
    (await request({ id: task.id, runId: "active-run", action: "spawn" }))
      .status,
    400
  );
  assert.equal(
    (await request({ id: task.id, runId: "previous-run" })).status,
    409
  );
  assert.equal(calls.length, 0, "Rejected requests must never contact Sandbox");
  foreign = true;
  assert.equal((await request()).status, 409);
  assert.equal(calls.filter((call) => call.type === "control").length, 0);
  foreign = false;
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).task.status,
    "stopping",
    "ACK is not stopped"
  );
  assert.ok(
    calls
      .filter((call) => call.type === "get")
      .every((call) => call.input.resume === false)
  );
  assert.equal(session.workspace.liveReply.id, "active-run");
  assert.equal(session.steeringQueue.length, 0);
  rejectStop = true;
  assert.equal((await request()).status, 409);
  const count = calls.length;
  session.workspace.completedAt = 10;
  assert.equal((await request()).status, 409);
  assert.equal(calls.length, count);
  console.log(
    "PASS: stop requires same-origin task membership, active run, matching VM and run capability; never creates/resumes a sandbox, starts Hive, or changes the queue."
  );
} finally {
  if (previousSecret === undefined) delete process.env.HIVE_INVITE_SECRET;
  else process.env.HIVE_INVITE_SECRET = previousSecret;
}
