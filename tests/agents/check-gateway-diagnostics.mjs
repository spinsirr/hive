// Exercise the production harness wrapper's diagnostic boundary without a sandbox.
import assert from "node:assert/strict";
import { mock } from "node:test";

let started;
await mock.module("@ai-sdk/harness-codex", {
  namedExports: {
    createCodex(settings) {
      return {
        async doStart(options) {
          started = { settings, options };
          return { fixture: true };
        },
        async getBootstrap() {
          return {
            bootstrapDir: ".harness-bootstrap/codex",
            files: [
              {
                path: ".harness-bootstrap/codex/bridge.mjs",
                content: "old bridge",
              },
            ],
            commands: [{ command: "pinned-recipe" }],
          };
        },
      };
    },
  },
});
const { createHiveCodex } =
  await import("../../src/server/agents/codex/codex-harness.ts");
const records = [];
const settings = {
  auth: { AI_GATEWAY_API_KEY: "controlled-fixture-key" },
  webSearch: false,
};
const harness = createHiveCodex(settings, (attributes) =>
  records.push(attributes)
);
await harness.doStart({
  sessionId: "fixture-session",
  observability: {
    report: () => assert.fail("Do not enable the raw framework debug sink"),
  },
});
assert.equal(
  started.settings,
  settings,
  "Do not replace auth or model settings"
);
assert.equal(started.options.sessionId, "fixture-session");
const { debug, report } = started.options.observability;
assert.deepEqual(debug, {
  enabled: true,
  level: "info",
  subsystems: ["hive.gateway", "hive.subagent", "hive.auth"],
});
report({
  kind: "log",
  subsystem: "sandbox.log.stdout",
  message: "private console text",
});
report({ kind: "log", subsystem: "hive.gateway", message: "still raw text" });
report({
  kind: "event",
  subsystem: "other.provider",
  attrs: { input: "private prompt" },
});
const attrs = {
  statusCode: 429,
  requestId: "req-fixture",
  retryAfterMs: 1000,
  outcome: "retrying",
};
report({ kind: "event", subsystem: "hive.gateway", attrs });
assert.deepEqual(records, [attrs]);
const recipe = await harness.getBootstrap();
for (const name of [
  "runtime.mjs",
  "bridge.mjs",
  "app-server.mjs",
  "auth.mjs",
  "subagents.mjs",
  "gateway-transport.mjs",
  "hive-collaboration/SKILL.md",
]) {
  const assets = recipe.files.filter(
    (file) => file.path === `.harness-bootstrap/codex/${name}`
  );
  assert.equal(assets.length, 1, `Ship exactly one ${name}`);
  assert.ok(assets[0].content.length > 100);
}
assert.deepEqual(recipe.commands, [{ command: "pinned-recipe" }]);
console.log(
  "PASS: Gateway diagnostics exclude raw sandbox logs; auth and pinned bootstrap are preserved; the private transport ships with the bridge."
);
