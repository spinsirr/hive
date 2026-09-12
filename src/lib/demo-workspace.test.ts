import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoWorkspace, demoMembers } from "./demo-workspace.ts";
import { demoTasks } from "./ui-demo.ts";
import { workspaceCheckpointsResponse, workspaceReadResponse } from "./workspace-files.ts";

test("sample actions use production identity, queue, review and recovery rules", async () => {
  const demo = createDemoWorkspace(demoTasks[0]);
  const initial = demo.getSnapshot();
  demo.setMember(demoMembers[1].id);
  await demo.dispatch({ type: "answer-question", messageId: "sample-question", clientId: "wrong-person", body: "Keep it open" });
  assert.equal(demo.getSnapshot(), initial, "targeted questions reject the other teammate");
  demo.setMember(demoMembers[0].id);
  await demo.dispatch({ type: "answer-question", messageId: "sample-question", clientId: "answer", body: "Keep it open" });
  const answered = demo.getSnapshot();
  await demo.dispatch({ type: "answer-question", messageId: "sample-question", clientId: "duplicate", body: "Close it" });
  assert.equal(demo.getSnapshot(), answered);
  assert.equal(answered.session.activeSteer?.authorId, demoMembers[0].id, "idle question answers start immediately");
  const questionRun = demo.getSnapshot().session.workspace.liveReply;
  assert.ok(questionRun);
  demo.finishRun(questionRun.id);
  assert.equal(demo.getSnapshot().session.messages.find((message) => message.id === "sample-question")?.annotations?.at(-1)?.role, "agent");
  await demo.dispatch({ type: "send-message", clientId: "next", body: "Prepare a sample change for review" });
  const run = demo.getSnapshot().session.workspace.liveReply;
  assert.ok(run);
  const runId = run.id;
  demo.finishRun(runId);
  const review = demo.getSnapshot().session.messages.find((message) => message.interaction?.kind === "review");
  assert.ok(review?.interaction?.kind === "review" && review.interaction.revision);
  assert.equal(review.interaction.status, "open");
  demo.setMember(demoMembers[1].id);
  await demo.dispatch({ type: "resolve-peer-review", messageId: review.id, revision: review.interaction.revision });
  assert.equal(demo.getSnapshot().session.messages.find((message) => message.id === review.id)?.interaction?.resolved?.by, demoMembers[1].id);
  const base = `/api/sessions/${initial.session.sessionId}`;
  const checkpoints = workspaceCheckpointsResponse.parse(await (await demo.client.request(`${base}/checkpoints`)).json());
  const oldest = checkpoints.checkpoints.at(-1);
  assert.ok(oldest);
  const count = demo.getSnapshot().session.messages.length;
  const restored = await demo.client.request(`${base}/checkpoints`, { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), snapshotId: oldest.id, version: checkpoints.version }) });
  assert.equal(restored.status, 200);
  assert.equal(demo.getSnapshot().session.workspace.diff, "");
  assert.equal(demo.getSnapshot().session.messages.length, count + 1, "restore keeps discussion");
  demo.restart();
  demo.finishRun(runId);
  assert.deepEqual(demo.getSnapshot(), initial, "stale simulated work cannot survive restart");
});

test("every demo is isolated and files/checkpoints use production contracts", async () => {
  for (const task of demoTasks) {
    const demo = createDemoWorkspace(task);
    const base = `/api/sessions/${demo.getSnapshot().session.sessionId}`;
    const response = await demo.client.request(`${base}/files?kind=directory&path=`);
    const directory = workspaceReadResponse.parse(await response.json());
    assert.equal(directory.kind, "directory");
    if (task.repositoryName) {
      assert.ok(directory.entries.some((entry) => entry.path === "src"));
      const file = workspaceReadResponse.parse(await (await demo.client.request(`${base}/files?kind=file&path=src/components/settings-nav.tsx`)).json());
      assert.equal(file.kind, "file");
      assert.match(file.content, /SettingsNav/);
    }
    for (const path of ["/api/auth/logout", "/api/sessions/real-task/files", "https://example.com/api", `${base}/unknown`]) {
      assert.equal((await demo.client.request(path, { method: "POST" })).status, 403);
    }
  }
  const demo = createDemoWorkspace(demoTasks[2]);
  const repos = `/api/github/repositories?session_id=${demo.getSnapshot().session.sessionId}`;
  assert.equal((await demo.client.request(repos)).status, 200);
  await demo.client.request(repos, { method: "POST", body: JSON.stringify({ repositoryId: 1 }) });
  assert.equal(demo.getSnapshot().session.repository?.name, "sample-team/website");
  assert.equal(createDemoWorkspace(demoTasks[2]).getSnapshot().session.repository, undefined);
});
