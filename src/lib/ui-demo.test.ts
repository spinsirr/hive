import assert from "node:assert/strict";
import test from "node:test";
import { dashboardTasks } from "./task-dashboard.ts";
import { demoLoadedAt, demoTaskHref, demoTasks, findDemoTask, newDemoTask } from "./ui-demo.ts";
import { demoTaskMessages } from "./demo-task-conversation.ts";

test("UI demo fixtures keep all sample tasks with invented identifiers and an unattached example", () => {
  assert.equal(dashboardTasks(demoTasks).length, 4);
  assert.ok(demoTasks.some((task) => !task.repositoryName));
  assert.equal(new Set(demoTasks.map((task) => task.id)).size, demoTasks.length);
  assert.ok(demoTasks.every((task) => task.id.startsWith("demo-") && (!task.repositoryName || task.repositoryName.startsWith("sample-team/"))));
});

test("each sample has a distinct, reloadable demo route and task-specific conversation", () => {
  const links = demoTasks.map(demoTaskHref);
  assert.equal(new Set(links).size, demoTasks.length);
  for (const task of demoTasks) {
    assert.equal(demoTaskHref(task), `/demo/tasks/${task.id}`);
    assert.deepEqual(findDemoTask(task.id), task);
    const messages = demoTaskMessages(task);
    assert.ok(messages[0].body);
    assert.equal(messages[1].annotations?.[0].authorId, "demo-casey");
    assert.equal(messages[2].interaction?.kind, "question");
  }
  assert.equal(new Set(demoTasks.map((task) => demoTaskMessages(task)[0].body)).size, demoTasks.length);
  assert.equal(findDemoTask("real-task"), null);
  assert.equal(findDemoTask("__proto__"), null);
});

test("new local tasks have a safe URL and reloadable title without storing a live task", () => {
  const title = '中文 & / ? # <script>sample</script>';
  const task = newDemoTask(title, "custom")!;
  const url = new URL(demoTaskHref(task), "https://hive.example");
  assert.equal(url.pathname, "/demo/tasks/new");
  assert.equal(url.searchParams.get("title"), title);
  const restored = findDemoTask("new", url.searchParams.get("title")!);
  assert.equal(restored?.title, title);
  assert.equal(demoTaskMessages(restored!)[0].body, title);
  assert.equal(findDemoTask("new")?.title, "");
  assert.equal(findDemoTask("new", "  ")?.title, "");
  assert.equal(findDemoTask("new", "x".repeat(121)), null);
});

test("demo creation validates the title and returns only a local display record", () => {
  assert.equal(newDemoTask("  ", "1")?.title, "");
  assert.equal(demoTaskHref(newDemoTask("", "1")!), "/demo/tasks/new");
  assert.equal(newDemoTask("a".repeat(121), "1"), null);
  assert.equal(newDemoTask("a".repeat(120), "1")?.title.length, 120);
  assert.deepEqual(newDemoTask("  一起调整菜单  ", "1"), {
    id: "demo-1", title: "一起调整菜单", repositoryName: null, updatedAt: demoLoadedAt,
  });
  assert.equal(demoTasks.length, 4);
});
