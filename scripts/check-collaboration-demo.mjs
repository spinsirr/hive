// Mount the actual workspace, not a copied preview. Only Monaco's browser engine
// is represented by a text fixture here; browser QA covers the real editor.
import "./check-design-system.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/demo/tasks/demo-menu", pretendToBeVisual: true });
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event", "MouseEvent", "Node", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.DOMRect = window.DOMRect;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Demo attempted an HTTP request"); };
globalThis.WebSocket = class { constructor() { requests++; throw new Error("Demo mounted live transport"); } };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return next("next/link.js", context);
    if (specifier === "next/dynamic") return next("next/dynamic.js", context);
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return next(specifier, context);
    const base = specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}`, import.meta.url) : new URL(specifier, context.parentURL);
    const target = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((url) => existsSync(url));
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".module.css")) return { format: "module", shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => key });' };
    if (url.endsWith("/next/dynamic.js")) return { format: "module", shortCircuit: true, source: 'import { createElement } from "react"; export default () => function CodeFixture({ path, content }) { return createElement("pre", { "aria-label": `Sample file: ${path}` }, content); };' };
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});
const { createElement: h } = await import("react");
const { render, renderHook, screen, fireEvent, cleanup, waitFor, within, act } = await import("@testing-library/react");
const { DemoWorkspace } = await import("../src/app/demo/demo-workspace.tsx");
const { demoTasks } = await import("../src/lib/ui-demo.ts");
try {
  render(h(DemoWorkspace, { task: demoTasks[0] }));
  const button = (name) => screen.getByRole("button", { name, exact: true });
  assert.ok(screen.getByLabelText("Demo controls"));
  assert.ok(screen.getByLabelText("Resize conversation and workspace"));
  for (const name of ["Diff", "Files", "Runs", "Checkpoints"]) assert.ok(button(name));
  assert.ok(button("Invite teammate").disabled);
  assert.equal(screen.getByRole("link", { name: /Hive/ }).getAttribute("href"), "/demo");
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Files"));
  await waitFor(() => assert.match(screen.getByLabelText("Sample file: src/components/settings-nav.tsx").textContent, /SettingsNav/));
  fireEvent.click(button("Checkpoints"));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ })));
  fireEvent.click(screen.getByRole("button", { name: /^Restore checkpoint from/ }));
  assert.ok(screen.getByRole("dialog", { name: "Restore this checkpoint?" }));
  fireEvent.click(button("Cancel"));
  fireEvent.click(button("Conversation"));
  fireEvent.click(button("Open collaboration thread"));
  await waitFor(() => assert.ok(screen.getByRole("textbox", { name: "Answer Hive" })));
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Casey", exact: true }));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, false));
  assert.equal(screen.queryByRole("button", { name: "Send answer", exact: true }), null, "Casey cannot formally answer a question assigned to Alex");
  assert.equal(screen.queryByRole("button", { name: "Keep it open", exact: true }), null, "answer options are only shown to the addressee");
  fireEvent.change(screen.getByRole("textbox", { name: "Reply in thread" }), { target: { value: "Casey discussion, not Alex's answer" } });
  fireEvent.click(button("Send reply"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Casey discussion, not Alex's answer/));
  assert.match(screen.getByLabelText("Message thread").textContent, /Question for Alex/);
  assert.match(screen.getByLabelText("Message thread").textContent, /Needs answer/);
  assert.doesNotMatch(screen.getByLabelText("Message thread").textContent, /Answered by Casey|Simulated result/);
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Alex", exact: true }));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Answer Hive" }).disabled, false));
  console.log("PASS: Casey can discuss, but cannot answer Alex's question; switching back restores Alex's answer controls.");
  fireEvent.click(button("Keep it open"));
  fireEvent.click(button("Send answer"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Answered by Alex/));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Simulated result/), { timeout: 2500 });
  fireEvent.click(button("Close thread"));
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Casey", exact: true }));
  fireEvent.click(button("Open thread with 1 reply"));
  await waitFor(() => assert.ok(screen.getByLabelText("Message thread")));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, false));
  const input = screen.getByRole("textbox", { name: "Reply in thread" });
  fireEvent.change(input, { target: { value: "Please keep the focus ring visible" } });
  fireEvent.click(button("Send reply"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Please keep the focus ring visible/));
  fireEvent.click(button("Archive task: Polish the settings menu"));
  fireEvent.click(button("Archive task"));
  await waitFor(() => assert.ok(screen.getByText(/Read-only for everyone/)));
  assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, true);
  assert.ok(button("Send reply").disabled);
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Files"));
  await waitFor(() => assert.match(screen.getByLabelText("Sample file: src/components/settings-nav.tsx").textContent, /SettingsNav/));
  fireEvent.click(button("Checkpoints"));
  await waitFor(() => assert.ok(screen.getAllByRole("button", { name: /^Restore checkpoint from/ }).every((button) => button.disabled)));
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Alex", exact: true }));
  fireEvent.click(button("Restore task: Polish the settings menu"));
  fireEvent.click(button("Restore task"));
  await waitFor(() => assert.equal(screen.queryByText(/Read-only for everyone/), null));
  fireEvent.click(button("Conversation"));
  fireEvent.click(button("Open thread with 2 replies"));
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Reply in thread" }).disabled, false));
  assert.match(screen.getByLabelText("Message thread").textContent, /Please keep the focus ring visible/);
  console.log("PASS: shared archive dialog locks discussion and checkpoint writes, preserves Files and replies, and another member restores without starting an agent.");
  assert.equal(requests, 0, "demo interactions never call HTTP or WebSocket");
  console.log("PASS: real workspace, files, checkpoint dialog, question continuation, teammate reply, and zero service calls.");
  cleanup();
  render(h(DemoWorkspace, { task: demoTasks[0] }));
  const composer = screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" });
  await waitFor(() => assert.equal(composer.disabled, false));
  fireEvent.change(composer, { target: { value: "Prepare the sample change for Casey to review" } });
  fireEvent.click(button("Send message"));
  await waitFor(() => assert.ok(screen.getByText("Review this sample change together. Does the keyboard focus behavior look right?")), { timeout: 2500 });
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Diff"));
  const directReviews = screen.getByRole("region", { name: "Workspace reviews" });
  assert.match(directReviews.textContent, /Review for Casey/);
  assert.match(directReviews.textContent, /Needs review/);
  assert.ok(document.activeElement !== button("Open review"), "direct Diff entry does not steal focus");
  fireEvent.click(button("Open review"));
  assert.match(screen.getByLabelText("Message thread").textContent, /Review this sample change together/);
  assert.ok(button("Verify & resolve").disabled, "Alex cannot verify Casey's review");
  fireEvent.click(button("View changes"));
  assert.ok(!screen.queryByRole("button", { name: "Approve changes", exact: true }), "viewing a review diff must not expose a separate task approval");
  assert.ok(button("Back to review"));
  assert.ok(document.activeElement === button("Back to review"), "keyboard focus lands on safe review navigation, not an approval action");
  assert.equal(screen.queryByRole("button", { name: "Verify & resolve", exact: true }), null, "verification stays in its thread");
  fireEvent.click(button("Runs"));
  fireEvent.click(button("Back to review"));
  assert.match(screen.getByLabelText("Message thread").textContent, /Review for Casey/);
  assert.match(screen.getByLabelText("Message thread").textContent, /Needs review/);
  assert.ok(button("Verify & resolve").disabled);
  fireEvent.click(within(screen.getByLabelText("Demo controls")).getByRole("button", { name: "Casey", exact: true }));
  await waitFor(() => assert.equal(button("Verify & resolve").disabled, false));
  fireEvent.click(button("View changes"));
  fireEvent.click(button("Back to review"));
  assert.match(screen.getByLabelText("Message thread").textContent, /Needs review/, "navigation alone never verifies the revision");
  fireEvent.click(button("Verify & resolve"));
  await waitFor(() => assert.match(screen.getByLabelText("Message thread").textContent, /Verified by Casey/));
  fireEvent.click(button("View changes"));
  assert.ok(button("Back to review"));
  assert.match(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /Verified by Casey/);
  assert.equal(screen.queryByRole("button", { name: "Approve changes", exact: true }), null);
  fireEvent.click(button("Back to review"));
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(button("Diff"));
  fireEvent.click(button("Archive task: Polish the settings menu"));
  fireEvent.click(button("Archive task"));
  await waitFor(() => assert.match(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /Archived · Read-only/));
  assert.match(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /Verified by Casey/);
  assert.ok(!button("Open review").disabled, "archiving preserves direct review navigation");
  fireEvent.click(button("Open review"));
  assert.match(screen.getByLabelText("Message thread").textContent, /Verified by Casey/);
  assert.ok(screen.getByRole("textbox", { name: "Reply in thread" }).disabled);
  assert.ok(!screen.queryByRole("button", { name: "Verify & resolve", exact: true }));
  fireEvent.click(button("View changes"));
  assert.ok(!button("Back to review").disabled);
  assert.equal(requests, 0);
  console.log("PASS: direct Diff and review → Diff/Runs preserve status and thread navigation, including archived read-only reviews; only the designated reviewer can verify.");
  cleanup();
  const { createDemoWorkspace, demoMembers } = await import("../src/lib/demo-workspace.ts");
  const { requestPeerInput } = await import("../src/lib/peer-collaboration.ts");
  const { HiveWorkspaceView } = await import("../src/components/hive/hive-workspace.tsx");
  const { HiveClientContext } = await import("../src/components/hive/hive-client.tsx");
  const reviewsDemo = createDemoWorkspace(demoTasks[0]);
  await reviewsDemo.dispatch({ type: "send-message", body: "Prepare the first revision", clientId: "review-first" });
  reviewsDemo.finishRun(reviewsDemo.getSnapshot().session.workspace.liveReply.id);
  await reviewsDemo.dispatch({ type: "send-message", body: "Prepare a new revision", clientId: "review-next" });
  const preparing = reviewsDemo.getSnapshot();
  const secondRunId = preparing.session.workspace.liveReply.id;
  reviewsDemo.receiveSnapshot({ ...preparing, session: requestPeerInput(preparing.session,
    { sessionId: preparing.session.sessionId, runId: secondRunId, memberId: demoMembers[0].id },
    { kind: "review", key: "second-reviewer", prompt: "Alex, check the current keyboard behavior", targetMemberId: demoMembers[0].id }, demoMembers, Date.now()).session });
  reviewsDemo.finishRun(secondRunId);
  let navigationWrites = 0;
  const reviewView = () => h(HiveClientContext, { value: reviewsDemo.client }, h(HiveWorkspaceView, {
    currentMember: demoMembers[0], sessionId: reviewsDemo.getSnapshot().session.sessionId,
    sessionTitle: demoTasks[0].title, inviteToken: "", homeHref: "/demo", connectionLabel: "Demo", accountActionsDisabled: true,
    connection: { snapshot: reviewsDemo.getSnapshot(), dispatch: (action) => { navigationWrites++; return reviewsDemo.dispatch(action); },
      receiveSnapshot: reviewsDemo.receiveSnapshot, setTyping: reviewsDemo.setTyping, syncing: false, syncError: false },
  }));
  const reviewMount = render(reviewView());
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  assert.equal(within(screen.getByRole("region", { name: "Workspace reviews" })).getAllByRole("button", { name: "Open review" }).length, 2, "direct Diff lists every review of this revision, excluding the earlier revision");
  fireEvent.click(screen.getAllByRole("button", { name: "Open review", exact: true })[0]);
  assert.match(screen.getByLabelText("Message thread").textContent, /Alex, check the current keyboard behavior/);
  fireEvent.click(button("View changes"));
  assert.match(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /Review for Alex/);
  assert.doesNotMatch(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /Review for Casey/);
  fireEvent.click(button("Back to review"));
  fireEvent.click(button("Close thread"));
  // The conversation retains the initial question, then the old review, then both current reviews.
  fireEvent.click(screen.getAllByRole("button", { name: "Open collaboration thread", exact: true })[1]);
  assert.ok(button("Verify & resolve").disabled);
  fireEvent.click(button("View changes"));
  assert.match(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /does not match the current diff/);
  fireEvent.click(button("Back to review"));
  fireEvent.click(button("Close thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  assert.equal(screen.getAllByRole("button", { name: "Open review", exact: true }).length, 2);
  fireEvent.click(screen.getAllByRole("button", { name: "Open review", exact: true })[0]);
  assert.ok(!button("Verify & resolve").disabled, "the current review is ready for Alex before archiving");
  assert.equal(navigationWrites, 0, "opening and switching reviews never dispatches a task mutation");
  await reviewsDemo.dispatch({ type: "archive-task" });
  reviewMount.rerender(reviewView());
  assert.ok(button("Verify & resolve").disabled);
  assert.doesNotMatch(screen.getByLabelText("Message thread").textContent, /workspace has moved on/, "archiving is not a revision change");
  fireEvent.click(button("View changes"));
  assert.match(screen.getByRole("region", { name: "Workspace reviews" }).textContent, /Archived · Read-only/);
  assert.ok(!button("Back to review").disabled);
  assert.equal(navigationWrites, 0);
  assert.equal(requests, 0);
  console.log("PASS: direct Diff shows all current reviews, excludes old revisions, preserves the selected thread, and keeps archived unresolved reviews read-only.");
  cleanup();
  const { WorkspaceCheckpoints } = await import("../src/components/hive/workspace-checkpoints.tsx");
  const remote = createDemoWorkspace(demoTasks[0]);
  const checkpoints = () => h(HiveClientContext, { value: remote.client }, h(WorkspaceCheckpoints, { sessionId: remote.getSnapshot().session.sessionId, revision: remote.getSnapshot().session.version, onRestored: remote.receiveSnapshot, recoveryStatus: { checking: false, notice: "", check() {} } }));
  const mounted = render(checkpoints());
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ })));
  fireEvent.click(screen.getByRole("button", { name: /^Restore checkpoint from/ }));
  assert.equal(button("Restore checkpoint").disabled, false);
  await remote.dispatch({ type: "archive-task" });
  mounted.rerender(checkpoints());
  await waitFor(() => assert.ok(button("Restore checkpoint").disabled));
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /archived/));
  assert.equal(requests, 0);
  console.log("PASS: a teammate archiving the task also disables an already-open checkpoint confirmation.");
  cleanup();
  // A delayed POST must not trap the user in a modal. After an uncertain result,
  // status checks reconcile the existing operation instead of replaying it.
  const recoveryDemo = createDemoWorkspace(demoTasks[0]);
  const baseCheckpointData = await (await recoveryDemo.client.request(`/api/sessions/${recoveryDemo.getSnapshot().session.sessionId}/checkpoints`)).json();
  let recoveryData = baseCheckpointData, recoverySnapshot = recoveryDemo.getSnapshot(), recoveryMounted;
  let releaseRestore, restoreCalls = 0, checkCalls = 0, deliveredRecovery;
  const recoveryClient = { ...recoveryDemo.client, request: async (_path, init) => {
    if (init?.method !== "POST") return Response.json(recoveryData);
    const request = JSON.parse(init.body);
    if (request.mode === "check") {
      checkCalls++;
      const confirmed = structuredClone(recoverySnapshot);
      confirmed.session.version++;
      confirmed.session.workspace.lastRestore = { id: request.id, snapshotId: request.snapshotId, by: confirmed.members[0].id, at: Date.now() };
      delete confirmed.session.workspace.restore;
      recoveryData = { ...baseCheckpointData, version: confirmed.session.version };
      return Response.json(confirmed);
    }
    restoreCalls++;
    recoveryData = { ...baseCheckpointData, blockedReason: "Restore needs confirmation. Retry the same checkpoint before continuing.", restore: { id: request.id, snapshotId: request.snapshotId, status: "unconfirmed", retryAfter: Date.now() + 400 } };
    recoverySnapshot = structuredClone(recoverySnapshot);
    recoverySnapshot.session.version++;
    recoverySnapshot.session.workspace.restore = { ...recoveryData.restore, startedAt: Date.now(), sourceSessionId: "original-vm", by: recoverySnapshot.members[0] };
    recoveryMounted.rerender(recoveryView());
    return new Promise((resolve) => { releaseRestore = () => resolve(Response.json({ error: "Restore response timed out." }, { status: 503 })); });
  } };
  const recoveryView = () => h(HiveClientContext, { value: recoveryClient }, h(HiveWorkspaceView, {
    sessionId: recoverySnapshot.session.sessionId, sessionTitle: "Restore then change tabs", currentMember: recoverySnapshot.members[0], inviteToken: "demo",
    connection: { snapshot: recoverySnapshot, dispatch: async () => { throw new Error("Recovery must not start an agent"); }, setTyping() {}, syncing: false, syncError: false,
      receiveSnapshot: (snapshot) => { deliveredRecovery = snapshot; recoverySnapshot = snapshot; recoveryMounted.rerender(recoveryView()); } },
  }));
  recoveryMounted = render(recoveryView());
  fireEvent.click(button("Checkpoints"));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /^Restore checkpoint from/ })));
  fireEvent.click(screen.getByRole("button", { name: /^Restore checkpoint from/ }));
  fireEvent.click(button("Restore checkpoint"));
  assert.ok(button("Restoring…").disabled);
  assert.ok(!button("Close dialog").disabled);
  assert.match(screen.getByRole("dialog").textContent, /You can close this dialog/);
  fireEvent.click(button("Close dialog"));
  assert.ok(!screen.queryByRole("dialog"));
  assert.equal(restoreCalls, 1);
  await act(async () => releaseRestore());
  await waitFor(() => assert.match(document.body.textContent, /Checking safely in \d+s/));
  assert.ok(button("Retry restore").disabled, "the lease countdown is explicit and prevents a concurrent retry");
  fireEvent.click(button("Diff"));
  assert.equal(screen.queryByRole("button", { name: "Refresh checkpoints" }), null);
  await waitFor(() => assert.ok(deliveredRecovery), { timeout: 1500 });
  assert.equal(screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" }).disabled, false);
  assert.equal(checkCalls, 1);
  assert.equal(restoreCalls, 1, "automatic status confirmation never submits another destructive restore");
  assert.equal(requests, 0);
  console.log("PASS: the restoring dialog can close, switching to Diff does not stop recovery, and metadata-only confirmation unlocks the composer without another restore.");
  cleanup();
  // A viewer on Diff never mounts Checkpoints. Recovery still belongs to the task.
  const diffDemo = createDemoWorkspace(demoTasks[0]);
  const completedOnDiff = diffDemo.getSnapshot();
  const pendingOnDiff = structuredClone(completedOnDiff);
  pendingOnDiff.session.version += 1;
  pendingOnDiff.session.workspace.restore = { id: "88b52ee4-8f47-48a6-a057-c023eaa4454c", snapshotId: "target-checkpoint", sourceSessionId: "original-vm", by: completedOnDiff.members[0], status: "unconfirmed", startedAt: Date.now() - 100_000, retryAfter: Date.now() - 1 };
  const confirmedOnDiff = structuredClone(completedOnDiff);
  confirmedOnDiff.session.version = pendingOnDiff.session.version + 1;
  confirmedOnDiff.session.workspace.lastRestore = { id: pendingOnDiff.session.workspace.restore.id, snapshotId: "target-checkpoint", by: completedOnDiff.members[0].id, at: Date.now() };
  confirmedOnDiff.session.messages.push({ id: "restore-while-on-diff", memberId: completedOnDiff.members[0].id, name: "Alex", initials: "AL", role: "human", body: "Restored while viewing Diff; nothing was rerun.", time: "12:00 PM" });
  let diffSnapshot = pendingOnDiff, diffChecks = 0, diffMounted;
  const receiveOnDiff = (next) => { diffSnapshot = next; diffMounted.rerender(diffView()); };
  const diffClient = { ...diffDemo.client, request: async (_path, init) => {
    assert.equal(init?.method, "POST", "a viewer on Diff must not fetch the checkpoint list");
    assert.equal(JSON.parse(init.body).mode, "check", "recovery must never replay the restore");
    diffChecks++;
    return Response.json(confirmedOnDiff);
  } };
  const diffView = () => h(HiveClientContext, { value: diffClient }, h(HiveWorkspaceView, {
    sessionId: diffSnapshot.session.sessionId, sessionTitle: "Restore on Diff", currentMember: completedOnDiff.members[0], inviteToken: "demo",
    connection: { snapshot: diffSnapshot, dispatch: async () => { throw new Error("Recovery must not start an agent"); }, setTyping() {}, syncing: false, syncError: false, receiveSnapshot: receiveOnDiff },
  }));
  diffMounted = render(diffView());
  assert.ok(screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" }).disabled);
  assert.equal(screen.queryByRole("button", { name: "Refresh checkpoints" }), null);
  await waitFor(() => assert.equal(screen.getByRole("textbox", { name: "Ask Hive or mention a teammate" }).disabled, false), { timeout: 1500 });
  assert.equal(diffChecks, 1);
  assert.equal(screen.queryByText("Restore needs confirmation. The workspace is paused."), null);
  assert.ok(screen.getByText("Restored while viewing Diff; nothing was rerun."));
  assert.equal(requests, 0);
  console.log("PASS: a viewer staying on Diff confirms recovery and unlocks the composer without opening Checkpoints, replaying the restore or running an agent.");
  cleanup();
  const { useWorkspaceRecovery } = await import("../src/hooks/use-workspace-recovery.ts");
  mock.timers.enable({ apis: ["setTimeout"] });
  const pendingChecks = [], receivedChecks = [];
  const pendingClient = { ...diffDemo.client, request: (_path, init) => new Promise((resolve) => pendingChecks.push({ init, resolve })) };
  const wrapper = ({ children }) => h(HiveClientContext, { value: pendingClient }, children);
  const operation = pendingOnDiff.session.workspace.restore;
  const hook = renderHook(({ version, restore }) => useWorkspaceRecovery("demo-task", version, restore, (snapshot) => receivedChecks.push(snapshot)), { wrapper, initialProps: { version: 1, restore: operation } });
  await act(async () => mock.timers.tick(0));
  assert.equal(pendingChecks.length, 1);
  hook.rerender({ version: 2, restore: { ...operation } });
  await act(async () => mock.timers.tick(0));
  assert.equal(pendingChecks.length, 1, "ordinary snapshots and callback identities do not restart checks");
  assert.equal(pendingChecks[0].init.signal.aborted, false);
  hook.rerender({ version: 3, restore: { ...operation, startedAt: operation.startedAt + 1 } });
  assert.ok(pendingChecks[0].init.signal.aborted, "a new attempt cancels the previous check even when its operation id is reused");
  await act(async () => mock.timers.tick(0));
  assert.equal(pendingChecks.length, 2);
  await act(async () => pendingChecks[0].resolve(Response.json({ stale: true })));
  assert.deepEqual(receivedChecks, [], "an aborted late response cannot update the task");
  await act(async () => pendingChecks[1].resolve(Response.json(confirmedOnDiff)));
  assert.deepEqual(receivedChecks, [JSON.parse(JSON.stringify(confirmedOnDiff))]);
  hook.rerender({ version: 4, restore: undefined });
  await act(async () => mock.timers.tick(60_000));
  assert.equal(pendingChecks.length, 2, "confirmation leaves no idle polling");
  hook.unmount();
  const boundedRequests = [];
  const boundedClient = { ...diffDemo.client, request: async (_path, init) => { boundedRequests.push(JSON.parse(init.body)); return Response.json({ pending: true }, { status: 202 }); } };
  const bounded = renderHook(({ version }) => useWorkspaceRecovery("demo-task", version, { ...operation }, () => { throw new Error("202 must not unlock the task"); }), { wrapper: ({ children }) => h(HiveClientContext, { value: boundedClient }, children), initialProps: { version: 1 } });
  for (let attempt = 1; attempt <= 12; attempt++) {
    bounded.rerender({ version: attempt });
    await act(async () => mock.timers.tick(attempt === 1 ? 0 : 10_000));
    assert.equal(boundedRequests.length, attempt);
    assert.equal(boundedRequests.at(-1).version, attempt, "checks use the current revision without resetting their budget");
    assert.equal(boundedRequests.at(-1).mode, "check");
  }
  bounded.rerender({ version: 13 });
  await act(async () => mock.timers.tick(60_000));
  assert.equal(boundedRequests.length, 12, "task updates cannot turn bounded checks into a permanent heartbeat");
  assert.match(bounded.result.current.notice, /Not confirmed yet/);
  act(() => bounded.result.current.check());
  await act(async () => mock.timers.tick(0));
  assert.equal(boundedRequests.length, 13, "explicit Check status can retry the same metadata check");
  bounded.unmount();
  mock.timers.reset();
  console.log("PASS: recovery ignores stale attempts, survives task revisions, stops after 12 pending checks, and leaves no idle heartbeat.");
} finally { cleanup(); mock.timers.reset(); dom.window.close(); }
