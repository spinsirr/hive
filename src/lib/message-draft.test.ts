import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeMessageSubmission,
  beginMessageSubmission,
  editMessageDraft,
  emptyMessageDraft,
  failMessageSubmission,
  isClientSubmissionId,
  restoreMessageDraft,
} from "./message-draft.ts";

const FIRST = "e7535baf-8d42-4e42-94a6-ce940a72da5f";
const SECOND = "37ac24d8-2299-490a-93c9-2a66dc963e0e";

test("a submission keeps its Chinese draft until delivery is acknowledged", () => {
  const draft = editMessageDraft(emptyMessageDraft(), "  保留中文输入  ");
  const sending = beginMessageSubmission(draft, FIRST);
  assert.equal(sending.body, draft.body);
  assert.equal(sending.submission?.body, "保留中文输入");
  const failed = failMessageSubmission(sending, FIRST);
  assert.equal(failed.body, draft.body);
  assert.equal(failed.status, "unconfirmed");
  assert.deepEqual(acknowledgeMessageSubmission(failed, FIRST), emptyMessageDraft());
});

test("a retry reuses the original submission identity even if a new ID was generated", () => {
  const first = beginMessageSubmission(editMessageDraft(emptyMessageDraft(), "Keep this"), FIRST);
  const retry = beginMessageSubmission(failMessageSubmission(first, FIRST), SECOND);
  assert.equal(retry.submission?.clientId, FIRST);
  assert.equal(retry.body, first.body);
});

test("double submission and edits during acknowledgement wait are ignored", () => {
  const sending = beginMessageSubmission(editMessageDraft(emptyMessageDraft(), "One request"), FIRST);
  assert.equal(beginMessageSubmission(sending, SECOND), sending);
  assert.equal(editMessageDraft(sending, "Another request"), sending);
});

test("refresh restores an uncertain submission without resending or changing its ID", () => {
  const sending = beginMessageSubmission(editMessageDraft(emptyMessageDraft(), "Refresh me"), FIRST);
  const restored = restoreMessageDraft(JSON.stringify({ version: 1, ...sending }));
  assert.equal(restored.status, "unconfirmed");
  assert.equal(restored.body, sending.body);
  assert.deepEqual(restored.submission, sending.submission);
  assert.equal(beginMessageSubmission(restored, SECOND).submission?.clientId, FIRST);
});

test("an old response cannot clear a newer draft after polling has confirmed delivery", () => {
  const first = beginMessageSubmission(editMessageDraft(emptyMessageDraft(), "First"), FIRST);
  const confirmed = acknowledgeMessageSubmission(first, FIRST);
  const second = beginMessageSubmission(editMessageDraft(confirmed, "Second"), SECOND);
  assert.equal(acknowledgeMessageSubmission(second, FIRST), second);
  assert.equal(failMessageSubmission(second, FIRST), second);
});

test("editing an unconfirmed message creates a new intent instead of reusing its identity", () => {
  const first = beginMessageSubmission(editMessageDraft(emptyMessageDraft(), "First"), FIRST);
  const edited = editMessageDraft(failMessageSubmission(first, FIRST), "Different intent");
  assert.equal(edited.submission, undefined);
  assert.equal(beginMessageSubmission(edited, SECOND).submission?.clientId, SECOND);
  assert.equal(acknowledgeMessageSubmission(edited, FIRST), edited);
});

test("malformed stored drafts do not restore submission identities", () => {
  for (const value of [null, "broken", "null", "{}", '{"version":2,"body":"old"}']) {
    assert.deepEqual(restoreMessageDraft(value), emptyMessageDraft());
  }
  for (const submission of [null, { clientId: "bad", body: "Keep" }, { clientId: FIRST, body: "Different" }]) {
    const restored = restoreMessageDraft(JSON.stringify({ version: 1, body: "Keep", submission }));
    assert.equal(restored.body, "Keep");
    assert.equal(restored.status, "editing");
    assert.equal(restored.submission, undefined);
  }
});

test("submission IDs are bounded UUIDs and empty drafts cannot submit", () => {
  assert.equal(isClientSubmissionId(FIRST), true);
  for (const id of [null, 123, "", "abc", FIRST + "x", "a".repeat(1000)]) {
    assert.equal(isClientSubmissionId(id), false);
  }
  const empty = emptyMessageDraft();
  assert.equal(beginMessageSubmission(empty, FIRST), empty);
});
