import assert from "node:assert/strict";
import test from "node:test";

import { hiveAgentFailureMessage } from "./hive-agent.ts";

test("maps Codex SDK string-based 429 errors to a useful team message", () => {
  assert.equal(
    hiveAgentFailureMessage(
      new Error("exceeded retry limit, last status: 429 Too Many Requests"),
    ),
    "I saved the team’s input, but AI Gateway is rate-limited right now. Try again in a moment.",
  );
});
