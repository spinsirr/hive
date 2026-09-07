import assert from "node:assert/strict";
import { test } from "node:test";

import { codeReferenceLabel, codeReferenceSchema } from "./code-reference.ts";
import { buildHivePrompt, buildHiveRunInput } from "./hive-prompt.ts";
import { applyHiveRunResult, createInitialTaskSessionState, reduceTaskSession } from "./task-session.ts";

const reference = { path: "src/main.tsx", startLine: 3, endLine: 5, quote: 'export const Main = () => {\n  return <button>Save</button>;\n};' };
const action = { type: "annotate-code" as const, actor: "maya", body: "Add an accessible name, preserving keyboard focus", clientId: "43725302-b3ef-47b6-a717-70cc459d839f", reference };
function withRepository() {
  return reduceTaskSession(createInitialTaskSessionState(1), {
    type: "connect-repository", actor: "spencer", repositoryUrl: "https://github.com/spinsirr/hive", repositoryName: "spinsirr/hive", repositoryId: 1,
    repositoryBranch: "main", installationId: 1, visibility: "private", githubUserId: 1, githubLogin: "spinsirr",
  }, 2);
}

test("code annotations are durable discussion records, not implicit agent tasks", () => {
  const initial = withRepository();
  const annotated = reduceTaskSession(initial, action, 3);
  assert.equal(annotated.stage, initial.stage);
  assert.deepEqual(annotated.workspace, initial.workspace);
  assert.deepEqual(annotated.steeringQueue, []);
  const message = annotated.messages.at(-1)!;
  assert.equal(message.memberId, "maya");
  assert.deepEqual(message.codeReference, reference);
  assert.equal(message.annotations![0].body, action.body);
  assert.equal(message.annotations![0].status, "open");
  assert.deepEqual(JSON.parse(JSON.stringify(annotated)).messages.at(-1).codeReference, reference);
  assert.equal(reduceTaskSession(annotated, action, 4), annotated, "retry must not create a second annotation");
  assert.doesNotMatch(buildHivePrompt(annotated, "spencer"), /Add an accessible name/);
});

for (const running of [false, true]) {
  test(`code annotation ${running ? "queues without interrupting the run" : "starts only on explicit steer"}, with its file, lines, quote and real author`, () => {
    let session = withRepository();
    if (running) session = reduceTaskSession(session, { type: "send-message", actor: "spencer", body: "Check the repository" }, 3);
    session = reduceTaskSession(session, action, 4);
    const message = session.messages.at(-1)!;
    const beforeWorkspace = session.workspace;
    const promote = { type: "steer-message-annotation" as const, actor: "spencer", messageId: message.id, annotationId: message.annotations![0].id };
    session = reduceTaskSession(session, promote, 5);
    if (running) {
      assert.equal(session.workspace, beforeWorkspace);
      assert.equal(session.steeringQueue.length, 1);
      session = applyHiveRunResult(session, { sandboxName: "sandbox-test", agentSession: session.workspace.agentSession!, summary: "Previous run done", diff: "", files: [], commands: [], changedFiles: [] }, 6);
      session = reduceTaskSession(session, { type: "apply-next-steer", actor: "spencer" }, 7);
    }
    const input = buildHiveRunInput(session, running ? { type: "apply-next-steer", actor: "spencer" } : promote, []);
    assert.match(input.steer!, /Annotation author: Maya Chen/);
    assert.match(input.steer!, /Steer requested by: Spencer Zhao/);
    assert.match(input.steer!, /src\/main.tsx:3–5/);
    assert.ok(input.steer!.includes(reference.quote));
    assert.ok(input.steer!.includes(action.body));
    assert.match(input.steer!, /Re-read the current file before editing/);
    assert.equal(session.stage, "running");
  });
}

test("code references reject traversal and oversized selections; completed or unattached tasks cannot annotate code", () => {
  assert.equal(codeReferenceLabel({ ...reference, startLine: 5 }), "src/main.tsx:5");
  for (const change of [{ path: "../secret" }, { startLine: 0 }, { endLine: 2 }, { endLine: 103 }, { quote: "x".repeat(8_001) }]) assert.equal(codeReferenceSchema.safeParse({ ...reference, ...change }).success, false);
  const unattached = createInitialTaskSessionState(1);
  assert.equal(reduceTaskSession(unattached, action, 3), unattached);
  const completed = reduceTaskSession(withRepository(), { type: "complete-session", actor: "spencer" }, 3);
  assert.equal(reduceTaskSession(completed, action, 4), completed);
});
