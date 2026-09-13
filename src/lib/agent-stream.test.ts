import assert from "node:assert/strict";
import test from "node:test";

import { consumeAgentText, createReplyWriter } from "./agent-stream.ts";
import {
  appendHiveReply,
  applyHiveRunError,
  conversationMessages,
  createInitialTaskSessionState,
  reduceTaskSession,
} from "./task-session.ts";

test("only incremental public text reaches the chat, with distinct text blocks separated", async () => {
  const received: string[] = [];
  async function* stream() {
    yield { type: "reasoning-delta", text: "private reasoning fixture" };
    yield { type: "tool-result", text: "raw command output fixture" };
    yield { type: "text-start" };
    yield { type: "text-delta", text: "我来" };
    assert.deepEqual(
      received,
      ["我来"],
      "must deliver before generation has finished"
    );
    yield { type: "text-delta", text: "检查。" };
    yield { type: "text-end" };
    yield { type: "text-start" };
    yield { type: "text-delta", text: "**检查通过**" };
  }
  assert.equal(
    await consumeAgentText(stream(), (text) => received.push(text)),
    "我来检查。\n\n**检查通过**"
  );
  assert.deepEqual(received, [
    "我来",
    "我来检查。",
    "我来检查。\n\n**检查通过**",
  ]);
});

test("provider error and abort events cannot be mistaken for a successful short reply", async () => {
  for (const part of [
    { type: "error", error: new Error("provider stopped") },
    { type: "abort" },
  ]) {
    const received: string[] = [];
    async function* stream() {
      yield { type: "text-delta", text: "Partial reply" };
      yield part;
    }
    await assert.rejects(
      consumeAgentText(stream(), (text) => received.push(text))
    );
    assert.deepEqual(received, ["Partial reply"]);
  }
});

test("checkpoints coalesce tokens and flush the final pending text exactly once", async () => {
  const saved: [string, number][] = [];
  const writer = createReplyWriter(async (body, sequence) => {
    saved.push([body, sequence]);
  });
  writer.push("H");
  writer.push("He");
  writer.push("Hello");
  assert.deepEqual(saved, []);
  await writer.close();
  await writer.close();
  assert.deepEqual(saved, [["Hello", 1]]);
  assert.throws(() => writer.push("too late"));
});

test("checkpoints are sent during generation, not only at completion", async () => {
  let first!: () => void;
  const checkpoint = new Promise<void>((resolve) => {
    first = resolve;
  });
  const saved: string[] = [];
  const writer = createReplyWriter(async (body) => {
    saved.push(body);
    first();
  }, 1);
  writer.push("first");
  await checkpoint;
  assert.deepEqual(saved, ["first"]);
  writer.push("first and last");
  await writer.close();
  assert.deepEqual(saved, ["first", "first and last"]);
});

test("a failed progress checkpoint is reported, never interrupts the turn, and later text still saves", async () => {
  const errors: unknown[] = [];
  const saved: string[] = [];
  let failing = true;
  const writer = createReplyWriter(
    async (body) => {
      if (failing) throw new Error("database unavailable");
      saved.push(body);
    },
    1,
    (error) => errors.push(error)
  );
  writer.push("Hello");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(errors.length, 1);
  assert.deepEqual(saved, []);
  assert.doesNotThrow(
    () => writer.push("Hello team"),
    "one failed save must not poison later deltas"
  );
  failing = false;
  assert.deepEqual(await writer.close(), { delivered: true });
  assert.deepEqual(saved, ["Hello team"]);
});

test("a persistently failing checkpoint store still lets the turn finish and reports non-delivery", async () => {
  const errors: unknown[] = [];
  const writer = createReplyWriter(
    async () => {
      throw new Error("database unavailable");
    },
    1,
    (error) => errors.push(error)
  );
  writer.push("Hello");
  assert.deepEqual(await writer.close(), { delivered: false });
  assert.ok(errors.length >= 1);
});

test("a slow database coalesces pending text instead of building an unbounded write queue", async () => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstSave = new Promise<void>((resolve) => {
    started = resolve;
  });
  const saved: [string, number][] = [];
  const writer = createReplyWriter(async (body, sequence) => {
    saved.push([body, sequence]);
    if (sequence === 1) {
      started();
      await blocked;
    }
  }, 1);
  writer.push("first");
  await firstSave;
  for (let i = 0; i < 100; i++) writer.push(`latest ${i}`);
  const finished = writer.close();
  release();
  await finished;
  assert.deepEqual(saved, [
    ["first", 1],
    ["latest 99", 2],
  ]);
});

function streamingSession() {
  const state = reduceTaskSession(
    createInitialTaskSessionState(1, "streaming-task"),
    {
      type: "send-message",
      actor: "spencer",
      body: "Clarify the task",
    },
    2
  );
  state.workspace.liveReply = {
    id: "agent-reply",
    body: "Partial reply",
    sequence: 2,
    startedAt: 2,
  };
  return state;
}

test("refresh restores a streaming reply and completion keeps the same message identity", () => {
  const state = streamingSession();
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(conversationMessages(restored).at(-1)?.status, "streaming");
  assert.equal(conversationMessages(restored).at(-1)?.id, "agent-reply");
  const finished = appendHiveReply(restored, "Final step summary", 3);
  assert.equal(finished.messages.at(-1)?.id, "agent-reply");
  assert.equal(
    finished.messages.at(-1)?.body,
    "Final step summary",
    "the completed text wins over a possibly lagging checkpoint"
  );
  assert.equal(
    finished.messages.at(-1)?.createdAt,
    2,
    "the reply keeps the time it started streaming"
  );
  assert.equal(finished.workspace.liveReply, undefined);
  assert.equal(finished.messages.at(-1)?.status, undefined);
  assert.equal(
    conversationMessages(finished).filter(
      (message) => message.id === "agent-reply"
    ).length,
    1
  );
});

test("failure preserves already-visible text and ends the typing state", () => {
  const failed = applyHiveRunError(streamingSession(), "Try again shortly.", 4);
  assert.equal(failed.messages.at(-2)?.body, "Partial reply");
  assert.equal(failed.messages.at(-2)?.id, "agent-reply");
  assert.equal(failed.messages.at(-1)?.status, "error");
  assert.equal(failed.workspace.liveReply, undefined);
  assert.ok(
    conversationMessages(failed).every(
      (message) => message.status !== "streaming"
    )
  );
});
