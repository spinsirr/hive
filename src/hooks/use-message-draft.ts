"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  acknowledgeMessageSubmission,
  beginMessageSubmission,
  editMessageDraft,
  emptyMessageDraft,
  failMessageSubmission,
  type MessageDraft,
  type MessageSubmission,
} from "@/lib/conversation/message-draft";
import { createMessageDraftStore } from "@/lib/conversation/message-draft-store";

const serverSnapshot = () => null;

export function useMessageDraft(
  storageKey: string,
  deliveredIds: ReadonlySet<string>,
  onSubmit: (submission: MessageSubmission) => Promise<boolean>
) {
  const store = useMemo(
    () => createMessageDraftStore(storageKey),
    [storageKey]
  );
  const draft = useSyncExternalStore<MessageDraft | null>(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot
  );

  useEffect(() => {
    const current = store.getSnapshot();
    const pending = current.submission;
    if (pending && deliveredIds.has(pending.clientId)) {
      store.commit(acknowledgeMessageSubmission(current, pending.clientId));
    }
  }, [store, deliveredIds]);

  const edit = useCallback(
    (body: string) => {
      store.commit(editMessageDraft(store.getSnapshot(), body));
    },
    [store]
  );
  const clear = useCallback(() => store.commit(emptyMessageDraft()), [store]);
  const submit = useCallback(async () => {
    const current = store.getSnapshot();
    const next = beginMessageSubmission(current, crypto.randomUUID());
    if (next === current || !next.submission) return;
    // Persist the identity before sending, so reload/retry cannot mint a new one.
    store.commit(next);
    const { clientId } = next.submission;
    try {
      const delivered = await onSubmit(next.submission);
      store.commit(
        delivered
          ? acknowledgeMessageSubmission(store.getSnapshot(), clientId)
          : failMessageSubmission(store.getSnapshot(), clientId)
      );
    } catch {
      store.commit(failMessageSubmission(store.getSnapshot(), clientId));
    }
  }, [store, onSubmit]);

  return { draft, edit, clear, submit };
}
