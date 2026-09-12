// Exercise the real Conversation and use-stick-to-bottom with a deterministic
// browser clock and layout measurements. No messages, APIs, or accounts are used.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://hive.example", pretendToBeVisual: true });
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let reducedMotion = false;
const mediaListeners = new Set();
window.matchMedia = () => ({ get matches() { return reducedMotion; }, addEventListener: (_event, listener) => mediaListeners.add(listener), removeEventListener: (_event, listener) => mediaListeners.delete(listener) });
let clock = 0;
let frameId = 0;
const frames = new Map();
globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
mock.method(performance, "now", () => clock);
mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
const observers = new Map();
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(element) { this.element = element; observers.set(element, this.callback); }
  disconnect() { observers.delete(this.element); }
};

registerHooks({
  resolve(specifier, context, next) {
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
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { Conversation, ConversationContent, ConversationScrollButton } = await import("../src/components/ai-elements/conversation.tsx");

async function frame() {
  await act(async () => {
    clock += 1000 / 60;
    mock.timers.tick(17);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(clock);
  });
}

function mountHistory() {
  const contextRef = { current: null };
  const view = render(h(Conversation, { contextRef }, h(ConversationContent, null, h("p", null, "Existing task history")), h(ConversationScrollButton)));
  const { scrollRef, contentRef } = contextRef.current;
  const scroll = scrollRef.current;
  let height = 20_000;
  let viewport = 500;
  let top = 0;
  scroll.style.overflow = "auto";
  Object.defineProperties(scroll, {
    clientHeight: { get: () => viewport },
    scrollHeight: { get: () => height },
    scrollTop: { get: () => top, set: (value) => { top = Math.max(0, Math.min(value, height - viewport)); } },
  });
  return {
    view, scroll,
    bottom: () => height - viewport - 1,
    resize(nextHeight, nextViewport = viewport) {
      height = nextHeight;
      viewport = nextViewport;
      act(() => observers.get(contentRef.current)([{ contentRect: { height } }]));
    },
  };
}

try {
  const chat = mountHistory();
  chat.resize(20_000);
  const positions = [];
  for (let index = 0; index < 6; index += 1) {
    await frame();
    positions.push(chat.scroll.scrollTop);
  }
  assert.equal(positions[0], chat.bottom(), `Opening saved history must start at the latest message, not animate down from the top: ${positions.join(" → ")}`);
  console.log("PASS: saved history is at the bottom on the first animation frame.");

  // CSS-hidden panes remain mounted, but their layout height becomes zero.
  chat.resize(0, 0);
  await frame();
  chat.resize(20_000, 500);
  await frame();
  assert.equal(chat.scroll.scrollTop, chat.bottom(), "Reopening the message pane must not replay a scroll from the top");
  console.log("PASS: hiding and reopening the message pane returns directly to the latest message.");
  for (let index = 0; index < 6; index += 1) await frame();

  const beforeMessage = chat.scroll.scrollTop;
  chat.resize(20_300);
  for (let index = 0; index < 6; index += 1) await frame();
  assert.ok(chat.scroll.scrollTop > beforeMessage && chat.scroll.scrollTop < chat.bottom(), "New messages must still follow smoothly instead of jumping");
  for (let index = 0; index < 120; index += 1) await frame();
  assert.ok(Math.abs(chat.scroll.scrollTop - chat.bottom()) <= 1);
  console.log("PASS: newly arriving content still follows smoothly to the bottom.");

  fireEvent.wheel(chat.scroll, { deltaY: -100 });
  chat.scroll.scrollTop = 1000;
  fireEvent.scroll(chat.scroll);
  await frame();
  chat.resize(20_600);
  for (let index = 0; index < 6; index += 1) await frame();
  assert.equal(chat.scroll.scrollTop, 1000, "New messages must not pull someone away from reading earlier history");
  const latest = chat.view.getByRole("button", { name: "Back to latest messages" });
  latest.focus();
  fireEvent.click(latest);
  for (let index = 0; index < 150; index += 1) await frame();
  assert.ok(Math.abs(chat.scroll.scrollTop - chat.bottom()) <= 1, "The explicit return-to-latest button must still work");
  assert.equal(document.activeElement, chat.scroll.firstElementChild, "focus stays in the reading surface after the button disappears");
  console.log("PASS: reading older history pauses follow; return-to-latest resumes it.");

  chat.view.unmount();
  const reopened = mountHistory();
  reopened.resize(20_000);
  await frame();
  assert.equal(reopened.scroll.scrollTop, reopened.bottom(), "A newly mounted task or thread must also start at the latest message");
  console.log("PASS: reopening a task or thread starts at the bottom without the opening animation.");
  for (let index = 0; index < 6; index += 1) await frame();
  await act(async () => { reducedMotion = true; for (const listener of mediaListeners) listener(); });
  reopened.resize(20_600);
  await frame();
  assert.equal(reopened.scroll.scrollTop, reopened.bottom(), "reduced motion updates follow position without spring animation");
  fireEvent.wheel(reopened.scroll, { deltaY: -100 });
  reopened.scroll.scrollTop = 1000;
  fireEvent.scroll(reopened.scroll);
  await frame();
  reopened.resize(21_000);
  await frame();
  assert.equal(reopened.scroll.scrollTop, 1000, "reduced motion must not override the reader's opt-out");
  fireEvent.click(reopened.view.getByRole("button", { name: "Back to latest messages" }));
  await frame();
  assert.equal(reopened.scroll.scrollTop, reopened.bottom(), "explicit return respects reduced motion too");
  console.log("PASS: live reduced-motion changes affect automatic and explicit scrolling without stealing reading position.");
} finally {
  cleanup();
  mock.restoreAll();
  mock.timers.reset();
  dom.window.close();
}
