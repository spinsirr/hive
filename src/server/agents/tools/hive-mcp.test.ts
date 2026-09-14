import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleHiveMcp } from "./hive-mcp.ts";
import { createHiveMemory } from "../memory/hive-memory.ts";
import {
  assertHiveToolRun,
  describeHiveContext,
  hiveThreadReply,
  memoryContribution,
  type HiveToolContext,
} from "./hive-tool-context.ts";
import {
  createInitialTaskSessionState,
  memberDirectory,
  reduceTaskSession,
} from "../../../lib/session/task-session.ts";
import type {
  HiveSubagent,
  SubagentControl,
} from "../../../lib/agents/hive-subagents.ts";

const scope = { sessionId: "tool-test", memberId: "spencer", runId: "run-one" };

test("MCP delegation, result reads and stop remain bound to the current authenticated run", async () => {
  let context = fixture();
  const calls: SubagentControl[] = [];
  const task: HiveSubagent = {
    id: "dc064a02-7cff-4874-9f70-4a0f936958c3",
    runId: scope.runId,
    kind: "research",
    task: "Inspect queue.ts",
    status: "running",
    startedAt: 1,
    result: "",
  };
  const client = new Client({ name: "subagent-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL("https://hive.test/agent-tools"),
      {
        fetch: (input, init) =>
          handleHiveMcp(
            new Request(input, init),
            scope,
            {
              read: async () => context,
              reply: async () => {
                throw new Error("Delegation must not post a team reply");
              },
              control: async (receivedScope, input) => {
                assert.deepEqual(receivedScope, scope);
                calls.push(input);
                return task;
              },
            },
            createHiveMemory(undefined)
          ),
      }
    )
  );
  try {
    const tools = await client.listTools();
    for (const name of ["spawn_subagent", "read_subagent", "stop_subagent"])
      assert.ok(tools.tools.some((tool) => tool.name === name));
    await client.callTool({
      name: "spawn_subagent",
      arguments: {
        key: "inspect-queue",
        kind: "research",
        task: "Inspect queue.ts",
      },
    });
    await client.callTool({
      name: "read_subagent",
      arguments: { id: task.id },
    });
    await client.callTool({
      name: "stop_subagent",
      arguments: { id: task.id },
    });
    assert.deepEqual(
      calls.map((input) => input.action),
      ["spawn", "read", "stop"]
    );
    assert.equal(context.steeringQueue.length, 0);
    context = {
      ...context,
      workspace: { ...context.workspace, liveReply: { id: "new-run" } },
    };
    assert.equal(
      (
        await client.callTool({
          name: "spawn_subagent",
          arguments: { key: "stale", kind: "research", task: "Must not run" },
        })
      ).isError,
      true
    );
    assert.equal(calls.length, 3);
  } finally {
    await client.close();
  }
});
function fixture(): HiveToolContext {
  const initial = createInitialTaskSessionState(1, scope.sessionId);
  return {
    ...initial,
    stage: "running",
    repository: {
      id: 20,
      installationId: 10,
      url: "https://github.com/example/repo",
      name: "example/repo",
      branch: "main",
      provider: "github-app",
      connectedAt: 1,
      connectedBy: "spencer",
      visibility: "private",
      authorizedByGitHub: { id: 1, login: "spencer" },
    },
    messages: [
      {
        id: "human-one",
        memberId: "spencer",
        name: "Spencer Zhao",
        initials: "SZ",
        body: "Use pnpm for this repository.",
        time: "now",
        role: "human",
      },
    ],
    workspace: { status: "running", liveReply: { id: scope.runId } },
    members: [memberDirectory.spencer, memberDirectory.maya],
  };
}

