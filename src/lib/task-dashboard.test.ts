import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardTasks,
  taskUpdatedLabel,
  type DashboardTask,
} from "./task-dashboard.ts";

test("dashboard keeps every task ordered by update without mutating the input", () => {
  const tasks: DashboardTask[] = [
    { id: "first", title: "First", updatedAt: 1, repositoryName: null },
    {
      id: "finished",
      title: "Finished",
      updatedAt: 3,
      repositoryName: "team/repo",
    },
    {
      id: "recent",
      title: "Recent",
      updatedAt: 2,
      repositoryName: "team/repo",
    },
  ];
  assert.deepEqual(
    dashboardTasks(tasks).map((task) => task.id),
    ["finished", "recent", "first"]
  );
  assert.deepEqual(
    tasks.map((task) => task.id),
    ["first", "finished", "recent"]
  );
  assert.deepEqual(dashboardTasks([]), []);
});

test("dashboard timestamps use a stable load time and handle fresh or future updates", () => {
  const loadedAt = 10 * 86_400_000;
  assert.equal(taskUpdatedLabel(loadedAt + 1000, loadedAt), "Just now");
  assert.equal(taskUpdatedLabel(loadedAt - 59_000, loadedAt), "Just now");
  assert.equal(taskUpdatedLabel(loadedAt - 60_000, loadedAt), "1m ago");
  assert.equal(taskUpdatedLabel(loadedAt - 3_600_000, loadedAt), "1h ago");
  assert.equal(taskUpdatedLabel(loadedAt - 86_400_000, loadedAt), "1d ago");
});
