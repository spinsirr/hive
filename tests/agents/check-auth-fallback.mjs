import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { runCodexAppServerTurn } from "../../src/server/agents/codex/bridge/app-server.mjs";
import {
  codexProcessEnvironment,
  subscriptionLimited,
  portableNativeHistory,
  isEncryptedHistoryRejection,
} from "../../src/server/agents/codex/bridge/auth.mjs";

test("subscription process excludes Gateway/API credentials; API-only installations remain explicit", () => {
  const env = {
    PATH: "/bin",
    CODEX_HOME: "/fixture",
    CODEX_API_KEY: "secret",
    AI_GATEWAY_BASE_URL: "https://fixture.invalid",
  };
  assert.deepEqual(codexProcessEnvironment(true, env), {
    PATH: "/bin",
    CODEX_HOME: "/fixture",
  });
  assert.equal(codexProcessEnvironment(false, env), env);
  assert.equal(subscriptionLimited({}), false);
  assert.equal(
    subscriptionLimited({
      rateLimits: {
        primary: { usedPercent: 100, resetsAt: Date.now() / 1000 + 60 },
      },
    }),
    true
  );
  assert.equal(
    subscriptionLimited({
      rateLimitsByLimitId: { other: { primary: { usedPercent: 100 } } },
    }),
    false
  );
});

test("portable history rejects unknown, partial, oversized or opaque native history", () => {
  const rejected = {
    id: "rejected",
    status: "failed",
    items: [{ type: "userMessage" }],
  };
  const prior = {
    id: "prior",
    status: "completed",
    items: [{ type: "agentMessage", text: "Prior reply" }],
  };
  for (const turns of [
    undefined,
    {},
    [],
    [prior],
    [{ ...rejected, itemsView: "notLoaded" }],
    [{ ...prior, status: "inProgress" }, rejected],
    [{ ...prior, itemsView: "notLoaded" }, rejected],
    [{ ...rejected, items: [{ type: "commandExecution" }] }],
    [
      {
        ...prior,
        items: [{ type: "agentMessage", encrypted_content: "OPAQUE" }],
      },
      rejected,
    ],
    [
      {
        ...prior,
        items: [{ type: "agentMessage", text: "x".repeat(250_000) }],
      },
      rejected,
    ],
  ])
    assert.throws(() => portableNativeHistory({ turns }, "rejected"));
  assert.match(
    portableNativeHistory({ turns: [prior, rejected] }, "rejected"),
    /Prior reply/
  );
  assert.equal(
    isEncryptedHistoryRejection({ message: "Unknown network failure" }),
    false
  );
  assert.equal(
    isEncryptedHistoryRejection({
      message: JSON.stringify({ error: { code: "other" } }),
    }),
    false
  );
});

