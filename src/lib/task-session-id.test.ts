import assert from "node:assert/strict";
import test from "node:test";

import { isTaskSessionId } from "./task-session-id.ts";

test("session IDs are short URL-safe slugs", () => {
  assert.equal(isTaskSessionId("orbit-nav"), true);
  assert.equal(isTaskSessionId("session-2"), true);
  assert.equal(isTaskSessionId("../private"), false);
  assert.equal(isTaskSessionId("-session"), false);
  assert.equal(isTaskSessionId("session-"), false);
  assert.equal(isTaskSessionId("a".repeat(49)), false);
});
