import assert from "node:assert/strict";
import test from "node:test";

import { shouldSubmitMessage } from "./message-keyboard.ts";

test("submits a regular Enter press", () => {
  assert.equal(
    shouldSubmitMessage({ key: "Enter", shiftKey: false }),
    true,
  );
});

test("keeps Shift+Enter as a newline", () => {
  assert.equal(
    shouldSubmitMessage({ key: "Enter", shiftKey: true }),
    false,
  );
});

test("does not submit Enter while an IME composition is active", () => {
  assert.equal(
    shouldSubmitMessage({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: true },
    }),
    false,
  );
});

test("does not submit Safari's legacy IME Enter event", () => {
  assert.equal(
    shouldSubmitMessage({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { keyCode: 229 },
    }),
    false,
  );
});
