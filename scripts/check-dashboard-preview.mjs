import { registerTestModules } from "./test-modules.mjs";
// Exercise home/demo navigation without a database or account.
import assert from "node:assert/strict";

import { createDomFixture } from "./test-dom.mjs";

const dom = createDomFixture("<!doctype html><html><body></body></html>", {
  url: "https://hive.example/demo",
  pretendToBeVisual: true,
});
globalThis.self = dom.window;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
  dom.window
);
globalThis.fetch = () => {
  throw new Error("Dashboard preview must not access a backend.");
};
registerTestModules({
  resolve(specifier, context, next) {
    if (specifier === "@/db")
      throw new Error(
        "Public home must not import the database without a session."
      );
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/next/navigation.js"))
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export function useRouter() { return { push(url) { globalThis.__demoDestination = url; } }; }",
      };
    if (url.endsWith("/next/headers.js"))
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export async function cookies() { return { get() { return globalThis.__demoTestCookie; } }; }",
      };
    return next(url, context);
  },
});

const { createElement: h } = await import("react");
const { cleanup, fireEvent, render, screen, within } =
  await import("@testing-library/react");
const { waitFor } = await import("@testing-library/react");
const { DashboardDemo } = await import("../src/app/demo/dashboard-demo.tsx");
const { TaskDashboard } =
  await import("../src/components/hive/task-dashboard.tsx");
const { HiveSignIn } = await import("../src/components/hive/hive-sign-in.tsx");
const { demoLoadedAt, demoTasks, demoTaskHref, newDemoTask } =
  await import("../src/lib/ui-demo.ts");

render(h(DashboardDemo));
assert.ok(screen.getByRole("heading", { name: "Sample tasks" }));
assert.ok(screen.getByRole("group", { name: "Task status" }));
assert.equal(
  within(screen.getByRole("region", { name: "Task list" })).getAllByRole(
    "listitem"
  ).length,
  4
);
assert.equal(
  screen.getByRole("link", { name: "Open Hive" }).getAttribute("href"),
  "/"
);
assert.equal(
  screen.queryByRole("region", { name: "One agent. Your whole team." }),
  null
);
assert.equal(
  screen.queryByRole("link", { name: "Try collaboration demo" }),
  null
);
for (const task of demoTasks) {
  const sample = screen.getByRole("link", {
    name: `Open sample task: ${task.title}`,
  });
  assert.equal(sample.getAttribute("href"), `/demo/tasks/${task.id}`);
  assert.ok(within(sample).getByText("Demo"));
  sample.focus();
  assert.equal(document.activeElement, sample);
}
assert.equal(document.querySelector('a[href^="/sessions/"]'), null);
assert.equal(
  screen.queryByRole("button", { name: /Preview sample task/ }),
  null
);
assert.equal(screen.queryByRole("dialog"), null);
fireEvent.click(screen.getByRole("button", { name: "New task", exact: true }));
await waitFor(() =>
  assert.equal(globalThis.__demoDestination, "/demo/tasks/new")
);
assert.equal(
  screen.queryByRole("dialog"),
  null,
  "New task enters the conversation without a naming dialog"
);
assert.equal(screen.queryByRole("textbox", { name: "Task name" }), null);
fireEvent.click(
  screen.getByRole("button", { name: "Archive task: Polish the settings menu" })
);
assert.ok(
  screen.getByRole("dialog", { name: "Archive this task for everyone?" })
);
fireEvent.click(
  screen.getByRole("button", { name: "Archive task", exact: true })
);
await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
assert.equal(
  screen.getAllByRole("link", { name: /^Open sample task:/ }).length,
  3
);
assert.equal(
  document.activeElement,
  screen.getByRole("button", { name: "Active 3" }),
  "focus survives archiving a row"
);
fireEvent.click(screen.getByRole("button", { name: "Archived 1" }));
assert.equal(
  screen
    .getByRole("link", { name: "Open sample task: Polish the settings menu" })
    .getAttribute("href"),
  "/demo/tasks/demo-menu?archived=1"
);
fireEvent.click(
  screen.getByRole("button", { name: "Restore task: Polish the settings menu" })
);
fireEvent.click(
  screen.getByRole("button", { name: "Restore task", exact: true })
);
await waitFor(() => assert.ok(screen.getByText("No archived tasks")));
fireEvent.click(screen.getByRole("button", { name: "Active 4" }));
console.log(
  "PASS: team archive, Archived list, read-only task link, restore and keyboard focus; zero network requests."
);
fireEvent.click(screen.getByRole("button", { name: "Empty state" }));
assert.ok(screen.getByText("Start your first shared task"));
fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
assert.equal(
  screen.getAllByRole("link", { name: /^Open sample task:/ }).length,
  4
);
cleanup();
console.log(
  "PASS: all four sample rows have real, keyboard-accessible demo links; no placeholder dialogs or live task links."
);

