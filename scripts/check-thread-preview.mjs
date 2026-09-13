// Render the real shared reply components with invented data. No browser,
// account, API, database, or model is involved in this regression check.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    const target = [".ts", ".tsx"]
      .map((extension) => new URL(`${base.href}${extension}`))
      .find((url) => existsSync(url));
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext },
      }).outputText,
    };
  },
});

const { MessageThreadPreview } =
  await import("../src/components/hive/message-thread-preview.tsx");
const { ConversationMessage, ConversationTurn } =
  await import("../src/components/hive/conversation-message.tsx");
const members = [
  { id: "demo-alex", name: "Alex Example", shortName: "Alex", initials: "AL" },
  {
    id: "demo-casey",
    name: "Casey Example",
    shortName: "Casey",
    initials: "CA",
  },
];
const reply = (id, body, extra = {}) => ({
  id,
  body,
  authorId: "demo-casey",
  createdAt: 1000,
  status: "open",
  ...extra,
});
let actions = 0;
const props = {
  message: {
    id: "demo-parent",
    name: "Alex Example",
    initials: "AL",
    body: "Review this",
    role: "human",
    time: "10:00 AM",
  },
  members,
  onOpen: () => {
    actions += 1;
  },
};
const render = (replies, extra = {}) =>
  renderToStaticMarkup(
    createElement(MessageThreadPreview, {
      ...props,
      ...extra,
      message: { ...props.message, annotations: replies },
    })
  );

assert.equal(render([]), "");
const single = render([reply("one", "Is this correct?\n请保留作者。")]);
assert.match(single, /Casey:/);
assert.match(single, /Is this correct\? 请保留作者。/);
assert.doesNotMatch(single, /Steer Hive/);
assert.match(single, /Open thread with 1 reply/);
assert.doesNotMatch(single, /<details|<time/);
assert.match(
  render([reply("one", "<script>alert(1)</script>")]),
  /&lt;script&gt;/
);
console.log(
  "PASS: a short thread shows an attributed excerpt, escapes content, and has one entry."
);

const queued = render([
  reply("one", "Please check", { status: "queued", queuedBy: "demo-alex" }),
]);
assert.match(queued, /Casey:/);
assert.doesNotMatch(queued, /Alex:/);
assert.doesNotMatch(queued, /aria-label="Steer Hive/);
assert.doesNotMatch(queued, /disabled=""/);
console.log(
  "PASS: the preview retains the author, never the promoter, and remains readable without mutation controls."
);

const agentReply = render([
  reply("agent-one", "Should this also apply to CI?", {
    authorId: "hive-agent",
    role: "agent",
  }),
]);
assert.match(agentReply, />Hive: <\/span>/);
assert.match(agentReply, /Should this also apply to CI\?/);
assert.doesNotMatch(
  agentReply,
  /Casey Example|aria-label="(?:Steer Hive|Queue steer)/
);
assert.match(agentReply, /Open thread with 1 reply/);
console.log(
  "PASS: agent replies are attributed to Hive, not a teammate, and cannot steer themselves."
);

const many = render(
  [1, 2, 3, 4, 5].map((id) => reply(String(id), `Unique reply ${id}`))
);
assert.doesNotMatch(many, /<details|Unique reply [1234]/);
assert.match(many, /Unique reply 5/);
assert.match(many, /Open thread with 5 replies/);
assert.equal(actions, 0);
console.log(
  "PASS: only the latest reply is previewed; older replies stay in the thread and rendering triggers no actions."
);

const longReply =
  "Here are the pros and cons. ".repeat(40) +
  "Only visible inside the full thread.";
const question = {
  ...props.message,
  role: "agent",
  name: "Hive",
  body: "Should we close the tab?",
  interaction: {
    kind: "question",
    runId: "qa-run",
    targetMemberId: "demo-casey",
    options: ["Yes", "No"],
  },
  annotations: [
    reply("opinion", "What are the tradeoffs?"),
    reply("analysis", longReply, { role: "agent", authorId: "hive-agent" }),
  ],
};
const cardProps = {
  message: question,
  currentMember: "demo-alex",
  members,
  sessionId: "thread-preview",
  disabled: false,
  runActive: false,
  selected: false,
  onOpenThread() {},
};
const card = renderToStaticMarkup(
  createElement(ConversationMessage, cardProps)
);
assert.equal(
  (
    card.match(
      /aria-label="(?:Open thread with|Reply in thread to)[^"]*"|>Open collaboration thread</g
    ) ?? []
  ).length,
  1,
  "one discussion must have one entry, not Reply + Open collaboration thread + Open thread"
);
assert.doesNotMatch(
  card,
  /Only visible inside the full thread/,
  "the main conversation must not contain a second full thread transcript"
);
const openCard = renderToStaticMarkup(
  createElement(ConversationMessage, { ...cardProps, selected: true })
);
assert.doesNotMatch(
  openCard,
  /Here are the pros and cons/,
  "when the thread is open, its reply must not also be shown in the main conversation"
);
assert.match(openCard, /aria-expanded="true"/);
assert.match(openCard, /Thread open/);
const emptyQuestion = renderToStaticMarkup(
  createElement(ConversationMessage, {
    ...cardProps,
    message: { ...question, annotations: [] },
  })
);
assert.doesNotMatch(
  emptyQuestion,
  /Open collaboration thread|Open thread with/
);
assert.match(emptyQuestion, /Reply in thread to/);
assert.match(emptyQuestion, /data-slot="question-message"/);
const archivedCard = renderToStaticMarkup(
  createElement(ConversationMessage, { ...cardProps, disabled: true })
);
assert.match(archivedCard, /Open thread with 2 replies/);
assert.doesNotMatch(archivedCard, /disabled=""/);
console.log(
  "PASS: a question has one thread entry and never repeats a full transcript alongside the open thread."
);

