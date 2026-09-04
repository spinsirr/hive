import assert from "node:assert/strict";
import test from "node:test";

import { hiveAgentFailureMessage } from "./hive-agent.ts";
import { displayHiveErrorMessage } from "./hive-error-copy.ts";

test("maps raw Codex bridge errors and wrapped errors to the same rate-limit message", () => {
  const bridgeError = "exceeded retry limit, last status: 429 Too Many Requests";
  for (const error of [
    bridgeError,
    new Error(bridgeError),
    new Error("Codex turn failed", { cause: bridgeError }),
  ]) {
    assert.equal(
      hiveAgentFailureMessage(error),
      "Rate limit reached. Try again shortly.",
    );
  }
});

test("reduces legacy explanatory errors to quiet status copy", () => {
  assert.equal(
    displayHiveErrorMessage(
      "I saved the team’s input, but I couldn’t reach AI Gateway. The shared session is still live.",
    ),
    "Run failed. Try again.",
  );
});
