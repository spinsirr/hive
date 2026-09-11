// Real client synchronization hook; only browser/network boundaries are doubled.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://hive.test/sessions/shared-qa" });
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const sockets = [], requests = [];
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  sent = [];
  constructor(url) { this.url = url; sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}
globalThis.WebSocket = Socket;
let tick;
dom.window.setInterval = (callback) => { tick = callback; return 1; };
dom.window.clearInterval = () => { tick = undefined; };
let refresh;
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  if (options?.method === "POST") {
    throw new Error("Presence and typing must never issue HTTP POST requests");
  }
  return refresh();
};
const { act, cleanup, renderHook } = await import("@testing-library/react");
const { createInitialTaskSessionState } = await import("../src/lib/task-session.ts");
const { useSharedSession } = await import("../src/hooks/use-shared-session.ts");
const initial = { session: createInitialTaskSessionState(1, "shared-qa"), members: [], activeMembers: [], typingMembers: [] };
initial.session.workspace.liveReply = { id: "reply-qa", body: "Hello", sequence: 1, startedAt: 1 };
initial.session.workspace.files = [{ path: "README.md", content: "Retained workspace" }];
const presence = { activeMembers: ["github-101"], typingMembers: ["github-101"], members: [{ id: "github-101", name: "Ada", shortName: "Ada", initials: "AD" }] };
initial.members = presence.members;

