import assert from "node:assert/strict";
import { test } from "node:test";
// The same self-contained module is copied into the task sandbox.
import { createGatewayFetch } from "./codex-bridge/gateway-transport.mjs";

function request(signal = new AbortController().signal) {
  return {
    method: "POST",
    body: Buffer.from("private-prompt"),
    headers: { authorization: "Bearer private-key" },
    signal,
  };
}

test("429 recovery retries only the rejected HTTP request and respects Retry-After", async () => {
  const calls: unknown[][] = [];
  const waits: number[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  let cancelled = false;
  const rejected = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    {
      status: 429,
      headers: {
        "retry-after": "2",
        "x-request-id": "req-controlled",
        "x-vercel-id": "iad1::controlled",
      },
    }
  );
  const accepted = new Response("accepted");
  const send = createGatewayFetch({
    fetchRequest: async (...args: unknown[]) => {
      calls.push(args);
      return calls.length === 1 ? rejected : accepted;
    },
    wait: async (ms: number) => {
      waits.push(ms);
    },
    onDiagnostic: (attrs: Record<string, unknown>) => diagnostics.push(attrs),
  });
  const input = request();
  assert.equal(
    await send("https://controlled.invalid/responses", input),
    accepted
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal((calls[1][1] as RequestInit).body, input.body);
  assert.equal((calls[0][1] as RequestInit).redirect, "manual");
  assert.deepEqual(waits, [2000]);
  assert.equal(cancelled, true);
  assert.equal(diagnostics[0].requestId, "req-controlled");
  assert.deepEqual(
    diagnostics.map((d) => d.outcome),
    ["retrying", "recovered"]
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /private-prompt|private-key/
  );
});

test("persistent 429 is bounded to two retries across the entire native turn", async () => {
  let calls = 0;
  const waits: number[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  const send = createGatewayFetch({
    fetchRequest: async () => {
      calls++;
      return new Response("original error", { status: 429 });
    },
    wait: async (ms: number) => {
      waits.push(ms);
    },
    random: () => 0,
    onDiagnostic: (attrs: Record<string, unknown>) => diagnostics.push(attrs),
  });
  assert.equal(
    await (
      await send("https://controlled.invalid/responses", request())
    ).text(),
    "original error"
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [15_000, 30_000]);
  assert.equal(diagnostics.at(-1)?.stopReason, "attempt-limit");
  assert.equal(
    (await send("https://controlled.invalid/responses", request())).status,
    429
  );
  assert.equal(
    calls,
    4,
    "A later model call cannot reset this turn's retry budget"
  );
  assert.equal(waits.length, 2);
});

test("Retry-After dates and the cumulative one-minute wait cap are honored without shortening a provider delay", async () => {
  const clock = Date.UTC(2026, 8, 8);
  const waits: number[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  let calls = 0;
  const send = createGatewayFetch({
    now: () => clock,
    fetchRequest: async () => {
      calls++;
      return new Response("limited", {
        status: 429,
        headers: {
          "retry-after":
            calls === 1 ? new Date(clock + 40_000).toUTCString() : "30",
        },
      });
    },
    wait: async (ms: number) => {
      waits.push(ms);
    },
    onDiagnostic: (attrs: Record<string, unknown>) => diagnostics.push(attrs),
  });
  assert.equal(
    (await send("https://controlled.invalid/responses", request())).status,
    429
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [40_000]);
  assert.equal(diagnostics.at(-1)?.stopReason, "wait-limit");
  assert.equal(diagnostics.at(-1)?.retryAfterMs, 30_000);
});

test("invalid Retry-After falls back to jittered backoff; a zero delay cannot cause a hot loop", async () => {
  for (const [header, expected] of [
    ["nonsense", 18_000],
    ["-1", 18_000],
    ["0", 1000],
  ] as const) {
    let calls = 0;
    const waits: number[] = [];
    const send = createGatewayFetch({
      fetchRequest: async () =>
        ++calls === 1
          ? new Response(null, {
              status: 429,
              headers: { "retry-after": header },
            })
          : new Response("ok"),
      wait: async (ms: number) => {
        waits.push(ms);
      },
      random: () => 1,
    });
    await send("https://controlled.invalid/responses", request());
    assert.deepEqual(waits, [expected]);
  }
});

test("cancellation before or during backoff cannot submit another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const send = createGatewayFetch({
    fetchRequest: async () => {
      calls++;
      return new Response(null, {
        status: 429,
        headers: { "retry-after": "1" },
      });
    },
    onDiagnostic: () => controller.abort(),
  });
  await assert.rejects(
    send("https://controlled.invalid/responses", request(controller.signal)),
    { name: "AbortError" }
  );
  assert.equal(calls, 1);
  await assert.rejects(
    send("https://controlled.invalid/responses", request(controller.signal)),
    { name: "AbortError" }
  );
  assert.equal(calls, 1);
});

test("authentication, budget, server, redirect and ambiguous transport failures are never retried", async () => {
  for (const status of [301, 401, 402, 403, 500, 502, 503]) {
    let calls = 0;
    const send = createGatewayFetch({
      fetchRequest: async () => {
        calls++;
        return new Response("error", { status });
      },
      wait: async () => assert.fail("Only a rejected 429 may be retried"),
    });
    assert.equal(
      (await send("https://controlled.invalid/responses", request())).status,
      status
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const send = createGatewayFetch({
    fetchRequest: async () => {
      calls++;
      throw new Error("uncertain delivery");
    },
  });
  await assert.rejects(
    send("https://controlled.invalid/responses", request()),
    /uncertain delivery/
  );
  assert.equal(calls, 1);
});

test("an accepted but interrupted response stream is not buffered or replayed", async () => {
  let calls = 0;
  let streamController: ReadableStreamDefaultController;
  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
      controller.enqueue(new TextEncoder().encode("first delta"));
    },
  });
  const send = createGatewayFetch({
    fetchRequest: async () => {
      calls++;
      return new Response(body);
    },
  });
  const response = await send(
    "https://controlled.invalid/responses",
    request()
  );
  const reader = response.body!.getReader();
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    "first delta"
  );
  streamController!.error(new Error("interrupted"));
  await assert.rejects(reader.read(), /interrupted/);
  assert.equal(calls, 1);
});
