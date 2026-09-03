import assert from "node:assert/strict";
import test from "node:test";

import { isRoomId } from "./room-id.ts";

test("room IDs are short URL-safe slugs", () => {
  assert.equal(isRoomId("orbit-nav"), true);
  assert.equal(isRoomId("room-2"), true);
  assert.equal(isRoomId("../private"), false);
  assert.equal(isRoomId("-room"), false);
  assert.equal(isRoomId("room-"), false);
  assert.equal(isRoomId("a".repeat(49)), false);
});
