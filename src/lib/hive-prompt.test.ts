import assert from "node:assert/strict";
import test from "node:test";

import { buildCodexPrompt } from "./hive-prompt.ts";
import { createInitialRoomState, reduceRoom } from "./room.ts";

test("Codex receives attributed team context and an attributed active task", () => {
  const room = reduceRoom(
    reduceRoom(
      createInitialRoomState(1),
      { type: "send-message", actor: "spencer", body: "Prefer the compact menu" },
      2,
    ),
    { type: "send-message", actor: "maya", body: "Keep keyboard navigation" },
    3,
  );

  const prompt = buildCodexPrompt(room, "maya", "Do not remove focus styles");

  assert.match(prompt, /\[Spencer Zhao\]: Prefer the compact menu/);
  assert.match(prompt, /\[Maya Chen\]: Keep keyboard navigation/);
  assert.match(prompt, /Current teammate: Maya Chen/);
  assert.match(prompt, /Task to execute now:\n\n\[Maya Chen\]: Do not remove focus styles/);
});
