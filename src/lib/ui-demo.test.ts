import assert from "node:assert/strict";
import test from "node:test";
import { dashboardTasks } from "./task-dashboard.ts";
import { demoLoadedAt, demoTasks, newDemoTask } from "./ui-demo.ts";

test("UI demo fixtures keep all sample tasks with invented identifiers and an unattached example", () => {
  assert.equal(dashboardTasks(demoTasks).length, 4);
  assert.ok(demoTasks.some((task) => !task.repositoryName));
  assert.equal(new Set(demoTasks.map((task) => task.id)).size, demoTasks.length);
  assert.ok(demoTasks.every((task) => task.id.startsWith("demo-") && (!task.repositoryName || task.repositoryName.startsWith("sample-team/"))));
});

test("demo creation validates the title and returns only a local display record", () => {
  assert.equal(newDemoTask("  ", "1"), null);
  assert.equal(newDemoTask("a".repeat(121), "1"), null);
  assert.equal(newDemoTask("a".repeat(120), "1")?.title.length, 120);
  assert.deepEqual(newDemoTask("  一起调整菜单  ", "1"), {
    id: "demo-1", title: "一起调整菜单", repositoryName: null, updatedAt: demoLoadedAt,
  });
  assert.equal(demoTasks.length, 4);
});