for (const scenario of [
  "success",
  "background-refresh",
  "inference-refresh",
  "auth-down",
  "malformed",
  "quota",
  "rate-check-failed",
  "login-rejected",
  "empty-rejected",
  "dirty-tail",
  "bad-close",
  "after-command",
  "after-text",
  "ambiguous",
  "revoked",
  "encrypted-history",
  "encrypted-gateway",
  "encrypted-quota",
  "encrypted-after-command",
  "encrypted-after-text",
  "encrypted-dirty-tail",
  "encrypted-bad-close",
]) {
  test(`native auth boundary: ${scenario}`, async () => {
    const encrypted = scenario.startsWith("encrypted-");
    const previousFetch = globalThis.fetch;
    const oldBase = process.env.AI_GATEWAY_BASE_URL;
    const oldKey = process.env.CODEX_API_KEY;
    process.env.AI_GATEWAY_BASE_URL = "https://gateway.fixture.invalid/v1";
    process.env.CODEX_API_KEY = "GATEWAY_FIXTURE";
    const launches = [],
      calls = [],
      events = [],
      diagnostics = [];
    let fixtureError;
    globalThis.fetch = async () => {
      throw new Error(
        "Native subscription must never fetch credentials or use Gateway."
      );
    };
    function launch(_cwd, subscription) {
      launches.push(subscription);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let threadId = "existing-thread";
      const respond = (message) =>
        child.stdout.write(JSON.stringify(message) + "\n");
      const event = (method, params) =>
        respond({
          method,
          params: { threadId, turnId: "attempt-turn", ...params },
        });
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          const r = JSON.parse(chunk.toString());
          calls.push({ ...r, subscription });
          try {
            if (r.method === "initialize") {
              assert.equal(
                Boolean(r.params.capabilities?.experimentalApi),
                subscription
              );
              respond({ id: r.id, result: {} });
            }
            if (r.method === "account/login/start") {
              assert.equal(subscription, true);
              assert.equal(r.params.accessToken, "ACCESS_FIXTURE");
              respond(
                scenario === "login-rejected"
                  ? {
                      id: r.id,
                      error: { code: -1, message: "secret must not be logged" },
                    }
                  : { id: r.id, result: { type: "chatgptAuthTokens" } }
              );
            }
            if (r.method === "account/rateLimits/read")
              respond(
                scenario === "rate-check-failed"
                  ? {
                      id: r.id,
                      error: { message: "Rate metadata unavailable" },
                    }
                  : {
                      id: r.id,
                      result: {
                        rateLimits: {
                          primary: {
                            usedPercent: scenario === "quota" ? 100 : 2,
                            resetsAt: Date.now() / 1000 + 60,
                          },
                        },
                      },
                    }
              );
            if (r.method === "skills/extraRoots/set")
              respond({ id: r.id, result: {} });
            if (r.method === "thread/resume" || r.method === "thread/start") {
              threadId = r.params.threadId ?? "portable-thread";
              assert.equal(
                r.params.model,
                subscription ? "gpt-5.6-luna" : "openai/gpt-5.1-codex-mini"
              );
              assert.equal(
                r.params.config.model_provider,
                subscription ? "hive_chatgpt" : "agent_bridge_openai"
              );
              if (subscription) {
                const provider = r.params.config.model_providers.hive_chatgpt;
                assert.equal(
                  provider.base_url,
                  "https://chatgpt.com/backend-api/codex"
                );
                assert.equal(
                  provider.requires_openai_auth,
                  true,
                  "Preserve native subscription authentication"
                );
                assert.equal(
                  provider.supports_websockets,
                  false,
                  "Brokered credentials require HTTP streaming"
                );
                assert.equal(
                  provider.env_key,
                  undefined,
                  "Never change subscription auth to API-key billing"
                );
              }
              respond({ id: r.id, result: { thread: { id: threadId } } });
            }
            if (r.method === "turn/start") {
              assert.equal(r.params.effort, subscription ? "max" : "high");
              respond({ id: r.id, result: { turn: { id: "attempt-turn" } } });
              if (
                ["background-refresh", "inference-refresh"].includes(scenario)
              ) {
                respond({
                  id: "native-refresh",
                  method: "account/chatgptAuthTokens/refresh",
                  params: {
                    reason: "unauthorized",
                    previousAccountId: "ACCOUNT_FIXTURE",
                  },
                });
                callback();
                return;
              }
              if (encrypted && threadId === "existing-thread") {
                if (scenario === "encrypted-after-command")
                  event("item/started", {
                    item: {
                      id: "cmd",
                      type: "commandExecution",
                      command: "change-code",
                    },
                  });
                if (scenario === "encrypted-after-text")
                  event("item/agentMessage/delta", {
                    itemId: "text",
                    delta: "Started",
                  });
                event("turn/completed", {
                  turn: {
                    id: "attempt-turn",
                    status: "failed",
                    error: {
                      message: JSON.stringify({
                        error: {
                          code: "invalid_encrypted_content",
                          message:
                            "Encrypted content could not be decrypted or parsed.",
                        },
                      }),
                      codexErrorInfo: "other",
                    },
                  },
                });
                callback();
                return;
              }
              if (encrypted) {
                const prompt = r.params.input[0].text;
                assert.match(prompt, /Already inspected package.json/);
                assert.match(prompt, /pnpm test/);
                assert.match(prompt, /One request/);
                assert.doesNotMatch(
                  prompt,
                  /PRIVATE_REASONING|FOREIGN_CIPHERTEXT/
                );
              }
              if (subscription && scenario === "after-command")
                event("item/started", {
                  item: {
                    id: "cmd",
                    type: "commandExecution",
                    command: "change-code",
                  },
                });
              if (subscription && scenario === "after-text")
                event("item/agentMessage/delta", {
                  itemId: "text",
                  delta: "Started",
                });
              const failed =
                subscription &&
                [
                  "empty-rejected",
                  "dirty-tail",
                  "bad-close",
                  "after-command",
                  "after-text",
                  "ambiguous",
                  "encrypted-quota",
                ].includes(scenario);
              if (!failed)
                event("item/completed", {
                  item: { id: "text", type: "agentMessage", text: "Done." },
                });
              event("turn/completed", {
                turn: {
                  id: "attempt-turn",
                  status: failed ? "failed" : "completed",
                  error: failed
                    ? {
                        message: "fixture rejection",
                        codexErrorInfo:
                          scenario === "ambiguous"
                            ? "other"
                            : "usageLimitExceeded",
                      }
                    : null,
                },
              });
            }
            if (r.id === "native-refresh") {
              assert.equal(
                r.error?.code,
                -32000,
                "Refuse refresh explicitly without returning credentials"
              );
              assert.equal(r.result, undefined);
              if (scenario === "background-refresh")
                event("item/completed", {
                  item: { id: "text", type: "agentMessage", text: "Done." },
                });
              event("turn/completed", {
                turn: {
                  id: "attempt-turn",
                  status:
                    scenario === "background-refresh" ? "completed" : "failed",
                  error:
                    scenario === "inference-refresh"
                      ? {
                          message: "fixture rejection",
                          codexErrorInfo: "unauthorized",
                        }
                      : null,
                },
              });
            }
            if (r.method === "thread/read")
              respond({
                id: r.id,
                result: {
                  thread: {
                    id: threadId,
                    turns: [
                      ...(encrypted
                        ? [
                            {
                              id: "previous-turn",
                              status: "completed",
                              items: [
                                {
                                  type: "agentMessage",
                                  text: "Already inspected package.json",
                                },
                                {
                                  type: "commandExecution",
                                  command: "pnpm test",
                                  aggregatedOutput: "all checks passed",
                                  exitCode: 0,
                                },
                                {
                                  type: "reasoning",
                                  summary: ["PRIVATE_REASONING"],
                                  encrypted_content: "FOREIGN_CIPHERTEXT",
                                },
                              ],
                            },
                          ]
                        : []),
                      {
                        id: "attempt-turn",
                        status: "failed",
                        items: [
                          {
                            type: [
                              "dirty-tail",
                              "encrypted-dirty-tail",
                            ].includes(scenario)
                              ? "commandExecution"
                              : "userMessage",
                          },
                        ],
                      },
                    ],
                  },
                },
              });
            if (r.method === "thread/fork") {
              assert.equal(r.params.beforeTurnId, "attempt-turn");
              assert.equal(r.params.deferGoalContinuation, true);
              respond({
                id: r.id,
                result: { thread: { id: "safe-continuation" } },
              });
            }
          } catch (error) {
            fixtureError = error;
            child.stdout.destroy(error);
          }
          callback();
        },
        final(callback) {
          child.stdout.end();
          child.stderr.end();
          child.emit(
            "close",
            ["bad-close", "encrypted-bad-close"].includes(scenario) ? 1 : 0,
            null
          );
          callback();
        },
      });
      return child;
    }
    try {
      let error;
      try {
        await runCodexAppServerTurn({
          start: {
            model:
              scenario === "encrypted-gateway"
                ? "openai/gpt-5.1-codex-mini"
                : "gpt-5.6-luna",
            reasoningEffort: scenario === "encrypted-gateway" ? "high" : "max",
            prompt: "One request",
            codexConfig:
              scenario === "encrypted-gateway"
                ? {}
                : {
                    hive_subscription_tokens: [
                      "auth-down",
                      "malformed",
                      "revoked",
                    ].includes(scenario)
                      ? null
                      : {
                          accessToken: "ACCESS_FIXTURE",
                          chatgptAccountId: "ACCOUNT_FIXTURE",
                        },
                  },
            mcpServers: {
              hive: {
                url: "https://hive.fixture/api/sessions/fixture/agent-tools",
                http_headers: { Authorization: "Bearer CAPABILITY_FIXTURE" },
              },
            },
          },
          workdir: "/fixture",
          threadId: "existing-thread",
          onThread() {},
          launch,
          turn: {
            abortSignal: AbortSignal.timeout(5000),
            emit: (e) => events.push(e),
            bridgeLog: (e) => diagnostics.push(e),
          },
        });
      } catch (e) {
        error = e;
      }
      if (fixtureError) throw fixtureError;
      const shouldFail = ![
        "success",
        "background-refresh",
        "rate-check-failed",
        "encrypted-history",
        "encrypted-gateway",
      ].includes(scenario);
      assert.equal(Boolean(error), shouldFail, error?.stack);
      assert.deepEqual(
        launches,
        ["auth-down", "malformed", "revoked"].includes(scenario)
          ? []
          : scenario === "encrypted-gateway"
            ? [false, false]
            : ["encrypted-history", "encrypted-quota"].includes(scenario)
              ? [true, true]
              : [true]
      );
      if (scenario !== "encrypted-gateway")
        assert.ok(
          launches.every(Boolean),
          "Never switch a subscription turn to paid Gateway"
        );
      if (encrypted && !shouldFail) {
        assert.equal(
          calls.filter((c) => c.method === "thread/start").length,
          1
        );
        assert.equal(
          calls.some(
            (c) => c.method === "thread/delete" || c.method === "thread/archive"
          ),
          false
        );
      }
      assert.equal(events.filter((e) => e.type === "stream-start").length, 1);
      assert.equal(
        calls.some((c) => c.method === "thread/rollback"),
        false
      );
      assert.equal(
        calls.filter((c) => c.method === "thread/fork").length,
        0,
        "No automatic fork/replay on quota errors"
      );
      if (scenario === "rate-check-failed")
        assert.ok(calls.some((c) => c.method === "skills/extraRoots/set"));
      if (["background-refresh", "inference-refresh"].includes(scenario)) {
        assert.equal(
          calls.filter((call) => call.id === "native-refresh").length,
          1
        );
        assert.equal(
          calls.filter((call) => call.method === "turn/start").length,
          1,
          "Never replay the requested turn"
        );
        assert.equal(
          events.filter((event) => event.type === "finish").length,
          shouldFail ? 0 : 1
        );
        if (shouldFail)
          assert.match(error.message, /Reconnect the Codex subscription/);
        else
          assert.equal(
            events
              .filter((event) => event.type === "text-delta")
              .map((event) => event.delta)
              .join(""),
            "Done."
          );
      }
      for (const call of calls.filter(
        (c) => c.method === "thread/start" || c.method === "thread/resume"
      ))
        assert.equal(call.params.config.hive_subscription_tokens, undefined);
      assert.doesNotMatch(
        JSON.stringify([events, diagnostics]),
        /ACCESS_FIXTURE|ACCOUNT_FIXTURE|CAPABILITY_FIXTURE/
      );
    } finally {
      globalThis.fetch = previousFetch;
      if (oldBase === undefined) delete process.env.AI_GATEWAY_BASE_URL;
      else process.env.AI_GATEWAY_BASE_URL = oldBase;
      if (oldKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = oldKey;
    }
  });
}