try {
  const view = renderHook(() => useSharedSession("shared-qa", initial));
  assert.equal(tick, undefined, "the hook must not install an HTTP heartbeat interval");
  await act(async () => { sockets[0].open(); sockets[0].receive({ type: "snapshot", snapshot: initial }); });
  const sessionBefore = view.result.current.snapshot.session;
  await act(async () => { sockets[0].receive({ type: "presence", sessionId: "shared-qa", presence }); });
  assert.deepEqual(view.result.current.snapshot.activeMembers, ["github-101"]);
  assert.deepEqual(view.result.current.snapshot.typingMembers, ["github-101"]);
  assert.equal(view.result.current.snapshot.members[0].name, "Ada");
  assert.equal(view.result.current.snapshot.session, sessionBefore, "presence must not replace conversation, workspace, or streaming text");
  assert.equal(requests.filter(({ options }) => options?.method !== "POST").length, 0, "presence events must not trigger an HTTP snapshot refresh");
  console.log("PASS: the real client hook applies lightweight presence without replacing task data or refreshing it.");

  await act(async () => {
    sockets[0].receive({ type: "presence", sessionId: "another-task", presence: { ...presence, activeMembers: [], typingMembers: [] } });
    sockets[0].receive({ type: "reply", sessionId: "shared-qa", reply: { ...initial.session.workspace.liveReply, body: "Hello team", sequence: 2 } });
    sockets[0].receive({ type: "presence", sessionId: "shared-qa", presence: { ...presence, typingMembers: [] } });
  });
  assert.deepEqual(view.result.current.snapshot.activeMembers, ["github-101"]);
  assert.deepEqual(view.result.current.snapshot.typingMembers, []);
  assert.equal(view.result.current.snapshot.session.workspace.liveReply.body, "Hello team");
  assert.equal(view.result.current.snapshot.session.version, initial.session.version);
  assert.equal(requests.filter(({ options }) => options?.method !== "POST").length, 0);
  assert.equal(requests.length, 0);
  await act(async () => { view.result.current.setTyping(true); view.result.current.setTyping(true); });
  assert.deepEqual(sockets[0].sent, [{ type: "typing", typing: true }]);
  assert.equal(requests.length, 0);
  console.log("PASS: presence preserves task data; typing is deduplicated and sent through WebSocket, with no HTTP heartbeat.");
  const liveReply = view.result.current.snapshot.session.workspace.liveReply;
  const child = { id: "e9e3838b-8945-41df-bf86-8e3b7911fa51", runId: liveReply.id, kind: "research", task: "Read the fixture", status: "completed", startedAt: 1, result: "Child result" };
  await act(async () => {
    sockets[0].receive({ type: "reply", sessionId: "shared-qa", reply: { ...liveReply, body: "old", sequence: 1, subagentSequence: 2, subagents: [child] } });
    sockets[0].receive({ type: "reply", sessionId: "shared-qa", reply: { ...liveReply, subagentSequence: 1, subagents: [{ ...child, status: "running" }] } });
  });
  assert.equal(view.result.current.snapshot.session.workspace.liveReply.body, "Hello team");
  assert.equal(view.result.current.snapshot.session.workspace.liveReply.subagents[0].status, "completed");
  assert.equal(requests.length, 0);
  console.log("PASS: subagent-only WebSocket updates preserve newer parent text and reject stale child status without a refetch.");

  await act(async () => { view.result.current.receiveSnapshot(structuredClone(initial)); });
  assert.deepEqual(view.result.current.snapshot.activeMembers, ["github-101"], "an HTTP result must not overwrite live connection state");

  const recovered = structuredClone(view.result.current.snapshot);
  recovered.session.version += 1;
  recovered.session.messages.push({ id: "missed-message", role: "human", memberId: "github-101", name: "Ada", initials: "AD", body: "Shared discussion while disconnected", time: "12:00 PM" });
  let releaseOld;
  refresh = () => new Promise((resolve) => { releaseOld = resolve; });
  await act(async () => {
    sockets[0].close(1006);
    view.result.current.setTyping(false);
    view.result.current.setTyping(true);
    dom.window.dispatchEvent(new dom.window.Event("online"));
  });
  assert.equal(sockets.length, 2);
  await act(async () => {
    sockets[1].open();
    sockets[1].receive({ type: "snapshot", snapshot: recovered });
    releaseOld(Response.json(initial));
  });
  assert.equal(view.result.current.snapshot.session.messages.filter(({ id }) => id === "missed-message").length, 1);
  assert.equal(view.result.current.snapshot.session.workspace.liveReply.body, "Hello team");
  assert.equal(view.result.current.snapshot.session.workspace.files[0].content, "Retained workspace");
  assert.equal(view.result.current.syncing, false);
  assert.equal(view.result.current.syncError, false);
  assert.deepEqual(sockets[1].sent, [{ type: "typing", typing: true }], "reconnect publishes the latest typing state once");
  const beforeFocus = requests.length;
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); });
  assert.equal(requests.length, beforeFocus, "focusing an already-live task does not fetch another snapshot");
  console.log("PASS: reconnect recovers a missed message once; a late HTTP snapshot cannot roll back the conversation, workspace or reply.");

  const edit = { type: "edit-message", messageId: "missed-message", expectedRevision: 0, body: "Updated shared discussion" };
  globalThis.fetch = async () => Response.json({ error: "This message was edited elsewhere." }, { status: 409 });
  await act(async () => assert.rejects(view.result.current.dispatch(edit, { throwOnError: true }), /edited elsewhere/));
  assert.equal(view.result.current.syncError, false, "A conflict must not mark a connected task offline");
  const saved = structuredClone(view.result.current.snapshot);
  saved.session.version++;
  const target = saved.session.messages.find(message => message.id === "missed-message");
  target.edits = [{ body: target.body, replacedAt: 12345 }];
  target.body = "Updated shared discussion";
  globalThis.fetch = async () => Response.json(saved);
  await act(async () => { await view.result.current.dispatch(edit, { throwOnError: true }); });
  assert.equal(view.result.current.snapshot.session.messages.at(-1).body, "Updated shared discussion");
  const second = renderHook(() => useSharedSession("shared-qa", recovered));
  const secondSocket = sockets.at(-1);
  await act(async () => { secondSocket.open(); secondSocket.receive({ type: "snapshot", snapshot: saved }); });
  assert.deepEqual(second.result.current.snapshot.session.messages.at(-1), view.result.current.snapshot.session.messages.at(-1));
  const late = structuredClone(recovered);
  await act(async () => second.result.current.receiveSnapshot(late));
  assert.equal(second.result.current.snapshot.session.messages.at(-1).body, "Updated shared discussion");
  console.log("PASS: edit errors preserve online state; saved text/history reach a second live viewer and cannot be reverted by a stale response.");
} finally {
  cleanup();
  dom.window.close();
}
