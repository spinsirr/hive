// Exercise the real dashboard and sample-task dialog without a database or account.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://hive.example/demo", pretendToBeVisual: true });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.self = dom.window;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.fetch = () => { throw new Error("Dashboard preview must not access a backend."); };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return next("next/link.js", context);
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    const target = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((url) => existsSync(url));
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});

const { createElement: h } = await import("react");
const { cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { DashboardDemo } = await import("../src/app/demo/dashboard-demo.tsx");
const { TaskDashboard } = await import("../src/components/hive/task-dashboard.tsx");
const { demoLoadedAt, demoTasks } = await import("../src/lib/ui-demo.ts");

render(h(DashboardDemo));
assert.ok(screen.getByRole("heading", { name: "Sample tasks" }));
assert.equal(screen.queryByRole("group", { name: "Task status" }), null);
assert.equal(within(screen.getByRole("region", { name: "Task list" })).getAllByRole("listitem").length, 4);
assert.equal(screen.getByRole("link", { name: "Open Hive" }).getAttribute("href"), "/");
const sample = screen.getByRole("button", { name: "Preview sample task: Work through the onboarding flow" });
assert.ok(within(sample).getByText("Preview"));
assert.equal(document.querySelector('a[href^="/sessions/"]'), null);
sample.focus();
fireEvent.click(sample);
const preview = await screen.findByRole("dialog");
assert.ok(within(preview).getByRole("heading", { name: "Work through the onboarding flow" }));
assert.equal(within(preview).getByRole("link", { name: "Open Hive" }).getAttribute("href"), "/");
assert.match(preview.textContent, /not a live task/);
fireEvent.click(within(preview).getByRole("button", { name: "Back to sample tasks" }));
await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
await waitFor(() => assert.equal(document.activeElement, sample));
cleanup();
console.log("PASS: sample rows clearly preview, open an honest dialog with a real-app link, and return keyboard focus without backend calls.");

render(h(TaskDashboard, {
  tasks: [{ ...demoTasks[0], id: "real-task" }],
  memberName: "Alex", memberInitials: "AL", loadedAt: demoLoadedAt,
  createAction: async () => { throw new Error("This check must not create a task."); },
}));
assert.ok(screen.getByRole("heading", { name: "Tasks" }));
assert.equal(screen.getByRole("link", { name: /Polish the settings menu/ }).getAttribute("href"), "/sessions/real-task");
assert.equal(screen.queryByText("Preview"), null);
assert.equal(screen.queryByRole("group", { name: "Task status" }), null);
cleanup();
render(h(TaskDashboard, {
  tasks: [], memberName: "Alex", memberInitials: "AL", loadedAt: demoLoadedAt,
  createAction: async () => { throw new Error("This check must not create a task."); },
}));
assert.ok(screen.getByText("Start your first shared task"));
assert.ok(screen.getByRole("button", { name: "New task" }));
assert.equal(screen.queryByRole("button", { name: /Completed|Active/ }), null);
cleanup();
dom.window.close();
console.log("PASS: the dashboard keeps real task links and an honest empty state without manual status filters.");