const grouped = renderToStaticMarkup(
  createElement(ConversationTurn, {
    ...cardProps,
    selectedThreadId: question.id,
    turn: {
      message: {
        id: "qa-run",
        name: "Hive",
        initials: "H",
        role: "agent",
        body: "We need one preference before continuing.",
        time: "10:00 AM",
      },
      requests: [question],
    },
  })
);
const groupedDoc = new JSDOM(grouped).window.document;
assert.equal(
  groupedDoc.querySelectorAll('[role="img"][aria-label="Hive logo"]').length,
  1,
  "a turn and its tool-created card share an author header"
);
assert.equal(
  groupedDoc.querySelectorAll("[data-message-id]").length,
  2,
  "grouping preserves both addressable source messages"
);
const attachedCard = groupedDoc.querySelector('[data-slot="threaded-message"]');
assert.ok(attachedCard);
assert.equal(
  attachedCard.lastElementChild.getAttribute("aria-label"),
  "Open thread with 2 replies",
  "the Thread entry is the attached card footer"
);
assert.equal(
  attachedCard.querySelectorAll("button[aria-expanded]").length,
  1,
  "one card has one Thread entry"
);
assert.equal(
  attachedCard.querySelectorAll('button[aria-label="Copy response"]').length,
  1,
  "the question retains its own copy action"
);
assert.equal(
  groupedDoc.querySelectorAll('button[aria-label="Copy response"]').length,
  2,
  "grouping must not discard the original response action"
);
assert.equal(
  attachedCard.lastElementChild.getAttribute("aria-expanded"),
  "true"
);
const ordinary = new JSDOM(
  renderToStaticMarkup(
    createElement(ConversationMessage, {
      ...cardProps,
      message: { ...question, interaction: undefined },
    })
  )
).window.document.querySelector('[data-slot="threaded-message"]');
assert.ok(ordinary, "ordinary replies use the same body-and-footer surface");
const collapsedQuestion = new JSDOM(card).window.document.querySelector(
  "button[aria-expanded]"
);
assert.equal(
  ordinary.lastElementChild.className,
  collapsedQuestion.className,
  "tool-created and ordinary Thread entries have identical styles"
);
assert.match(ordinary.lastElementChild.textContent, /Open thread/);
for (const message of [
  { ...question, role: "human", memberId: "demo-alex", interaction: undefined },
  {
    ...question,
    interaction: {
      kind: "review",
      runId: "qa-run",
      status: "open",
      revision: "qa-run",
    },
  },
]) {
  const surface = new JSDOM(
    renderToStaticMarkup(
      createElement(ConversationMessage, { ...cardProps, message })
    )
  ).window.document.querySelector('[data-slot="threaded-message"]');
  assert.equal(
    surface.className,
    ordinary.className,
    "all Thread-bearing messages share one surface"
  );
  const withoutAlignment = (classes) =>
    classes.replace(/self-(start|end)/g, "");
  assert.equal(
    withoutAlignment(surface.lastElementChild.className),
    withoutAlignment(collapsedQuestion.className),
    "human and review Thread entries share styling; only author alignment differs"
  );
  assert.equal(surface.querySelectorAll("button[aria-expanded]").length, 1);
}
assert.equal(actions, 0);
console.log(
  "PASS: one author group retains individual messages and a single attached Thread footer without mutations."
);

