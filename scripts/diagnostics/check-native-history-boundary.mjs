// Pinned native process, loopback Responses provider, no credentials/model spend.
// node scripts/diagnostics/check-native-history-boundary.mjs /path/to/isolated/sdk-install
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCodexAppServerTurn } from "../../src/lib/codex-bridge/app-server.mjs";

assert.ok(process.argv[2], "Provide an isolated SDK installation");
const require = createRequire(await realpath(path.resolve(process.argv[2], "node_modules/@openai/codex-sdk/package.json")));
const pkg = require.resolve("@openai/codex/package.json");
assert.equal(require(pkg).version, "0.149.1");
const cli = path.join(path.dirname(pkg), require(pkg).bin.codex);
const home = await mkdtemp(path.join(os.tmpdir(), "hive-native-history-"));
let count = 0, requestFailure;
const requests = [], events = [], diagnostics = [], threads = [];
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.url, "/v1/responses");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push(body); count++;
    if (count === 2) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_encrypted_content", message: "Controlled foreign encrypted history" } }));
      return;
    }
    assert.ok(count <= 3, "Only one recovery is allowed");
    if (count === 3) {
      assert.match(JSON.stringify(body.input), /NATIVE-HISTORY-MARKER/);
      assert.match(JSON.stringify(body.input), /Prior native reply/);
      assert.match(JSON.stringify(body.input), /Current request/);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    const text = count === 1 ? "Prior native reply" : "Recovered reply";
    send({ type: "response.created", response: { id: `fixture-${count}` } });
    send({ type: "response.output_item.done", item: { id: `reply-${count}`, type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
    send({ type: "response.completed", response: { id: `fixture-${count}`, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
    res.end();
  } catch (error) { requestFailure = error; res.destroy(error); }
});
await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
process.env.AI_GATEWAY_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
delete process.env.OPENAI_BASE_URL;
delete process.env.AI_GATEWAY_API_KEY;
process.env.CODEX_API_KEY = "LOOPBACK_FIXTURE";
let threadId;
try {
  for (const prompt of ["Remember NATIVE-HISTORY-MARKER", "Only reply; do not run commands."]) {
    await runCodexAppServerTurn({
      start: { model: "openai/gpt-5.1-codex-mini", prompt, reasoningEffort: "low" }, workdir: home, threadId,
      onThread(id) { threadId = id; threads.push(id); },
      launch(workdir) { return spawn(process.execPath, [cli, "app-server"], {
        cwd: workdir, env: { PATH: process.env.PATH, CODEX_HOME: home, CODEX_API_KEY: "LOOPBACK_FIXTURE" },
        stdio: ["pipe", "pipe", "pipe"], detached: true,
      }); },
      turn: { abortSignal: AbortSignal.timeout(30_000), emit(e) { events.push(e); }, bridgeLog(e) { diagnostics.push(e); } },
    });
  }
  if (requestFailure) throw requestFailure;
  assert.equal(count, 3);
  assert.equal(threads[0], threads[1]);
  assert.notEqual(threads[1], threads[2]);
  assert.equal(events.filter(e => e.type === "stream-start").length, 2);
  assert.equal(events.filter(e => e.type === "finish").length, 2);
  assert.equal(events.some(e => e.type === "tool-call" || e.type === "file-change"), false);
  assert.equal(diagnostics.filter(e => e.attrs.reason === "incompatible_native_history").length, 1);
  console.log("PASS: pinned Codex preserves prior public history, replaces only the incompatible native context, and completes without replaying tools.");
} finally {
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
}
