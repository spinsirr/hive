import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 60_000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

function retryAfterMs(value, now) {
  if (value == null) return undefined;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.ceil(Number(value) * 1000);
  // Do not interpret a negative delay or an arbitrary number as a calendar date.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function requestId(headers, name) {
  const value = headers.get(name);
  return value && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : undefined;
}

/**
 * One retry budget per native turn, shared by all of its model requests.
 * @param {{
 *   fetchRequest?: typeof fetch,
 *   wait?: (ms: number, value: undefined, options: { signal: AbortSignal }) => Promise<unknown>,
 *   now?: () => number,
 *   random?: () => number,
 *   onDiagnostic?: (attributes: Record<string, unknown>) => void,
 * }} options
 */
export function createGatewayFetch({
  fetchRequest = fetch, wait = sleep, now = Date.now, random = Math.random,
  onDiagnostic = () => {},
} = {}) {
  let retries = 0;
  let waitedMs = 0;
  return async (url, init) => {
    let retried = false;
    for (;;) {
      init.signal.throwIfAborted();
      // A failed/ambiguous fetch or interrupted accepted stream is never replayed.
      const response = await fetchRequest(url, { ...init, redirect: "manual" });
      const afterMs = retryAfterMs(response.headers.get("retry-after"), now());
      const attrs = {
        route: "ai-gateway", statusCode: response.status,
        requestId: requestId(response.headers, "x-request-id"),
        gatewayRequestId: requestId(response.headers, "x-vercel-ai-gateway-request-id"),
        vercelId: requestId(response.headers, "x-vercel-id"),
        retryAfterMs: afterMs, retries, waitedMs,
      };
      if (response.status !== 429) {
        if (response.status >= 400 || retried) onDiagnostic({
          ...attrs, outcome: response.ok ? "recovered" : "stopped",
        });
        return response;
      }
      const delayMs = Math.max(1000, afterMs ?? Math.ceil(15_000 * 2 ** retries * (1 + random() * 0.2)));
      const stopReason = retries >= MAX_RETRIES ? "attempt-limit"
        : delayMs > MAX_WAIT_MS - waitedMs ? "wait-limit" : undefined;
      if (stopReason) {
        onDiagnostic({ ...attrs, outcome: "stopped", stopReason });
        return response; // Keep the real 429, its headers, and its error body.
      }
      retries++;
      waitedMs += delayMs;
      retried = true;
      onDiagnostic({ ...attrs, outcome: "retrying", retries, waitedMs, delayMs });
      await response.body?.cancel();
      await wait(delayMs, undefined, { signal: init.signal });
    }
  };
}

function forwardHeaders(headers) {
  const connectionHeaders = new Set((headers.get("connection") ?? "").toLowerCase().split(",").map((name) => name.trim()));
  const forwarded = new Headers();
  for (const [name, value] of headers) {
    if (!HOP_HEADERS.has(name) && !connectionHeaders.has(name)) forwarded.set(name, value);
  }
  return forwarded;
}

/** Private, turn-scoped Responses transport. Auth still uses harness credential brokering. */
export async function startGatewayTransport({ baseUrl, authorization, signal, onDiagnostic, ...fetchOptions }) {
  if (!authorization || authorization === "Bearer undefined") throw new Error("Codex Gateway authentication is missing.");
  const upstream = new URL(`${baseUrl.replace(/\/+$/, "")}/responses`);
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw new Error("Codex Gateway URL is invalid.");
  }
  signal.throwIfAborted();
  const lifetime = new AbortController();
  const gatewayFetch = createGatewayFetch({ ...fetchOptions, onDiagnostic });
  const pending = new Set();
  const server = createServer((request, response) => {
    const done = handle(request, response);
    pending.add(done);
    void done.then(() => pending.delete(done), () => pending.delete(done));
  });
  async function handle(request, response) {
    const disconnected = new AbortController();
    const abort = () => { if (!response.writableFinished) disconnected.abort(); };
    response.once("close", abort);
    const requestSignal = AbortSignal.any([signal, lifetime.signal, disconnected.signal]);
    try {
      if (request.method !== "POST" || request.url !== "/responses") {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== authorization) {
        response.writeHead(401).end();
        return;
      }
      if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) {
        response.writeHead(413).end();
        return;
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        requestSignal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const headers = forwardHeaders(new Headers(request.headers));
      headers.set("accept-encoding", "identity");
      const result = await gatewayFetch(upstream, {
        method: "POST", headers, body: Buffer.concat(chunks), signal: requestSignal,
      });
      const outputHeaders = forwardHeaders(result.headers);
      // Fetch decodes compressed responses; never advertise the old encoding/size.
      outputHeaders.delete("content-encoding");
      response.writeHead(result.status, Object.fromEntries(outputHeaders));
      if (result.body) await pipeline(Readable.fromWeb(result.body), response, { signal: requestSignal });
      else response.end();
    } catch {
      // Do not log request bodies, credentials, URLs, or arbitrary provider errors.
      if (!requestSignal.aborted) onDiagnostic?.({ route: "ai-gateway", outcome: "transport-error" });
      if (response.headersSent || requestSignal.aborted) response.destroy();
      else response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({
        error: { message: "Gateway connection failed; this request was not retried." },
      }));
    } finally {
      response.removeListener("close", abort);
    }
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      lifetime.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled(pending);
    },
  };
}
