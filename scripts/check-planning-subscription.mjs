import assert from "node:assert/strict";
import { mock } from "node:test";
import { registerHooks } from "node:module";
import { HarnessAgent as RealHarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode as realClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex as realCodex } from "@ai-sdk/harness-codex";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return next("next/dist/compiled/server-only/empty.js", context);
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
let settings, stopped = 0, detached = 0, starts = 0, fail = false, question = false, native, runtime;
const collaboration = { url: "https://hive.test/api/sessions/planning-fixture/agent-tools", token: "short-lived-tool-fixture" };
const raw = { name: "ai-sdk-harness-session-planning-native", persistent: true, timeout: 1_800_000,
  tags: { session: "planning-fixture" }, expiresAt: new Date(Date.now() + 1_800_000),
  currentSession: () => ({ sessionId: "planning-vm" }), async stop() {},
};
const network = { id: raw.name, async setRequestTransformations() {}, async addRequestTransformations() {} };
mock.module("@vercel/sandbox", { namedExports: { Sandbox: { async get({ resume }) { assert.equal(resume, false); return raw; }, async create(options) {
  assert.fail(`Planning must let the Harness provider reuse its bootstrap snapshot, not create a cold VM directly (${options.runtime}).`);
} } } });
mock.module("@ai-sdk/sandbox-vercel", { namedExports: { createVercelSandbox(options) {
  assert.equal(options.sandbox, undefined);
  assert.equal(options.source, undefined);
  assert.equal(options.persistent, undefined, "only the clean bootstrap template is persistent, never the per-turn VM");
  assert.equal(options.runtime, "node24");
  assert.equal(options.timeout, 30 * 60_000, "a task environment must remain available for the agreed 30-minute idle window");
  assert.equal(options.resources.vcpus, runtime === "claude-code" ? 2 : 1);
  return {};
} } });
mock.module("@ai-sdk/harness-codex", { namedExports: { createCodex(value) { native = value; return { ...realCodex(value), async doStart() { return {}; } }; } } });
mock.module("@ai-sdk/harness-claude-code", { namedExports: { createClaudeCode(value) { native = value; return { ...realClaudeCode(value), async doStart() { return {}; } }; } } });
mock.module("@ai-sdk/harness/agent", { namedExports: { HarnessAgent: class {
  constructor(value) {
    // Exercise the real SDK's settings validation; replacing the whole agent
    // previously hid its relative-workDir requirement until production.
    new RealHarnessAgent(value);
    settings = value;
    assert.equal(value.model, runtime === "codex" ? "gpt-5.6-luna" : "claude-opus-4-6");
    assert.equal(value.permissionMode, "allow-all", "Native Codex supports only this mode in its isolated VM");
    assert.deepEqual(native.auth, {});
    assert.equal(native.mcpServers?.hive.url, collaboration.url, "no-repository chat must expose the same inline question tool");
    assert.equal((native.mcpServers.hive.headers ?? native.mcpServers.hive.http_headers).Authorization, `Bearer ${collaboration.token}`);
    assert.match(value.instructions, /does not have a repository/);
    assert.match(value.instructions, /request_input/);
    assert.match(value.instructions, /Do not.*run commands/);
    assert.doesNotMatch(JSON.stringify(native), /REAL_CODEX_ACCESS|sk-ant-oat01-native-fixture/);
  }
  async createSession(options) {
    starts++;
    await settings.harness.doStart({ ...options, sandboxSession: network });
    return { async stop() { stopped++; }, async detach() { detached++; return {
      type: "resume-session", harnessId: runtime, specificationVersion: "harness-v1", data: { threadId: "planning-history" },
    }; } };
  }
  async stream({ prompt }) {
    assert.match(prompt, /Clarify the acceptance criteria/);
    return { fullStream: (async function* () {
      yield { type: "text-delta", text: "First " };
      if (fail) throw new Error("Subscription limit reached.");
      yield { type: "text-delta", text: "reply." };
      if (question) {
        const receipt = { messageId: "confirmed-question", created: true, status: "awaiting_answer" };
        yield { type: "tool-result", toolName: runtime === "codex" ? "request_input" : "mcp__hive__request_input",
          output: runtime === "codex" ? { content: [{ type: "text", text: JSON.stringify(receipt) }] } : [{ type: "text", text: JSON.stringify(receipt) }] };
        yield { type: "text-start", id: "unnecessary-followup" };
        yield { type: "text-delta", text: '["Close after navigation"]' };
      }
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
  const result = await runHiveConversation(state, "person", "Person", text => publicText.push(text), undefined, auth, collaboration);
  assert.equal(result.summary, "First reply.");
  assert.equal(result.environment.vmId, "planning-vm");
  assert.equal(result.agentSession.resumeFrom.data.threadId, "planning-history");
  assert.deepEqual(publicText, ["First ", "First reply."]);
  assert.equal(settings.sandboxConfig.workDir, "planning");
  question = true;
  const questionText = [];
  const questionResult = await runHiveConversation(state, "person", "Person", text => questionText.push(text), undefined, auth, collaboration);
  assert.equal(questionResult.summary, "First reply.", "a published question must not be followed by invented answer text");
  assert.deepEqual(questionText, ["First ", "First reply."]);
  assert.equal(questionResult.agentSession.resumeFrom.data.threadId, "planning-history", "the native turn still completes and retains context");
  question = false;
  fail = true;
  await assert.rejects(runHiveConversation(state, "person", "Person", () => {}, undefined, auth, collaboration), /Subscription limit reached/);
  fail = false;
  const before = starts;
  if (runtime === "codex") await assert.rejects(runHiveConversation(state, "person"), /Reconnect the Codex subscription/);
  else {
    delete process.env.HIVE_CLAUDE_OAUTH_TOKEN;
    await assert.rejects(runHiveConversation(state, "person"), /Reconnect the Claude subscription/);
  }
  assert.equal(starts, before, "Missing credentials cannot create a sandbox or select Gateway");
}
assert.equal(starts, 6); assert.equal(stopped, 2); assert.equal(detached, 4);
console.log("PASS: planning streams the selected subscription, retains native context and its isolated warm VM on success, stops on failure, and never falls back to Gateway.");
