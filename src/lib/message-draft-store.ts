import { emptyMessageDraft, restoreMessageDraft, type MessageDraft } from "./message-draft.ts";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createMessageDraftStore(
  storageKey: string,
  getStorage: () => DraftStorage = () => sessionStorage,
) {
  let current: MessageDraft | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot() {
      if (current === null) {
        try { current = restoreMessageDraft(getStorage().getItem(storageKey)); }
        catch { current = emptyMessageDraft(); }
      }
      return current;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    commit(next: MessageDraft) {
      if (next === current) return;
      current = next;
      try {
        if (next.body || next.submission) {
          getStorage().setItem(storageKey, JSON.stringify({ version: 1, ...next }));
        } else {
          getStorage().removeItem(storageKey);
        }
      } catch {
        // Disabled/full storage must not discard the in-memory draft.
      }
      listeners.forEach((listener) => listener());
    },
  };
}
