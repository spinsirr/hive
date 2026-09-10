/** Only public assistant text belongs in the conversation, never tool output or reasoning. */
export async function consumeAgentText<TPart extends { type: string; text?: string; error?: unknown }>(
  stream: AsyncIterable<TPart>,
  onText: (body: string) => void,
  onPart?: (part: TPart) => void,
) {
  let body = "";
  let separator = false;
  for await (const part of stream) {
    onPart?.(part);
    if (part.type === "error") throw part.error ?? new Error("Agent stream failed.");
    if (part.type === "abort") throw new Error("Agent stream was interrupted.");
    if (part.type === "text-start") separator = body.length > 0;
    if (part.type !== "text-delta" || !part.text) continue;
    body += (separator ? "\n\n" : "") + part.text;
    separator = false;
    onText(body);
  }
  return body;
}

/**
 * Coalesce model deltas into ordered progress checkpoints, including the last
 * pending chunk. Checkpoints are best effort: a failed save is reported through
 * `onSaveError`, later deltas try again, and the turn itself is never
 * interrupted. The completed reply is persisted separately by the caller.
 */
export function createReplyWriter(
  save: (body: string, sequence: number) => Promise<void>,
  intervalMs = 250,
  onSaveError: (error: unknown) => void = () => undefined,
) {
  let latest = "";
  let saved = "";
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let closed = false;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending && latest !== saved) {
      const body = latest;
      const nextSequence = ++sequence;
      let failed = false;
      pending = Promise.resolve().then(() => save(body, nextSequence))
        .then(() => { saved = body; })
        .catch((error: unknown) => { failed = true; onSaveError(error); })
        .finally(() => {
          pending = undefined;
          // After a failure, wait for the next delta instead of retrying in a loop.
          if (!closed && !failed && latest !== saved) timer ??= setTimeout(() => void flush(), intervalMs);
        });
    }
    return pending;
  }

  return {
    push(body: string) {
      if (closed) throw new Error("Agent reply is already closed.");
      latest = body;
      timer ??= setTimeout(() => void flush(), intervalMs);
    },
    /** Attempts one final save of the latest text; reports whether it was stored. */
    async close() {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      if (pending) await pending;
      if (latest !== saved) await flush();
      return { delivered: latest === saved };
    },
  };
}
