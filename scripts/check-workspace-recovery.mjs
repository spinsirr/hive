// Purpose: confirm completed recovery promptly, keep confirming after a lost
// status response, and never turn a status check into a second restore.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://hive.test",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? dom.window : dom.window[name],
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    return next(
      [".ts", ".tsx"]
        .map((ext) => new URL(`${base.href}${ext}`))
        .find(existsSync).href,
      context
    );
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext },
      }).outputText,
    };
  },
});
const { createElement: h } = await import("react");
const { act, renderHook, cleanup } = await import("@testing-library/react");
const { HiveClientContext } =
  await import("../src/components/hive/hive-client.tsx");
const { useWorkspaceRecovery } =
  await import("../src/hooks/use-workspace-recovery.ts");
mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
const requests = [],
  received = [];
let next = "pending";
const client = {
  reload() {},
  async request(_path, init) {
    requests.push(JSON.parse(init.body));
    if (next === "timeout")
      throw new DOMException("transport timeout", "TimeoutError");
    return next === "confirmed"
      ? Response.json({ confirmed: true })
      : Response.json({ pending: true }, { status: 202 });
  },
};
const restore = {
  id: "restore",
  snapshotId: "snap",
  startedAt: 1000,
  retryAfter: 91_000,
  status: "unconfirmed",
  by: { id: "owner" },
};
const wrapper = ({ children }) =>
  h(HiveClientContext, { value: client }, children);
const tick = async (ms) =>
  act(async () => {
    mock.timers.tick(ms);
  });
try {
  const view = renderHook(
    ({ revision, pending }) =>
      useWorkspaceRecovery("task", revision, pending, (value) =>
        received.push(value)
      ),
    { wrapper, initialProps: { revision: 1, pending: restore } }
  );
  await tick(3000);
  assert.equal(
    requests.length,
    1,
    "read-only confirmation begins well before the 90-second write retry boundary"
  );
  assert.equal(requests[0].mode, "check");
  assert.match(view.result.current.notice, /Checking automatically/);
  view.rerender({ revision: 2, pending: { ...restore } });
  next = "timeout";
  await tick(10_000);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].version,
    2,
    "use the latest revision without restarting the recovery loop"
  );
  assert.match(view.result.current.notice, /Checking again automatically/);
  next = "confirmed";
  await tick(10_000);
  assert.equal(
    received.length,
    1,
    "a transient timeout does not strand the disabled composer"
  );
  assert.ok(Date.now() < restore.retryAfter);
  view.rerender({ revision: 3, pending: undefined });
  await tick(200_000);
  assert.equal(requests.length, 3, "confirmation stops all polling");
  assert.ok(requests.every((request) => request.mode === "check"));
  console.log(
    "PASS: recovery checks promptly, survives a transport timeout, uses the latest revision, confirms once, and stops without retrying writes."
  );
} finally {
  cleanup();
  mock.timers.reset();
  dom.window.close();
}
