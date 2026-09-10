// Runs only in the host-owned, non-persistent authentication VM. No repository,
// model turn, user prompt, or tool execution is accepted here. Never print tokens.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const child = spawn(process.execPath, ["/vercel/sandbox/node_modules/@openai/codex/bin/codex.js", "app-server", "-c", 'cli_auth_credentials_store="file"'], {
  env: { PATH: process.env.PATH, CODEX_HOME: "/vercel/sandbox/codex-auth" },
  stdio: ["pipe", "pipe", "ignore"],
});
let verified = false;
const timer = setTimeout(() => { child.kill("SIGKILL"); }, 25_000);
const send = (id, method, params) => child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.error) { child.stdin.end(); return; }
  if (message.id === 0) {
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    send(1, "account/read", { refreshToken: true });
  }
  if (message.id === 1) {
    verified = message.result?.account?.type === "chatgpt";
    child.stdin.end();
  }
});
child.on("error", () => { clearTimeout(timer); process.exitCode = 1; });
child.stdin.on("error", () => { child.kill("SIGKILL"); });
child.on("close", (code) => { clearTimeout(timer); process.exitCode = verified && code === 0 ? 0 : 1; });
send(0, "initialize", { clientInfo: { name: "hive-auth", version: "0.1.0" } });
