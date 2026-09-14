import { registerTestModules } from "../helpers/test-modules.mjs";
// Mount the actual workspace, not a copied preview. Only Monaco's browser engine
// is represented by a text fixture here; browser QA covers the real editor.
import "./check-design-system.mjs";
import assert from "node:assert/strict";

import { mock } from "node:test";
import { createDomFixture } from "../helpers/test-dom.mjs";

const dom = createDomFixture("<!doctype html><html><body></body></html>", {
  url: "http://localhost/demo/tasks/demo-menu",
  pretendToBeVisual: true,
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.DOMRect = window.DOMRect;
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
window.HTMLElement.prototype.scrollIntoView = function () {};
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  throw new Error("Demo attempted an HTTP request");
};
globalThis.WebSocket = class {
  constructor() {
    requests++;
    throw new Error("Demo mounted live transport");
  }
};
registerTestModules({
  load(url, context, next) {
    if (url.endsWith(".module.css"))
      return {
        format: "module",
        shortCircuit: true,
        source: "export default new Proxy({}, { get: (_, key) => key });",
      };
    if (url.endsWith("/next/dynamic.js"))
      return {
        format: "module",
        shortCircuit: true,
        source:
          'import { createElement } from "react"; export default () => function CodeFixture({ path, content }) { return createElement("pre", { "aria-label": `Sample file: ${path}` }, content); };',
      };
    return next(url, context);
  },
});
const { createElement: h } = await import("react");
const { render, renderHook, screen, fireEvent, cleanup, waitFor, within, act } =
  await import("@testing-library/react");
const { DemoWorkspace } = await import("../../src/app/demo/demo-workspace.tsx");
const { demoTasks } = await import("../../src/lib/demo/ui-demo.ts");
try {
  render(
    h(DemoWorkspace, {
      task: { id: "demo-new", title: "", repositoryName: null, updatedAt: 1 },
    })
  );
  assert.ok(screen.getByRole("button", { name: "Rename task: Untitled task" }));
  assert.ok(
    !screen.queryByText(/What should we accomplish/),
    "new tasks do not fabricate a Hive greeting"
  );
  assert.equal(
    screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" })
      .disabled,
    false
  );
  assert.equal(
    screen.queryByRole("button", { name: "Open collaboration thread" }),
    null,
    "an empty task has no invented human request"
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" }),
    { target: { value: "@casey Polish the Settings menu" } }
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send message", exact: true })
  );
  await waitFor(() =>
    assert.ok(
      screen.getByRole("button", {
        name: "Rename task: @casey Polish the Settings menu",
      })
    )
  );
  fireEvent.click(screen.getByRole("button", { name: /^Rename task:/ }));
  const titleInput = screen.getByRole("textbox", { name: "Task name" });
  fireEvent.change(titleInput, { target: { value: "   " } });
  assert.ok(screen.getByRole("button", { name: "Save", exact: true }).disabled);
  fireEvent.change(titleInput, {
    target: { value: "团队导航 · Keyboard review" },
  });
  assert.equal(
    fireEvent.keyDown(titleInput, {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
    }),
    false,
    "IME Enter does not submit the name"
  );
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() =>
    assert.ok(
      !screen.queryByRole("dialog"),
      "rename dialog closes after saving"
    )
  );
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("button", {
          name: "Rename task: 团队导航 · Keyboard review",
        }),
      "focus returns to the renamed title"
    )
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" }),
    { target: { value: "@casey Keep this name" } }
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send message", exact: true })
  );
  await waitFor(() => assert.ok(screen.getByText("@casey Keep this name")));
  assert.ok(
    screen.getByRole("button", {
      name: "Rename task: 团队导航 · Keyboard review",
    })
  );
  fireEvent.click(
    within(screen.getByLabelText("Demo controls")).getByRole("button", {
      name: "Casey",
      exact: true,
    })
  );
  assert.ok(
    screen.getByRole("button", {
      name: "Rename task: 团队导航 · Keyboard review",
    })
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Archive task: 团队导航 · Keyboard review",
    })
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Archive task", exact: true })
  );
  await waitFor(() =>
    assert.ok(
      screen.getByRole("button", {
        name: "Rename task: 团队导航 · Keyboard review",
      }).disabled
    )
  );
  assert.equal(requests, 0);
  cleanup();
  console.log(
    "PASS: first-message naming and shared rename in the real workspace; blank/IME guards, focus return, teammate visibility and archived read-only state."
  );
  render(h(DemoWorkspace, { task: demoTasks[0] }));
  const button = (name) => screen.getByRole("button", { name, exact: true });
  assert.ok(screen.getByLabelText("Demo controls"));
  assert.ok(screen.getByLabelText("Resize conversation and workspace"));
  for (const name of ["Diff", "Files", "Runs", "Checkpoints"])
    assert.ok(button(name));
  assert.ok(button("Invite teammate").disabled);
  assert.ok(button("1 question needs your answer"));
  assert.equal(
    screen.getByRole("link", { name: /Hive/ }).getAttribute("href"),
    "/demo"
  );
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Files"));
  await waitFor(() =>
    assert.match(
      screen.getByLabelText("Sample file: src/components/settings-nav.tsx")
        .textContent,
      /SettingsNav/
    )
  );
  fireEvent.click(button("1 question needs your answer"));
  await waitFor(() =>
    assert.equal(
      document.activeElement?.dataset.messageId,
      screen
        .getByRole("group", { name: /^Answer:/ })
        .closest("[data-message-id]").dataset.messageId
    )
  );
  assert.equal(
    screen
      .getByRole("button", { name: "Conversation", exact: true })
      .getAttribute("aria-pressed"),
    "true",
    "attention navigates only after an explicit click"
  );
  assert.equal(
    button("Files").getAttribute("aria-pressed"),
    "true",
    "attention navigation retains the workspace tab"
  );
  fireEvent.click(button("Checkpoints"));
  await waitFor(() =>
    assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ }))
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Restore checkpoint from/ })
  );
  assert.ok(screen.getByRole("dialog", { name: "Restore this checkpoint?" }));
  fireEvent.click(button("Cancel"));
  fireEvent.click(button("Conversation"));
  assert.equal(
    screen.queryByRole("button", { name: "Open collaboration thread" }),
    null,
    "asking does not require a Thread"
  );
  const questionCard = screen
    .getByRole("group", { name: /^Answer:/ })
    .closest('[data-slot="question-message"]');
  const discussionEntry = within(questionCard).getByRole("button", {
    name: /Reply in thread to/,
  });
  discussionEntry.focus();
  fireEvent.click(discussionEntry);
  await waitFor(() =>
    assert.ok(
      screen.getByRole("button", { name: "Write an answer", exact: true })
    )
  );
  fireEvent.click(
    within(screen.getByLabelText("Demo controls")).getByRole("button", {
      name: "Casey",
      exact: true,
    })
  );
  assert.equal(
    screen.queryByRole("button", { name: "1 question needs your answer" }),
    null,
    "a question for Alex must not summon Casey"
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Reply in thread" }).disabled,
      false
    )
  );
  assert.equal(
    screen.queryByRole("button", { name: "Send answer", exact: true }),
    null,
    "Casey cannot formally answer a question assigned to Alex"
  );
  assert.equal(
    screen.queryByRole("button", { name: "Keep it open", exact: true }),
    null,
    "answer options are only shown to the addressee"
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reply in thread" }), {
    target: { value: "Casey discussion, not Alex's answer" },
  });
  fireEvent.click(button("Send reply"));
  await waitFor(() =>
    assert.match(
      screen.getByLabelText("Message thread").textContent,
      /Casey discussion, not Alex's answer/
    )
  );
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Question for Alex/
  );
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Needs answer/
  );
  assert.doesNotMatch(
    screen.getByLabelText("Message thread").textContent,
    /Answered by Casey|Simulated result/
  );
  fireEvent.click(button("Close thread"));
  await waitFor(() =>
    assert.equal(
      document.activeElement.getAttribute("aria-label"),
      "Open thread with 1 reply",
      "the first reply updates the same entry, so closing the Thread restores keyboard focus"
    )
  );
  fireEvent.click(document.activeElement);
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Casey discussion, not Alex's answer/
  );
  fireEvent.click(
    within(screen.getByLabelText("Demo controls")).getByRole("button", {
      name: "Alex",
      exact: true,
    })
  );
  await waitFor(() => assert.equal(button("Keep it open").disabled, false));
  console.log(
    "PASS: Casey can discuss, but cannot answer Alex's question; switching back restores Alex's answer controls."
  );
  fireEvent.click(button("Keep it open"));
  await waitFor(() =>
    assert.match(
      screen.getByLabelText("Message thread").textContent,
      /Answered by Alex/
    )
  );
  await waitFor(
    () =>
      assert.match(
        screen.getByLabelText("Message thread").textContent,
        /Simulated result/
      ),
    { timeout: 2500 }
  );
  fireEvent.click(button("Close thread"));
  fireEvent.click(
    within(screen.getByLabelText("Demo controls")).getByRole("button", {
      name: "Casey",
      exact: true,
    })
  );
  fireEvent.click(button("Open thread with 1 reply"));
  await waitFor(() => assert.ok(screen.getByLabelText("Message thread")));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Reply in thread" }).disabled,
      false
    )
  );
  const input = screen.getByRole("textbox", { name: "Reply in thread" });
  // A Thread is discussion only, including text addressed to Hive. The human
  // must explicitly Steer the whole discussion to the main agent.
  fireEvent.change(input, {
    target: { value: "@Hive Please keep the focus ring visible" },
  });
  assert.equal(
    screen.queryByRole("button", { name: "Ask Hive in thread", exact: true }),
    null,
    "Thread replies must not expose a separate agent invocation"
  );
  fireEvent.click(button("Send reply"));
  await waitFor(() =>
    assert.match(
      screen.getByLabelText("Message thread").textContent,
      /Please keep the focus ring visible/
    )
  );
  fireEvent.click(button("Archive task: Polish the settings menu"));
  fireEvent.click(button("Archive task"));
  await waitFor(() => assert.ok(screen.getByText(/Read-only for everyone/)));
  assert.equal(
    screen.getByRole("textbox", { name: "Reply in thread" }).disabled,
    true
  );
  assert.ok(button("Send reply").disabled);
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Files"));
  await waitFor(() =>
    assert.match(
      screen.getByLabelText("Sample file: src/components/settings-nav.tsx")
        .textContent,
      /SettingsNav/
    )
  );
  fireEvent.click(button("Checkpoints"));
  await waitFor(() =>
    assert.ok(
      screen
        .getAllByRole("button", { name: /^Restore checkpoint from/ })
        .every((button) => button.disabled)
    )
  );
  fireEvent.click(
    within(screen.getByLabelText("Demo controls")).getByRole("button", {
      name: "Alex",
      exact: true,
    })
  );
  fireEvent.click(button("Restore task: Polish the settings menu"));
  fireEvent.click(button("Restore task"));
  await waitFor(() =>
    assert.equal(screen.queryByText(/Read-only for everyone/), null)
  );
  fireEvent.click(button("Conversation"));
  fireEvent.click(
    within(document.querySelector('[data-message-id="answer"]')).getByRole(
      "button",
      { name: "Open thread with 2 replies", exact: true }
    )
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Reply in thread" }).disabled,
      false
    )
  );
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Please keep the focus ring visible/
  );
  console.log(
    "PASS: shared archive dialog locks discussion and checkpoint writes, preserves Files and replies, and another member restores without starting an agent."
  );
  assert.equal(requests, 0, "demo interactions never call HTTP or WebSocket");
  console.log(
    "PASS: real workspace, files, checkpoint dialog, question continuation, teammate reply, and zero service calls."
  );
  cleanup();
  render(h(DemoWorkspace, { task: demoTasks[0] }));
  const composer = screen.getByRole("textbox", {
    name: "Ask Hive or mention a teammate",
  });
  await waitFor(() => assert.equal(composer.disabled, false));
  fireEvent.change(composer, {
    target: { value: "Prepare the sample change for Casey to review" },
  });
  fireEvent.click(button("Send message"));
  await waitFor(
    () =>
      assert.ok(
        screen.getByText(
          "Review this sample change together. Does the keyboard focus behavior look right?"
        )
      ),
    { timeout: 2500 }
  );
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Diff"));
  const directReviews = screen.getByRole("region", {
    name: "Workspace reviews",
  });
  assert.match(directReviews.textContent, /Review for Casey/);
  assert.match(directReviews.textContent, /Needs review/);
  assert.ok(
    document.activeElement !== button("Open review"),
    "direct Diff entry does not steal focus"
  );
  fireEvent.click(button("Open review"));
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Review this sample change together/
  );
  assert.ok(
    button("Mark as reviewed").disabled,
    "Alex cannot verify Casey's review"
  );
  assert.match(
    screen.getByRole("group", { name: "Review actions" }).textContent,
    /Waiting for Casey to review/
  );
  fireEvent.click(button("View changes"));
  assert.ok(
    !screen.queryByRole("button", { name: "Approve changes", exact: true }),
    "viewing a review diff must not expose a separate task approval"
  );
  assert.ok(button("Back to review"));
  assert.ok(
    document.activeElement === button("Back to review"),
    "keyboard focus lands on safe review navigation, not an approval action"
  );
  assert.equal(
    screen.queryByRole("button", { name: "Mark as reviewed", exact: true }),
    null,
    "verification stays in its thread"
  );
  fireEvent.click(button("Runs"));
  fireEvent.click(button("Back to review"));
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Review for Casey/
  );
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Needs review/
  );
  assert.ok(button("Mark as reviewed").disabled);
  fireEvent.click(
    within(screen.getByLabelText("Demo controls")).getByRole("button", {
      name: "Casey",
      exact: true,
    })
  );
  await waitFor(() => assert.equal(button("Mark as reviewed").disabled, false));
  fireEvent.click(button("View changes"));
  fireEvent.click(button("Back to review"));
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Needs review/,
    "navigation alone never verifies the revision"
  );
  fireEvent.click(button("Mark as reviewed"));
  await waitFor(() =>
    assert.match(
      screen.getByLabelText("Message thread").textContent,
      /Reviewed by Casey/
    )
  );
  fireEvent.click(button("View changes"));
  assert.ok(button("Back to review"));
  assert.match(
    screen.getByRole("region", { name: "Workspace reviews" }).textContent,
    /Reviewed by Casey/
  );
  assert.equal(
    screen.queryByRole("button", { name: "Approve changes", exact: true }),
    null
  );
  fireEvent.click(button("Back to review"));
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Diff"));
  fireEvent.click(button("Archive task: Polish the settings menu"));
  fireEvent.click(button("Archive task"));
  await waitFor(() =>
    assert.match(
      screen.getByRole("region", { name: "Workspace reviews" }).textContent,
      /Archived · Read-only/
    )
  );
  assert.match(
    screen.getByRole("region", { name: "Workspace reviews" }).textContent,
    /Reviewed by Casey/
  );
  assert.ok(
    !button("Open review").disabled,
    "archiving preserves direct review navigation"
  );
  fireEvent.click(button("Open review"));
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Reviewed by Casey/
  );
  assert.ok(screen.getByRole("textbox", { name: "Reply in thread" }).disabled);
  assert.ok(
    !screen.queryByRole("button", { name: "Mark as reviewed", exact: true })
  );
  fireEvent.click(button("View changes"));
  assert.ok(!button("Back to review").disabled);
  assert.equal(requests, 0);
  console.log(
    "PASS: direct Diff and review → Diff/Runs preserve status and thread navigation, including archived read-only reviews; only the designated reviewer can verify."
  );
  cleanup();
  const { createDemoWorkspace, demoMembers } =
    await import("../../src/lib/demo/demo-workspace.ts");
  const { requestPeerInput } =
    await import("../../src/lib/conversation/peer-collaboration.ts");
  const { HiveWorkspaceView } =
    await import("../../src/components/hive/hive-workspace.tsx");
  const { HiveClientContext } =
    await import("../../src/components/hive/hive-client.tsx");
  // Pending send and completed server responses must not override navigation.
  const navigationDemo = createDemoWorkspace(demoTasks[0]);
  const navigationSnapshot = structuredClone(navigationDemo.getSnapshot());
  let finishSend;
  render(
    h(
      HiveClientContext,
      { value: navigationDemo.client },
      h(HiveWorkspaceView, {
        currentMember: demoMembers[0],
        sessionId: navigationSnapshot.session.sessionId,
        inviteToken: "",
        connection: {
          snapshot: navigationSnapshot,
          dispatch: (action) =>
            new Promise((resolve) => {
              finishSend = () => {
                const complete = structuredClone(navigationSnapshot);
                complete.session.stage = "review";
                complete.session.messages.push({
                  id: "accepted-ux-message",
                  memberId: demoMembers[0].id,
                  clientId: action.clientId,
                  body: action.body,
                  role: "human",
                  name: "Alex",
                  initials: "AL",
                  time: "12:00 PM",
                });
                resolve(complete);
              };
            }),
          receiveSnapshot() {},
          setTyping() {},
          syncing: false,
          syncError: false,
        },
      })
    )
  );
  fireEvent.click(button("Files"));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" }),
    { target: { value: "Navigation ownership test" } }
  );
  fireEvent.click(button("Send message"));
  assert.equal(
    button("Files").getAttribute("aria-pressed"),
    "true",
    "sending does not switch to Runs"
  );
  fireEvent.click(button("Runs"));
  await act(async () => finishSend());
  assert.equal(
    button("Runs").getAttribute("aria-pressed"),
    "true",
    "completion does not switch to Diff"
  );
  cleanup();
  console.log(
    "PASS: pending and completed sends preserve the reader's latest evidence-tab choice."
  );
  for (const destination of ["failed", "another-thread", "files"]) {
    const handoffDemo = createDemoWorkspace(demoTasks[0]);
    let confirmHandoff;
    const handoffView = () =>
      h(
        HiveClientContext,
        { value: handoffDemo.client },
        h(HiveWorkspaceView, {
          currentMember: demoMembers[0],
          sessionId: handoffDemo.getSnapshot().session.sessionId,
          inviteToken: "",
          connection: {
            snapshot: handoffDemo.getSnapshot(),
            dispatch: (action) =>
              new Promise((resolve) => {
                confirmHandoff = async () =>
                  resolve(
                    destination === "failed"
                      ? undefined
                      : await handoffDemo.dispatch(action)
                  );
              }),
            receiveSnapshot: handoffDemo.receiveSnapshot,
            setTyping() {},
            syncing: false,
            syncError: false,
          },
        })
      );
    const handoffMount = render(handoffView());
    fireEvent.click(button("Open thread with 1 reply"));
    fireEvent.click(button("Steer entire thread with 1 reply"));
    if (destination === "another-thread")
      fireEvent.click(button("Reply in thread to Alex's message"));
    if (destination === "files") {
      fireEvent.click(button("Close thread"));
      fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
      fireEvent.click(button("Files"));
    }
    await act(async () => confirmHandoff());
    handoffMount.rerender(handoffView());
    if (destination === "failed") {
      assert.match(
        screen.getByLabelText("Message thread").textContent,
        /thread could not be steered/
      );
      assert.equal(
        handoffDemo.getSnapshot().session.workspace.liveReply,
        undefined
      );
    } else if (destination === "another-thread") {
      assert.match(
        screen.getByLabelText("Message thread").textContent,
        /Make the Settings menu more predictable/
      );
      assert.equal(
        screen
          .getByRole("button", { name: "Thread", exact: true })
          .getAttribute("aria-pressed"),
        "true"
      );
    } else {
      assert.equal(button("Files").getAttribute("aria-pressed"), "true");
      assert.equal(
        screen
          .getByRole("button", { name: /^Workspace/ })
          .getAttribute("aria-pressed"),
        "true"
      );
    }
    cleanup();
  }
  console.log(
    "PASS: failed Steer keeps discussion open; delayed acknowledgements never pull readers out of another Thread or Files."
  );
  const attentionSnapshot = structuredClone(navigationSnapshot);
  const attentionParent = {
    id: "attention-parent",
    role: "human",
    name: "Alex",
    initials: "AL",
    body: "Discuss the navigation",
    time: "12:00 PM",
    memberId: demoMembers[0].id,
  };
  const attentionQuestion = {
    id: "attention-child",
    threadId: attentionParent.id,
    role: "agent",
    name: "Hive",
    initials: "H",
    body: "Should the menu stay open?",
    time: "12:01 PM",
    interaction: {
      kind: "question",
      runId: "attention-run",
      targetMemberId: demoMembers[0].id,
      options: ["Yes", "No"],
    },
  };
  attentionSnapshot.session.messages = [attentionParent, attentionQuestion];
  render(
    h(
      HiveClientContext,
      { value: navigationDemo.client },
      h(HiveWorkspaceView, {
        currentMember: demoMembers[0],
        sessionId: "ux-child-attention",
        inviteToken: "",
        connection: {
          snapshot: attentionSnapshot,
          dispatch: async () => {
            throw new Error("Opening a question must not dispatch");
          },
          receiveSnapshot() {},
          setTyping() {},
          syncing: false,
          syncError: false,
        },
      })
    )
  );
  fireEvent.click(button("1 question needs your answer"));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Reply in thread" }).disabled,
      false
    )
  );
  await waitFor(() =>
    assert.equal(
      document.activeElement?.dataset.messageId,
      attentionQuestion.id,
      "attention focuses the child question, not the Thread composer"
    )
  );
  assert.ok(
    within(screen.getByLabelText("Message thread")).getByText(
      attentionQuestion.body
    )
  );
  cleanup();
  console.log(
    "PASS: Thread question attention opens and focuses the original question without dispatching work."
  );
  // The actual thread view shows pending feedback only for its active run.
  const { MessageThread } =
    await import("../../src/components/hive/conversation/message-thread.tsx");
  const threadWaitingProps = {
    sessionId: "ux-wait",
    message: {
      id: "ux-parent",
      name: "Alex",
      initials: "AL",
      role: "human",
      body: "Discuss this",
      time: "12:00 PM",
    },
    members: demoMembers,
    currentMember: demoMembers[0].id,
    disabled: false,
    runActive: true,
    queue: [],
    onClose() {},
    onReply: async () => true,
    onSteerThread: async () => true,
  };
  const waitingThread = render(
    h(MessageThread, { ...threadWaitingProps, replying: true })
  );
  assert.ok(screen.getByText("Hive is replying in this thread…"));
  waitingThread.rerender(
    h(MessageThread, { ...threadWaitingProps, replying: false })
  );
  assert.equal(
    screen.queryByText("Hive is replying in this thread…"),
    null,
    "an unrelated run cannot make this Thread appear busy"
  );
  waitingThread.rerender(
    h(MessageThread, {
      ...threadWaitingProps,
      replying: true,
      message: {
        ...threadWaitingProps.message,
        annotations: [
          {
            id: "live-reply",
            role: "agent",
            authorId: "hive-agent",
            body: "Incremental text",
            deliveryStatus: "streaming",
            createdAt: Date.now(),
            status: "open",
          },
        ],
      },
    })
  );
  assert.equal(
    screen.queryByText("Hive is replying in this thread…"),
    null,
    "first text replaces the pending placeholder"
  );
  cleanup();
  console.log(
    "PASS: first-token waiting feedback belongs to the running Thread and settles when text arrives."
  );
  // Reproduce the reported shape: one long discussion plus a repeated empty
  // question from another run. Use the production view and original IDs.
  const threadDemo = createDemoWorkspace(demoTasks[0]);
  const threadSnapshot = structuredClone(threadDemo.getSnapshot());
  const longThreadBody =
    "Here are the tradeoffs. ".repeat(40) + "THREAD_FULL_TEXT";
  const firstQuestion = {
    id: "peer-run-original-close_tab",
    role: "agent",
    name: "Hive",
    initials: "H",
    time: "12:28 AM",
    body: "Should we close the tab after use?",
    interaction: {
      kind: "question",
      runId: "run-original",
      targetMemberId: demoMembers[1].id,
      options: ["Yes", "No"],
    },
    annotations: [
      {
        id: "first-opinion",
        authorId: demoMembers[0].id,
        body: "Let's discuss the tradeoffs first.",
        createdAt: 1,
        status: "open",
      },
      {
        id: "first-analysis",
        authorId: "hive-agent",
        role: "agent",
        body: longThreadBody,
        createdAt: 2,
        status: "open",
      },
    ],
  };
  const repeatedQuestion = {
    ...firstQuestion,
    id: "peer-run-repeated-close_tab",
    interaction: { ...firstQuestion.interaction, runId: "run-repeated" },
    annotations: [],
  };
  threadSnapshot.session.messages = [firstQuestion, repeatedQuestion];
  threadDemo.receiveSnapshot(threadSnapshot);
  const originalHistory = structuredClone(
    threadDemo.getSnapshot().session.messages
  );
  const threadActions = [];
  const threadView = () =>
    h(
      HiveClientContext,
      { value: threadDemo.client },
      h(HiveWorkspaceView, {
        currentMember: demoMembers[0],
        sessionId: threadSnapshot.session.sessionId,
        inviteToken: "",
        connection: {
          snapshot: threadDemo.getSnapshot(),
          dispatch: (action) => {
            threadActions.push(action);
            return threadDemo.dispatch(action);
          },
          receiveSnapshot: threadDemo.receiveSnapshot,
          setTyping: threadDemo.setTyping,
          syncing: false,
          syncError: false,
        },
      })
    );
  const threadMount = render(threadView());
  assert.equal(
    screen.getAllByText(firstQuestion.body).length,
    1,
    "the repeated empty question must not create a second timeline card"
  );
  assert.equal(
    screen.getAllByRole("button", {
      name: "Open thread with 2 replies",
      exact: true,
    }).length,
    1
  );
  assert.equal(
    screen.queryByText(/THREAD_FULL_TEXT/),
    null,
    "full replies belong only to the thread, not the main timeline"
  );
  fireEvent.click(button("Open thread with 2 replies"));
  const fullThread = screen.getByLabelText("Message thread");
  assert.match(fullThread.textContent, /Let's discuss the tradeoffs first/);
  assert.match(fullThread.textContent, /THREAD_FULL_TEXT/);
  assert.equal(
    (document.body.textContent.match(/THREAD_FULL_TEXT/g) ?? []).length,
    1
  );
  assert.equal(
    (document.body.textContent.match(/Here are the tradeoffs/g) ?? []).length,
    40,
    "even the short excerpt disappears while the full thread is open"
  );
  assert.equal(
    button("Open thread with 2 replies").getAttribute("aria-expanded"),
    "true"
  );
  assert.deepEqual(threadActions, [], "navigation must not wake Hive");
  assert.deepEqual(
    threadDemo.getSnapshot().session.messages,
    originalHistory,
    "projection must never rewrite or delete stored messages"
  );
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "Reply in thread" }).disabled,
      false
    )
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reply in thread" }), {
    target: { value: "New reply to the original discussion" },
  });
  fireEvent.click(button("Send reply"));
  await waitFor(() => assert.equal(threadActions.length, 1));
  assert.equal(threadActions[0].type, "annotate-message");
  assert.equal(threadActions[0].messageId, firstQuestion.id);
  threadMount.rerender(threadView());
  const addedReply = screen
    .getByText("New reply to the original discussion")
    .closest("article");
  assert.equal(
    within(addedReply).queryByRole("button", { name: /Steer|Queue/ }),
    null
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: /Steer entire thread|Queue entire thread/,
    })
  );
  await waitFor(() => assert.equal(threadActions.length, 2));
  assert.equal(threadActions[1].type, "steer-thread");
  assert.equal(threadActions[1].messageId, firstQuestion.id);
  await waitFor(() =>
    assert.equal(
      screen.queryByLabelText("Message thread"),
      null,
      "a confirmed handoff returns the sender to the main conversation"
    )
  );
  assert.equal(
    threadDemo.getSnapshot().session.workspace.liveReply.threadId,
    undefined
  );
  const handoffRunId = threadDemo.getSnapshot().session.workspace.liveReply.id;
  const handoffReplies = threadDemo
    .getSnapshot()
    .session.messages.find((m) => m.id === firstQuestion.id).annotations;
  await act(async () => threadDemo.finishRun(handoffRunId));
  threadMount.rerender(threadView());
  assert.match(
    threadDemo.getSnapshot().session.messages.find((m) => m.id === handoffRunId)
      .body,
    /Simulated result/
  );
  assert.deepEqual(
    threadDemo
      .getSnapshot()
      .session.messages.find((m) => m.id === firstQuestion.id).annotations,
    handoffReplies
  );
  assert.equal(
    threadDemo
      .getSnapshot()
      .session.messages.find((m) => m.id === repeatedQuestion.id).annotations
      .length,
    0
  );
  assert.equal(requests, 0);
  console.log(
    "PASS: repeated empty questions collapse without history loss; full text appears once, and reply/steer keep the original Thread identity with no navigation wakeups."
  );
  cleanup();
  const reviewsDemo = createDemoWorkspace(demoTasks[0]);
  await reviewsDemo.dispatch({
    type: "send-message",
    body: "Prepare the first revision",
    clientId: "review-first",
  });
  reviewsDemo.finishRun(
    reviewsDemo.getSnapshot().session.workspace.liveReply.id
  );
  await reviewsDemo.dispatch({
    type: "send-message",
    body: "Prepare a new revision",
    clientId: "review-next",
  });
  const preparing = reviewsDemo.getSnapshot();
  const secondRunId = preparing.session.workspace.liveReply.id;
  reviewsDemo.receiveSnapshot({
    ...preparing,
    session: requestPeerInput(
      preparing.session,
      {
        sessionId: preparing.session.sessionId,
        runId: secondRunId,
        memberId: demoMembers[0].id,
      },
      {
        kind: "review",
        key: "second-reviewer",
        prompt: "Alex, check the current keyboard behavior",
        targetMemberId: demoMembers[0].id,
      },
      demoMembers,
      Date.now()
    ).session,
  });
  reviewsDemo.finishRun(secondRunId);
  let navigationWrites = 0;
  const reviewView = () =>
    h(
      HiveClientContext,
      { value: reviewsDemo.client },
      h(HiveWorkspaceView, {
        currentMember: demoMembers[0],
        sessionId: reviewsDemo.getSnapshot().session.sessionId,
        inviteToken: "",
        homeHref: "/demo",
        connectionLabel: "Demo",
        accountActionsDisabled: true,
        connection: {
          snapshot: reviewsDemo.getSnapshot(),
          dispatch: (action) => {
            navigationWrites++;
            return reviewsDemo.dispatch(action);
          },
          receiveSnapshot: reviewsDemo.receiveSnapshot,
          setTyping: reviewsDemo.setTyping,
          syncing: false,
          syncError: false,
        },
      })
    );
  const reviewMount = render(reviewView());
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  assert.equal(
    within(
      screen.getByRole("region", { name: "Workspace reviews" })
    ).getAllByRole("button", { name: "Open review" }).length,
    2,
    "direct Diff lists every review of this revision, excluding the earlier revision"
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Open review", exact: true })[0]
  );
  assert.match(
    screen.getByLabelText("Message thread").textContent,
    /Alex, check the current keyboard behavior/
  );
  fireEvent.click(button("View changes"));
  assert.match(
    screen.getByRole("region", { name: "Workspace reviews" }).textContent,
    /Review for Alex/
  );
  assert.doesNotMatch(
    screen.getByRole("region", { name: "Workspace reviews" }).textContent,
    /Review for Casey/
  );
  fireEvent.click(button("Back to review"));
  fireEvent.click(button("Close thread"));
  // Questions are inline; locate the old review by its durable revision, not a card ordinal.
  const oldReview = reviewsDemo
    .getSnapshot()
    .session.messages.find(
      (message) =>
        message.interaction?.kind === "review" &&
        message.interaction.revision !== secondRunId
    );
  fireEvent.click(
    within(
      document.querySelector(`[data-message-id="${oldReview.id}"]`)
    ).getByRole("button", { name: "Open collaboration thread", exact: true })
  );
  assert.ok(button("Mark as reviewed").disabled);
  fireEvent.click(button("View changes"));
  assert.match(
    screen.getByRole("region", { name: "Workspace reviews" }).textContent,
    /does not match the current diff/
  );
  fireEvent.click(button("Back to review"));
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  assert.equal(
    screen.getAllByRole("button", { name: "Open review", exact: true }).length,
    2
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Open review", exact: true })[0]
  );
  assert.ok(
    !button("Mark as reviewed").disabled,
    "the current review is ready for Alex before archiving"
  );
  assert.equal(
    navigationWrites,
    0,
    "opening and switching reviews never dispatches a task mutation"
  );
  await reviewsDemo.dispatch({ type: "archive-task" });
  reviewMount.rerender(reviewView());
  assert.ok(button("Mark as reviewed").disabled);
  assert.doesNotMatch(
    screen.getByLabelText("Message thread").textContent,
    /changes are out of date/,
    "archiving is not a revision change"
  );
  fireEvent.click(button("View changes"));
  assert.match(
    screen.getByRole("region", { name: "Workspace reviews" }).textContent,
    /Archived · Read-only/
  );
  assert.ok(!button("Back to review").disabled);
  assert.equal(navigationWrites, 0);
  assert.equal(requests, 0);
  console.log(
    "PASS: direct Diff shows all current reviews, excludes old revisions, preserves the selected thread, and keeps archived unresolved reviews read-only."
  );
  cleanup();
  const { WorkspaceCheckpoints } =
    await import("../../src/components/hive/workspace/workspace-checkpoints.tsx");
  const remote = createDemoWorkspace(demoTasks[0]);
  const checkpoints = () =>
    h(
      HiveClientContext,
      { value: remote.client },
      h(WorkspaceCheckpoints, {
        sessionId: remote.getSnapshot().session.sessionId,
        revision: remote.getSnapshot().session.version,
        onRestored: remote.receiveSnapshot,
        recoveryStatus: { checking: false, notice: "", check() {} },
      })
    );
  const mounted = render(checkpoints());
  await waitFor(() =>
    assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ }))
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Restore checkpoint from/ })
  );
  assert.equal(button("Restore checkpoint").disabled, false);
  await remote.dispatch({ type: "archive-task" });
  mounted.rerender(checkpoints());
  await waitFor(() => assert.ok(button("Restore checkpoint").disabled));
  await waitFor(() =>
    assert.match(screen.getByRole("dialog").textContent, /archived/)
  );
  assert.equal(requests, 0);
  console.log(
    "PASS: a teammate archiving the task also disables an already-open checkpoint confirmation."
  );
  cleanup();
  // A delayed POST must not trap the user in a modal. After an uncertain result,
  // status checks reconcile the existing operation instead of replaying it.
  const recoveryDemo = createDemoWorkspace(demoTasks[0]);
  const baseCheckpointData = await (
    await recoveryDemo.client.request(
      `/api/sessions/${recoveryDemo.getSnapshot().session.sessionId}/checkpoints`
    )
  ).json();
  let recoveryData = baseCheckpointData,
    recoverySnapshot = recoveryDemo.getSnapshot();
  let releaseRestore,
    restoreCalls = 0,
    checkCalls = 0,
    deliveredRecovery;
  const recoveryClient = {
    ...recoveryDemo.client,
    request: async (_path, init) => {
      if (init?.method !== "POST") return Response.json(recoveryData);
      const request = JSON.parse(init.body);
      if (request.mode === "check") {
        checkCalls++;
        const confirmed = structuredClone(recoverySnapshot);
        confirmed.session.version++;
        confirmed.session.workspace.lastRestore = {
          id: request.id,
          snapshotId: request.snapshotId,
          by: confirmed.members[0].id,
          at: Date.now(),
        };
        delete confirmed.session.workspace.restore;
        recoveryData = {
          ...baseCheckpointData,
          version: confirmed.session.version,
        };
        return Response.json(confirmed);
      }
      restoreCalls++;
      recoveryData = {
        ...baseCheckpointData,
        blockedReason: "Still confirming the restored workspace…",
        restore: {
          id: request.id,
          snapshotId: request.snapshotId,
          status: "unconfirmed",
          retryAfter: Date.now() + 400,
        },
      };
      recoverySnapshot = structuredClone(recoverySnapshot);
      recoverySnapshot.session.version++;
      recoverySnapshot.session.workspace.restore = {
        ...recoveryData.restore,
        startedAt: Date.now(),
        sourceSessionId: "original-vm",
        by: recoverySnapshot.members[0],
      };
      recoveryMounted.rerender(recoveryView());
      return new Promise((resolve) => {
        releaseRestore = () =>
          resolve(
            Response.json(
              { error: "Restore response timed out." },
              { status: 503 }
            )
          );
      });
    },
  };
  const recoveryView = () =>
    h(
      HiveClientContext,
      { value: recoveryClient },
      h(HiveWorkspaceView, {
        sessionId: recoverySnapshot.session.sessionId,
        currentMember: recoverySnapshot.members[0],
        inviteToken: "demo",
        connection: {
          snapshot: recoverySnapshot,
          dispatch: async () => {
            throw new Error("Recovery must not start an agent");
          },
          setTyping() {},
          syncing: false,
          syncError: false,
          receiveSnapshot: (snapshot) => {
            deliveredRecovery = snapshot;
            recoverySnapshot = snapshot;
            recoveryMounted.rerender(recoveryView());
          },
        },
      })
    );
  const recoveryMounted = render(recoveryView());
  fireEvent.click(button("Checkpoints"));
  await waitFor(() =>
    assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ }))
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Restore checkpoint from/ })
  );
  fireEvent.click(button("Restore checkpoint"));
  assert.ok(button("Restoring…").disabled);
  assert.ok(!button("Close dialog").disabled);
  assert.match(
    screen.getByRole("dialog").textContent,
    /You can close this dialog/
  );
  fireEvent.click(button("Close dialog"));
  assert.ok(!screen.queryByRole("dialog"));
  assert.equal(restoreCalls, 1);
  await act(async () => releaseRestore());
  await waitFor(() =>
    assert.match(document.body.textContent, /Checking automatically/)
  );
  assert.doesNotMatch(
    document.body.textContent,
    /Checking safely in \d+s/,
    "a write retry fence must not look like an idle wait before status can be checked"
  );
  assert.ok(
    !button("Check status").disabled,
    "read-only status is available before the retry lease expires"
  );
  assert.ok(
    button("Retry restore").disabled,
    "only another write remains delayed"
  );
  fireEvent.click(button("Diff"));
  assert.equal(
    screen.queryByRole("button", { name: "Refresh checkpoints" }),
    null
  );
  await waitFor(() => assert.ok(deliveredRecovery), { timeout: 1500 });
  assert.equal(
    screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" })
      .disabled,
    false
  );
  assert.equal(checkCalls, 1);
  assert.equal(
    restoreCalls,
    1,
    "automatic status confirmation never submits another destructive restore"
  );
  assert.equal(requests, 0);
  console.log(
    "PASS: the restoring dialog can close, switching to Diff does not stop recovery, and metadata-only confirmation unlocks the composer without another restore."
  );
  cleanup();
  // A viewer on Diff never mounts Checkpoints. Recovery still belongs to the task.
  const diffDemo = createDemoWorkspace(demoTasks[0]);
  const completedOnDiff = diffDemo.getSnapshot();
  const pendingOnDiff = structuredClone(completedOnDiff);
  pendingOnDiff.session.version += 1;
  pendingOnDiff.session.workspace.restore = {
    id: "88b52ee4-8f47-48a6-a057-c023eaa4454c",
    snapshotId: "target-checkpoint",
    sourceSessionId: "original-vm",
    by: completedOnDiff.members[0],
    status: "unconfirmed",
    startedAt: Date.now() - 100_000,
    retryAfter: Date.now() - 1,
  };
  const confirmedOnDiff = structuredClone(completedOnDiff);
  confirmedOnDiff.session.version = pendingOnDiff.session.version + 1;
  confirmedOnDiff.session.workspace.lastRestore = {
    id: pendingOnDiff.session.workspace.restore.id,
    snapshotId: "target-checkpoint",
    by: completedOnDiff.members[0].id,
    at: Date.now(),
  };
  confirmedOnDiff.session.messages.push({
    id: "restore-while-on-diff",
    memberId: completedOnDiff.members[0].id,
    name: "Alex",
    initials: "AL",
    role: "human",
    body: "Restored while viewing Diff; nothing was rerun.",
    time: "12:00 PM",
  });
  let diffSnapshot = pendingOnDiff,
    diffChecks = 0;
  const receiveOnDiff = (next) => {
    diffSnapshot = next;
    diffMounted.rerender(diffView());
  };
  const diffClient = {
    ...diffDemo.client,
    request: async (_path, init) => {
      assert.equal(
        init?.method,
        "POST",
        "a viewer on Diff must not fetch the checkpoint list"
      );
      assert.equal(
        JSON.parse(init.body).mode,
        "check",
        "recovery must never replay the restore"
      );
      diffChecks++;
      return Response.json(confirmedOnDiff);
    },
  };
  const diffView = () =>
    h(
      HiveClientContext,
      { value: diffClient },
      h(HiveWorkspaceView, {
        sessionId: diffSnapshot.session.sessionId,
        currentMember: completedOnDiff.members[0],
        inviteToken: "demo",
        connection: {
          snapshot: diffSnapshot,
          dispatch: async () => {
            throw new Error("Recovery must not start an agent");
          },
          setTyping() {},
          syncing: false,
          syncError: false,
          receiveSnapshot: receiveOnDiff,
        },
      })
    );
  const diffMounted = render(diffView());
  assert.ok(
    screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" })
      .disabled
  );
  assert.equal(
    screen.queryByRole("button", { name: "Refresh checkpoints" }),
    null
  );
  await waitFor(
    () =>
      assert.equal(
        screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" })
          .disabled,
        false
      ),
    { timeout: 1500 }
  );
  assert.equal(diffChecks, 1);
  assert.equal(
    screen.queryByText("Restore needs confirmation. The workspace is paused."),
    null
  );
  assert.equal(
    screen.queryByText("Restored while viewing Diff; nothing was rerun."),
    null,
    "restore receipts no longer appear as user chat bubbles"
  );
  assert.ok(
    diffSnapshot.session.messages.some(
      (message) => message.id === "restore-while-on-diff"
    ),
    "the receipt remains in stored context"
  );
  assert.equal(requests, 0);
  console.log(
    "PASS: a viewer staying on Diff confirms recovery and unlocks the composer without opening Checkpoints, replaying the restore or running an agent."
  );
  cleanup();
  const { useWorkspaceRecovery } =
    await import("../../src/hooks/use-workspace-recovery.ts");
  mock.timers.enable({ apis: ["setTimeout"] });
  const pendingChecks = [],
    receivedChecks = [];
  const pendingClient = {
    ...diffDemo.client,
    request: (_path, init) =>
      new Promise((resolve) => pendingChecks.push({ init, resolve })),
  };
  const wrapper = ({ children }) =>
    h(HiveClientContext, { value: pendingClient }, children);
  const operation = pendingOnDiff.session.workspace.restore;
  const hook = renderHook(
    ({ version, restore }) =>
      useWorkspaceRecovery("demo-task", version, restore, (snapshot) =>
        receivedChecks.push(snapshot)
      ),
    { wrapper, initialProps: { version: 1, restore: operation } }
  );
  await act(async () => mock.timers.tick(0));
  assert.equal(pendingChecks.length, 1);
  hook.rerender({ version: 2, restore: { ...operation } });
  await act(async () => mock.timers.tick(0));
  assert.equal(
    pendingChecks.length,
    1,
    "ordinary snapshots and callback identities do not restart checks"
  );
  assert.equal(pendingChecks[0].init.signal.aborted, false);
  hook.rerender({
    version: 3,
    restore: { ...operation, startedAt: operation.startedAt + 1 },
  });
  assert.ok(
    pendingChecks[0].init.signal.aborted,
    "a new attempt cancels the previous check even when its operation id is reused"
  );
  await act(async () => mock.timers.tick(0));
  assert.equal(pendingChecks.length, 2);
  await act(async () =>
    pendingChecks[0].resolve(Response.json({ stale: true }))
  );
  assert.deepEqual(
    receivedChecks,
    [],
    "an aborted late response cannot update the task"
  );
  await act(async () =>
    pendingChecks[1].resolve(Response.json(confirmedOnDiff))
  );
  assert.deepEqual(receivedChecks, [
    JSON.parse(JSON.stringify(confirmedOnDiff)),
  ]);
  hook.rerender({ version: 4, restore: undefined });
  await act(async () => mock.timers.tick(60_000));
  assert.equal(pendingChecks.length, 2, "confirmation leaves no idle polling");
  hook.unmount();
  const boundedRequests = [];
  const boundedClient = {
    ...diffDemo.client,
    request: async (_path, init) => {
      boundedRequests.push(JSON.parse(init.body));
      return Response.json({ pending: true }, { status: 202 });
    },
  };
  const bounded = renderHook(
    ({ version }) =>
      useWorkspaceRecovery("demo-task", version, { ...operation }, () => {
        throw new Error("202 must not unlock the task");
      }),
    {
      wrapper: ({ children }) =>
        h(HiveClientContext, { value: boundedClient }, children),
      initialProps: { version: 1 },
    }
  );
  for (let attempt = 1; attempt <= 18; attempt++) {
    bounded.rerender({ version: attempt });
    await act(async () => mock.timers.tick(attempt === 1 ? 0 : 10_000));
    assert.equal(boundedRequests.length, attempt);
    assert.equal(
      boundedRequests.at(-1).version,
      attempt,
      "checks use the current revision without resetting their budget"
    );
    assert.equal(boundedRequests.at(-1).mode, "check");
  }
  bounded.rerender({ version: 19 });
  await act(async () => mock.timers.tick(60_000));
  assert.equal(
    boundedRequests.length,
    18,
    "task updates cannot turn bounded checks into a permanent heartbeat"
  );
  assert.match(bounded.result.current.notice, /taking longer than usual/);
  act(() => bounded.result.current.check());
  await act(async () => mock.timers.tick(0));
  assert.equal(
    boundedRequests.length,
    19,
    "explicit Check status can retry the same metadata check"
  );
  bounded.unmount();
  mock.timers.reset();
  console.log(
    "PASS: recovery ignores stale attempts, survives task revisions, stops after 18 pending checks, and leaves no idle heartbeat."
  );
} finally {
  cleanup();
  mock.timers.reset();
  dom.close();
}
