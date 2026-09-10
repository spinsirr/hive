import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://hive.test", pretendToBeVisual: true });
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    const target = [".ts", ".tsx"].map((extension) => new URL(base.href + extension)).find(existsSync);
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});
const { createElement: h } = await import("react");
const { cleanup, fireEvent, render, screen, waitFor, act } = await import("@testing-library/react");
const { SubagentActivity } = await import("../src/components/hive/subagent-activity.tsx");
const task = { id: "dc064a02-7cff-4874-9f70-4a0f936958c3", runId: "run-one", kind: "research", task: "Inspect queue semantics", status: "running", startedAt: 1, result: "" };
const calls = [];
let resolveStop;
globalThis.fetch = (url, input) => { calls.push({ url, input }); return new Promise((resolve) => { resolveStop = resolve; }); };
try {
  const view = render(h(SubagentActivity, { sessionId: "shared-qa", tasks: [task], live: true }));
  assert.equal(calls.length, 0, "Rendering does not poll, start a model, or fetch a snapshot");
  assert.equal(document.querySelector("details").open, false);
  fireEvent.click(screen.getByRole("button", { name: "Stop research subagent" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/sessions/shared-qa/subagents");
  assert.deepEqual(JSON.parse(calls[0].input.body), { id: task.id, runId: task.runId });
  assert.equal(screen.getByRole("button", { name: "Stop research subagent" }).disabled, true);
  await act(async () => resolveStop(Response.json({ task: { ...task, status: "stopping" } })));
  assert.equal(screen.queryByText("Stopped"), null, "ACK cannot fabricate a terminal status");
  view.rerender(h(SubagentActivity, { sessionId: "shared-qa", tasks: [{ ...task, status: "stopping" }], live: true }));
  assert.equal(screen.getByRole("button", { name: "Stop research subagent" }).disabled, true);
  view.rerender(h(SubagentActivity, { sessionId: "shared-qa", tasks: [{ ...task, status: "stopped" }], live: true }));
  assert.ok(screen.getByText("Stopped"));
  assert.equal(screen.queryByRole("button", { name: "Stop research subagent" }), null);
  cleanup();
  const completed = render(h(SubagentActivity, { sessionId: "shared-qa", tasks: [{ ...task, status: "completed", result: "**Finding:** check src/queue.ts:12" }] }));
  assert.ok(screen.getByText("Completed"));
  assert.ok(completed.container.textContent.includes("src/queue.ts:12"));
  assert.equal(screen.queryByRole("button", { name: "Stop research subagent" }), null);
  cleanup();
  render(h(SubagentActivity, { sessionId: "shared-qa", tasks: [task], live: true }));
  fireEvent.click(screen.getByRole("button", { name: "Stop research subagent" }));
  await act(async () => resolveStop(Response.json({ error: "denied" }, { status: 409 })));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /could not be confirmed/));
  assert.equal(screen.queryByText("Stopped"), null);
  console.log("PASS: real React subagent rows render without polling, send an exact run-scoped Stop, wait for actual completion, show results, and surface one quiet failure.");
} finally { cleanup(); dom.window.close(); }
