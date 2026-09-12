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
const { ConversationMessage } = await import("../src/components/hive/conversation-message.tsx");
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
  onClose() {}, onSteerThread: async () => true,
  onReply: async () => { replies++; return true; },
  onAnswerQuestion: async (messageId, submission, replyThreadId) => { answers++; session = reduceTaskSession(session, { type: "answer-question", actor: "maya", messageId, replyThreadId, ...submission }, 4, members); return true; },
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
  assert.equal(session.steeringQueue[0].source.replyThreadId, props.message.id, "answering inside a manually opened Thread returns here");
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
  cleanup();
  let destination = "unset";
  const answerProps = { message: props.message, currentMember: "maya", members, sessionId: "inline-question-ui", disabled: false, runActive: false, selected: false, onOpenThread() { throw new Error("answer must not open a Thread"); }, onAnswerQuestion: async (_id, _submission, threadId) => { destination = threadId; return true; } };
  render(createElement(ConversationMessage, answerProps));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).disabled, false));
  assert.equal(screen.queryByRole("button", { name: "Open collaboration thread" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Team", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Send answer", exact: true }));
  await waitFor(() => assert.equal(destination, undefined));
  assert.equal(screen.queryByLabelText("Message thread"), null, "inline answer does not navigate");
  cleanup();
  const threadRoot = { id: "root", name: "Maya", initials: "MC", body: "Discuss here", role: "human", time: "10:00", annotations: [{ id: "human-feedback", authorId: "maya", body: "Ask me a preference", createdAt: 1, status: "open" }, { id: "agent-ack", authorId: "hive-agent", role: "agent", body: "A question below", createdAt: 2, status: "open" }], threadSteer: { throughReplyId: "human-feedback", status: "steered", requestedBy: "maya", replyCount: 1 } };
  destination = "unset";
  const nestedView = render(createElement(MessageThread, { ...props, sessionId: "nested-question-ui", message: threadRoot, requests: [{ ...props.message, id: "nested-question", threadId: threadRoot.id }], onAnswerQuestion: async (_id, _submission, threadId) => { destination = threadId; return true; } }));
  assert.equal(screen.getAllByLabelText("Message thread").length, 1);
  assert.equal(screen.queryByRole("button", { name: /Open collaboration thread|Reply in thread to/ }), null, "a question in a Thread cannot create a nested Thread");
  assert.ok(screen.getByRole("button", { name: /Queue entire thread/ }).disabled, "agent-only acknowledgement cannot be steered again");
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).disabled, false));
  fireEvent.click(screen.getByRole("button", { name: "Author", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Send answer", exact: true }));
  await waitFor(() => assert.equal(destination, threadRoot.id));
  nestedView.rerender(createElement(MessageThread, { ...props, message: { ...threadRoot, threadSteer: undefined, annotations: threadRoot.annotations.map((reply) => ({ ...reply, deliveryStatus: "streaming" })) } }));
  assert.ok(screen.getByRole("button", { name: /Queue entire thread/ }).disabled, "partial output cannot be shared");
  console.log("PASS: inline questions need no Thread; child questions and answer destinations stay in one Thread, with no agent self-steer or partial-output handoff.");
  cleanup();
  let copiedText;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(text) { copiedText = text; } } });
  render(createElement(ConversationMessage, { message: props.message, currentMember: "maya", members, sessionId: scope.sessionId, disabled: false, runActive: false, selected: false, onOpenThread() {} }));
  fireEvent.click(screen.getByRole("button", { name: "Copy response", exact: true }));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Response copied", exact: true })));
  assert.equal(copiedText, props.message.body, "copy uses only this message body, not its Thread");
  const copiedButton = screen.getByRole("button", { name: "Response copied", exact: true });
  assert.equal(copiedButton.textContent, "Copied");
  assert.ok(copiedButton.querySelector(".lucide-copy"));
  assert.equal(copiedButton.querySelector(".lucide-check"), null, "copy success must not resemble approval");
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Copy response", exact: true })), { timeout: 3000 });
  navigator.clipboard.writeText = async () => { throw new Error("Clipboard unavailable"); };
  fireEvent.click(screen.getByRole("button", { name: "Copy response", exact: true }));
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /Couldn’t copy/));
  console.log("PASS: Copy keeps its icon, copies the exact message, briefly labels success and reports failure without an approval checkmark.");
} finally { cleanup(); dom.window.close(); }
