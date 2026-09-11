// Opt-in, one real read-only turn. Pass isolated SDK install and explicit auth
// seed path. Never loads the desktop login, refreshes the seed or prints tokens.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, realpath, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseManagedCodexAuth, externalCodexTokens, codexAuthNeedsRefresh } from "../../src/lib/codex-subscription-credentials.ts";
import { CODEX_SUBSCRIPTION_MODEL } from "../../src/lib/coding-models.ts";

assert.ok(process.argv[2] && process.argv[3], "Provide an isolated SDK installation and explicitly authorized seed file");
const require = createRequire(await realpath(path.resolve(process.argv[2], "node_modules/@openai/codex-sdk/package.json")));
const pkg = require.resolve("@openai/codex/package.json");
assert.equal(require(pkg).version, "0.149.1");
let auth;
try { auth = parseManagedCodexAuth(JSON.parse(await readFile(process.argv[3], "utf8"))); } catch { throw new Error("Authorized seed unavailable."); }
assert.equal(codexAuthNeedsRefresh(auth), false, "Reconnect before testing an expired seed");
const home = await mkdtemp(path.join(os.tmpdir(), "hive-native-auth-"));
const app = spawn(process.execPath, [path.join(path.dirname(pkg), require(pkg).bin.codex), "app-server", "-c", 'cli_auth_credentials_store="ephemeral"'], {
  cwd: home, env: { PATH: process.env.PATH, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"], detached: true,
});
const exited = new Promise(resolve => app.once("close", resolve));
const pending = new Map(), completed = Promise.withResolvers();
let sequence = 0, toolCalls = 0, output = "";
app.stderr.resume();
const lines = createInterface({ input: app.stdout });
lines.on("line", line => {
  const msg = JSON.parse(line);
  if (msg.method && msg.id != null) app.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: "This bounded check cannot refresh credentials or approve actions." } }) + "\n");
  if (msg.method === "turn/completed") completed.resolve(msg.params.turn);
  if (msg.method === "item/started" && !["userMessage", "agentMessage", "reasoning"].includes(msg.params.item.type)) toolCalls++;
  if (msg.method === "item/completed" && msg.params.item.type === "agentMessage") output += msg.params.item.text;
  if (!msg.method && pending.has(msg.id)) {
    const item = pending.get(msg.id); pending.delete(msg.id); clearTimeout(item.timer);
    if (msg.error) item.reject(new Error("Native request failed (details withheld).")); else item.resolve(msg.result);
  }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject, timer: setTimeout(() => reject(new Error(`${method} timed out`)), 20_000) });
  app.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
try {
  await rpc("initialize", { clientInfo: { name: "hive-auth-check", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  app.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  const login = await rpc("account/login/start", { type: "chatgptAuthTokens", ...externalCodexTokens(auth) });
  assert.equal(login.type, "chatgptAuthTokens");
  const { account } = await rpc("account/read", {});
  assert.equal(account.type, "chatgpt");
  const { thread } = await rpc("thread/start", { model: CODEX_SUBSCRIPTION_MODEL, cwd: home, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", config: {
    model_provider: "openai", cli_auth_credentials_store: "ephemeral", web_search: "disabled", model_verbosity: "low", model_reasoning_effort: "low",
  } });
  await rpc("turn/start", { threadId: thread.id, input: [{ type: "text", text: 'Do not call tools or inspect files. Reply with exactly: "Hive native authentication verified."', text_elements: [] }] });
  const result = await Promise.race([completed.promise, new Promise((_, reject) => setTimeout(() => reject(new Error("Turn deadline exceeded")), 60_000).unref())]);
  assert.equal(result.status, "completed");
  assert.equal(toolCalls, 0);
  assert.match(output, /Hive native authentication verified/);
  await assert.rejects(access(path.join(home, "auth.json")), { code: "ENOENT" });
  console.log("PASS: pinned Codex 0.149.1 accepts ephemeral external tokens and completes one Luna turn; zero tools, no auth.json on disk.");
} finally {
  app.stdin.end();
  const timer = setTimeout(() => { try { process.kill(-app.pid, "SIGKILL"); } catch { app.kill("SIGKILL"); } }, 4000);
  await exited; clearTimeout(timer); lines.close();
  for (const item of pending.values()) clearTimeout(item.timer);
}
