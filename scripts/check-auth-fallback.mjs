import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { runCodexAppServerTurn } from "../src/lib/codex-bridge/app-server.mjs";
import { codexProcessEnvironment, subscriptionLimited } from "../src/lib/codex-bridge/auth.mjs";

test("subscription process excludes Gateway/API credentials without changing the fallback's environment", () => {
  const env = { PATH: "/bin", CODEX_HOME: "/fixture", CODEX_API_KEY: "secret", AI_GATEWAY_BASE_URL: "https://fixture.invalid" };
  assert.deepEqual(codexProcessEnvironment(true, env), { PATH: "/bin", CODEX_HOME: "/fixture" });
  assert.equal(codexProcessEnvironment(false, env), env);
  assert.equal(subscriptionLimited({}), false);
  assert.equal(subscriptionLimited({ rateLimits: { primary: { usedPercent: 100, resetsAt: Date.now() / 1000 + 60 } } }), true);
  assert.equal(subscriptionLimited({ rateLimitsByLimitId: { other: { primary: { usedPercent: 100 } } } }), false);
});

for (const scenario of ["success", "auth-down", "malformed", "quota", "rate-check-failed", "login-rejected", "empty-rejected", "dirty-tail", "bad-close", "after-command", "after-text", "ambiguous", "revoked"]) {
  test(`native auth boundary: ${scenario}`, async () => {
    const previousFetch = globalThis.fetch;
    const oldBase = process.env.AI_GATEWAY_BASE_URL;
    const oldKey = process.env.CODEX_API_KEY;
    process.env.AI_GATEWAY_BASE_URL = "https://gateway.fixture.invalid/v1";
    process.env.CODEX_API_KEY = "GATEWAY_FIXTURE";
    const launches = [], calls = [], events = [], diagnostics = [];
    let fixtureError;
    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).pathname, "/api/sessions/fixture/codex-auth");
      if (scenario === "malformed") return new Response("unavailable", { status: 200 });
      return Response.json(scenario === "auth-down" ? { reason: "subscription_unavailable" } : { accessToken: "ACCESS_FIXTURE", chatgptAccountId: "ACCOUNT_FIXTURE" }, { status: scenario === "auth-down" ? 503 : scenario === "revoked" ? 403 : 200 });
    };
    function launch(_cwd, subscription) {
      launches.push(subscription);
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      let threadId = "existing-thread";
      const respond = (message) => child.stdout.write(JSON.stringify(message) + "\n");
      const event = (method, params) => respond({ method, params: { threadId, turnId: "attempt-turn", ...params } });
      child.stdin = new Writable({ write(chunk, _encoding, callback) {
        const r = JSON.parse(chunk.toString()); calls.push({ ...r, subscription });
        try {
          if (r.method === "initialize") {
            assert.equal(Boolean(r.params.capabilities?.experimentalApi), subscription);
            respond({ id: r.id, result: {} });
          }
          if (r.method === "account/login/start") {
            assert.equal(subscription, true); assert.equal(r.params.accessToken, "ACCESS_FIXTURE");
            respond(scenario === "login-rejected" ? { id: r.id, error: { code: -1, message: "secret must not be logged" } } : { id: r.id, result: { type: "chatgptAuthTokens" } });
          }
          if (r.method === "account/rateLimits/read") respond(scenario === "rate-check-failed" ? { id: r.id, error: { message: "Rate metadata unavailable" } } : { id: r.id, result: { rateLimits: { primary: { usedPercent: scenario === "quota" ? 100 : 2, resetsAt: Date.now() / 1000 + 60 } } } });
          if (r.method === "skills/extraRoots/set") respond({ id: r.id, result: {} });
          if (r.method === "thread/resume") {
            threadId = r.params.threadId;
            assert.equal(r.params.model, subscription ? "gpt-5.6-luna" : "openai/gpt-5.1-codex-mini");
            assert.equal(r.params.config.model_provider, subscription ? "openai" : "agent_bridge_openai");
            respond({ id: r.id, result: { thread: { id: threadId } } });
          }
          if (r.method === "turn/start") {
            respond({ id: r.id, result: { turn: { id: "attempt-turn" } } });
            if (subscription && scenario === "after-command") event("item/started", { item: { id: "cmd", type: "commandExecution", command: "change-code" } });
            if (subscription && scenario === "after-text") event("item/agentMessage/delta", { itemId: "text", delta: "Started" });
            const failed = subscription && ["empty-rejected", "dirty-tail", "bad-close", "after-command", "after-text", "ambiguous"].includes(scenario);
            if (!failed) event("item/completed", { item: { id: "text", type: "agentMessage", text: "Done." } });
            event("turn/completed", { turn: { id: "attempt-turn", status: failed ? "failed" : "completed", error: failed ? { message: "fixture rejection", codexErrorInfo: scenario === "ambiguous" ? "other" : "usageLimitExceeded" } : null } });
          }
          if (r.method === "thread/read") respond({ id: r.id, result: { thread: { turns: [{ id: "attempt-turn", status: "failed", items: [{ type: scenario === "dirty-tail" ? "commandExecution" : "userMessage" }] }] } } });
          if (r.method === "thread/fork") {
            assert.equal(r.params.beforeTurnId, "attempt-turn"); assert.equal(r.params.deferGoalContinuation, true);
            respond({ id: r.id, result: { thread: { id: "safe-continuation" } } });
          }
        } catch (error) { fixtureError = error; child.stdout.destroy(error); }
        callback();
      }, final(callback) { child.stdout.end(); child.stderr.end(); child.emit("close", scenario === "bad-close" ? 1 : 0, null); callback(); } });
      return child;
    }
    try {
      let error;
      try {
        await runCodexAppServerTurn({ start: { model: "gpt-5.6-luna", prompt: "One request", mcpServers: { hive: { url: "https://hive.fixture/api/sessions/fixture/agent-tools", http_headers: { Authorization: "Bearer CAPABILITY_FIXTURE", "X-Hive-Auth": "prefer-chatgpt", "X-Hive-Gateway-Model": "openai/gpt-5.1-codex-mini" } } } },
          workdir: "/fixture", threadId: "existing-thread", onThread() {}, launch,
          turn: { abortSignal: AbortSignal.timeout(5000), emit: (e) => events.push(e), bridgeLog: (e) => diagnostics.push(e) },
        });
      } catch (e) { error = e; }
      if (fixtureError) throw fixtureError;
      const shouldFail = ["dirty-tail", "bad-close", "after-command", "after-text", "ambiguous", "revoked"].includes(scenario);
      assert.equal(Boolean(error), shouldFail, error?.stack);
      assert.deepEqual(launches, scenario === "revoked" ? [] : ["auth-down", "malformed"].includes(scenario) ? [false] : shouldFail || ["success", "rate-check-failed"].includes(scenario) ? [true] : [true, false]);
      assert.equal(events.filter((e) => e.type === "stream-start").length, 1);
      assert.equal(calls.some((c) => c.method === "thread/rollback"), false);
      assert.equal(calls.filter((c) => c.method === "thread/fork").length, ["empty-rejected", "bad-close"].includes(scenario) ? 1 : 0);
      if (scenario === "rate-check-failed") assert.ok(calls.some(c => c.method === "skills/extraRoots/set"));
      if (scenario === "empty-rejected") assert.equal(calls.find((c) => c.method === "thread/resume" && !c.subscription).params.threadId, "safe-continuation");
      assert.doesNotMatch(JSON.stringify([events, diagnostics]), /ACCESS_FIXTURE|ACCOUNT_FIXTURE|CAPABILITY_FIXTURE/);
    } finally {
      globalThis.fetch = previousFetch;
      if (oldBase === undefined) delete process.env.AI_GATEWAY_BASE_URL; else process.env.AI_GATEWAY_BASE_URL = oldBase;
      if (oldKey === undefined) delete process.env.CODEX_API_KEY; else process.env.CODEX_API_KEY = oldKey;
    }
  });
}
