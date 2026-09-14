import { registerTestModules } from "../helpers/test-modules.mjs";
// Real thread controls and reducer, invented accounts; no provider/network calls.
import assert from "node:assert/strict";

import { createDomFixture } from "../helpers/test-dom.mjs";

const dom = createDomFixture("<!doctype html><body></body>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
// Draft persistence belongs to this browser window, not the host Node version.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
registerTestModules();
const { createElement } = await import("react");
const { render, screen, fireEvent, cleanup, waitFor, act } =
  await import("@testing-library/react");
const { MessageThread } =
  await import("../../src/components/hive/conversation/message-thread.tsx");
const { ConversationMessage } =
  await import("../../src/components/hive/conversation/conversation-message.tsx");
const { createInitialTaskSessionState, memberDirectory, reduceTaskSession } =
  await import("../../src/lib/session/task-session.ts");
const { requestPeerInput } =
  await import("../../src/lib/conversation/peer-collaboration.ts");
const members = Object.values(memberDirectory);
const scope = { sessionId: "ui-peer", memberId: "spencer", runId: "run-one" };
let session = createInitialTaskSessionState(1, scope.sessionId);
session.workspace.startedAt = 2;
session.workspace.liveReply = {
  id: "run-one",
  body: "",
  sequence: 0,
  startedAt: 2,
};
const published = requestPeerInput(
  session,
  scope,
  { key: "draft", prompt: "Who can see drafts?", options: ["Team", "Author"] },
  members,
  3
);
session = published.session;
let replies = 0;
let answers = 0;
const props = {
  sessionId: scope.sessionId,
  message: session.messages.at(-1),
  members,
  currentMember: "maya",
  disabled: false,
  runActive: true,
  queue: [],
  onClose() {},
  onSteerThread: async () => true,
  onReply: async () => {
    replies++;
    return true;
  },
  onAnswerQuestion: async (messageId, submission, replyThreadId) => {
    answers++;
    session = reduceTaskSession(
      session,
      {
        type: "answer-question",
        actor: "maya",
        messageId,
        replyThreadId,
        ...submission,
      },
      4,
      members
    );
    return true;
  },
};
try {
  const view = render(createElement(MessageThread, props));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Author", exact: true }).disabled,
      false
    )
  );
  assert.ok(
    !screen.queryByRole("textbox", { name: "Answer Hive" }),
    "option questions do not mount a second composer"
  );
  assert.ok(
    !screen.queryByRole("button", { name: "Send answer", exact: true }),
    "option answers need no separate submit action"
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Write an answer", exact: true })
  );
  assert.equal(answers, 0, "opening custom input must not answer or wake Hive");
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("textbox", { name: "Answer Hive" })
    )
  );
  assert.equal(
    screen.getByRole("textbox", { name: "Answer Hive" }).rows,
    1,
    "custom answers start as one line and grow with content"
  );
  assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).value, "");
  fireEvent.change(screen.getByRole("textbox", { name: "Answer Hive" }), {
    target: { value: "Author until shared" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send answer", exact: true })
  );
  await waitFor(() => assert.equal(answers, 1));
  assert.equal(replies, 0, "answer is not an ordinary discussion reply");
  assert.equal(
    session.steeringQueue[0].source.replyThreadId,
    props.message.id,
    "answering inside a manually opened Thread returns here"
  );
  view.rerender(
    createElement(MessageThread, {
      ...props,
      message: session.messages.at(-1),
      queue: session.steeringQueue,
    })
  );
  assert.equal(
    screen.queryByRole("button", { name: "Send answer", exact: true }),
    null
  );
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Answered by Maya/
  );
  const review = {
    ...props.message,
    id: "review-one",
    interaction: {
      kind: "review",
      runId: "run-one",
      revision: "run-one",
      options: [],
      status: "open",
    },
  };
  let verified;
  const reviewProps = {
    ...props,
    message: review,
    runActive: false,
    reviewCurrent: true,
    onViewChanges() {},
    onResolveReview: async (_id, revision) => {
      verified = revision;
      return true;
    },
  };
  view.rerender(
    createElement(MessageThread, { ...reviewProps, reviewReady: false })
  );
  assert.ok(
    screen.getByRole("button", { name: "Mark as reviewed", exact: true })
      .disabled
  );
  assert.match(
    screen.getByRole("group", { name: "Review actions" }).textContent,
    /Finish pending work and feedback/
  );
  view.rerender(
    createElement(MessageThread, {
      ...reviewProps,
      reviewReady: false,
      reviewCurrent: false,
    })
  );
  assert.match(
    screen.getByRole("group", { name: "Review actions" }).textContent,
    /changes are out of date/
  );
  view.rerender(
    createElement(MessageThread, {
      ...reviewProps,
      reviewReady: false,
      disabled: true,
    })
  );
  assert.match(
    screen.getByRole("group", { name: "Review actions" }).textContent,
    /Reviewing is paused/
  );
  view.rerender(
    createElement(MessageThread, { ...reviewProps, reviewReady: true })
  );
  const reviewActions = screen.getByRole("group", { name: "Review actions" });
  assert.equal(
    reviewActions.querySelector("p"),
    null,
    "a ready review needs no repeated instruction block"
  );
  assert.ok(
    !reviewActions.className.includes("border"),
    "review actions have no surrounding card"
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Mark as reviewed", exact: true })
  );
  await waitFor(() => assert.equal(verified, "run-one"));
  console.log(
    "PASS: choices, free text, answer-once acknowledgement and return to discussion in the real Thread."
  );
  console.log(
    "PASS: review readiness gates verification and submits the displayed revision."
  );
  cleanup();
  let destination = "unset";
  const answerProps = {
    message: props.message,
    currentMember: "maya",
    members,
    sessionId: "inline-question-ui",
    disabled: false,
    runActive: false,
    selected: false,
    onOpenThread() {
      throw new Error("answer must not open a Thread");
    },
    onAnswerQuestion: async (_id, _submission, threadId) => {
      destination = threadId;
      return true;
    },
  };
  render(createElement(ConversationMessage, answerProps));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Team", exact: true }).disabled,
      false
    )
  );
  assert.equal(
    screen.queryByRole("button", { name: "Open collaboration thread" }),
    null
  );
  fireEvent.click(screen.getByRole("button", { name: "Team", exact: true }));
  await waitFor(() => assert.equal(destination, undefined));
  assert.equal(
    screen.queryByLabelText("Message thread"),
    null,
    "inline answer does not navigate"
  );
  cleanup();
  const threadRoot = {
    id: "root",
    name: "Maya",
    initials: "MC",
    body: "Discuss here",
    role: "human",
    time: "10:00",
    annotations: [
      {
        id: "human-feedback",
        authorId: "maya",
        body: "Ask me a preference",
        createdAt: 1,
        status: "open",
      },
      {
        id: "agent-ack",
        authorId: "hive-agent",
        role: "agent",
        body: "A question below",
        createdAt: 2,
        status: "open",
      },
    ],
    threadSteer: {
      throughReplyId: "human-feedback",
      status: "steered",
      requestedBy: "maya",
      replyCount: 1,
    },
  };
  destination = "unset";
  const nestedView = render(
    createElement(MessageThread, {
      ...props,
      sessionId: "nested-question-ui",
      message: threadRoot,
      requests: [
        { ...props.message, id: "nested-question", threadId: threadRoot.id },
      ],
      onAnswerQuestion: async (_id, _submission, threadId) => {
        destination = threadId;
        return true;
      },
    })
  );
  assert.equal(screen.getAllByLabelText("Message thread").length, 1);
  assert.equal(
    screen.queryByRole("button", {
      name: /Open collaboration thread|Reply in thread to/,
    }),
    null,
    "a question in a Thread cannot create a nested Thread"
  );
  assert.ok(
    screen.getByRole("button", { name: /Queue entire thread/ }).disabled,
    "agent-only acknowledgement cannot be steered again"
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Author", exact: true }).disabled,
      false
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Author", exact: true }));
  await waitFor(() => assert.equal(destination, threadRoot.id));
  nestedView.rerender(
    createElement(MessageThread, {
      ...props,
      message: {
        ...threadRoot,
        threadSteer: undefined,
        annotations: threadRoot.annotations.map((reply) => ({
          ...reply,
          deliveryStatus: "streaming",
        })),
      },
    })
  );
  assert.ok(
    screen.getByRole("button", { name: /Queue entire thread/ }).disabled,
    "partial output cannot be shared"
  );
  console.log(
    "PASS: inline questions need no Thread; child questions and answer destinations stay in one Thread, with no agent self-steer or partial-output handoff."
  );
  cleanup();
  // Real question controls, with only delivery controlled: a failed free-text
  // answer survives remount and keeps its original submission identity.
  const { QuestionAnswer } =
    await import("../../src/components/hive/conversation/question-answer.tsx");
  const choiceSubmissions = [];
  let settleChoice;
  const choiceProps = {
    message: props.message,
    members,
    currentMember: "maya",
    sessionId: "one-click-choice",
    disabled: false,
    onAnswer: (_id, submission) => {
      choiceSubmissions.push(submission);
      return new Promise((resolve) => {
        settleChoice = resolve;
      });
    },
  };
  const choiceView = render(createElement(QuestionAnswer, choiceProps));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Author", exact: true }).disabled,
      false
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Author", exact: true }));
  assert.equal(
    choiceSubmissions.length,
    1,
    "one click submits the choice without a second Answer click"
  );
  assert.equal(choiceSubmissions[0].body, "Author");
  assert.ok(
    screen.getByRole("button", { name: "Author", exact: true }).disabled
  );
  assert.ok(screen.getByRole("button", { name: "Team", exact: true }).disabled);
  assert.ok(
    !screen.queryByRole("button", { name: "Send answer", exact: true })
  );
  fireEvent.click(screen.getByRole("button", { name: "Author", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Team", exact: true }));
  assert.equal(
    choiceSubmissions.length,
    1,
    "rapid repeat/other choice cannot submit while sending"
  );
  await act(async () => settleChoice(false));
  assert.match(
    screen.getByRole("status").textContent,
    /Choose the option again to retry/
  );
  fireEvent.click(screen.getByRole("button", { name: "Author", exact: true }));
  assert.equal(choiceSubmissions.length, 2);
  assert.equal(
    choiceSubmissions[0].clientId,
    choiceSubmissions[1].clientId,
    "choice retry preserves delivery identity"
  );
  await act(async () => settleChoice(false));
  choiceView.rerender(
    createElement(QuestionAnswer, { ...choiceProps, disabled: true })
  );
  fireEvent.click(screen.getByRole("button", { name: "Team", exact: true }));
  assert.equal(choiceSubmissions.length, 2, "read-only choices cannot submit");
  cleanup();
  console.log(
    "PASS: single-click answers submit once, block repeated clicks, retry with the same identity and respect read-only state."
  );
  const freeTextQuestion = {
    ...props.message,
    id: "free-text",
    interaction: { ...props.message.interaction, options: [] },
  };
  const submissions = [];
  const freeTextProps = {
    message: freeTextQuestion,
    members,
    currentMember: "maya",
    sessionId: "compact-free-text",
    disabled: false,
    onAnswer: async (_id, submission) => {
      submissions.push(submission);
      return false;
    },
  };
  render(createElement(QuestionAnswer, freeTextProps));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Answer Hive" }).disabled,
      false
    )
  );
  assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).rows, 1);
  assert.ok(
    document.activeElement !==
      screen.getByRole("textbox", { name: "Answer Hive" }),
    "arrival does not focus a free-text question"
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Answer Hive" }), {
    target: { value: "Keep drafts private\nuntil shared" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Answer Hive" }), {
    key: "Enter",
    keyCode: 229,
    isComposing: true,
  });
  assert.equal(submissions.length, 0, "IME confirmation does not answer");
  fireEvent.click(
    screen.getByRole("button", { name: "Send answer", exact: true })
  );
  await waitFor(() =>
    assert.ok(screen.getByRole("button", { name: "Retry answer", exact: true }))
  );
  cleanup();
  const restoredCustom = {
    ...freeTextQuestion,
    interaction: {
      ...freeTextQuestion.interaction,
      options: ["Team", "Author"],
    },
  };
  const customView = render(
    createElement(QuestionAnswer, { ...freeTextProps, message: restoredCustom })
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Answer Hive" }).value,
      "Keep drafts private\nuntil shared"
    )
  );
  assert.ok(
    document.activeElement !==
      screen.getByRole("textbox", { name: "Answer Hive" }),
    "restored custom draft is visible without stealing focus"
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry answer", exact: true })
  );
  await waitFor(() => assert.equal(submissions.length, 2));
  assert.equal(submissions[0].clientId, submissions[1].clientId);
  customView.rerender(
    createElement(QuestionAnswer, {
      ...freeTextProps,
      message: restoredCustom,
      disabled: true,
    })
  );
  assert.ok(screen.getByRole("textbox", { name: "Answer Hive" }).disabled);
  assert.ok(screen.getByRole("button", { name: "Team", exact: true }).disabled);
  assert.ok(
    screen.getByRole("button", { name: "Retry answer", exact: true }).disabled
  );
  cleanup();
  console.log(
    "PASS: compact free text, IME guard, restored custom draft, retry identity and read-only state remain intact."
  );
  let copiedText;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(text) {
        copiedText = text;
      },
    },
  });
  render(
    createElement(ConversationMessage, {
      message: props.message,
      currentMember: "maya",
      members,
      sessionId: scope.sessionId,
      disabled: false,
      runActive: false,
      selected: false,
      onOpenThread() {},
    })
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Copy response", exact: true })
  );
  await waitFor(() =>
    assert.ok(
      screen.getByRole("button", { name: "Response copied", exact: true })
    )
  );
  assert.equal(
    copiedText,
    props.message.body,
    "copy uses only this message body, not its Thread"
  );
  const copiedButton = screen.getByRole("button", {
    name: "Response copied",
    exact: true,
  });
  assert.equal(copiedButton.textContent, "Copied");
  assert.ok(copiedButton.querySelector(".lucide-copy"));
  assert.equal(
    copiedButton.querySelector(".lucide-check"),
    null,
    "copy success must not resemble approval"
  );
  await waitFor(
    () =>
      assert.ok(
        screen.getByRole("button", { name: "Copy response", exact: true })
      ),
    { timeout: 3000 }
  );
  navigator.clipboard.writeText = async () => {
    throw new Error("Clipboard unavailable");
  };
  fireEvent.click(
    screen.getByRole("button", { name: "Copy response", exact: true })
  );
  await waitFor(() =>
    assert.match(screen.getByRole("status").textContent, /Couldn’t copy/)
  );
  console.log(
    "PASS: Copy keeps its icon, copies the exact message, briefly labels success and reports failure without an approval checkmark."
  );
} finally {
  cleanup();
  dom.close();
}
