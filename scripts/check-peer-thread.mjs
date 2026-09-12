// Real thread controls and reducer, invented accounts; no provider/network calls.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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
const { createElement } = await import("react");
const { render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { MessageThread } = await import("../src/components/hive/message-thread.tsx");
const { createInitialTaskSessionState, memberDirectory, reduceTaskSession } = await import("../src/lib/task-session.ts");
const { requestPeerInput } = await import("../src/lib/peer-collaboration.ts");
const members = Object.values(memberDirectory);
const scope = { sessionId: "ui-peer", memberId: "spencer", runId: "run-one" };
let session = createInitialTaskSessionState(1, scope.sessionId);
session.stage = "running";
session.workspace.startedAt = 2;
session.workspace.liveReply = { id: "run-one", body: "", sequence: 0, startedAt: 2 };
const published = requestPeerInput(session, scope, { key: "draft", prompt: "Who can see drafts?", options: ["Team", "Author"] }, members, 3);
session = published.session;
let replies = 0;
let answers = 0;
const props = {
  sessionId: scope.sessionId, message: session.messages.at(-1), members, currentMember: "maya", disabled: false, runActive: true, queue: [],
  onClose() {}, onSteerReply() {}, onSteerThread: async () => true,
  onReply: async () => { replies++; return true; },
  onAnswerQuestion: async (messageId, submission) => { answers++; session = reduceTaskSession(session, { type: "answer-question", actor: "maya", messageId, ...submission }, 4, members); return true; },
};
try {
  const view = render(createElement(MessageThread, props));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).disabled, false));
  fireEvent.click(screen.getByRole("button", { name: "Author", exact: true }));
  assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).value, "Author");
  fireEvent.change(screen.getByRole("textbox", { name: "Answer Hive" }), { target: { value: "Author until shared" } });
  fireEvent.click(screen.getByRole("button", { name: "Send answer", exact: true }));
  await waitFor(() => assert.equal(answers, 1));
  assert.equal(replies, 0, "answer is not an ordinary discussion reply");
  view.rerender(createElement(MessageThread, { ...props, message: session.messages.at(-1), queue: session.steeringQueue }));
  assert.equal(screen.queryByRole("button", { name: "Send answer", exact: true }), null);
  assert.match(screen.getByLabelText("Message thread").textContent, /Answered by Maya/);
  const review = { ...props.message, id: "review-one", interaction: { kind: "review", runId: "run-one", revision: "run-one", options: [], status: "open" } };
  let verified;
  const reviewProps = { ...props, message: review, reviewCurrent: true, onViewChanges() {}, onResolveReview: async (_id, revision) => { verified = revision; return true; } };
  view.rerender(createElement(MessageThread, { ...reviewProps, reviewReady: false }));
  assert.ok(screen.getByRole("button", { name: "Verify & resolve", exact: true }).disabled);
  view.rerender(createElement(MessageThread, { ...reviewProps, reviewReady: true }));
  fireEvent.click(screen.getByRole("button", { name: "Verify & resolve", exact: true }));
  await waitFor(() => assert.equal(verified, "run-one"));
  console.log("PASS: choices, free text, answer-once acknowledgement and return to discussion in the real Thread.");
  console.log("PASS: review readiness gates verification and submits the displayed revision.");
} finally { cleanup(); dom.window.close(); }
