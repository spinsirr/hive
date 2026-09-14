import assert from "node:assert/strict";
import test from "node:test";
import { createMessageDraftStore } from "./message-draft-store.ts";
import {
  beginMessageSubmission,
  editMessageDraft,
  emptyMessageDraft,
} from "./message-draft.ts";

const ID = "e7535baf-8d42-4e42-94a6-ce940a72da5f";
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("draft stores persist identity synchronously and isolate members and tasks", () => {
  const storage = memoryStorage();
  const key = "hive-draft:v1:task-a:github-101:message";
  const first = createMessageDraftStore(key, () => storage);
  const pending = beginMessageSubmission(
    editMessageDraft(first.getSnapshot(), "Keep after refresh"),
    ID
  );
  first.commit(pending);
  const reloaded = createMessageDraftStore(key, () => storage).getSnapshot();
  assert.equal(reloaded.body, pending.body);
  assert.equal(reloaded.submission?.clientId, ID);
  assert.equal(reloaded.status, "unconfirmed");
  for (const anotherKey of [
    "hive-draft:v1:task-b:github-101:message",
    "hive-draft:v1:task-a:github-202:message",
  ]) {
    assert.deepEqual(
      createMessageDraftStore(anotherKey, () => storage).getSnapshot(),
      emptyMessageDraft()
    );
  }
  first.commit(emptyMessageDraft());
  assert.equal(storage.getItem(key), null);
});

test("draft snapshots are cached and listeners unsubscribe cleanly", () => {
  const store = createMessageDraftStore("draft", memoryStorage);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  let changes = 0;
  const unsubscribe = store.subscribe(() => {
    changes += 1;
  });
  const edited = editMessageDraft(store.getSnapshot(), "Changed");
  store.commit(edited);
  store.commit(edited);
  assert.equal(changes, 1);
  unsubscribe();
  store.commit(emptyMessageDraft());
  assert.equal(changes, 1);
});

test("unavailable browser storage does not lose the in-memory draft", () => {
  const store = createMessageDraftStore("draft", () => {
    throw new Error("Storage disabled");
  });
  store.commit(editMessageDraft(store.getSnapshot(), "Keep in memory"));
  assert.equal(store.getSnapshot().body, "Keep in memory");
});