test("Claude shares discussion and memory tools without advertising Codex child controls", async () => {
  const context = fixture();
  context.workspace.runtime = "claude-code";
  let controlled = false;
  const client = new Client({ name: "claude-tools", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL("https://hive.test/agent-tools"),
      {
        fetch: (input, init) =>
          handleHiveMcp(
            new Request(input, init),
            scope,
            {
              read: async () => context,
              reply: async (_scope, messageId) => ({
                messageId,
                replyId: "hive-reply",
              }),
              control: async () => {
                controlled = true;
                throw new Error("Must not invoke Codex");
              },
            },
            createHiveMemory(undefined)
          ),
      }
    )
  );
  try {
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
      [
        "get_context",
        "get_presence",
        "read_thread",
        "remember_memory",
        "reply_to_thread",
        "search_memory",
      ]
    );
    const result = await client.callTool({
      name: "get_context",
      arguments: {},
    });
    assert.match(JSON.stringify(result), /claude-code/);
    const unavailable = await client.callTool({
      name: "get_presence",
      arguments: {},
    });
    assert.match(JSON.stringify(unavailable), /unavailable/);
    assert.equal(
      JSON.parse((unavailable.content as Array<{ text: string }>)[0].text)
        .onlineCount,
      null
    );
    const reply = await client.callTool({
      name: "reply_to_thread",
      arguments: {
        key: "clarify",
        messageId: "human-one",
        body: "Can you clarify?",
      },
    });
    assert.match(JSON.stringify(reply), /hive-reply/);
    assert.equal(controlled, false);
  } finally {
    await client.close();
  }
});

test("tools reject stale or finished runs, restores and revoked members", () => {
  const context = fixture();
  assert.doesNotThrow(() => assertHiveToolRun(context, scope));
  for (const changed of [
    { ...context, sessionId: "other-task" },
    { ...context, stage: "waiting" as const },
    { ...context, stage: "review" as const },
    { ...context, stage: "approved" as const },
    { ...context, members: [] },
    {
      ...context,
      workspace: { ...context.workspace, liveReply: { id: "another-run" } },
    },
    {
      ...context,
      workspace: {
        ...context.workspace,
        restore: {
          id: "restore",
          snapshotId: "checkpoint",
          by: memberDirectory.spencer,
          startedAt: 1,
          retryAfter: 2,
          status: "restoring" as const,
        },
      },
    },
  ])
    assert.throws(() => assertHiveToolRun(changed, scope));
});

test("context is bounded, attributed and does not equate membership with presence", () => {
  const context = fixture();
  context.messages[0].annotations = [
    hiveThreadReply("Can you clarify?", "reply-one"),
  ];
  assert.equal(
    describeHiveContext(context).discussion[0].replies[0].author,
    "Hive"
  );
  assert.match(describeHiveContext(context).presence, /do not infer/);
  assert.equal(
    memoryContribution(context, "human-one").source.authorId,
    "spencer"
  );
  assert.throws(() => memoryContribution(context, "human-one", "reply-one"));
  assert.throws(() => memoryContribution(context, "foreign"));
  assert.throws(() => memoryContribution(context, "human-one", "missing"));
  const full = {
    ...createInitialTaskSessionState(1),
    ...context,
    workspace: {
      ...createInitialTaskSessionState(1).workspace,
      ...context.workspace,
      liveReply: { id: scope.runId, body: "", sequence: 0, startedAt: 1 },
    },
  };
  assert.equal(
    reduceTaskSession(full, {
      type: "steer-message-annotation",
      actor: "spencer",
      messageId: "human-one",
      annotationId: "reply-one",
    }),
    full,
    "Hive cannot promote its own words into a human steer"
  );
});

