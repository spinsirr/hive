import assert from "node:assert/strict";
import test from "node:test";

import { formatMessageTime } from "./message-time.ts";

const at = Date.UTC(2026, 8, 9, 18, 52); // 18:52 UTC

test("messages with a timestamp render in the viewer's zone, not the server's", () => {
  assert.equal(formatMessageTime({ time: "6:52 PM", createdAt: at }, { locale: "en-US", timeZone: "UTC" }), "6:52 PM");
  assert.equal(formatMessageTime({ time: "6:52 PM", createdAt: at }, { locale: "en-US", timeZone: "America/Los_Angeles" }), "11:52 AM");
  assert.equal(formatMessageTime({ time: "6:52 PM", createdAt: at }, { locale: "en-US", timeZone: "America/New_York" }), "2:52 PM");
});

test("messages saved before timestamps existed keep their stored label unchanged", () => {
  assert.equal(formatMessageTime({ time: "6:52 PM" }, { locale: "en-US", timeZone: "America/Los_Angeles" }), "6:52 PM");
  assert.equal(formatMessageTime({ time: "6:52 PM", createdAt: Number.NaN }, { locale: "en-US" }), "6:52 PM");
});
