import { registerTestModules } from "../helpers/test-modules.mjs";
// Exercise the real Files UI, read hook, SWR provider, and Monaco React lifecycle.
// Only the network and Monaco rendering engine are doubled; no live workspace is read.
import assert from "node:assert/strict";

import { createRequire } from "node:module";
import { mock } from "node:test";
import { createDomFixture } from "../helpers/test-dom.mjs";

const dom = createDomFixture("<!doctype html><html><body></body></html>", {
  url: "https://hive.example",
  pretendToBeVisual: true,
});
registerTestModules({
  resolve(specifier, context, next) {
    if (specifier === "@monaco-editor/react")
      return next(
        new URL(
          "../../node_modules/@monaco-editor/react/dist/index.mjs",
          import.meta.url
        ).href,
        context
      );
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".module.css"))
      return {
        format: "module",
        shortCircuit: true,
        source:
          'export default { browser: "browser", body: "body", explorer: "explorer", editor: "editor" };',
      };
    return next(url, context);
  },
});
const { StrictMode, createElement: h } = await import("react");
const { act, cleanup, fireEvent, render, screen, waitFor } =
  await import("@testing-library/react");
// Preserve the actual @monaco-editor/react effects, ready state and editor refs.
// The engine double catches calls on an already-disposed editor without WebGL.
const invalidEditorCalls = [];
const editorInstances = [];
const models = new Map();
const monaco = {
  Uri: { parse: (path) => ({ toString: () => path }) },
  editor: {
    EditorOption: { readOnly: 1 },
    defineTheme() {},
    setTheme() {},
    onDidChangeMarkers: () => ({ dispose() {} }),
    getModel: (uri) => models.get(uri.toString()),
    createModel(content, language, uri) {
      const model = {
        content,
        uri,
        dispose: () => models.delete(uri.toString()),
      };
      models.set(uri.toString(), model);
      return model;
    },
    create(container, options) {
      let disposed = false;
      let model = options.model;
      const code = document.createElement("pre");
      code.textContent = model.content;
      container.append(code);
      const live =
        (name, action = () => {}) =>
        (...args) => {
          if (disposed) invalidEditorCalls.push(name);
          return action(...args);
        };
      const editor = {
        getModel: live("getModel", () => model),
        setModel: live("setModel", (next) => {
          model = next;
          code.textContent = next.content;
        }),
        getOption: live("getOption", () => true),
        setValue: live("setValue", (value) => {
          model.content = value;
          code.textContent = value;
        }),
        updateOptions: live("updateOptions"),
        saveViewState: live("saveViewState", () => null),
        restoreViewState: live("restoreViewState"),
        onDidChangeCursorSelection: live("onDidChangeCursorSelection", () => ({
          dispose() {},
        })),
        dispose() {
          disposed = true;
          code.remove();
        },
      };
      editorInstances.push(editor);
      return editor;
    },
  },
};
mock.module(
  createRequire(import.meta.resolve("@monaco-editor/react")).resolve(
    "@monaco-editor/loader"
  ),
  {
    defaultExport: {
      config() {},
      init: () => Object.assign(Promise.resolve(monaco), { cancel() {} }),
    },
  }
);
const { default: CodeViewer } =
  await import("../../src/components/hive/workspace/code-viewer.tsx");
let realEditorLifecycle = false;
mock.module("next/dynamic.js", {
  defaultExport: () =>
    function CodeFixture({ path, content, onSelectionChange }) {
      return realEditorLifecycle
        ? h(CodeViewer, { path, content, onSelectionChange })
        : h("pre", { "aria-label": `Code: ${path}` }, content);
    },
});
const { WorkspaceFiles } =
  await import("../../src/components/hive/workspace/workspace-files.tsx");
const { WorkspaceReadCache } =
  await import("../../src/components/hive/workspace/workspace-read-cache.tsx");
const { useWorkspaceRead } =
  await import("../../src/hooks/use-workspace-read.ts");
const { workspaceReadRevision } =
  await import("../../src/lib/workspace/workspace-files.ts");

