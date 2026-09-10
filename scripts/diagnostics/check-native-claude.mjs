// Real pinned Claude SDK/CLI against loopback. No login, provider or model spend.
// node scripts/diagnostics/check-native-claude.mjs /path/to/isolated/sdk-install
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

assert.ok(process.argv[2], "Provide an isolated Claude SDK installation");
const root = await realpath(process.argv[2]);
const require = createRequire(path.join(root, "package.json"));
const { query } = await import(require.resolve("@anthropic-ai/claude-agent-sdk"));
assert.equal(JSON.parse(await readFile(path.join(root, "node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8")).version, "0.3.245");
const cliPackage = path.join(root, "node_modules/@anthropic-ai/claude-code");
const cliManifest = JSON.parse(await readFile(path.join(cliPackage, "package.json"), "utf8"));
assert.equal(cliManifest.version, "2.1.245");
const cli = path.join(cliPackage, cliManifest.bin.claude);
const workdir = await mkdtemp(path.join(os.tmpdir(), "hive-claude-fixture-"));
const credential = "sk-ant-oat01-loopback-fixture-not-a-real-token";
const partialReceived = Promise.withResolvers();
const requests = [];
let requestFailure;
let finishedFirstResponse = false;
const provider = createServer(async (req, res) => {
  try {
    const route = new URL(req.url, "http://localhost").pathname;
    if (route === "/api/hello") { res.writeHead(204); res.end(); return; }
    if (route.endsWith("/count_tokens")) { res.setHeader("Content-Type", "application/json"); res.end('{"input_tokens":50}'); return; }
    assert.equal(route, "/v1/messages");
    assert.equal(req.headers.authorization, `Bearer ${credential}`);
    assert.equal(req.headers["x-api-key"], undefined, "OAuth must not silently become API-key auth");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    if (process.env.HIVE_FIXTURE_DEBUG) console.log("fixture request", { stream: body.stream, messages: body.messages, model: body.model });
    requests.push(body);
    const count = requests.length;
    assert.ok(count <= 3, "No unexpected retries or background model requests");
    assert.equal(body.model, "claude-sonnet-4-6");
    if (count === 2) assert.match(JSON.stringify(body.messages), /CLAUDE_TOOL_MARKER/);
    if (count === 3) {
      assert.match(JSON.stringify(body.messages), /HIVE_NATIVE_HISTORY_MARKER/);
      assert.match(JSON.stringify(body.messages), /First turn complete/);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({ type: "message_start", message: { id: `msg_${count}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: count === 1 ? "Inspecting the task." : count === 2 ? "First turn complete" : "History resumed" } });
    if (count === 1) await partialReceived.promise;
    send({ type: "content_block_stop", index: 0 });
    if (count === 1) {
      send({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_fixture", name: "Bash", input: {} } });
      send({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: "printf 'CLAUDE_TOOL_MARKER\\n'; exit 7", description: "Verify fixture command execution" }) } });
      send({ type: "content_block_stop", index: 1 });
      finishedFirstResponse = true;
    }
    send({ type: "message_delta", delta: { stop_reason: count === 1 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
    send({ type: "message_stop" });
    res.end();
  } catch (error) { requestFailure = error; if (process.env.HIVE_FIXTURE_DEBUG) console.error("fixture failure", req.url, error); partialReceived.resolve(); res.destroy(error); }
});
await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
let sessionId;
let toolResults = 0;
try {
  for (const prompt of ["Remember HIVE_NATIVE_HISTORY_MARKER. Run only the fixture command.", "Keep the earlier context. Only reply now; no commands."]) {
    const running = query({ prompt, options: {
      cwd: workdir, pathToClaudeCodeExecutable: cli, settingSources: [],
      model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
      tools: ["Bash"], includePartialMessages: true, maxTurns: 3,
      ...(sessionId ? { resume: sessionId } : {}),
      env: {
        CLAUDE_CONFIG_DIR: path.join(workdir, "config"), CLAUDE_CODE_OAUTH_TOKEN: credential,
        ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_CUSTOM_HEADERS: "",
        CLAUDE_CODE_USE_BEDROCK: "", CLAUDE_CODE_USE_VERTEX: "", CLAUDE_CODE_USE_FOUNDRY: "",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    } });
    const timeout = setTimeout(() => { partialReceived.resolve(); void running.return(); }, 35_000);
    let completed = false;
    try {
      for await (const message of running) {
        if (process.env.HIVE_FIXTURE_DEBUG) console.log("native event", message.type, message.event?.type, message.subtype, message.event?.delta);
        if (message.type === "stream_event" && message.event.type === "content_block_delta" && message.event.delta.text === "Inspecting the task.") {
          assert.equal(finishedFirstResponse, false, "Native output must arrive before message completion");
          partialReceived.resolve();
        }
        if (message.type === "user" && message.tool_use_result) {
          toolResults++;
          assert.match(JSON.stringify(message), /CLAUDE_TOOL_MARKER/);
        }
        if (message.type === "result") {
          assert.equal(message.subtype, "success", JSON.stringify(message));
          assert.equal(message.is_error, false);
          if (sessionId) assert.equal(message.session_id, sessionId, "Resume must preserve the native session identity");
          sessionId = message.session_id;
          completed = true;
        }
      }
      if (requestFailure) throw requestFailure;
      assert.equal(completed, true, "The native query must finish successfully");
    } finally { clearTimeout(timeout); await running.return(); }
  }
  assert.equal(requests.length, 3);
  assert.equal(toolResults, 1, "A fresh process must not replay the prior Bash command");
  console.log("PASS: pinned Claude uses OAuth bearer auth, emits text before completion, executes one real command and resumes native history without replaying it.");
} finally { partialReceived.resolve(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