test("real MCP client can read, remember, recall and reply without starting another run", async () => {
  let context = fixture();
  const providerBodies: unknown[] = [];
  let saved: { text: string; metadata: Record<string, unknown> } | undefined;
  const memory = createHiveMemory(
    "mem0-fixture-not-real",
    async (url, options) => {
      const body = JSON.parse(String(options?.body));
      providerBodies.push(body);
      if (String(url).endsWith("/add/")) {
        saved = { text: body.messages[0].content, metadata: body.metadata };
        return Response.json({ results: [{ id: "stored-one" }] });
      }
      return Response.json({
        results: saved
          ? [{ id: "stored-one", memory: saved.text, metadata: saved.metadata }]
          : [],
      });
    }
  );
  const replies: unknown[] = [];
  const client = new Client({ name: "fixture", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://hive.test/agent-tools"),
    {
      fetch: async (input, options) => {
        const request = new Request(input, options);
        if (request.method !== "POST")
          return new Response(null, { status: 405 });
        return handleHiveMcp(
          request,
          scope,
          {
            read: async () => context,
            reply: async (_scope, messageId, body, requestId) => {
              replies.push(hiveThreadReply(body, requestId));
              return { messageId, replyId: requestId };
            },
          },
          memory
        );
      },
    }
  );
  try {
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
      [
        "get_context",
        "get_presence",
        "read_thread",
        "remember_memory",
        "reply_to_thread",
        "search_memory",
      ]
    );
    const description = await client.callTool({
      name: "get_context",
      arguments: {},
    });
    assert.match(JSON.stringify(description), /Spencer Zhao/);
    assert.doesNotMatch(JSON.stringify(description), /mem0-fixture-not-real/);
    const invalid = await client.callTool({
      name: "remember_memory",
      arguments: {
        messageId: "human-one",
        user_id: "other-scope",
        text: "invented",
      },
    });
    assert.equal(invalid.isError, true);
    assert.equal(providerBodies.length, 0);
    const save = await client.callTool({
      name: "remember_memory",
      arguments: { messageId: "human-one" },
    });
    assert.equal(save.isError, undefined);
    assert.match(JSON.stringify(save), /saved/);
    const recalled = await client.callTool({
      name: "search_memory",
      arguments: { query: "package manager" },
    });
    assert.match(JSON.stringify(recalled), /Use pnpm/);
    assert.equal(providerBodies.length, 2);
    const version = context.version;
    await client.callTool({
      name: "reply_to_thread",
      arguments: {
        key: "ci-policy",
        messageId: "human-one",
        body: "Should this apply to CI too?",
      },
    });
    assert.equal(replies.length, 1);
    assert.equal(context.version, version);
    assert.equal(context.steeringQueue.length, 0);
    context = { ...context, members: [] };
    assert.equal(
      (
        await client.callTool({
          name: "search_memory",
          arguments: { query: "conventions" },
        })
      ).isError,
      true
    );
    assert.equal(providerBodies.length, 2);
  } finally {
    await client.close();
  }
});

for (const kind of [
  "message",
  "message-annotation",
  "message-thread",
] as const) {
  test(`pending ${kind} content is not readable or shareable as memory by the active agent`, async () => {
    const context = fixture();
    const messageId = kind === "message" ? "queued-message" : "human-one";
    const replyId = kind === "message" ? undefined : "queued-reply";
    if (kind === "message") {
      context.messages.push({
        ...context.messages[0],
        id: messageId,
        body: "FUTURE_REQUEST_ONLY",
      });
    } else {
      context.messages[0].annotations = [
        {
          id: "queued-reply",
          body: "FUTURE_REQUEST_ONLY",
          authorId: "spencer",
          createdAt: 2,
          status: kind === "message-annotation" ? "queued" : "open",
        },
      ];
      if (kind === "message-thread")
        context.messages[0].threadSteer = {
          id: "queue-one",
          throughReplyId: "queued-reply",
          replyCount: 1,
          requestedBy: "spencer",
          requestedAt: 2,
          status: "queued",
        };
    }
    context.steeringQueue.push({
      id: "queue-one",
      authorId: "spencer",
      body: "FUTURE_REQUEST_ONLY",
      queuedAt: 2,
      source:
        kind === "message"
          ? { kind, messageId }
          : kind === "message-thread"
            ? { kind, messageId, steerId: "queue-one" }
            : { kind, messageId, annotationId: "queued-reply" },
      sourceLabel: "Spencer's message",
    });
    const client = new Client({ name: "queue-boundary", version: "1" });
    const writes: unknown[] = [];
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("https://hive.test/agent-tools"),
        {
          fetch: (input, init) =>
            handleHiveMcp(
              new Request(input, init),
              scope,
              {
                read: async () => context,
                reply: async () => {
                  throw new Error("No reply requested");
                },
              },
              createHiveMemory("local-fixture", async (_url, options) => {
                writes.push(options?.body);
                return Response.json({ results: [{ id: "must-not-save" }] });
              })
            ),
        }
      )
    );
    try {
      const result = await client.callTool({
        name: "get_context",
        arguments: {},
      });
      assert.match(JSON.stringify(result), /queue-one/);
      assert.doesNotMatch(JSON.stringify(result), /FUTURE_REQUEST_ONLY/);
      const thread = await client.callTool({
        name: "read_thread",
        arguments: { messageId },
      });
      assert.doesNotMatch(JSON.stringify(thread), /FUTURE_REQUEST_ONLY/);
      assert.equal(
        (
          await client.callTool({
            name: "remember_memory",
            arguments: { messageId, ...(replyId ? { replyId } : {}) },
          })
        ).isError,
        true
      );
      assert.deepEqual(
        writes,
        [],
        "Unapplied requests must never leave this task as shared memory"
      );
    } finally {
      await client.close();
    }
  });
}