const calls = [];
let version = "one";
const file = (path) => ({ name: path.split("/").at(-1), path, kind: "file" });
const directory = (path) => ({ name: path, path, kind: "directory" });
const response = (value, status = 200) => Response.json(value, { status });
const defaultRead = (url) => {
  const path = url.searchParams.get("path");
  return url.searchParams.get("kind") === "file"
    ? response({
        kind: "file",
        path,
        content: `${url.pathname}:${path}:${version}`,
        bytes: 40,
      })
    : response({
        kind: "directory",
        path,
        entries:
          path === "src"
            ? [file("src/index.ts")]
            : [file("README.md"), file("notes.md"), directory("src")],
        nextOffset: null,
      });
};
let read = defaultRead;
globalThis.fetch = async (input, options) => {
  const url = new URL(input, "https://hive.example");
  assert.equal(
    options.cache,
    "no-store",
    "HTTP responses must remain private/no-store"
  );
  calls.push(url);
  return read(url);
};
const count = (path, session = "cache-a") =>
  calls.filter(
    (url) =>
      url.pathname.includes(`/sessions/${session}/`) &&
      url.searchParams.get("path") === path
  ).length;
const props = {
  sessionId: "cache-a",
  memberId: "member-a",
  revision: "idle-one",
  initialPath: "README.md",
  deliveredIds: new Set(),
  disabled: false,
  onAnnotate: async () => {
    throw new Error("Reading must never annotate or steer");
  },
};
const files = (extra = {}, mode = "visible") =>
  h(
    StrictMode,
    null,
    h(WorkspaceFiles, { ...props, ...extra, active: mode === "visible" })
  );
const click = (name) =>
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
const content = (path, value = version, session = "cache-a") =>
  `/api/sessions/${session}/files:${path}:${value}`;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

