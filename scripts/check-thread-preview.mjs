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
const members = [
  { id: "demo-alex", name: "Alex Example", shortName: "Alex", initials: "AL" },
  { id: "demo-casey", name: "Casey Example", shortName: "Casey", initials: "CA" },
];
const reply = (id, body, extra = {}) => ({ id, body, authorId: "demo-casey", createdAt: 1000, status: "open", ...extra });
let actions = 0;
const props = {
  message: { id: "demo-parent", name: "Alex Example", initials: "AL", body: "Review this", role: "human", time: "10:00 AM" },
  members, disabled: false, queueing: false,
  onOpen: () => { actions += 1; }, onSteerReply: () => { actions += 1; },
};
const render = (replies, extra = {}) => renderToStaticMarkup(createElement(MessageThreadPreview, { ...props, ...extra, message: { ...props.message, annotations: replies } }));

assert.equal(render([]), "");
const single = render([reply("one", "Is this correct?\n请保留作者。")]);
assert.match(single, /Casey Example/);
assert.match(single, /Is this correct\?\n请保留作者。/);
assert.match(single, /Steer Hive for Casey&#x27;s reply/);
assert.match(single, /Open thread with 1 reply/);
assert.doesNotMatch(single, /<details|<time/);
assert.match(render([reply("one", "<script>alert(1)<\/script>")]), /&lt;script&gt;/);
console.log("PASS: a short thread renders its author's full reply inline, escapes content, and keeps the thread entry.");

const busy = render([reply("one", "Please check")], { queueing: true });
assert.match(busy, /Queue steer for Casey&#x27;s reply/);
const disabled = render([reply("one", "Please check")], { disabled: true });
const disabledSteer = disabled.match(/<button[^>]*aria-label="Steer Hive[^>]*>/)?.[0] ?? "";
assert.match(disabledSteer, /\sdisabled=""/);
const queued = render([reply("one", "Please check", { status: "queued", queuedBy: "demo-alex" })]);
assert.match(queued, /Queued.*by Alex/);
assert.match(queued, /Casey Example/);
assert.doesNotMatch(queued, /aria-label="Steer Hive/);
console.log("PASS: inline steer labels follow run state, honor disabled state, and keep author/promoter attribution separate.");

const many = render([1, 2, 3, 4, 5].map((id) => reply(String(id), `Unique reply ${id}`)));
assert.match(many, /<details[^>]*>/);
assert.doesNotMatch(many, /<details[^>]*\bopen(?:[=>\s])/);
assert.match(many, /2 earlier replies/);
const visible = many.replace(/<details[\s\S]*?<\/details>/, "");
assert.doesNotMatch(visible, /Unique reply [12]/);
assert.match(visible, /Unique reply 3[\s\S]*Unique reply 4[\s\S]*Unique reply 5/);
assert.match(visible, /Open thread with 5 replies/);
assert.equal(actions, 0);
console.log("PASS: only older replies collapse; the newest three remain visible in order and rendering triggers no actions.");
