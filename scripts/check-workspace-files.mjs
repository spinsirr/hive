// Exercise the production route and sandbox reader; only identity, storage and
// the remote sandbox transport are doubled. No real task or model is touched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { mock } from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });

const fixture = await mkdtemp(path.join(os.tmpdir(), "hive-files-route-"));
await mkdir(path.join(fixture, "hive"));
await writeFile(path.join(fixture, "hive", "README.md"), "Actual workspace contents, not the saved diff snapshot.");
let member = { id: "github-101" };
let admitted = true;
let calls = [];
let getError = false;
let foreign = false;
let corrupt = false;
let session;
let reducer;
let codeRunInput;
let codeRuns = 0;
mock.module(new URL("../src/lib/codex-subscription-store.ts", import.meta.url).href, { namedExports: {
  prefersCodexSubscription: async () => false,
} });
mock.module(new URL("../src/lib/auth-session.ts", import.meta.url).href, { namedExports: {
  HIVE_SESSION_COOKIE: "hive_session", getSessionMember: async () => member,
} });
mock.module(new URL("../src/lib/task-session-store.ts", import.meta.url).href, { namedExports: {
  withTaskWorkspaceRead: async (_id, read) => read(session),
  startTaskWorkspaceRestore: async () => { throw new Error("Restore is outside this read-only check"); },
  finishTaskWorkspaceRestore: async () => { throw new Error("Restore is outside this read-only check"); },
  isTaskSessionMember: async () => admitted,
  getTaskSessionSnapshot: async () => ({ session }),
  getPublicTaskSessionSnapshot: async () => ({ session }),
  checkpointAgentReply: async () => {},
  checkpointSubagents: async () => {},
  applyTaskSessionAction: async (_id, action, actor, now) => {
    const previous = session;
    session = reducer.reduceTaskSession(session, action, now, [actor]);
    const startedRun = reducer.didStartHiveRun(previous, session);
    if (startedRun) session.workspace.liveReply = { id: "reply-qa", body: "", sequence: 0, startedAt: now };
    return { snapshot: { session, members: [actor] }, startedRun };
  },
  appendHiveReply: async (_id, body, options) => {
    session = options?.runResult ? reducer.applyHiveRunResult(session, options.runResult) : reducer.appendHiveReply(session, body);
    return { session, members: [member] };
  },
} });
mock.module(new URL("../src/lib/hive-runner.ts", import.meta.url).href, { namedExports: {
  runHiveCodingTask: async (state, actor, steer) => {
    codeRuns += 1;
    codeRunInput = { actor, steer };
    return { sandboxName: "sandbox-qa", agentSession: state.workspace.agentSession, summary: "Observed the code annotation", diff: "", files: [], commands: [], changedFiles: [] };
  },
} });
mock.module(new URL("../src/lib/hive-conversation.ts", import.meta.url).href, { namedExports: {
  runHiveConversation: async () => { throw new Error("A code annotation must not start a planning turn"); },
} });
mock.module("@vercel/sandbox", { namedExports: { Sandbox: {
  get: async (options) => {
    calls.push(["get", options]);
    if (getError) throw new Error("PRIVATE PROVIDER DETAILS");
    return {
      tags: { session: foreign ? "other-task" : session.sessionId },
      currentSnapshotId: "snap-current",
      keepLastSnapshots: { count: 1 },
      listSnapshots: async () => {
        calls.push(["list-snapshots"]);
        return { snapshots: [
          { id: "snap-current", createdAt: 1000, sizeBytes: 512, status: "created" },
          { id: "snap-deleted", createdAt: 900, sizeBytes: 512, status: "deleted" },
          { id: "snap-expired", createdAt: 800, sizeBytes: 512, status: "created", expiresAt: 900 },
        ] };
      },
      currentSession: () => ({ cwd: fixture }),
      runCommand: async (command) => {
        calls.push(["read", command]);
        assert.equal(command.cmd, "node");
        const output = corrupt ? "PRIVATE INVALID RESPONSE" : execFileSync(process.execPath, command.args, { timeout: 5_000 }).toString();
        return { exitCode: 0, stdout: async () => output };
      },
    };
  },
} } });

