import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialTaskSessionState,
  memberDirectory,
  reduceTaskSession,
} from "../session/task-session.ts";

const members = Object.values(memberDirectory);
const actor = members[0].id;

test("a new unnamed task takes its title from its first accepted message only", () => {
  const initial = createInitialTaskSessionState(1, "stable-task", {
    title: "",
    createdBy: actor,
  });
  assert.equal(initial.title, "");
  assert.equal(
    reduceTaskSession(
      initial,
      {
        type: "send-message",
        clientId: crypto.randomUUID(),
        actor,
        body: "   ",
      },
      2,
      members
    ),
    initial
  );
  const first = reduceTaskSession(
    initial,
    {
      type: "send-message",
      actor,
      body: "  Fix   keyboard\n focus in Settings  ",
      clientId: "first",
    },
    3,
    members
  );
  assert.equal(first.title, "Fix keyboard focus in Settings");
  assert.equal(first.sessionId, "stable-task");
  assert.equal(
    first.version,
    initial.version + 1,
    "naming is part of the same message update"
  );
  const second = reduceTaskSession(
    first,
    { type: "send-message", actor, body: "Then add tests", clientId: "second" },
    4,
    members
  );
  assert.equal(second.title, first.title);
});

test("automatic task labels stay short without splitting Chinese or emoji", () => {
  const initial = createInitialTaskSessionState(1, "stable-task", {
    title: "",
  });
  const next = reduceTaskSession(
    initial,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor,
      body: "修复👩🏽‍💻".repeat(40),
    },
    2,
    members
  );
  assert.ok(next.title.endsWith("…"));
  assert.ok(next.title.length <= 120);
  assert.ok(Array.from(new Intl.Segmenter().segment(next.title)).length <= 72);
  assert.ok(!next.title.includes("\uFFFD"));
});

test("a member can rename without running the agent or changing the conversation", () => {
  const initial = createInitialTaskSessionState(1, "stable-task", {
    title: "",
  });
  const renamed = reduceTaskSession(
    initial,
    { type: "rename-task", actor, title: "  Untitled task  " },
    2,
    members
  );
  assert.equal(renamed.title, "Untitled task");
  assert.equal(renamed.version, initial.version + 1);
  assert.equal(
    reduceTaskSession(
      renamed,
      { type: "rename-task", actor, title: "Settings polish" },
      3,
      members
    ).title,
    "Settings polish"
  );
  assert.equal(renamed.sessionId, initial.sessionId);
  assert.equal(renamed.stage, initial.stage);
  assert.equal(renamed.workspace, initial.workspace);
  assert.equal(renamed.messages, initial.messages);
  assert.equal(renamed.steeringQueue, initial.steeringQueue);
  const first = reduceTaskSession(
    renamed,
    {
      type: "send-message",
      clientId: crypto.randomUUID(),
      actor,
      body: "Do not replace my chosen name",
    },
    3,
    members
  );
  assert.equal(
    first.title,
    "Untitled task",
    "even a manually chosen placeholder-like name is authoritative"
  );
  for (const title of ["", " ", "a".repeat(121)]) {
    assert.equal(
      reduceTaskSession(
        renamed,
        { type: "rename-task", actor, title },
        4,
        members
      ),
      renamed
    );
  }
  assert.equal(
    reduceTaskSession(
      renamed,
      { type: "rename-task", actor: "stranger", title: "No access" },
      4,
      members
    ),
    renamed
  );
  const archived = reduceTaskSession(
    renamed,
    { type: "archive-task", actor },
    5,
    members
  );
  assert.equal(
    reduceTaskSession(
      archived,
      { type: "rename-task", actor, title: "Read only" },
      6,
      members
    ),
    archived
  );
});
