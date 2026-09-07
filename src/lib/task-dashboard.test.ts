import assert from "node:assert/strict";
import test from "node:test";
import { dashboardTasks, taskUpdatedLabel, type DashboardTask } from "./task-dashboard.ts";

test("dashboard separates active and completed tasks and orders them by update without mutating the input", () => {
  const tasks: DashboardTask[] = [
    { id: "first", title: "First", lifecycle: "active", updatedAt: 1, repositoryName: null },
    { id: "finished", title: "Finished", lifecycle: "completed", updatedAt: 3, repositoryName: "team/repo" },
    { id: "recent", title: "Recent", lifecycle: "active", updatedAt: 2, repositoryName: "team/repo" },
  ];
  assert.deepEqual(dashboardTasks(tasks, "active").map((task) => task.id), ["recent", "first"]);
  assert.deepEqual(dashboardTasks(tasks, "completed").map((task) => task.id), ["finished"]);
  assert.deepEqual(tasks.map((task) => task.id), ["first", "finished", "recent"]);
  assert.deepEqual(dashboardTasks([], "active"), []);
});

test("dashboard timestamps use a stable load time and handle fresh or future updates", () => {
  const loadedAt = 10 * 86_400_000;
  assert.equal(taskUpdatedLabel(loadedAt + 1000, loadedAt), "Just now");
  assert.equal(taskUpdatedLabel(loadedAt - 59_000, loadedAt), "Just now");
  assert.equal(taskUpdatedLabel(loadedAt - 60_000, loadedAt), "1m ago");
  assert.equal(taskUpdatedLabel(loadedAt - 3_600_000, loadedAt), "1h ago");
  assert.equal(taskUpdatedLabel(loadedAt - 86_400_000, loadedAt), "1d ago");
});
