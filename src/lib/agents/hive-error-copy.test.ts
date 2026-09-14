import assert from "node:assert/strict";
import test from "node:test";

import { displayHiveErrorMessage, hiveErrorCopy } from "./hive-error-copy.ts";
import { STALLED_RUN_ERROR } from "../session/task-session.ts";

test("a run marked lost is explained as lost, not as a generic retryable failure", () => {
  assert.equal(
    displayHiveErrorMessage(
      `${STALLED_RUN_ERROR} Ada marked the run as lost; partial output and queued steers were kept, and nothing was rerun.`
    ),
    hiveErrorCopy.lost
  );
  assert.equal(
    displayHiveErrorMessage("Rate limit reached. Try again shortly."),
    hiveErrorCopy.rateLimit
  );
  assert.equal(
    displayHiveErrorMessage("something else"),
    hiveErrorCopy.generic
  );
});
