// Mount the actual workspace, not a copied preview. Only Monaco's browser engine
// is represented by a text fixture here; browser QA covers the real editor.
import "./check-design-system.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/demo/tasks/demo-menu", pretendToBeVisual: true });
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event", "MouseEvent", "Node", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.DOMRect = window.DOMRect;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Demo attempted an HTTP request"); };
globalThis.WebSocket = class { constructor() { requests++; throw new Error("Demo mounted live transport"); } };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return next("next/link.js", context);
    if (specifier === "next/dynamic") return next("next/dynamic.js", context);
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return next(specifier, context);
    const base = specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}`, import.meta.url) : new URL(specifier, context.parentURL);
    const target = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((url) => existsSync(url));
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".module.css")) return { format: "module", shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => key });' };
    if (url.endsWith("/next/dynamic.js")) return { format: "module", shortCircuit: true, source: 'import { createElement } from "react"; export default () => function CodeFixture({ path, content }) { return createElement("pre", { "aria-label": `Sample file: ${path}` }, content); };' };
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});
const { createElement: h } = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, within } = await import("@testing-library/react");
const { DemoWorkspace } = await import("../src/app/demo/demo-workspace.tsx");
const { demoTasks } = await import("../src/lib/ui-demo.ts");
try {
  render(h(DemoWorkspace, { task: demoTasks[0] }));
  const button = (name) => screen.getByRole("button", { name, exact: true });
  assert.ok(screen.getByLabelText("Demo controls"));
  assert.ok(screen.getByLabelText("Resize conversation and workspace"));
  for (const name of ["Diff", "Files", "Runs", "Checkpoints"]) assert.ok(button(name));
  assert.ok(button("Invite teammate").disabled);
  assert.equal(screen.getByRole("link", { name: /Hive/ }).getAttribute("href"), "/demo");
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Files"));
  await waitFor(() => assert.match(screen.getByLabelText("Sample file: src/components/settings-nav.tsx").textContent, /SettingsNav/));
  fireEvent.click(button("Checkpoints"));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ })));
  fireEvent.click(screen.getByRole("button", { name: /^Restore checkpoint from/ }));
  assert.ok(screen.getByRole("dialog", { name: "Restore this checkpoint?" }));
  fireEvent.click(button("Cancel"));
  fireEvent.click(button("Conversation"));
  fireEvent.click(button("Open collaboration thread"));
  await waitFor(() => assert.ok(screen.getByRole("textbox", { name: "Answer Hive" })));
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Casey", exact: true }));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, false));
  assert.equal(screen.queryByRole("button", { name: "Send answer", exact: true }), null, "Casey cannot formally answer a question assigned to Alex");
  assert.equal(screen.queryByRole("button", { name: "Keep it open", exact: true }), null, "answer options are only shown to the addressee");
  fireEvent.change(screen.getByRole("textbox", { name: "Reply in thread" }), { target: { value: "Casey discussion, not Alex's answer" } });
  fireEvent.click(button("Send reply"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Casey discussion, not Alex's answer/));
  assert.match(screen.getByLabelText("Message thread").textContent, /Question for Alex/);
  assert.match(screen.getByLabelText("Message thread").textContent, /Needs answer/);
  assert.doesNotMatch(screen.getByLabelText("Message thread").textContent, /Answered by Casey|Simulated result/);
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Alex", exact: true }));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).disabled, false));
  console.log("PASS: Casey can discuss, but cannot answer Alex's question; switching back restores Alex's answer controls.");
  fireEvent.click(button("Keep it open"));
  fireEvent.click(button("Send answer"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Answered by Alex/));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Simulated result/), { timeout: 2500 });
  fireEvent.click(button("Close thread"));
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Casey", exact: true }));
  fireEvent.click(button("Open thread with 1 reply"));
  await waitFor(() => assert.ok(screen.getByLabelText("Message thread")));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, false));
  const input = screen.getByRole("textbox", { name: "Reply in thread" });
  fireEvent.change(input, { target: { value: "Please keep the focus ring visible" } });
  fireEvent.click(button("Send reply"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Please keep the focus ring visible/));
  fireEvent.click(button("Archive task: Polish the settings menu"));
  fireEvent.click(button("Archive task"));
  await waitFor(() => assert.ok(screen.getByText(/Read-only for everyone/)));
  assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, true);
  assert.ok(button("Send reply").disabled);
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Files"));
  await waitFor(() => assert.match(screen.getByLabelText("Sample file: src/components/settings-nav.tsx").textContent, /SettingsNav/));
  fireEvent.click(button("Checkpoints"));
  await waitFor(() => assert.ok(screen.getAllByRole("button", { name: /^Restore checkpoint from/ }).every((button) => button.disabled)));
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Alex", exact: true }));
  fireEvent.click(button("Restore task: Polish the settings menu"));
  fireEvent.click(button("Restore task"));
  await waitFor(() => assert.equal(screen.queryByText(/Read-only for everyone/), null));
  fireEvent.click(button("Conversation"));
  fireEvent.click(button("Open thread with 2 replies"));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, false));
  assert.match(screen.getByLabelText("Message thread").textContent, /Please keep the focus ring visible/);
  console.log("PASS: shared archive dialog locks discussion and checkpoint writes, preserves Files and replies, and another member restores without starting an agent.");
  assert.equal(requests, 0, "demo interactions never call HTTP or WebSocket");
  console.log("PASS: real workspace, files, checkpoint dialog, question continuation, teammate reply, and zero service calls.");
  cleanup();
  const { createDemoWorkspace } = await import("../src/lib/demo-workspace.ts");
  const { WorkspaceCheckpoints } = await import("../src/components/hive/workspace-checkpoints.tsx");
  const { HiveClientContext } = await import("../src/components/hive/hive-client.tsx");
  const remote = createDemoWorkspace(demoTasks[0]);
  const checkpoints = () => h(HiveClientContext, { value: remote.client }, h(WorkspaceCheckpoints, { sessionId: remote.getSnapshot().session.sessionId, revision: remote.getSnapshot().session.version, onRestored: remote.receiveSnapshot }));
  const mounted = render(checkpoints());
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ })));
  fireEvent.click(screen.getByRole("button", { name: /^Restore checkpoint from/ }));
  assert.equal(button("Restore checkpoint").disabled, false);
  await remote.dispatch({ type: "archive-task" });
  mounted.rerender(checkpoints());
  await waitFor(() => assert.ok(button("Restore checkpoint").disabled));
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /archived/));
  assert.equal(requests, 0);
  console.log("PASS: a teammate archiving the task also disables an already-open checkpoint confirmation.");
} finally { cleanup(); dom.window.close(); }