test("multiplayer tools observe only task members and read older discussion without granting execution", async () => {
  let context = fixture();
  const original = context.messages[0];
  original.annotations = Array.from({ length: 22 }, (_, i) => ({
    id: `reply-${i}`,
    authorId: "spencer",
    body: `Discussion ${i}`,
    createdAt: i + 1,
    status: "open" as const,
  }));
  original.annotations.push({
    id: "queued",
    authorId: "spencer",
    body: "Unapplied secret instruction",
    createdAt: 30,
    status: "queued",
  });
  context.messages.push(
    ...Array.from({ length: 15 }, (_, i) => ({
      ...original,
      id: `later-${i}`,
      annotations: [],
    }))
  );
  let observed = 0;
  const client = new Client({ name: "multiplayer-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL("https://hive.test/agent-tools"),
      {
        fetch: (input, init) =>
          handleHiveMcp(
            new Request(input, init),
            scope,
            {
              read: async () => context,
              reply: async () => {
                throw new Error("Read tools cannot post replies");
              },
              presence: async (sessionId) => {
                observed++;
                assert.equal(sessionId, scope.sessionId);
                return {
                  activeMembers: ["spencer", "spencer", "foreign"],
                  observedAt: 123,
                };
              },
            },
            createHiveMemory(undefined)
          ),
      }
    )
  );
  const read = async (name: string, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true);
    return JSON.parse((response.content as Array<{ text: string }>)[0].text);
  };
  try {
    const presence = await read("get_presence");
    assert.equal(presence.onlineCount, 1);
    assert.equal(presence.members[0].id, "spencer");
    assert.equal(presence.observedAt, 123);
    assert.doesNotMatch(JSON.stringify(presence), /foreign/);
    const first = await read("read_thread", { messageId: original.id });
    assert.equal(first.replies.length, 20);
    assert.equal(first.nextOffset, 20);
    const second = await read("read_thread", {
      messageId: original.id,
      offset: first.nextOffset,
    });
    assert.equal(second.replies.length, 2);
    assert.equal(second.nextOffset, null);
    assert.doesNotMatch(JSON.stringify([first, second]), /Unapplied secret/);
    assert.equal(
      (
        await client.callTool({
          name: "read_thread",
          arguments: { messageId: "foreign" },
        })
      ).isError,
      true
    );
    assert.equal(context.steeringQueue.length, 0);
    context = { ...context, members: [] };
    assert.equal(
      (await client.callTool({ name: "get_presence", arguments: {} })).isError,
      true
    );
    assert.equal(observed, 1, "revoked members cannot even observe presence");
  } finally {
    await client.close();
  }
});