try {
  const view = render(files());
  await screen.findByText(content("README.md"));
  click("notes.md");
  await screen.findByText(content("notes.md"));
  click("README.md");
  assert.ok(
    screen.getByText(content("README.md")),
    "cached file must be visible immediately"
  );
  click("src");
  await screen.findByRole("button", { name: "index.ts" });
  click("src");
  click("src");
  assert.ok(screen.getByRole("button", { name: "index.ts" }));
  assert.deepEqual(
    [count(""), count("README.md"), count("notes.md"), count("src")],
    [1, 1, 1, 1]
  );
  view.rerender(files({}, "hidden"));
  view.rerender(files());
  await screen.findByText(content("README.md"));
  assert.ok(screen.getByRole("button", { name: "index.ts" }));
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    dom.window.dispatchEvent(new dom.window.Event("online"));
  });
  assert.equal(
    calls.length,
    4,
    "tab/thread visibility and focus must not re-read cached paths"
  );
  console.log(
    "PASS: file switches, reopened folders, and pane hide/show reuse content and preserve the expanded tree without new reads."
  );

  version = "two";
  click("Refresh workspace files");
  await screen.findByText(content("README.md"));
  await waitFor(() => assert.equal(count("src"), 2));
  click("notes.md");
  await screen.findByText(content("notes.md"));
  assert.equal(
    count("notes.md"),
    2,
    "refresh must invalidate closed/cached files too"
  );
  version = "three";
  view.rerender(files({ revision: "completed-two" }));
  await screen.findByText(content("notes.md"));
  assert.ok(screen.getByRole("button", { name: "index.ts" }));
  assert.equal(count("notes.md"), 3);
  view.rerender(files({ revision: "restore-pending", locked: true }));
  assert.ok(screen.getByText("The workspace is being restored."));
  assert.equal(screen.queryByText(content("notes.md")), null);
  const beforeRestore = calls.length;
  await act(async () => {});
  assert.equal(
    calls.length,
    beforeRestore,
    "restoring must not issue reads or show cached code"
  );
  version = "restored";
  view.rerender(files({ revision: "restored-three" }));
  await screen.findByText(content("notes.md"));
  view.rerender(files({ revision: "restored-three", memberId: "member-b" }));
  await waitFor(() => assert.equal(count("notes.md"), 5));
  view.rerender(
    files({
      revision: "restored-three",
      memberId: "member-b",
      sessionId: "cache-b",
    })
  );
  await screen.findByText(content("notes.md", version, "cache-b"));
  assert.equal(count("notes.md", "cache-b"), 1);
  console.log(
    "PASS: refresh and new workspace revisions discard old files; restore fences reads; member and task scopes do not share cached content."
  );
  cleanup();

  const beforeHidden = calls.length;
  const hidden = render(files({}, "hidden"));
  await act(async () => {});
  assert.equal(
    calls.length,
    beforeHidden,
    "a never-opened Files tab must not read the sandbox"
  );
  hidden.rerender(files({ revision: "changed-while-hidden" }, "hidden"));
  await act(async () => {});
  assert.equal(
    calls.length,
    beforeHidden,
    "a hidden revision update must wait for Files to open"
  );
  hidden.rerender(files({ revision: "changed-while-hidden" }));
  await screen.findByText(content("README.md"));
  assert.equal(calls.length, beforeHidden + 2);
  hidden.unmount();
  console.log(
    "PASS: hidden Files and hidden revision updates wait until the pane opens, including in Strict Mode."
  );

  calls.length = 0;
  const slow = deferred();
  read = (url) =>
    url.searchParams.get("path") === "notes.md"
      ? slow.promise
      : defaultRead(url);
  const switching = render(files());
  await screen.findByText(content("README.md"));
  click("notes.md");
  await waitFor(() => assert.equal(count("notes.md"), 1));
  click("README.md");
  assert.ok(screen.getByText(content("README.md")));
  click("notes.md");
  await act(async () => {});
  assert.equal(
    count("notes.md"),
    1,
    "switching back shares the still-pending read"
  );
  click("README.md");
  await act(async () =>
    slow.resolve(
      response({
        kind: "file",
        path: "notes.md",
        content: "late notes",
        bytes: 10,
      })
    )
  );
  assert.ok(
    screen.getByText(content("README.md")),
    "late result must not render under the selected filename"
  );
  click("notes.md");
  assert.ok(screen.getByText("late notes"));
  const oldRevision = deferred();
  read = () => oldRevision.promise;
  switching.rerender(
    files({ revision: "old-pending", initialPath: "notes.md" })
  );
  await act(async () => {});
  read = defaultRead;
  version = "newest";
  switching.rerender(files({ revision: "new-current" }));
  await screen.findByText(content("notes.md"));
  await act(async () =>
    oldRevision.resolve(
      response({
        kind: "file",
        path: "notes.md",
        content: "obsolete",
        bytes: 8,
      })
    )
  );
  assert.ok(screen.getByText(content("notes.md")));
  assert.equal(screen.queryByText("obsolete"), null);
  console.log(
    "PASS: pending reads deduplicate and late file/revision responses cannot overwrite the current editor."
  );
  cleanup();

  calls.length = 0;
  let failPage = false;
  read = (url) => {
    if (url.searchParams.get("kind") === "file") return defaultRead(url);
    const path = url.searchParams.get("path");
    if (!path)
      return response({
        kind: "directory",
        path,
        entries: [directory("src")],
        nextOffset: null,
      });
    if (url.searchParams.get("offset") === "0")
      return response({
        kind: "directory",
        path,
        entries: [file("src/first.ts")],
        nextOffset: 500,
      });
    if (failPage) return response({ error: "Couldn’t load this page." }, 503);
    return response({
      kind: "directory",
      path,
      entries: [file("src/first.ts"), file("src/last.ts")],
      nextOffset: null,
    });
  };
  render(files({ initialPath: "" }));
  await screen.findByRole("button", { name: "src" });
  click("src");
  await screen.findByRole("button", { name: "first.ts" });
  failPage = true;
  click("Load more files");
  await screen.findByText("Couldn’t load this page.");
  assert.ok(screen.getByRole("button", { name: "first.ts" }));
  failPage = false;
  click("Load more files");
  await screen.findByRole("button", { name: "last.ts" });
  assert.equal(screen.getAllByRole("button", { name: "first.ts" }).length, 1);
  const pagesRead = calls.length;
  click("src");
  click("src");
  assert.ok(screen.getByRole("button", { name: "last.ts" }));
  await act(async () => {});
  assert.equal(calls.length, pagesRead);
  assert.deepEqual(
    calls
      .filter((url) => url.searchParams.get("path") === "src")
      .map((url) => url.searchParams.get("offset")),
    ["0", "500", "500"]
  );
  console.log(
    "PASS: paginated folders preserve all loaded pages, deduplicate entries, and retry a failed page without re-reading page one."
  );
  cleanup();

  calls.length = 0;
  read = () =>
    response({
      kind: "file",
      path: "wrong.md",
      content: "wrong file",
      bytes: 10,
    });
  render(files());
  await screen.findAllByText("Workspace could not be read. Try again.");
  assert.equal(screen.queryByText("wrong file"), null);
  read = defaultRead;
  click("Refresh workspace files");
  await screen.findByText(content("README.md"));
  console.log(
    "PASS: mismatched responses never populate the file cache; explicit retry recovers."
  );
  cleanup();

  calls.length = 0;
  const sharedRead = deferred();
  read = () => sharedRead.promise;
  function Reader() {
    const result = useWorkspaceRead({
      sessionId: "cache-a",
      revision: "r",
      kind: "file",
      path: "README.md",
    });
    return h("span", null, result.data?.content ?? "pending");
  }
  render(h(WorkspaceReadCache, { scope: "dedup" }, h(Reader), h(Reader)));
  await waitFor(() => assert.equal(calls.length, 1));
  await act(async () =>
    sharedRead.resolve(
      response({
        kind: "file",
        path: "README.md",
        content: "shared response",
        bytes: 15,
      })
    )
  );
  assert.equal(screen.getAllByText("shared response").length, 2);
  console.log("PASS: concurrent consumers share one pending request.");

  const idle = {
    sandboxName: "sandbox-a",
    agentSession: { id: "agent-a" },
    startedAt: 10,
    completedAt: 20,
  };
  const baseline = workspaceReadRevision(idle);
  assert.equal(
    baseline,
    workspaceReadRevision({
      ...idle,
      summary: "Chat-only update",
      status: "review",
    })
  );
  for (const change of [
    { startedAt: 30, completedAt: undefined },
    { completedAt: 40 },
    { sandboxName: "sandbox-b" },
    { agentSession: { id: "agent-b" } },
    { restore: { id: "restore-a" } },
    { lastRestore: { id: "restore-a" } },
  ])
    assert.notEqual(baseline, workspaceReadRevision({ ...idle, ...change }));
  assert.notEqual(
    workspaceReadRevision({ ...idle, startedAt: 30, completedAt: undefined }),
    workspaceReadRevision({ ...idle, startedAt: 50, completedAt: undefined })
  );
  console.log(
    "PASS: run starts/completions, sandbox/context replacement and restores invalidate; unrelated chat/status changes do not."
  );
  cleanup();

  realEditorLifecycle = true;
  read = defaultRead;
  calls.length = 0;
  const editorView = render(files());
  await screen.findByText(content("README.md"));
  for (let index = 0; index < 3; index++) {
    editorView.rerender(files({}, "hidden"));
    editorView.rerender(files());
    await act(async () => {});
    assert.deepEqual(
      invalidEditorCalls,
      [],
      "showing a cached Files pane must never reuse a disposed Monaco editor"
    );
    await screen.findByText(content("README.md"));
  }
  assert.equal(
    count("README.md"),
    1,
    "editor remounts must reuse the file cache"
  );
  assert.equal(
    editorInstances.length,
    4,
    "a disposed editor needs a new React instance on each show"
  );
  console.log(
    "PASS: the real Monaco React wrapper remounts cleanly across repeated pane switches while file reads stay cached."
  );
  cleanup();
  const { HiveClientContext } =
    await import("../../src/components/hive/hive-client.tsx");
  const { Workspace } =
    await import("../../src/components/hive/workspace/repository-workspace.tsx");
  const { WorkspaceCheckpoints } =
    await import("../../src/components/hive/workspace/workspace-checkpoints.tsx");
  const catalogRequests = [];
  const catalogClient = {
    reload() {
      throw new Error("A valid fixture login must not reload");
    },
    request(path, init) {
      assert.notEqual(
        init?.method,
        "POST",
        "Loading repositories never attaches one"
      );
      const pending = Promise.withResolvers();
      catalogRequests.push({ ...pending, path });
      return pending.promise;
    },
  };
  const catalog = (sessionId = "catalog-one", disabled = false) =>
    h(
      HiveClientContext,
      { value: catalogClient },
      h(Workspace, { sessionId, fileCollaboration: { disabled } })
    );
  const repositoryView = render(catalog());
  assert.equal(
    catalogRequests.length,
    0,
    "Repository discovery stays on demand"
  );
  const choose = screen.getByRole("button", { name: "Choose repository" });
  fireEvent.click(choose);
  fireEvent.click(choose);
  await waitFor(() => assert.equal(catalogRequests.length, 1));
  const listing = (name) => ({
    repositories: [
      { id: 1, name, defaultBranch: "main", visibility: "private" },
    ],
  });
  await act(async () =>
    catalogRequests[0].resolve(response(listing("team/one")))
  );
  await screen.findByText("team/one");
  fireEvent.click(screen.getByRole("button", { name: "Refresh repositories" }));
  await waitFor(() => assert.equal(catalogRequests.length, 2));
  assert.equal(
    screen.getByRole("button", { name: /team\/one/ }).disabled,
    true,
    "A repository being revalidated cannot be selected from stale data"
  );
  await act(async () =>
    catalogRequests[1].resolve(
      response({ error: "Repository discovery failed" }, 503)
    )
  );
  await screen.findByText("Repository discovery failed");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  assert.equal(
    catalogRequests.length,
    2,
    "Focus and reconnect never start an unrequested repository lookup"
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh repositories" }));
  await waitFor(() => assert.equal(catalogRequests.length, 3));
  repositoryView.rerender(catalog("catalog-two"));
  await waitFor(() => assert.equal(catalogRequests.length, 4));
  await act(async () =>
    catalogRequests[3].resolve(response(listing("team/two")))
  );
  await screen.findByText("team/two");
  await act(async () =>
    catalogRequests[2].resolve(response(listing("team/stale")))
  );
  assert.equal(
    screen.queryByText("team/stale"),
    null,
    "A late response cannot populate another task's repository picker"
  );
  repositoryView.rerender(catalog("catalog-two", true));
  assert.equal(
    screen.queryByRole("button", {
      name: /Choose repository|Refresh repositories/,
    }),
    null
  );
  assert.equal(catalogRequests.length, 4);
  console.log(
    "PASS: SWR keeps repository reads on demand, gates stale selections, exposes errors, and isolates late responses by task."
  );
  cleanup();

  const checkpointRequests = [];
  const checkpointClient = {
    reload() {},
    request(path, init) {
      assert.notEqual(
        init?.method,
        "POST",
        "Refreshing checkpoints never restores files"
      );
      const pending = Promise.withResolvers();
      checkpointRequests.push({ ...pending, path });
      return pending.promise;
    },
  };
  const checkpointList = (revision) =>
    h(
      HiveClientContext,
      { value: checkpointClient },
      h(WorkspaceCheckpoints, {
        sessionId: "checkpoint-swr",
        revision,
        onRestored() {},
        recoveryStatus: { checking: false, notice: "", check() {} },
      })
    );
  const checkpointData = (version, id) => ({
    checkpoints: [
      {
        id,
        createdAt: version * 86400000,
        sizeBytes: 100,
        current: false,
        restorable: true,
      },
    ],
    retentionCount: 10,
    version,
    blockedReason: null,
    restore: null,
  });
  const checkpointView = render(checkpointList(1));
  await waitFor(() => assert.equal(checkpointRequests.length, 1));
  checkpointView.rerender(checkpointList(2));
  await waitFor(() => assert.equal(checkpointRequests.length, 2));
  await act(async () =>
    checkpointRequests[1].resolve(response(checkpointData(2, "checkpoint-new")))
  );
  await screen.findByText("checkpoint-new");
  await act(async () =>
    checkpointRequests[0].resolve(
      response(checkpointData(1, "checkpoint-stale"))
    )
  );
  assert.equal(screen.queryByText("checkpoint-stale"), null);
  fireEvent.click(
    screen.getByRole("button", { name: /^Restore checkpoint from/ })
  );
  assert.equal(
    screen.getByRole("button", { name: "Restore checkpoint" }).disabled,
    false
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh checkpoints", hidden: true })
  );
  await waitFor(() => assert.equal(checkpointRequests.length, 3));
  assert.equal(
    screen.getByRole("button", { name: "Restore checkpoint" }).disabled,
    true,
    "An open restore dialog is gated while SWR revalidates its checkpoint version"
  );
  await act(async () =>
    checkpointRequests[2].resolve(
      response({
        ...checkpointData(3, "checkpoint-new"),
        blockedReason: "This task was archived.",
      })
    )
  );
  await screen.findAllByText("This task was archived.");
  assert.equal(
    screen.getByRole("button", { name: "Restore checkpoint" }).disabled,
    true
  );
  console.log(
    "PASS: SWR ignores stale checkpoint revisions and disables an open restore confirmation during refresh and after a teammate archives the task."
  );
} finally {
  cleanup();
  dom.close();
}
