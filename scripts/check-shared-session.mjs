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
  constructor(url) { this.url = url; sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
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
    assert.equal(JSON.parse(options.body).type, "heartbeat", "these checks must never launch agent work");
    return new Response(null, { status: 204 });
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

try {
  const view = renderHook(() => useSharedSession("shared-qa", initial));
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
    tick();
  });
  assert.deepEqual(view.result.current.snapshot.activeMembers, ["github-101"]);
  assert.deepEqual(view.result.current.snapshot.typingMembers, []);
  assert.equal(view.result.current.snapshot.session.workspace.liveReply.body, "Hello team");
  assert.equal(view.result.current.snapshot.session.version, initial.session.version);
  assert.equal(requests.filter(({ options }) => options?.method !== "POST").length, 0);
  console.log("PASS: presence cannot erase a text delta, change task version, or apply to a different task; periodic heartbeats still work.");

  const recovered = structuredClone(view.result.current.snapshot);
  recovered.session.version += 1;
  recovered.session.messages.push({ id: "missed-message", role: "human", memberId: "github-101", name: "Ada", initials: "AD", body: "Shared discussion while disconnected", time: "12:00 PM" });
  let releaseOld;
  refresh = () => new Promise((resolve) => { releaseOld = resolve; });
  await act(async () => {
    sockets[0].close(1006);
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
  console.log("PASS: reconnect recovers a missed message once; a late HTTP snapshot cannot roll back the conversation, workspace or reply.");
} finally {
  cleanup();
  dom.window.close();
}
