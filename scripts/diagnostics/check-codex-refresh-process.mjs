// Opt-in: pinned native Codex + loopback HTTP streaming fixture, fabricated auth.
// No provider request, host login, refresh token, repository, or paid credential.
// node scripts/diagnostics/check-codex-refresh-process.mjs /isolated/codex-install
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { runCodexAppServerTurn } from "../../src/lib/codex-bridge/app-server.mjs";

assert.ok(
  process.argv[2],
  "Pass an isolated installation of @openai/codex@0.149.1"
);
const require = createRequire(path.resolve(process.argv[2], "package.json"));
const pkg = require.resolve("@openai/codex/package.json");
assert.equal(require(pkg).version, "0.149.1");
const cli = path.join(path.dirname(pkg), require(pkg).bin.codex);
const token = `e30.${Buffer.from(
  JSON.stringify({
    exp: 1_999_999_999,
    "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
  })
).toString("base64url")}.fixture`;

for (const scenario of [
  "background-401",
  "inference-401",
  "background-and-inference-401",
]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hive-codex-refresh-"));
  const inferenceFails = scenario !== "background-401";
  const events = [],
    refreshReplies = [],
    requests = [];
  let launches = 0,
    fixtureError;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    requests.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("/models")) res.end('{"models":[]}');
    else if (
      req.url === "/backend-api/codex/responses" &&
      req.method === "POST"
    ) {
      if (inferenceFails) {
        res.statusCode = 401;
        res.end(
          '{"error":{"message":"Fixture-only inference denial","type":"authentication_error"}}'
        );
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      const send = (value) =>
        res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
      const item = {
        type: "message",
        role: "assistant",
        id: "fixture-message",
        content: [{ type: "output_text", text: "HIVE_CODEX_OK" }],
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
        delta: "HIVE_CODEX_OK",
      });
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
    } else if (req.url.endsWith("/usage"))
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
    else {
      res.statusCode =
        req.url.endsWith("/settings/user") && scenario !== "inference-401"
          ? 401
          : 403;
      res.end(
        '{"error":{"message":"Fixture-only denial","type":"authentication_error"}}'
      );
    }
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    try {
      assert.equal(req.url, "/backend-api/codex/responses");
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      if (inferenceFails) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) =>
        ws.on("message", (raw) => {
          const message = JSON.parse(raw.toString());
          const send = (value) => ws.send(JSON.stringify(value));
          const item = {
            type: "message",
            role: "assistant",
            id: "fixture-message",
            content: [{ type: "output_text", text: "HIVE_CODEX_OK" }],
          };
          send({
            type: "response.created",
            response: { id: "fixture-response", status: "in_progress" },
          });
          if (message.generate !== false) {
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
              delta: "HIVE_CODEX_OK",
            });
            send({ type: "response.output_item.done", output_index: 0, item });
          }
          send({
            type: "response.completed",
            response: {
              id: "fixture-response",
              status: "completed",
              output: message.generate === false ? [] : [item],
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            },
          });
        })
      );
    } catch (error) {
      fixtureError = error;
      socket.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let caught;
  try {
    try {
      await runCodexAppServerTurn({
        workdir: root,
        onThread() {},
        start: {
          model: "gpt-5.6-luna",
          reasoningEffort: "low",
          prompt: "Reply HIVE_CODEX_OK. Do not use tools.",
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
          launches++;
          const child = spawn(
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
          const write = child.stdin.write.bind(child.stdin);
          child.stdin.write = (chunk, ...args) => {
            const message = JSON.parse(chunk.toString());
            if (message.error) refreshReplies.push(message);
            return write(chunk, ...args);
          };
          return child;
        },
        turn: {
          abortSignal: AbortSignal.timeout(12_000),
          emit: (event) => events.push(event),
        },
      });
    } catch (error) {
      caught = error;
    }
    if (fixtureError) throw fixtureError;
    assert.equal(launches, 1, "No native restart or paid fallback");
    assert.ok(
      refreshReplies.length > 0,
      "The real native refresh callback must be exercised"
    );
    assert.ok(
      refreshReplies.every(
        (reply) => reply.error.code === -32000 && !reply.result
      ),
      "Refresh must be explicitly refused, never supplied a token"
    );
    assert.equal(
      events.some((event) => event.type === "tool-call"),
      false
    );
    if (inferenceFails) {
      assert.ok(
        caught,
        "Real inference authentication failure must still fail the turn"
      );
      assert.equal(
        events.some((event) => event.type === "finish"),
        false
      );
      assert.equal(
        events.some((event) => event.type === "text-delta"),
        false
      );
    } else {
      assert.equal(caught, undefined);
      assert.ok(requests.some((url) => url.endsWith("/settings/user")));
      assert.equal(
        events
          .filter((event) => event.type === "text-delta")
          .map((event) => event.delta)
          .join(""),
        "HIVE_CODEX_OK"
      );
      assert.equal(events.filter((event) => event.type === "finish").length, 1);
    }
    console.log(
      `PASS: real Codex ${scenario}; refresh refused, ${inferenceFails ? "inference fails closed" : "valid turn completes"}`
    );
  } finally {
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
