import assert from "node:assert/strict";
import test from "node:test";

import { hiveAgentFailureMessage } from "./hive-agent.ts";
import { displayHiveErrorMessage } from "./hive-error-copy.ts";

test("maps Codex SDK string-based 429 errors to a useful team message", () => {
  assert.equal(
    hiveAgentFailureMessage(
      new Error("exceeded retry limit, last status: 429 Too Many Requests"),
    ),
    "Rate limit reached. Try again shortly.",
  );
});

test("reduces legacy explanatory errors to quiet status copy", () => {
  assert.equal(
    displayHiveErrorMessage(
      "I saved the team’s input, but I couldn’t reach AI Gateway. The shared session is still live.",
    ),
    "Run failed. Try again.",
  );
});
