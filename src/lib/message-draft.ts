export type MessageSubmission = { clientId: string; body: string };
export type MessageDraft = {
  body: string;
  status: "editing" | "sending" | "unconfirmed";
  submission?: MessageSubmission;
};

export function isClientSubmissionId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function emptyMessageDraft(): MessageDraft {
  return { body: "", status: "editing" };
}

export function editMessageDraft(draft: MessageDraft, body: string): MessageDraft {
  if (draft.status === "sending") return draft;
  if (draft.submission?.body === body.trim()) return { ...draft, body };
  return { body, status: "editing" };
}

export function beginMessageSubmission(draft: MessageDraft, clientId: string): MessageDraft {
  const body = draft.body.trim();
  if (!body || draft.status === "sending") return draft;
  return {
    ...draft,
    status: "sending",
    submission: draft.submission?.body === body ? draft.submission : { clientId, body },
  };
}

export function acknowledgeMessageSubmission(draft: MessageDraft, clientId: string): MessageDraft {
  if (draft.submission?.clientId !== clientId) return draft;
  return emptyMessageDraft();
}

export function failMessageSubmission(draft: MessageDraft, clientId: string): MessageDraft {
  if (draft.submission?.clientId !== clientId) return draft;
  return { ...draft, status: "unconfirmed" };
}

export function restoreMessageDraft(value: string | null): MessageDraft {
  try {
    const saved = JSON.parse(value ?? "null");
    if (saved?.version !== 1 || typeof saved.body !== "string") return emptyMessageDraft();
    const submission = saved.submission;
    return {
      body: saved.body,
      ...(isClientSubmissionId(submission?.clientId) &&
        typeof submission.body === "string" && submission.body === saved.body.trim()
        ? { submission, status: "unconfirmed" }
        : { status: "editing" }),
    };
  } catch {
    return emptyMessageDraft();
  }
}