try {
  const { NextRequest } = await import("next/server.js");
  const { GET } = await import("../src/app/api/sessions/[sessionId]/files/route.ts");
  const { GET: checkpoints } = await import("../src/app/api/sessions/[sessionId]/checkpoints/route.ts");
  const { createInitialTaskSessionState } = await import("../src/lib/task-session.ts");
  reducer = await import("../src/lib/task-session.ts");
  session = createInitialTaskSessionState(1, "files-qa");
  session.repository = { url: "https://github.com/spinsirr/hive.git" };
  session.workspace.agentSession = { id: "hive-files-qa-1", runtime: "codex" };
  session.workspace.completedAt = 1000;
  session.workspace.files = [{ path: "README.md", content: "WRONG: old snapshot" }];
  const request = (query = "kind=file&path=README.md", id = "files-qa") => GET(new NextRequest(`https://hive.example/api/sessions/${id}/files?${query}`), { params: Promise.resolve({ sessionId: id }) });

  for (const mode of ["anonymous", "non-member", "invalid-session"]) {
    member = mode === "anonymous" ? null : { id: "github-101" };
    admitted = mode !== "non-member";
    assert.equal((await request(undefined, mode === "invalid-session" ? ".." : "files-qa")).status, 401);
    assert.equal(calls.length, 0);
  }
  member = { id: "github-101" }; admitted = true;
  assert.equal((await request("kind=file&path=../secret")).status, 400);
  assert.equal(calls.length, 0);

  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal((await result.json()).content, "Actual workspace contents, not the saved diff snapshot.");
  assert.deepEqual(calls.map(([kind]) => kind), ["get", "read"]);
  assert.equal(calls[0][1].name, "hive-session-hive-files-qa-1");
  assert.equal(calls[0][1].resume, true);
  assert.equal(calls[1][1].args[2], path.join(fixture, "hive"));
  assert.equal((await request("kind=directory")).status, 200);
  assert.equal((await request("kind=file&path=missing")).status, 404);

  calls = []; foreign = true;
  assert.equal((await request()).status, 403);
  assert.deepEqual(calls.map(([kind]) => kind), ["get"]);
  foreign = false; getError = true;
  let error = await request();
  assert.equal(error.status, 503);
  assert.doesNotMatch(await error.text(), /PRIVATE/);
  getError = false; corrupt = true;
  error = await request();
  assert.equal(error.status, 503);
  assert.doesNotMatch(await error.text(), /PRIVATE/);
  corrupt = false; calls = [];
  const savedCompletion = session.workspace.completedAt;
  session.workspace.completedAt = undefined;
  assert.equal((await request()).status, 409);
  assert.equal(calls.length, 0);
  session.workspace.completedAt = savedCompletion;
  session.workspace.agentSession = undefined;
  assert.equal((await request()).status, 409);
  assert.equal(calls.length, 0);
  calls = [];
  session.workspace.agentSession = { id: "hive-files-qa-1", runtime: "codex" };
  session.workspace.completedAt = 1000;
  const checkpointRequest = () => checkpoints(new NextRequest("https://hive.example/api/sessions/files-qa/checkpoints"), { params: Promise.resolve({ sessionId: "files-qa" }) });
  member = null;
  assert.equal((await checkpointRequest()).status, 401);
  assert.equal(calls.length, 0);
  member = { id: "github-101" };
  const saved = await checkpointRequest();
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await saved.json(), { checkpoints: [{ id: "snap-current", createdAt: 1000, sizeBytes: 512, current: true, restorable: false }], retentionCount: 1, version: session.version, blockedReason: null, restore: null });
  assert.deepEqual(calls.map(([kind]) => kind), ["get", "list-snapshots"]);
  assert.equal(calls[0][1].resume, false);
  console.log("PASS: workspace route checks membership, reads the existing worktree, rejects unsafe paths, and never creates a sandbox or starts an agent");
  console.log("PASS: checkpoints are task-scoped, filter deleted/expired snapshots, and neither resume nor stop the sandbox");

  const { POST } = await import("../src/app/api/sessions/[sessionId]/route.ts");
  member = { id: "github-101", name: "QA User", shortName: "QA", initials: "QA" };
  const post = (body) => POST(new NextRequest("https://hive.example/api/sessions/files-qa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ sessionId: "files-qa" }) });
  const annotation = { type: "annotate-code", actor: "forged-author", clientId: "43725302-b3ef-47b6-a717-70cc459d839f", body: "Preserve keyboard focus", reference: { path: "src/main.tsx", startLine: 3, endLine: 3, quote: "<button>Save</button>" } };
  admitted = false;
  assert.equal((await post(annotation)).status, 401);
  admitted = true;
  assert.equal((await post({ ...annotation, reference: { ...annotation.reference, path: "../secret" } })).status, 400);
  assert.equal((await post({ ...annotation, clientId: "invalid" })).status, 400);
  assert.equal((await post(annotation)).status, 200);
  const annotatedVersion = session.version;
  assert.equal(codeRunInput, undefined);
  const codeMessage = session.messages.at(-1);
  assert.equal(codeMessage.memberId, member.id);
  assert.deepEqual(codeMessage.codeReference, annotation.reference);
  assert.equal((await post(annotation)).status, 200);
  assert.equal(session.version, annotatedVersion);
  assert.equal((await post({ type: "steer-message-annotation", messageId: codeMessage.id, annotationId: codeMessage.annotations[0].id })).status, 200);
  assert.equal(codeRunInput.actor, "github-101");
  assert.match(codeRunInput.steer, /Annotation author: QA User/);
  assert.match(codeRunInput.steer, /src\/main.tsx:3/);
  assert.match(codeRunInput.steer, /<button>Save<\/button>/);
  assert.match(codeRunInput.steer, /Preserve keyboard focus/);
  assert.doesNotMatch(codeRunInput.steer, /forged-author/);
  console.log("PASS: real session POST validates code anchors, derives the author from login, deduplicates retries, and gives the code context to the runner only on explicit steer");

  const agentMessage = session.messages.at(-1);
  const reply = { type: "annotate-message", actor: "forged-author", messageId: agentMessage.id, clientId: "311d0669-566f-4080-b8c0-10725e4dc605", body: "Also preserve the visible labels." };
  const runsBeforeReply = codeRuns;
  assert.equal((await post(reply)).status, 200);
  const throughReplyId = session.messages.find((message) => message.id === agentMessage.id).annotations.at(-1).id;
  assert.equal(codeRuns, runsBeforeReply, "A thread reply never wakes the agent");
  assert.equal((await post({ type: "steer-thread", messageId: agentMessage.id })).status, 400);
  const steerThread = { type: "steer-thread", actor: "forged-author", messageId: agentMessage.id, throughReplyId };
  admitted = false;
  assert.equal((await post(steerThread)).status, 401);
  admitted = true;
  assert.equal((await post(steerThread)).status, 200);
  assert.equal(codeRuns, runsBeforeReply + 1);
  assert.equal(codeRunInput.actor, member.id);
  assert.match(codeRunInput.steer, /Steer requested by: QA User/);
  assert.match(codeRunInput.steer, /Observed the code annotation/);
  assert.match(codeRunInput.steer, /Also preserve the visible labels/);
  assert.doesNotMatch(codeRunInput.steer, /forged-author/);
  assert.equal((await post(steerThread)).status, 200);
  assert.equal(codeRuns, runsBeforeReply + 1, "A retry never executes the same thread twice");
  console.log("PASS: real thread POST keeps replies human-only, requires a reply boundary, enforces membership and server authorship, and executes the frozen thread once");
} finally {
  mock.restoreAll();
  await rm(fixture, { recursive: true, force: true });
}
