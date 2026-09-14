import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { SubscriptionUnavailable, subscriptionLimited } from "./auth.mjs";

/**
 * @typedef {{kind: 'response', message: {id: string | number, result?: object, error?: {message: string}}}
 * | {kind: 'request' | 'notification', message: {id?: string | number, method: string, params?: object}}} NativeMessage
 */
/** @returns {NativeMessage} */
function parseMessage(line) {
  const message = JSON.parse(line);
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw new Error("Invalid Codex protocol message.");
  if (typeof message.method === "string")
    return { kind: message.id == null ? "notification" : "request", message };
  if (typeof message.id === "string" || typeof message.id === "number")
    return { kind: "response", message };
  throw new Error("Invalid Codex protocol message.");
}

/** Parse each line once. RPC and child events remain live while main-turn events drain. */
export function connectAppServer(child, { onNotification, onRequest }) {
  const lines = createInterface({ input: child.stdout });
  const notifications = new PassThrough({ objectMode: true });
  const pending = new Map();
  let sequence = 0,
    closed = false,
    processError,
    stderr = "";
  // The handshake can fail before an iterator attaches; retain the failure for the driver.
  notifications.on("error", () => {});
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  const fail = (error) => {
    processError ??= error;
    rejectPending(error);
    notifications.destroy(error);
  };
  const exited = new Promise((resolve) =>
    child.once("close", (code, signal) => {
      closed = true;
      rejectPending(new Error("Codex has stopped."));
      notifications.end();
      resolve({ code, signal });
    })
  );
  child.once("error", fail);
  child.stdin.on("error", fail);
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const send = (message) => {
    if (!closed && !child.stdin.destroyed)
      child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  lines.on("line", (line) => {
    try {
      const event = parseMessage(line);
      const message = event.message;
      switch (event.kind) {
        case "response": {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error)
            request.reject(
              new Error(message.error.message || "Codex request failed.")
            );
          else request.resolve(message.result);
          break;
        }
        case "request":
          onRequest(message, send);
          break;
        case "notification":
          onNotification(message);
          if (!notifications.destroyed) notifications.write(message);
          break;
      }
    } catch (error) {
      fail(error);
    }
  });
  const kill = () => {
    if (closed) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  return {
    notifications,
    send,
    kill,
    get error() {
      return processError;
    },
    get stderr() {
      return stderr;
    },
    request(method, params, timeoutMs = 12_000) {
      return new Promise((resolve, reject) => {
        if (closed || processError) {
          reject(processError ?? new Error("Codex is no longer running."));
          return;
        }
        const id = `hive:${++sequence}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex ${method} request timed out.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        send({ id, method, params });
      });
    },
    async shutdown() {
      // EOF flushes native history before a VM snapshot can be trusted.
      child.stdin.end();
      const timer = setTimeout(kill, 4000);
      try {
        return await exited;
      } finally {
        clearTimeout(timer);
        lines.close();
        notifications.destroy();
        rejectPending(new Error("Codex has stopped."));
      }
    },
  };
}

/** Ordered handshake with named RPCs; authentication errors never trigger paid fallback. */
export async function prepareNativeThread(
  connection,
  { start, settings, resumedThreadId, subscription, tokens, turn }
) {
  await connection.request("initialize", {
    clientInfo: { name: "hive", title: "Hive", version: "0.1.0" },
    ...(subscription ? { capabilities: { experimentalApi: true } } : {}),
  });
  connection.send({ method: "initialized", params: {} });
  if (subscription) {
    let login;
    try {
      login = await connection.request("account/login/start", {
        type: "chatgptAuthTokens",
        ...tokens,
      });
    } catch {
      throw new SubscriptionUnavailable("authentication_unavailable");
    }
    if (login?.type !== "chatgptAuthTokens")
      throw new SubscriptionUnavailable("authentication_unavailable");
    // Older native servers may not expose this optional quota hint.
    const limits = await connection
      .request("account/rateLimits/read", {})
      .catch(() => null);
    if (subscriptionLimited(limits))
      throw new SubscriptionUnavailable("quota_unavailable");
    turn.bridgeLog?.({
      level: "info",
      subsystem: "hive.auth",
      message: "Authentication selected",
      attrs: { source: "chatgpt", model: settings.model },
    });
  }
  if (start.mcpServers?.hive)
    await connection.request("skills/extraRoots/set", {
      extraRoots: [fileURLToPath(new URL(".", import.meta.url))],
    });
  const result = await connection.request(
    resumedThreadId ? "thread/resume" : "thread/start",
    {
      ...settings,
      ...(resumedThreadId ? { threadId: resumedThreadId } : {}),
    },
    120_000
  );
  const threadId = result?.thread?.id;
  if (!threadId || (resumedThreadId && threadId !== resumedThreadId))
    throw new Error("Codex did not resume the expected thread.");
  return threadId;
}