let creationCount = 0;
let finishCreation;
render(
  h(TaskDashboard, {
    tasks: [
      {
        id: "unnamed",
        title: "",
        repositoryName: null,
        updatedAt: demoLoadedAt,
      },
    ],
    memberName: "Alex",
    memberInitials: "AL",
    loadedAt: demoLoadedAt,
    createAction: async (form) => {
      creationCount++;
      assert.equal(form.get("title"), null);
      await new Promise((resolve) => {
        finishCreation = resolve;
      });
    },
  })
);
assert.equal(
  screen.getByRole("link", { name: /Untitled task/ }).getAttribute("href"),
  "/sessions/unnamed"
);
fireEvent.click(screen.getByRole("button", { name: "New task", exact: true }));
await waitFor(() =>
  assert.ok(screen.getByRole("button", { name: "Creating task" }).disabled)
);
fireEvent.click(screen.getByRole("button", { name: "Creating task" }));
assert.equal(creationCount, 1, "pending creation prevents repeated clicks");
finishCreation();
await waitFor(() =>
  assert.ok(
    !screen.getByRole("button", { name: "New task", exact: true }).disabled
  )
);
cleanup();
console.log(
  "PASS: one-click unnamed creation, pending guard and an accessible untitled dashboard label."
);

const customTask = newDemoTask("Try team onboarding", "custom");
render(
  h(TaskDashboard, {
    tasks: [customTask],
    memberName: "Alex",
    memberInitials: "AL",
    loadedAt: demoLoadedAt,
    createAction: async () => {
      throw new Error("This check must not create a live task.");
    },
    previewTaskHref: demoTaskHref,
  })
);
assert.equal(
  screen
    .getByRole("link", { name: "Open sample task: Try team onboarding" })
    .getAttribute("href"),
  "/demo/tasks/new?title=Try%20team%20onboarding"
);
cleanup();

render(
  h(TaskDashboard, {
    tasks: [{ ...demoTasks[0], id: "real-task" }],
    memberName: "Alex",
    memberInitials: "AL",
    loadedAt: demoLoadedAt,
    createAction: async () => {
      throw new Error("This check must not create a task.");
    },
  })
);
assert.ok(screen.getByRole("heading", { name: "Tasks" }));
assert.equal(
  screen
    .getByRole("link", { name: /Polish the settings menu/ })
    .getAttribute("href"),
  "/sessions/real-task"
);
assert.equal(screen.queryByText("Preview"), null);
assert.ok(screen.getByRole("group", { name: "Task status" }));
assert.equal(
  screen.getByRole("link", { name: "Explore demo" }).getAttribute("href"),
  "/demo"
);
cleanup();
render(
  h(TaskDashboard, {
    tasks: [],
    memberName: "Alex",
    memberInitials: "AL",
    loadedAt: demoLoadedAt,
    createAction: async () => {
      throw new Error("This check must not create a task.");
    },
  })
);
assert.ok(screen.getByText("Start your first shared task"));
assert.ok(screen.getByRole("button", { name: "New task" }));
assert.equal(
  screen.getByRole("link", { name: "Explore demo" }).getAttribute("href"),
  "/demo"
);
assert.ok(screen.getByRole("button", { name: "Active 0" }));
cleanup();
render(h(HiveSignIn, { returnTo: "/" }));
assert.equal(
  screen.getByRole("link", { name: "Explore demo" }).getAttribute("href"),
  "/demo"
);
assert.equal(
  screen
    .getByRole("link", { name: "Continue with GitHub" })
    .getAttribute("href"),
  "/api/github/login?return_to=%2F"
);
assert.ok(screen.getByText("No sign-in required. Sample data only."));
cleanup();
const { default: Home } = await import("../src/app/page.tsx");
render(await Home({ searchParams: Promise.resolve({}) }));
assert.ok(screen.getByRole("heading", { name: "Build together with Hive" }));
assert.equal(
  screen.getByRole("link", { name: "Explore demo" }).getAttribute("href"),
  "/demo"
);
cleanup();
globalThis.__demoTestCookie = { value: "invalid-fixture-session" };
render(await Home({ searchParams: Promise.resolve({ signin: "retry" }) }));
assert.ok(screen.getByRole("heading", { name: "Let’s try signing in again" }));
assert.equal(
  screen.getByRole("link", { name: "Explore demo" }).getAttribute("href"),
  "/demo"
);
cleanup();
await assert.rejects(
  Home({ searchParams: Promise.resolve({}) }),
  /must not import the database/,
  "A session cookie must still be verified against the database; no authentication bypass."
);
delete globalThis.__demoTestCookie;
dom.close();
console.log(
  "PASS: the dashboard keeps real task links, team archive filters and an honest empty state."
);
console.log(
  "PASS: signed-out, signed-in, and empty dashboards link to the demo index, including newly created local demo tasks."
);
console.log(
  "PASS: actual signed-out/retry home pages render without a database; session-bearing requests still require verification."
);
