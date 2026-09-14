import { registerTestModules } from "../helpers/test-modules.mjs";
// Real UI controls and state reducer; only browser services are doubled. No accounts/model calls.
import assert from "node:assert/strict";

import { createDomFixture } from "../helpers/test-dom.mjs";

const dom = createDomFixture("<!doctype html><body></body>", {
  url: "https://hive.test",
  pretendToBeVisual: true,
});
globalThis.fetch = async () => {
  throw new Error("Unexpected network request in the message UI fixture");
};
let copied;
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(body) {
      copied = body;
    },
  },
});
registerTestModules({
  load(url, context, next) {
    if (url.endsWith(".css"))
      return {
        format: "module",
        shortCircuit: true,
        source: "export default {};",
      };
    return next(url, context);
  },
});
const { createElement: h } = await import("react");
const { act, render, screen, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const { ConversationMessage } =
  await import("../../src/components/hive/conversation/conversation-message.tsx");
const { MessageEditComposer } =
  await import("../../src/components/hive/conversation/message-edit-composer.tsx");
const { SteeringQueue } =
  await import("../../src/components/hive/conversation/steering-queue.tsx");
const { createInitialTaskSessionState, reduceTaskSession } =
  await import("../../src/lib/session/task-session.ts");
const members = [
  { id: "alex", name: "Alex", shortName: "Alex", initials: "AL" },
  { id: "casey", name: "Casey", shortName: "Casey", initials: "CA" },
];
let session = reduceTaskSession(
  createInitialTaskSessionState(1),
  { type: "send-message", actor: "alex", body: "Original request" },
  2,
  members
);
session = reduceTaskSession(
  session,
  { type: "send-message", actor: "alex", body: "Queued request" },
  3,
  members
);
const message = session.messages.at(-1),
  queuedSteerId = session.steeringQueue[0].id;
let editing,
  opened,
  cancelled = 0;
const props = {
  message,
  members,
  currentMember: "alex",
  sessionId: "ui-fixture",
  disabled: false,
  runActive: true,
  queueing: true,
  selected: false,
  onOpenThread: (id) => {
    opened = id;
  },
  onSteerReply() {},
  onEdit: (value) => {
    editing = value;
  },
};
try {
  const view = render(h(ConversationMessage, props));
  // Purpose: message controls follow the text, including shared question cards;
  // author headers stay metadata-only, regardless of who wrote the message.
  for (const example of [
    message,
    { ...message, role: "agent", name: "Hive" },
    {
      ...message,
      role: "agent",
      name: "Hive",
      interaction: { kind: "question", status: "open", options: ["Yes", "No"] },
    },
  ]) {
    view.rerender(h(ConversationMessage, { ...props, message: example }));
    const body = view.container.querySelector('[data-slot="message-content"]');
    const control = screen.getByRole("button", {
      name:
        example.role === "agent" ? "Copy response" : "Message actions for Alex",
    });
    assert.ok(
      body.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
      "message actions must be below the body"
    );
  }
  view.rerender(h(ConversationMessage, props));
  fireEvent.click(
    screen.getByRole("button", { name: "Message actions for Alex" })
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Edit message" })
  );
  assert.equal(editing.id, message.id);
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(
    screen.getByRole("button", { name: "Message actions for Alex" })
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Copy message" })
  );
  await waitFor(() => assert.equal(copied, "Queued request"));
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(
    screen.getByRole("button", { name: "Message actions for Alex" })
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "Open thread" }));
  assert.equal(opened, message.id);
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  view.rerender(h(ConversationMessage, { ...props, currentMember: "casey" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Message actions for Alex" })
  );
  await screen.findByRole("menu");
  assert.equal(screen.queryByRole("menuitem", { name: "Edit message" }), null);
  cleanup();
  console.log(
    "PASS: own-message edit, copy and Thread actions work; teammates do not receive an edit control."
  );

  let fail = true,
    submissions = 0;
  const editor = render(
    h(MessageEditComposer, {
      message,
      queuedSteerId,
      disabled: false,
      onCancel() {
        cancelled++;
      },
      async onSave(change) {
        submissions++;
        if (fail) throw new Error("This message was edited elsewhere.");
        session = reduceTaskSession(
          session,
          { type: "edit-message", actor: "alex", ...change },
          4,
          members
        );
      },
    })
  );
  const text = screen.getByRole("textbox", { name: "Message text" });
  assert.equal(text, document.activeElement);
  fireEvent.change(text, {
    target: { value: "排队的修订\nKeep keyboard focus" },
  });
  fireEvent.keyDown(text, {
    key: "Enter",
    keyCode: 229,
    ctrlKey: true,
    isComposing: true,
  });
  fireEvent.keyDown(text, { key: "Enter" });
  assert.equal(
    submissions,
    0,
    "IME confirmation and ordinary new lines must not save"
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  assert.equal(text.value, "排队的修订\nKeep keyboard focus");
  assert.equal(cancelled, 0);
  fail = false;
  fireEvent.keyDown(text, { key: "Enter", ctrlKey: true });
  await waitFor(() => assert.equal(cancelled, 1));
  assert.equal(session.messages.at(-1).body, "排队的修订\nKeep keyboard focus");
  assert.equal(
    session.steeringQueue[0].body,
    "排队的修订\nKeep keyboard focus"
  );
  assert.equal(session.messages.at(-1).edits[0].body, "Queued request");
  editor.unmount();
  const history = render(
    h(ConversationMessage, { ...props, message: session.messages.at(-1) })
  );
  fireEvent.click(screen.getByRole("button", { name: "Edited" }));
  assert.ok(
    screen.getByRole("region", { name: "Edit history for Alex's message" })
  );
  assert.ok(screen.getByText("Queued request"));
  fireEvent.click(screen.getByRole("button", { name: "Hide history" }));
  assert.equal(
    screen.queryByRole("region", { name: "Edit history for Alex's message" }),
    null
  );
  history.unmount();
  console.log(
    "PASS: failed saves retain CJK/multiline drafts; explicit save updates the queue and exposes edit history."
  );

  let removed,
    applied = 0;
  render(
    h(SteeringQueue, {
      items: session.steeringQueue,
      messages: session.messages,
      members,
      currentMember: "alex",
      disabled: false,
      canApply: false,
      onApply() {
        applied++;
      },
      onMove() {},
      onRemove(id) {
        removed = id;
      },
      onEdit(value) {
        editing = value;
      },
      onOpenThread(id) {
        opened = id;
      },
    })
  );
  assert.equal(
    screen.getByRole("button", { name: "After current run" }).disabled,
    true
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for queued steer 1" })
  );
  assert.equal(
    (await screen.findByRole("menuitem", { name: "Move up" })).getAttribute(
      "aria-disabled"
    ),
    "true"
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
  assert.equal(editing.body, "排队的修订\nKeep keyboard focus");
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for queued steer 1" })
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Remove from queue" })
  );
  assert.equal(removed, queuedSteerId);
  assert.equal(applied, 0);
  cleanup();
  console.log(
    "PASS: compact queue actions edit/remove the selected item and cannot interrupt a running agent."
  );

  // Purpose: mixed queue sources remain recognizable, without exposing internal
  // handoff prompts or falsely previewing discussion added after a frozen Steer.
  session = reduceTaskSession(
    session,
    {
      type: "annotate-message",
      actor: "casey",
      messageId: message.id,
      body: "Keep the focus ring visible.",
    },
    5,
    members
  );
  const boundary = session.messages.at(-1).annotations.at(-1).id;
  session = reduceTaskSession(
    session,
    {
      type: "steer-thread",
      actor: "alex",
      messageId: message.id,
      throughReplyId: boundary,
    },
    6,
    members
  );
  const threadItem = session.steeringQueue.at(-1);
  assert.equal(threadItem.source.kind, "message-thread");
  session = reduceTaskSession(
    session,
    {
      type: "annotate-message",
      actor: "casey",
      messageId: message.id,
      body: "Later discussion is not queued.",
    },
    7,
    members
  );
  const queueProps = {
    items: session.steeringQueue,
    messages: session.messages,
    members,
    currentMember: "alex",
    disabled: false,
    canApply: true,
    onApply() {
      applied++;
    },
    onMove() {},
    onRemove() {},
    onEdit() {},
    onOpenThread(id) {
      opened = id;
    },
  };
  const mixed = render(h(SteeringQueue, queueProps));
  const rows = within(
    screen.getByRole("region", { name: "Queued steering" })
  ).getAllByRole("listitem");
  assert.equal(rows.length, 2);
  assert.ok(within(rows[0]).getByText("Message · Alex"));
  assert.ok(within(rows[1]).getByText("Thread · 1 reply · Alex"));
  assert.ok(within(rows[1]).getByText("Casey: Keep the focus ring visible."));
  assert.ok(!rows[1].textContent.includes("Later discussion"));
  assert.ok(
    !rows[1].outerHTML.includes("Steer using this complete thread"),
    "internal prompts must not leak through a hover title"
  );
  fireEvent.click(
    within(rows[1]).getByRole("button", { name: "Actions for queued steer 2" })
  );
  await screen.findByRole("menu");
  assert.equal(
    screen.queryByRole("menuitem", { name: "Edit message" }),
    null,
    "a frozen Thread is not an editable queued message"
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Open thread" }));
  assert.equal(opened, message.id);
  assert.equal(applied, 0, "opening the source never starts work");
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  mixed.rerender(
    h(SteeringQueue, {
      ...queueProps,
      items: [],
      activeSteer: { ...threadItem, appliedAt: 8 },
    })
  );
  assert.ok(screen.getByText("Casey: Keep the focus ring visible."));
  assert.ok(screen.getByText("Thread · 1 reply · Alex"));
  assert.match(screen.getByRole("status").textContent, /Applying/);
  assert.equal(
    screen.queryByRole("button", { name: /Actions for queued steer/ }),
    null
  );
  mixed.rerender(
    h(SteeringQueue, {
      ...queueProps,
      items: [],
      activeSteer: { ...session.steeringQueue[0], appliedAt: 8 },
    })
  );
  assert.ok(screen.getByText("Message · Alex"));
  assert.ok(screen.getByText("排队的修订 Keep keyboard focus"));
  mixed.rerender(
    h(SteeringQueue, {
      ...queueProps,
      messages: [],
      items: [threadItem],
      disabled: true,
    })
  );
  assert.ok(screen.getByText("Thread discussion"));
  assert.equal(
    screen.getByRole("button", { name: "Actions for queued steer 1" }).disabled,
    true
  );
  assert.equal(screen.getByRole("button", { name: "Run next" }).disabled, true);
  assert.ok(
    !screen
      .getByRole("region", { name: "Queued steering" })
      .outerHTML.includes("Steer using this complete thread")
  );
  // Answer payloads are also structured input, not user-facing queue copy.
  const question = {
    ...message,
    id: "question",
    body: "Which theme?",
    role: "agent",
    annotations: [
      {
        id: "answer",
        body: "Dark theme",
        authorId: "casey",
        createdAt: 9,
        status: "queued",
      },
    ],
  };
  const answer = {
    id: "answer-steer",
    authorId: "casey",
    queuedAt: 9,
    body: JSON.stringify({
      question: "Which theme?",
      answer: "Dark theme",
      answeredBy: "Casey",
    }),
    source: {
      kind: "peer-response",
      messageId: question.id,
      annotationId: "answer",
    },
    sourceLabel: "Answer · Casey",
  };
  mixed.rerender(
    h(SteeringQueue, { ...queueProps, messages: [question], items: [answer] })
  );
  assert.ok(screen.getByText("Dark theme"));
  assert.ok(screen.getByText("Answer · Casey"));
  assert.ok(
    !screen
      .getByRole("region", { name: "Queued steering" })
      .outerHTML.includes("answeredBy")
  );
  mixed.rerender(h(SteeringQueue, { ...queueProps, items: [] }));
  assert.equal(screen.queryByRole("region", { name: "Queued steering" }), null);
  cleanup();
  console.log(
    "PASS: unified queue previews preserve frozen boundaries and applying context; source navigation, read-only, missing-source, answer and empty states stay safe."
  );
} finally {
  await act(async () => cleanup());
  dom.close();
}
