import assert from "node:assert/strict";
import test from "node:test";

import { buildHivePrompt } from "./hive-prompt.ts";
import { createInitialTaskSessionState, reduceTaskSession } from "./task-session.ts";

test("Codex receives attributed team context and an attributed active task", () => {
  const session = reduceTaskSession(
    reduceTaskSession(
      createInitialTaskSessionState(1),
      { type: "send-message", actor: "spencer", body: "Prefer the compact menu" },
      2,
    ),
    { type: "send-message", actor: "maya", body: "Keep keyboard navigation" },
    3,
  );

  const prompt = buildHivePrompt(session, "maya", "Do not remove focus styles");

  assert.match(prompt, /\[Spencer Zhao\]: Prefer the compact menu/);
  assert.match(prompt, /\[Maya Chen\]: Keep keyboard navigation/);
  assert.match(prompt, /Current teammate: Maya Chen/);
  assert.match(prompt, /Task to execute now:\n\n\[Maya Chen\]: Do not remove focus styles/);
});

test("pre-repository conversation frames intent as discussion, not execution", () => {
  const session = reduceTaskSession(
    createInitialTaskSessionState(1),
    {
      type: "send-message",
      actor: "spencer",
      body: "Help us define the acceptance criteria",
    },
    2,
  );

  const prompt = buildHivePrompt(
    session,
    "spencer",
    undefined,
    undefined,
    "planning",
  );

  assert.match(prompt, /Latest request to discuss:/);
  assert.doesNotMatch(prompt, /Task to execute now:/);
});
