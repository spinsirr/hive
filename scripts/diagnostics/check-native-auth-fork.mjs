// Real pinned native process + loopback provider; no account/model spend.
// Pass the isolated SDK installation as argv[2].
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

assert.ok(process.argv[2], "Provide an isolated SDK installation");
const require = createRequire(
  await realpath(
    path.resolve(process.argv[2], "node_modules/@openai/codex-sdk/package.json")
  )
);
const pkg = require.resolve("@openai/codex/package.json");
assert.equal(require(pkg).version, "0.149.1");
const cli = path.join(path.dirname(pkg), require(pkg).bin.codex);
const home = await mkdtemp(path.join(os.tmpdir(), "hive-native-fork-"));
const repo = path.join(home, "repo");
await mkdir(repo);
let count = 0;
const server = createServer((req, res) => {
  req.resume();
  count++;
  res.writeHead(429, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        type: "usage_limit_reached",
        message: "Controlled rejection",
        plan_type: "pro",
        resets_at: Math.floor(Date.now() / 1000 + 3600),
      },
    })
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const app = spawn(process.execPath, [cli, "app-server"], {
  cwd: repo,
  env: {
    PATH: process.env.PATH,
    CODEX_HOME: home,
    CODEX_API_KEY: "LOOPBACK_FIXTURE",
  },
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,
});
const closed = new Promise((resolve) => app.once("close", resolve));
const pending = new Map(),
  completed = Promise.withResolvers();
let sequence = 0;
app.stderr.resume();
const lines = createInterface({ input: app.stdout });
lines.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "turn/completed") completed.resolve(msg.params.turn);
  if (!msg.method && pending.has(msg.id)) {
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  }
});
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(
      () => reject(new Error(`${method} timed out`)),
      20_000
    );
    pending.set(id, { resolve, reject, timer });
    app.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
const config = {
  model_provider: "fixture",
  web_search: "disabled",
  model_providers: {
    fixture: {
      name: "Local fixture",
      base_url: `http://127.0.0.1:${server.address().port}/v1`,
      env_key: "CODEX_API_KEY",
      wire_api: "responses",
      supports_websockets: false,
      request_max_retries: 0,
      stream_max_retries: 0,
    },
  },
};
try {
  await rpc("initialize", {
    clientInfo: { name: "hive-auth-fork-test", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  app.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  const { thread } = await rpc("thread/start", {
    model: "gpt-5.1-codex-mini",
    cwd: repo,
    sandbox: "read-only",
    approvalPolicy: "never",
    config,
  });
  await rpc("turn/start", {
    threadId: thread.id,
    input: [
      { type: "text", text: "Controlled rejected turn", text_elements: [] },
    ],
  });
  const failed = await Promise.race([
    completed.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Turn timeout")), 20_000).unref()
    ),
  ]);
  assert.equal(failed.status, "failed");
  assert.equal(count, 1);
  const before = await rpc("thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  assert.equal(before.thread.turns.at(-1).id, failed.id);
  const { thread: fork } = await rpc("thread/fork", {
    threadId: thread.id,
    beforeTurnId: failed.id,
    deferGoalContinuation: true,
    ephemeral: false,
    config,
  });
  assert.notEqual(fork.id, thread.id);
  const original = await rpc("thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  const continuation = await rpc("thread/read", {
    threadId: fork.id,
    includeTurns: true,
  });
  assert.equal(original.thread.turns.length, 1);
  assert.equal(continuation.thread.turns.length, 0);
  console.log(
    "PASS: pinned native Codex forks before an empty rejected turn, preserves the original history and does not repeat the rejected prompt."
  );
} finally {
  app.stdin.end();
  const timer = setTimeout(() => {
    try {
      process.kill(-app.pid, "SIGKILL");
    } catch {
      app.kill("SIGKILL");
    }
  }, 4000);
  await closed;
  clearTimeout(timer);
  lines.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