// A first reply may add a footer, never transform the parent's presentation.
for (const message of [
  { ...props.message, memberId: "demo-alex" },
  { ...props.message, memberId: "demo-casey" },
  { ...question, annotations: [], interaction: undefined },
  { ...question, annotations: [] },
  {
    ...question,
    annotations: [],
    interaction: {
      kind: "review",
      runId: "qa-run",
      status: "open",
      revision: "qa-run",
    },
  },
]) {
  const documents = [
    [],
    [reply("new", "Keep the parent presentation stable")],
  ].map(
    (annotations) =>
      new JSDOM(
        renderToStaticMarkup(
          createElement(ConversationMessage, {
            ...cardProps,
            message: { ...message, annotations },
          })
        )
      ).window.document
  );
  const [before, after] = documents.map((doc) =>
    doc.querySelector('[data-slot="message-content"]')
  );
  assert.equal(
    before.outerHTML,
    after.outerHTML,
    "first reply does not change body classes, content, bubble, padding or width"
  );
  assert.equal(
    before.parentElement.className,
    after.parentElement.className,
    "first reply does not add an outer card"
  );
  assert.equal(
    documents[0].querySelector("[data-message-id]").firstElementChild.className,
    documents[1].querySelector("[data-message-id]").firstElementChild.className,
    "author alignment stays stable"
  );
}
console.log(
  "PASS: human/Agent/question/review parent body and author styles are identical with zero or one reply."
);

// Opening a Thread only adds its selection outline, never changes the space
// reserved for the author, message bubble, or footer.
for (const message of [
  {
    ...props.message,
    memberId: "demo-alex",
    annotations: [reply("one", "Keep focus visible")],
  },
  question,
]) {
  const [closed, opened] = [false, true].map((selected) =>
    new JSDOM(
      renderToStaticMarkup(
        createElement(ConversationMessage, { ...cardProps, message, selected })
      )
    ).window.document.querySelector("[data-message-id]")
  );
  const withoutOutline = (classes) =>
    classes
      .split(/\s+/)
      .filter((name) => !name.startsWith("outline-"))
      .join(" ");
  assert.equal(
    withoutOutline(closed.className),
    withoutOutline(opened.className),
    "selection preserves the message's layout and padding"
  );
  assert.equal(
    closed.firstElementChild.outerHTML,
    opened.firstElementChild.outerHTML,
    "selection preserves the author header"
  );
  assert.equal(
    closed.querySelector('[data-slot="message-content"]').outerHTML,
    opened.querySelector('[data-slot="message-content"]').outerHTML,
    "selection preserves the body and bubble"
  );
}
console.log(
  "PASS: opening a Thread preserves the parent message's spacing, author header and bubble."
);
