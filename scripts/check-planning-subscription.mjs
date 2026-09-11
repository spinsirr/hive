import assert from "node:assert/strict";
import { mock } from "node:test";
import { registerHooks } from "node:module";
import { HarnessAgent as RealHarnessAgent } from "@ai-sdk/harness/agent";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next("next/dist/compiled/server-only/empty.js", context);
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
let settings, stopped = 0, starts = 0, fail = false, native, runtime;
mock.module("@vercel/sandbox", { namedExports: { Sandbox: { async create(options) {
  assert.equal(options.source, undefined); assert.equal(options.persistent, undefined);
  assert.equal(options.resources.vcpus, runtime === "claude-code" ? 2 : 1, "Claude's pinned native bootstrap requires 4 GiB; Codex keeps its existing size");
  starts++; return { async stop() { stopped++; } };
} } } });
mock.module("@ai-sdk/sandbox-vercel", { namedExports: { createVercelSandbox() { return {}; } } });
mock.module("@ai-sdk/harness-codex", { namedExports: { createCodex(value) { native = value; return {}; } } });
mock.module("@ai-sdk/harness-claude-code", { namedExports: { createClaudeCode(value) { native = value; return {}; } } });
mock.module("@ai-sdk/harness/agent", { namedExports: { HarnessAgent: class {
  constructor(value) {
    // Exercise the real SDK's settings validation; replacing the whole agent
    // previously hid its relative-workDir requirement until production.
    new RealHarnessAgent({ ...value, harness: { ...value.harness, builtinTools: {} } });
    settings = value;
    assert.equal(value.model, runtime === "codex" ? "gpt-5.6-luna" : "claude-opus-4-6");
    assert.equal(value.permissionMode, "allow-all", "Native Codex supports only this mode in its isolated VM");
    assert.deepEqual(native.auth, {}); assert.equal(native.mcpServers, undefined);
    assert.match(value.instructions, /does not have a repository/);
    assert.match(value.instructions, /Do not use tools/);
    assert.doesNotMatch(JSON.stringify(native), /REAL_CODEX_ACCESS|sk-ant-oat01-native-fixture/);
  }
  async createSession() {
    return { async stop() {} };
  }
  async stream({ prompt }) {
    assert.match(prompt, /Clarify the acceptance criteria/);
    return { fullStream: (async function* () {
      yield { type: "text-delta", text: "First " };
      if (fail) throw new Error("Subscription limit reached.");
      yield { type: "text-delta", text: "reply." };
    })() };
  }
} } });
globalThis.fetch = async () => { throw new Error("No real provider/Gateway HTTP in this test"); };
const { runHiveConversation } = await import("../src/lib/hive-conversation.ts");
const { createInitialTaskSessionState, reduceTaskSession } = await import("../src/lib/task-session.ts");
const { platformCodingModels } = await import("../src/lib/platform-models.ts");
process.env.HIVE_CODEX_AUTH_SECRET = "configured-fixture";
process.env.HIVE_CLAUDE_OAUTH_TOKEN = "sk-ant-oat01-native-fixture";
const auth = { accessToken: "REAL_CODEX_ACCESS", chatgptAccountId: "fixture-account" };
for (runtime of ["codex", "claude-code"]) {
  let state = createInitialTaskSessionState(1, "planning-fixture", { createdBy: "person" });
  state = reduceTaskSession(state, { type: "select-harness", actor: "person", runtime, modelId: runtime === "codex" ? "gpt-5.6-luna" : "claude-opus-4-6" }, 2, [], platformCodingModels(process.env));
  state = reduceTaskSession(state, { type: "send-message", actor: "person", body: "Clarify the acceptance criteria" }, 3);
  const publicText = [];
  assert.equal(await runHiveConversation(state, "person", "Person", text => publicText.push(text), undefined, auth), "First reply.");
  assert.deepEqual(publicText, ["First ", "First reply."]);
  assert.equal(settings.sandboxConfig.workDir, "planning");
  fail = true;
  await assert.rejects(runHiveConversation(state, "person", "Person", () => {}, undefined, auth), /Subscription limit reached/);
  fail = false;
  const before = starts;
  if (runtime === "codex") await assert.rejects(runHiveConversation(state, "person"), /Reconnect the Codex subscription/);
  else {
    delete process.env.HIVE_CLAUDE_OAUTH_TOKEN;
    await assert.rejects(runHiveConversation(state, "person"), /Reconnect the Claude subscription/);
  }
  assert.equal(starts, before, "Missing credentials cannot create a sandbox or select Gateway");
}
assert.equal(starts, 4); assert.equal(stopped, 4);
console.log("PASS: pre-repository chat uses the selected native subscription, streams text, isolates and stops each VM, and never falls back to Gateway.");
