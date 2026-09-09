import assert from "node:assert/strict";
import test from "node:test";
import { applyHiveRunError, applyHiveRunResult, canApplyNextSteer, canApproveChanges, createInitialTaskSessionState, reduceTaskSession, resolveMember, type TaskSessionState } from "./task-session.ts";
import { publicTaskSessionSnapshot } from "./task-session-snapshot.ts";
import { beginWorkspaceRestore, completeWorkspaceRestore, failWorkspaceRestore } from "./workspace-restore-state.ts";

function fixture() {
  const session = createInitialTaskSessionState(1, "restore-qa");
  session.repository = { provider: "github-app", url: "https://github.com/spinsirr/hive.git", id: 1, name: "spinsirr/hive", branch: "main", visibility: "private", installationId: 2, connectedBy: "spencer", connectedAt: 2, authorizedByGitHub: { id: 1, login: "spinsirr" } };
  let state = session;
  for (let turn = 1; turn <= 4; turn++) {
    state = applyHiveRunResult(state, {
      snapshot: { id: `snap-${turn}`, createdAt: turn * 10 }, sandboxName: "hive-session-agent-id",
      agentSession: { id: "agent-id", runtime: "codex", resumeFrom: { type: "resume-session", specificationVersion: "harness-v1", harnessId: "codex", data: { threadId: `native-${turn}`, secret: "DO NOT EXPOSE" } } },
      summary: `Finished turn ${turn}`, diff: `+ turn ${turn}`, files: [{ path: "nav.ts", content: `turn ${turn}` }], commands: [{ command: "test", output: `Test ${turn}`, exitCode: 0 }], changedFiles: ["nav.ts"],
    }, turn * 10);
  }
  state = reduceTaskSession(state, { type: "advance-run", actor: "spencer" }, 41);
  return state;
}
const request = { id: "ec594c84-9b30-4241-a31f-af8f76d270ff", snapshotId: "snap-2", version: 0 };

test("each completed sandbox snapshot is paired with its exact native agent state, retaining a bounded history", () => {
  const session = fixture();
  assert.deepEqual(session.workspace.checkpoints!.map((entry) => entry.id), ["snap-4", "snap-3", "snap-2"]);
  assert.equal(session.workspace.checkpoints![2].result.files[0].content, "turn 2");
  assert.deepEqual(session.workspace.checkpoints![2].result.agentSession.resumeFrom?.data, { threadId: "native-2", secret: "DO NOT EXPOSE" });
  const publicState = publicTaskSessionSnapshot({ session, activeMembers: [], members: [], typingMembers: [] });
  assert.doesNotMatch(JSON.stringify(publicState), /DO NOT EXPOSE|native-2|native-4/);
  assert.equal(session.workspace.checkpoints!.length, 3, "Projection never removes stored recovery data");
});

test("restore replaces files and native context together, preserves conversation and queue, removes approval, and is idempotent", () => {
  const session = fixture();
  session.steeringQueue = [{ id: "keep-this", authorId: "maya", body: "Check focus later", queuedAt: 42, source: { kind: "message", messageId: "message" }, sourceLabel: "Follow-up" }];
  const started = beginWorkspaceRestore(session, { ...request, version: session.version }, resolveMember("spencer"), 50);
  assert.equal(canApplyNextSteer(started), false);
  assert.equal(canApproveChanges(started), false);
  assert.equal(reduceTaskSession(started, { type: "reset", actor: "spencer" }), started);
  assert.equal(reduceTaskSession(started, { type: "send-message", actor: "maya", body: "New task" }), started);
  const restored = completeWorkspaceRestore(started, request.id, 60);
  assert.equal(restored.workspace.diff, "+ turn 2");
  assert.equal(restored.workspace.files[0].content, "turn 2");
  assert.deepEqual(restored.workspace.agentSession!.resumeFrom!.data, { threadId: "native-2", secret: "DO NOT EXPOSE" });
  assert.equal(restored.stage, "review");
  assert.deepEqual(restored.steeringQueue, session.steeringQueue);
  assert.deepEqual(restored.messages.slice(0, -1), session.messages);
  assert.equal(restored.messages.at(-1)!.memberId, "spencer");
  assert.match(restored.messages.at(-1)!.body, /nothing was rerun/);
  assert.equal(restored.workspace.restore, undefined);
  assert.ok(restored.version > session.version);
  assert.equal(beginWorkspaceRestore(restored, { ...request, version: session.version }, resolveMember("maya"), 70), restored);
});

test("stale, foreign, unpaired and actively-running restore attempts are rejected", () => {
  const session = fixture();
  const valid = { ...request, version: session.version };
  const rejected: Array<[TaskSessionState, typeof valid]> = [
    [session, { ...valid, version: 0 }],
    [session, { ...valid, snapshotId: "foreign-snapshot" }],
    [{ ...session, stage: "running", workspace: { ...session.workspace, startedAt: 45, completedAt: undefined } }, valid],
    [{ ...session, workspace: { ...session.workspace, agentSession: { id: "other-agent", runtime: "codex" } } }, valid],
  ];
  for (const [state, input] of rejected) assert.throws(() => beginWorkspaceRestore(state, input, resolveMember("maya"), 50));
});

test("restoring a failed-run checkpoint keeps its failure status and cannot approve an unfinished change", () => {
  const session = fixture();
  const failed = applyHiveRunError(session, "The run was interrupted.", 50, {
    ...session.workspace.checkpoints![0].result,
    snapshot: { id: "snap-failed", createdAt: 50 },
    commands: [{ command: "test", output: "Tests failed", exitCode: 1 }],
  });
  const started = beginWorkspaceRestore(failed, { ...request, snapshotId: "snap-failed", version: failed.version }, resolveMember("spencer"), 60);
  const restored = completeWorkspaceRestore(started, request.id, 70);
  assert.equal(restored.workspace.status, "error");
  assert.equal(restored.workspace.error, "The run was interrupted.");
  assert.equal(restored.workspace.commands[0].exitCode, 1);
  assert.equal(canApproveChanges(restored), false);
});

test("a failed or interrupted restore keeps the task fenced and only permits the same bounded operation to retry", () => {
  const session = fixture();
  const started = beginWorkspaceRestore(session, { ...request, version: session.version }, resolveMember("spencer"), 50);
  const failed = failWorkspaceRestore(started, request.id);
  assert.equal(failed.workspace.restore?.status, "unconfirmed");
  assert.equal(reduceTaskSession(failed, { type: "advance-run", actor: "maya" }), failed);
  assert.throws(() => beginWorkspaceRestore(failed, { ...request, version: failed.version }, resolveMember("maya"), 60));
  assert.throws(() => beginWorkspaceRestore(failed, { ...request, id: "other-operation", version: failed.version }, resolveMember("maya"), 100_000));
  const retry = beginWorkspaceRestore(failed, { ...request, version: session.version }, resolveMember("maya"), 100_000);
  assert.equal(retry.workspace.restore?.by.id, "spencer");
  assert.equal(retry.workspace.restore?.status, "restoring");
  assert.equal(completeWorkspaceRestore(retry, "stale-operation"), retry);
});
