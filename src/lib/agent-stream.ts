/** Only public assistant text belongs in the conversation, never tool output or reasoning. */
export async function consumeAgentText(
  stream: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
  onText: (body: string) => void,
) {
  let body = "";
  let separator = false;
  for await (const part of stream) {
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

/** Coalesce model deltas into ordered checkpoints, including the last pending chunk. */
export function createReplyWriter(
  save: (body: string, sequence: number) => Promise<void>,
  intervalMs = 250,
) {
  let latest = "";
  let saved = "";
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let failure: unknown;
  let closed = false;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending && latest !== saved && !failure) {
      const body = latest;
      const nextSequence = ++sequence;
      pending = Promise.resolve().then(() => save(body, nextSequence))
        .then(() => { saved = body; })
        .catch((error: unknown) => { failure = error; })
        .finally(() => {
          pending = undefined;
          if (!closed && !failure && latest !== saved) timer ??= setTimeout(() => void flush(), intervalMs);
        });
    }
    return pending;
  }

  return {
    push(body: string) {
      if (failure) throw failure;
      if (closed) throw new Error("Agent reply is already closed.");
      latest = body;
      timer ??= setTimeout(() => void flush(), intervalMs);
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      while ((pending || latest !== saved) && !failure) await flush();
      if (failure) throw failure;
    },
  };
}
