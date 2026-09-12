// Real UI controls and state reducer; only browser services are doubled. No accounts/model calls.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://hive.test", pretendToBeVisual: true });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => { throw new Error("Unexpected network request in the message UI fixture"); };
let copied;
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(body) { copied = body; } } });
registerHooks({ resolve(specifier, context, next) {
  if (["next/link", "next/image"].includes(specifier)) return next(`${specifier}.js`, context);
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
  const target = [".ts", ".tsx"].map(extension => new URL(`${base.href}${extension}`)).find(url => existsSync(url));
  return next(target?.href ?? specifier, context);
}, load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", shortCircuit: true, source: "export default {};" };
  if (!url.endsWith(".tsx")) return next(url, context);
  return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
const { createElement: h } = await import("react");
const { act, render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { ConversationMessage } = await import("../src/components/hive/conversation-message.tsx");
const { MessageEditComposer } = await import("../src/components/hive/message-edit-composer.tsx");
const { SteeringQueue } = await import("../src/components/hive/steering-queue.tsx");
const { createInitialTaskSessionState, reduceTaskSession } = await import("../src/lib/task-session.ts");
const members = [{ id: "alex", name: "Alex", shortName: "Alex", initials: "AL" }, { id: "casey", name: "Casey", shortName: "Casey", initials: "CA" }];
let session = reduceTaskSession(createInitialTaskSessionState(1), { type: "send-message", actor: "alex", body: "Original request" }, 2, members);
session = reduceTaskSession(session, { type: "send-message", actor: "alex", body: "Queued request" }, 3, members);
const message = session.messages.at(-1), queuedSteerId = session.steeringQueue[0].id;
let editing, opened, cancelled = 0;
const props = { message, members, currentMember: "alex", sessionId: "ui-fixture", disabled: false, runActive: true, queueing: true, selected: false, onOpenThread: id => { opened = id; }, onSteerReply() {}, onEdit: value => { editing = value; } };
try {
  const view = render(h(ConversationMessage, props));
  fireEvent.click(screen.getByRole("button", { name: "Message actions for Alex" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit message" }));
  assert.equal(editing.id, message.id);
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(screen.getByRole("button", { name: "Message actions for Alex" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy message" }));
  await waitFor(() => assert.equal(copied, "Queued request"));
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(screen.getByRole("button", { name: "Message actions for Alex" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Open thread" }));
  assert.equal(opened, message.id);
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  view.rerender(h(ConversationMessage, { ...props, currentMember: "casey" }));
  fireEvent.click(screen.getByRole("button", { name: "Message actions for Alex" }));
  await screen.findByRole("menu");
  assert.equal(screen.queryByRole("menuitem", { name: "Edit message" }), null);
  cleanup();
  console.log("PASS: own-message edit, copy and Thread actions work; teammates do not receive an edit control.");

  let fail = true, submissions = 0;
  const editor = render(h(MessageEditComposer, { message, queuedSteerId, disabled: false, onCancel() { cancelled++; }, async onSave(change) {
    submissions++;
    if (fail) throw new Error("This message was edited elsewhere.");
    session = reduceTaskSession(session, { type: "edit-message", actor: "alex", ...change }, 4, members);
  } }));
  const text = screen.getByRole("textbox", { name: "Message text" });
  assert.equal(text, document.activeElement);
  fireEvent.change(text, { target: { value: "排队的修订\nKeep keyboard focus" } });
  fireEvent.keyDown(text, { key: "Enter", keyCode: 229, ctrlKey: true, isComposing: true });
  fireEvent.keyDown(text, { key: "Enter" });
  assert.equal(submissions, 0, "IME confirmation and ordinary new lines must not save");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  assert.equal(text.value, "排队的修订\nKeep keyboard focus");
  assert.equal(cancelled, 0);
  fail = false;
  fireEvent.keyDown(text, { key: "Enter", ctrlKey: true });
  await waitFor(() => assert.equal(cancelled, 1));
  assert.equal(session.messages.at(-1).body, "排队的修订\nKeep keyboard focus");
  assert.equal(session.steeringQueue[0].body, "排队的修订\nKeep keyboard focus");
  assert.equal(session.messages.at(-1).edits[0].body, "Queued request");
  editor.unmount();
  const history = render(h(ConversationMessage, { ...props, message: session.messages.at(-1) }));
  fireEvent.click(screen.getByRole("button", { name: "Edited" }));
  assert.ok(screen.getByRole("region", { name: "Edit history for Alex's message" }));
  assert.ok(screen.getByText("Queued request"));
  fireEvent.click(screen.getByRole("button", { name: "Hide history" }));
  assert.equal(screen.queryByRole("region", { name: "Edit history for Alex's message" }), null);
  history.unmount();
  console.log("PASS: failed saves retain CJK/multiline drafts; explicit save updates the queue and exposes edit history.");

  let removed, applied = 0;
  render(h(SteeringQueue, { items: session.steeringQueue, messages: session.messages, members, currentMember: "alex", disabled: false, canApply: false, onApply() { applied++; }, onMove() {}, onRemove(id) { removed = id; }, onEdit(value) { editing = value; }, onOpenThread(id) { opened = id; } }));
  assert.equal(screen.getByRole("button", { name: "After current run" }).disabled, true);
  fireEvent.click(screen.getByRole("button", { name: "Actions for queued steer 1" }));
  assert.equal((await screen.findByRole("menuitem", { name: "Move up" })).getAttribute("aria-disabled"), "true");
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
  assert.equal(editing.body, "排队的修订\nKeep keyboard focus");
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(screen.getByRole("button", { name: "Actions for queued steer 1" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from queue" }));
  assert.equal(removed, queuedSteerId);
  assert.equal(applied, 0);
  cleanup();
  console.log("PASS: compact queue actions edit/remove the selected item and cannot interrupt a running agent.");
} finally { await act(async () => cleanup()); dom.window.close(); }
