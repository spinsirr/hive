import assert from "node:assert/strict";
import test from "node:test";
import {
  checkedMemoryText,
  createHiveMemory,
  repositoryMemoryId,
} from "./hive-memory.ts";

const scope = { installationId: 10, repositoryId: 20 };
const source = {
  sessionId: "task-one",
  messageId: "message-one",
  authorId: "github-1",
  authorName: "Alex",
};

test("memory scope follows the GitHub installation and repository, not a task or actor", () => {
  assert.equal(repositoryMemoryId(scope), repositoryMemoryId({ ...scope }));
  assert.notEqual(
    repositoryMemoryId(scope),
    repositoryMemoryId({ ...scope, installationId: 11 })
  );
  assert.notEqual(
    repositoryMemoryId(scope),
    repositoryMemoryId({ ...scope, repositoryId: 21 })
  );
  assert.throws(() => repositoryMemoryId({ ...scope, repositoryId: 0 }));
});

test("Mem0 search is bounded and filters out results without the server-owned scope", async () => {
  const calls: unknown[] = [];
  const memory = createHiveMemory("test-key-not-real", async (url, options) => {
    assert.equal(url, "https://api.mem0.ai/v3/memories/search/");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    calls.push(JSON.parse(String(options?.body)));
    return Response.json({
      results: [
        {
          id: "ours",
          memory: "Use pnpm.",
          metadata: {
            hive_scope: repositoryMemoryId(scope),
            source_session_id: "older-task",
          },
        },
        {
          id: "foreign",
          memory: "PRIVATE",
          metadata: { hive_scope: "other-scope" },
        },
        { id: "missing", memory: "UNSCOPED" },
      ],
    });
  });
  assert.deepEqual(await memory.search(scope, "package manager"), [
    {
      id: "ours",
      text: "Use pnpm.",
      source: {
        sessionId: "older-task",
        messageId: undefined,
        replyId: undefined,
        authorName: undefined,
      },
    },
  ]);
  assert.deepEqual(calls, [
    {
      query: "package manager",
      filters: {
        AND: [{ user_id: repositoryMemoryId(scope) }, { app_id: "hive" }],
      },
      top_k: 3,
      rerank: false,
    },
  ]);
});

test("Mem0 stores a short selected statement verbatim with attribution and no extraction LLM", async () => {
  let sent;
  const memory = createHiveMemory("test-key-not-real", async (url, options) => {
    assert.equal(url, "https://api.mem0.ai/v3/memories/add/");
    sent = JSON.parse(String(options?.body));
    return Response.json({ results: [{ id: "memory-one" }] });
  });
  assert.equal(
    (await memory.remember(scope, "  Prefer pnpm.  ", source)).status,
    "saved"
  );
  assert.deepEqual(sent, {
    user_id: repositoryMemoryId(scope),
    app_id: "hive",
    infer: false,
    messages: [{ role: "user", content: "Prefer pnpm." }],
    metadata: {
      hive_scope: repositoryMemoryId(scope),
      source_session_id: "task-one",
      source_message_id: "message-one",
      source_reply_id: null,
      author_id: "github-1",
      author_name: "Alex",
    },
  });
});

test("missing credentials make no request; failures are sanitized and never retried", async () => {
  let calls = 0;
  const unavailable = async () => {
    calls++;
    throw new Error("request contains secret");
  };
  const disabled = createHiveMemory(undefined, unavailable);
  assert.equal(disabled.enabled, false);
  await assert.rejects(disabled.search(scope, "conventions"), /not connected/);
  assert.equal(calls, 0);
  await assert.rejects(
    createHiveMemory("fixture", unavailable).remember(
      scope,
      "Use pnpm",
      source
    ),
    /may have been saved/
  );
  assert.equal(calls, 1);
  await assert.rejects(
    createHiveMemory("fixture", async () => {
      calls++;
      return new Response("sensitive upstream body", { status: 429 });
    }).search(scope, "conventions"),
    /429.*No automatic retry/
  );
  assert.equal(calls, 2);
});

test("pending, failed, and malformed writes are never reported as saved", async () => {
  const pending = createHiveMemory("fixture", async () =>
    Response.json({ status: "PENDING", event_id: "event-one" })
  );
  assert.deepEqual(await pending.remember(scope, "Use pnpm", source), {
    status: "pending",
    eventId: "event-one",
  });
  const pendingWithResults = createHiveMemory("fixture", async () =>
    Response.json({ status: "PENDING", results: [{ id: "not-yet-saved" }] })
  );
  await assert.rejects(
    pendingWithResults.remember(scope, "Use pnpm", source),
    /not confirmed/
  );
  for (const result of [{}, { results: [] }, { status: "FAILED" }]) {
    await assert.rejects(
      createHiveMemory("fixture", async () => Response.json(result)).remember(
        scope,
        "Use pnpm",
        source
      ),
      /did not confirm/
    );
  }
});

test("obvious code, credentials, and oversized statements are not memory input", () => {
  for (const value of [
    "",
    "x".repeat(1001),
    "```js\nconst x = 1;\n```",
    "postgresql://user:pass@db/test",
    "api_key=example",
    "-----BEGIN PRIVATE KEY-----",
    "Bearer abcdef123456",
  ]) {
    assert.throws(() => checkedMemoryText(value));
  }
  assert.equal(
    checkedMemoryText("Keep focus styles accessible."),
    "Keep focus styles accessible."
  );
});
