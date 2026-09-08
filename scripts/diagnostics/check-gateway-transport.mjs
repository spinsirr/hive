// Opt-in loopback HTTP checks. No external provider or real credentials.
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { startGatewayTransport } from "../../src/lib/codex-bridge/gateway-transport.mjs";

const authorization = "Bearer controlled-fixture-key";
const options = () => ({
  baseUrl: "https://controlled.invalid/v1", authorization,
  signal: new AbortController().signal,
});
const post = (transport, extra = {}) => fetch(`${transport.baseUrl}/responses`, {
  method: "POST", headers: { authorization, "content-type": "application/json" }, body: '{"input":"fixture-prompt"}', ...extra,
});

test("private transport restricts path, method and authorization; forwards accepted SSE without buffering", { timeout: 5000 }, async () => {
  const calls = [];
  const diagnostics = [];
  let streamController;
  const body = new ReadableStream({ start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode("data: first\n\n")); } });
  const transport = await startGatewayTransport({ ...options(),
    fetchRequest: async (url, init) => {
      calls.push({ url, init });
      return new Response(body, { headers: { "content-type": "text/event-stream", "content-encoding": "gzip", "content-length": "999", "connection": "x-internal", "x-internal": "drop", "x-request-id": "fixture-id" } });
    },
    onDiagnostic: (attrs) => diagnostics.push(attrs),
  });
  try {
    assert.equal((await fetch(`${transport.baseUrl}/responses`)).status, 404);
    assert.equal((await fetch(`${transport.baseUrl}/unrelated`, { method: "POST" })).status, 404);
    assert.equal((await post(transport, { headers: { authorization: "Bearer wrong" } })).status, 401);
    assert.equal(calls.length, 0);
    const response = await post(transport);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("x-internal"), null);
    assert.equal(response.headers.get("x-request-id"), "fixture-id");
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
    streamController.enqueue(new TextEncoder().encode("data: last\n\n"));
    streamController.close();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "data: last\n\n");
    assert.equal((await reader.read()).done, true);
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].url), "https://controlled.invalid/v1/responses");
    assert.equal(calls[0].init.headers.get("authorization"), authorization, "Preserve the harness-brokered credential");
    assert.equal(calls[0].init.body.toString(), '{"input":"fixture-prompt"}');
    assert.equal(calls[0].init.redirect, "manual");
    assert.deepEqual(diagnostics, []);
  } finally { await transport.close(); }
});

test("a persistent 429 retains upstream status, body and diagnostic headers", { timeout: 5000 }, async () => {
  let calls = 0;
  const waits = [];
  const diagnostics = [];
  const transport = await startGatewayTransport({ ...options(),
    fetchRequest: async () => { calls++; return new Response('{"error":{"message":"fixture limited"}}', { status: 429, headers: { "retry-after": "1", "x-request-id": "req-fixture" } }); },
    wait: async (ms) => waits.push(ms),
    onDiagnostic: (attrs) => diagnostics.push(attrs),
  });
  try {
    const response = await post(transport);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.equal(response.headers.get("x-request-id"), "req-fixture");
    assert.deepEqual(await response.json(), { error: { message: "fixture limited" } });
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1000, 1000]);
    assert.equal(diagnostics.at(-1).stopReason, "attempt-limit");
    assert.doesNotMatch(JSON.stringify(diagnostics), /fixture-prompt|controlled-fixture-key|fixture limited/);
  } finally { await transport.close(); }
});

test("closing the transport cancels backoff and closes the private port without another request", { timeout: 5000 }, async () => {
  let calls = 0;
  const waiting = Promise.withResolvers();
  const transport = await startGatewayTransport({ ...options(),
    fetchRequest: async () => { calls++; return new Response(null, { status: 429, headers: { "retry-after": "30" } }); },
    onDiagnostic: () => waiting.resolve(),
  });
  const pending = post(transport);
  const rejected = assert.rejects(pending);
  await waiting.promise;
  await transport.close();
  await rejected;
  assert.equal(calls, 1);
  await assert.rejects(post(transport));
});

test("client disconnect cancels its backoff without sending another request", { timeout: 5000 }, async () => {
  let calls = 0;
  const waiting = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  const transport = await startGatewayTransport({ ...options(),
    fetchRequest: async () => { calls++; return new Response(null, { status: 429 }); },
    wait: async (_ms, _value, { signal }) => {
      signal.throwIfAborted();
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      cancelled.resolve();
      signal.throwIfAborted();
    },
    onDiagnostic: () => waiting.resolve(),
  });
  const controller = new AbortController();
  try {
    const rejected = assert.rejects(post(transport, { signal: controller.signal }));
    await waiting.promise;
    controller.abort();
    await rejected;
    await cancelled.promise;
    assert.equal(calls, 1);
  } finally { await transport.close(); }
});

test("transport failure does not expose provider error details or follow redirects", { timeout: 5000 }, async () => {
  let calls = 0;
  const diagnostics = [];
  const transport = await startGatewayTransport({ ...options(),
    fetchRequest: async () => { calls++; throw new Error("https://secret.invalid/key-with-credentials"); },
    onDiagnostic: (attrs) => diagnostics.push(attrs),
  });
  try {
    const response = await post(transport);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /secret|credentials/);
    assert.equal(calls, 1);
    assert.deepEqual(diagnostics, [{ route: "ai-gateway", outcome: "transport-error" }]);
  } finally { await transport.close(); }
});

test("oversized requests and invalid upstream URLs never contact the provider", { timeout: 5000 }, async () => {
  const transport = await startGatewayTransport({ ...options(), fetchRequest: async () => assert.fail("No provider request expected") });
  try {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(`${transport.baseUrl}/responses`, { method: "POST", headers: { authorization, "content-length": 65 * 1024 * 1024 } }, (res) => {
        resolve(res.statusCode); res.resume(); req.destroy();
      });
      req.on("error", reject);
      req.flushHeaders();
    });
    assert.equal(status, 413);
  } finally { await transport.close(); }
  for (const baseUrl of ["file:///tmp/fixture", "https://user:password@controlled.invalid/v1", "https://controlled.invalid/v1?target=other"]) {
    await assert.rejects(startGatewayTransport({ ...options(), baseUrl }), /URL is invalid/);
  }
});
