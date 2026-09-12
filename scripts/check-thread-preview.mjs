// Render the real shared reply components with invented data. No browser,
// account, API, database, or model is involved in this regression check.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

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

const { MessageThreadPreview } = await import("../src/components/hive/message-thread-preview.tsx");
const { ConversationMessage } = await import("../src/components/hive/conversation-message.tsx");
const members = [
  { id: "demo-alex", name: "Alex Example", shortName: "Alex", initials: "AL" },
  { id: "demo-casey", name: "Casey Example", shortName: "Casey", initials: "CA" },
];
const reply = (id, body, extra = {}) => ({ id, body, authorId: "demo-casey", createdAt: 1000, status: "open", ...extra });
let actions = 0;
const props = {
  message: { id: "demo-parent", name: "Alex Example", initials: "AL", body: "Review this", role: "human", time: "10:00 AM" },
  members,
  onOpen: () => { actions += 1; },
};
const render = (replies, extra = {}) => renderToStaticMarkup(createElement(MessageThreadPreview, { ...props, ...extra, message: { ...props.message, annotations: replies } }));

assert.equal(render([]), "");
const single = render([reply("one", "Is this correct?\n请保留作者。")]);
assert.match(single, /Casey:/);
assert.match(single, /Is this correct\? 请保留作者。/);
assert.doesNotMatch(single, /Steer Hive/);
assert.match(single, /Open thread with 1 reply/);
assert.doesNotMatch(single, /<details|<time/);
assert.match(render([reply("one", "<script>alert(1)<\/script>")]), /&lt;script&gt;/);
console.log("PASS: a short thread shows an attributed excerpt, escapes content, and has one entry.");

const queued = render([reply("one", "Please check", { status: "queued", queuedBy: "demo-alex" })]);
assert.match(queued, /Casey:/);
assert.doesNotMatch(queued, /Alex:/);
assert.doesNotMatch(queued, /aria-label="Steer Hive/);
assert.doesNotMatch(queued, /disabled=""/);
console.log("PASS: the preview retains the author, never the promoter, and remains readable without mutation controls.");

const agentReply = render([reply("agent-one", "Should this also apply to CI?", { authorId: "hive-agent", role: "agent" })]);
assert.match(agentReply, />Hive: <\/span>/);
assert.match(agentReply, /Should this also apply to CI\?/);
assert.doesNotMatch(agentReply, /Casey Example|aria-label="(?:Steer Hive|Queue steer)/);
assert.match(agentReply, /Open thread with 1 reply/);
console.log("PASS: agent replies are attributed to Hive, not a teammate, and cannot steer themselves.");

const many = render([1, 2, 3, 4, 5].map((id) => reply(String(id), `Unique reply ${id}`)));
assert.doesNotMatch(many, /<details|Unique reply [1234]/);
assert.match(many, /Unique reply 5/);
assert.match(many, /Open thread with 5 replies/);
assert.equal(actions, 0);
console.log("PASS: only the latest reply is previewed; older replies stay in the thread and rendering triggers no actions.");

const longReply = "Here are the pros and cons. ".repeat(40) + "Only visible inside the full thread.";
const question = { ...props.message, role: "agent", name: "Hive", body: "Should we close the tab?", interaction: { kind: "question", runId: "qa-run", targetMemberId: "demo-casey", options: ["Yes", "No"] }, annotations: [reply("opinion", "What are the tradeoffs?"), reply("analysis", longReply, { role: "agent", authorId: "hive-agent" })] };
const cardProps = { message: question, currentMember: "demo-alex", members, sessionId: "thread-preview", disabled: false, runActive: false, selected: false, onOpenThread() {} };
const card = renderToStaticMarkup(createElement(ConversationMessage, cardProps));
assert.equal((card.match(/aria-label="(?:Open thread with|Reply in thread to)[^"]*"|>Open collaboration thread</g) ?? []).length, 1, "one discussion must have one entry, not Reply + Open collaboration thread + Open thread");
assert.doesNotMatch(card, /Only visible inside the full thread/, "the main conversation must not contain a second full thread transcript");
const openCard = renderToStaticMarkup(createElement(ConversationMessage, { ...cardProps, selected: true }));
assert.doesNotMatch(openCard, /Here are the pros and cons/, "when the thread is open, its reply must not also be shown in the main conversation");
assert.match(openCard, /aria-expanded="true"/);
assert.match(openCard, /Thread open/);
const emptyQuestion = renderToStaticMarkup(createElement(ConversationMessage, { ...cardProps, message: { ...question, annotations: [] } }));
assert.match(emptyQuestion, /Open collaboration thread/);
assert.doesNotMatch(emptyQuestion, /Reply in thread to/);
const archivedCard = renderToStaticMarkup(createElement(ConversationMessage, { ...cardProps, disabled: true }));
assert.match(archivedCard, /Open thread with 2 replies/);
assert.doesNotMatch(archivedCard, /disabled=""/);
console.log("PASS: a question has one thread entry and never repeats a full transcript alongside the open thread.");
