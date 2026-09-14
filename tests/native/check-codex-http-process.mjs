// Native transport regression: actual pinned Codex + Hive bridge against a
// loopback HTTP streaming endpoint. Fabricated auth only; no provider calls.
// Production acceptance remains a separate real browser/model test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCodexAppServerTurn } from "../../src/server/agents/codex/bridge/app-server.mjs";

assert.ok(
  process.argv[2],
  "Pass an isolated installation of @openai/codex@0.149.1"
);
const require = createRequire(path.resolve(process.argv[2], "package.json"));
const pkg = require.resolve("@openai/codex/package.json");
assert.equal(require(pkg).version, "0.149.1");
const cli = path.join(path.dirname(pkg), require(pkg).bin.codex);
const root = await mkdtemp(path.join(os.tmpdir(), "hive-codex-http-"));
const token = `e30.${Buffer.from(
  JSON.stringify({
    exp: 1_999_999_999,
    "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
  })
).toString("base64url")}.fixture`;
let upgrades = 0,
  inferenceRequests = 0,
  fixtureError,
  savedThread,
  firstDelta;
const server = createServer(async (req, res) => {
  try {
    for await (const chunk of req) void chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("/models")) res.end('{"models":[]}');
    else if (req.url.endsWith("/usage"))
      res.end(
        JSON.stringify({
          plan_type: "plus",
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: 0,
              limit_window_seconds: 18000,
              reset_after_seconds: 1000,
              reset_at: 1_999_999_999,
            },
          },
        })
      );
    else if (
      req.url === "/backend-api/codex/responses" &&
      req.method === "POST"
    ) {
      inferenceRequests++;
      assert.equal(
        req.headers.authorization,
        `Bearer ${token}`,
        "Keep native subscription authentication"
      );
      assert.equal(req.headers["chatgpt-account-id"], "fixture-account");
      res.setHeader("Content-Type", "text/event-stream");
      const send = (event) =>
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      const item = {
        type: "message",
        role: "assistant",
        id: `message-${inferenceRequests}`,
        content: [{ type: "output_text", text: "HTTP_STREAM_OK" }],
      };
      send({
        type: "response.created",
        response: { id: "fixture-response", status: "in_progress" },
      });
      send({
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, content: [] },
      });
      send({
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: "HTTP_STREAM_OK",
      });
      // Do not complete until the caller receives the actual streamed delta.
      let timeout;
      try {
        await Promise.race([
          firstDelta.promise,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Reply was buffered until completion")),
              2000
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      send({ type: "response.output_item.done", output_index: 0, item });
      send({
        type: "response.completed",
        response: {
          id: "fixture-response",
          status: "completed",
          output: [item],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      });
      res.end();
    } else {
      res.statusCode = 403;
      res.end('{"error":{"message":"Fixture-only endpoint"}}');
    }
  } catch (error) {
    fixtureError = error;
    res.destroy();
  }
});
server.on("upgrade", (_req, socket) => {
  upgrades++;
  socket.end(
    "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
  );
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (let turn = 0; turn < 2; turn++) {
    const events = [];
    firstDelta = Promise.withResolvers();
    await runCodexAppServerTurn({
      workdir: root,
      threadId: savedThread,
      onThread(id) {
        savedThread = id;
      },
      start: {
        model: "gpt-5.6-luna",
        reasoningEffort: "low",
        prompt: "Reply HTTP_STREAM_OK. No tools.",
        codexConfig: {
          model_providers: {
            hive_chatgpt: { base_url: `${base}/backend-api/codex` },
          },
          hive_subscription_tokens: {
            accessToken: token,
            chatgptAccountId: "fixture-account",
          },
        },
      },
      launch(cwd, subscription) {
        assert.equal(subscription, true);
        return spawn(
          process.execPath,
          [
            cli,
            "app-server",
            "-c",
            `chatgpt_base_url="${base}"`,
            "-c",
            `openai_base_url="${base}/backend-api/codex"`,
            "-c",
            'cli_auth_credentials_store="ephemeral"',
          ],
          {
            cwd,
            env: { PATH: process.env.PATH, CODEX_HOME: root },
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
          }
        );
      },
      turn: {
        abortSignal: AbortSignal.timeout(20_000),
        emit(event) {
          events.push(event);
          if (event.type === "text-delta") firstDelta.resolve();
        },
      },
    });
    if (fixtureError) throw fixtureError;
    assert.equal(
      upgrades,
      0,
      "Brokered subscriptions must not attempt failing WebSockets before HTTP streaming"
    );
    assert.equal(
      inferenceRequests,
      turn + 1,
      "One inference request per turn, including native resume"
    );
    assert.equal(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
      "HTTP_STREAM_OK"
    );
    assert.equal(events.filter((event) => event.type === "finish").length, 1);
    assert.ok(
      events.findIndex((event) => event.type === "text-delta") <
        events.findIndex((event) => event.type === "finish")
    );
    assert.equal(
      events.some((event) => event.type === "tool-call"),
      false
    );
    console.log(
      `PASS: native subscription ${turn ? "resume" : "start"}, HTTP streaming with zero WebSocket attempts`
    );
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
