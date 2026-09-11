// Exercise the local simulation and actual controls. No provider, task, or database.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { answerOptions, canAskHive, createDemoState, demoDiff, demoReducer as reduce, pendingComments, sampleFeedback } from "../src/app/demo/collaboration/demo-state.ts";

let state = createDemoState();
const answer = { type: "answer", author: "Casey", choice: "open", body: answerOptions[0].label };
assert.equal(reduce(state, { ...answer, body: "  " }), state);
assert.equal(reduce(state, { type: "resolve", author: "Alex", revision: 0 }), state);
state = reduce(state, { type: "advance" });
assert.equal(state.phase, "waiting");
assert.equal(reduce(state, { type: "advance" }), state, "Waiting cannot auto-approve or continue");
state = reduce(state, answer);
assert.equal(state.phase, "resumed", "Answer automatically continues without a steer action");
assert.equal(reduce(state, { ...answer, author: "Alex", choice: "close" }), state, "First accepted answer wins");
assert.match(demoDiff(state).map(line => line.text).join("\n"), /setSettingsOpen\(true\)/);
assert.match(demoDiff(reduce(createDemoState(), { ...answer, choice: "close" })).map(line => line.text).join("\n"), /setSettingsOpen\(false\)/);
assert.doesNotMatch(demoDiff(reduce(createDemoState(), { ...answer, choice: "custom" })).map(line => line.text).join("\n"), /setSettingsOpen/, "A custom answer must not pretend to generate code");
state = reduce(state, { type: "advance" });
assert.equal(state.revision, 1);
state = reduce(state, { type: "comment", author: "Casey", body: sampleFeedback });
assert.equal(state.phase, "review", "Discussion must not execute automatically");
assert.ok(canAskHive(state));
assert.equal(reduce(state, { type: "resolve", author: "Alex", revision: 1 }), state, "Unshared feedback cannot be silently resolved");
const firstComment = pendingComments(state)[0];
state = reduce(state, { type: "ask-hive", author: "Alex" });
assert.equal(state.phase, "revising");
assert.equal(state.sharedReplies[firstComment.id], "Alex");
assert.equal(firstComment.author, "Casey", "Sharing must preserve the original author");
assert.equal(reduce(state, { type: "ask-hive", author: "Alex" }), state, "Duplicate starts are ignored");
state = reduce(state, { type: "comment", author: "Alex", body: "Also inspect tab order." });
assert.equal(pendingComments(state).length, 1, "Late replies stay out of the captured run");
state = reduce(state, { type: "advance" });
assert.equal(state.revision, 2);
state = reduce(state, { type: "ask-hive", author: "Casey" });
assert.equal(state.sharedReplies[firstComment.id], "Alex", "A later sharer must not rewrite historical attribution");
state = reduce(state, { type: "advance" });
assert.equal(state.phase, "verify");
assert.equal(reduce(state, { type: "resolve", author: "Casey", revision: 1 }), state, "Stale review versions are rejected");
state = reduce(state, { type: "resolve", author: "Casey", revision: state.revision });
assert.equal(state.phase, "complete");
assert.equal(state.resolvedBy, "Casey");
assert.equal(reduce(state, { type: "comment", author: "Alex", body: "late" }), state);
assert.deepEqual(reduce(state, { type: "reset" }), createDemoState());
console.log("PASS: answer-once, nonblocking/waiting, explicit thread handoff, attribution, and version-bound human resolution.");

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/demo/collaboration", pretendToBeVisual: true });
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let requests = 0;
globalThis.fetch = async () => { requests += 1; throw new Error("This UI preview must not make fetch requests"); };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return next("next/link.js", context);
    let base;
    if (specifier.startsWith("@/")) base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    else if (specifier.startsWith("./") && context.parentURL?.includes("/demo/collaboration/")) base = new URL(specifier, context.parentURL);
    if (!base) return next(specifier, context);
    const target = [".ts", ".tsx"].map(extension => new URL(`${base.href}${extension}`)).find(url => existsSync(url));
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});
const { createElement } = await import("react");
const { render, screen, fireEvent, cleanup, within } = await import("@testing-library/react");
const { CollaborationDemo } = await import("../src/app/demo/collaboration/collaboration-demo.tsx");
try {
  render(createElement(CollaborationDemo));
  const button = name => screen.getByRole("button", { name, exact: true });
  const status = () => screen.getByRole("status").textContent;
  assert.match(status(), /Working · question open/);
  fireEvent.click(button("Finish independent work"));
  assert.match(status(), /Waiting for an answer/);
  fireEvent.click(button("Answer as Casey"));
  assert.match(status(), /Answer received · continuing/);
  assert.equal(screen.queryByRole("button", { name: "Answer as Casey" }), null);
  fireEvent.click(button("Prepare sample review"));
  assert.match(status(), /Review requested/);
  assert.match(screen.getByLabelText("Sample code diff").textContent, /setSettingsOpen\(true\)/);
  fireEvent.click(button("Try a keyboard-focus review comment"));
  assert.equal(screen.getByLabelText("Reply to thread as Casey").value, sampleFeedback);
  fireEvent.click(button("Send thread reply as Casey"));
  assert.match(status(), /Review requested/);
  assert.ok(button("Verify & resolve as Casey").disabled);
  fireEvent.click(button("Alex"));
  fireEvent.click(button("Ask Hive about this thread"));
  assert.match(status(), /Working from thread feedback/);
  const thread = screen.getByLabelText("Thread replies");
  const comment = within(thread).getByText(sampleFeedback).closest("article");
  assert.match(comment.textContent, /CaseyShared by Alex/);
  assert.equal(screen.queryByRole("button", { name: "Ask Hive about this thread" }), null);
  fireEvent.click(button("Return sample revision"));
  assert.match(status(), /Ready for verification/);
  assert.match(screen.getByLabelText("Sample code diff").textContent, /focus-visible:ring-2/);
  fireEvent.click(button("Casey"));
  fireEvent.click(button("Verify & resolve as Casey"));
  assert.match(status(), /Review resolved/);
  assert.ok(screen.getByLabelText("Reply to thread as Casey").disabled);
  fireEvent.click(button("Reset collaboration demo"));
  assert.match(status(), /Working · question open/);
  assert.equal(screen.queryByLabelText("Thread replies"), null);
  fireEvent.click(screen.getByRole("radio", { name: "Something else" }));
  assert.ok(button("Answer as Casey").disabled);
  fireEvent.change(screen.getByLabelText("Your navigation direction"), { target: { value: "Keep it open only on desktop. <script>hello</script>" } });
  fireEvent.click(button("Answer as Casey"));
  fireEvent.click(button("Prepare sample review"));
  assert.match(screen.getByLabelText("Sample code diff").textContent, /Custom direction captured/);
  assert.equal(document.querySelectorAll("script").length, 0, "Free text is rendered as text, not HTML");
  assert.equal(requests, 0);
  console.log("PASS: rendered two-person flow, custom answers, review controls, reset, escaped text, and zero service requests.");
} finally {
  cleanup();
  dom.window.close();
}
