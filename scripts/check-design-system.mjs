import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const allowedDemoFiles = new Set([
  "page.tsx",
  "dashboard-demo.tsx",
  "demo-workspace.tsx",
  "tasks/[taskId]/page.tsx",
  "collaboration/page.tsx",
  "conversation/page.tsx",
  "subagents/page.tsx",
]);
function inspect(file, source) {
  const errors = [];
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const demo = file.startsWith("src/app/demo/");
  const local = demo || file === "src/lib/demo-workspace.ts";
  const relative = file.slice("src/app/demo/".length);
  if (demo && !allowedDemoFiles.has(relative))
    errors.push(
      "Unowned demo UI: use DemoWorkspace or add a documented exception."
    );
  let sharedView = false;
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const target = node.moduleSpecifier.text;
      if (
        file.startsWith("src/components/hive/") &&
        /(?:\/demo\/|demo-workspace)/.test(target)
      )
        errors.push("Production UI cannot depend on demo code.");
      if (
        local &&
        /use-shared-session|task-session-store|hive-runner|auth-session/.test(
          target
        ) &&
        !node.importClause?.isTypeOnly
      )
        errors.push("Demo cannot import live connections or server services.");
    }
    const scopedControl =
      file.startsWith("src/components/hive/") &&
      file !== "src/components/hive/hive-client.tsx";
    if (
      (local || scopedControl) &&
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      /(?:^|\.)(fetch|WebSocket|EventSource)$/.test(
        node.expression.getText(tree)
      )
    )
      errors.push("Use the scoped client; demo must not call the network.");
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(tree);
      if (name === "HiveWorkspaceView") sharedView = true;
      if (demo && relative.endsWith("/page.tsx") && name !== "DemoWorkspace")
        errors.push("Demo task routes select data, not UI.");
      if (
        relative === "demo-workspace.tsx" &&
        ![
          "HiveClientContext",
          "HiveWorkspaceView",
          "div",
          "span",
          "Button",
        ].includes(name)
      )
        errors.push("Demo wrapper may only add the simulation toolbar.");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (
    (relative === "demo-workspace.tsx" ||
      file === "src/components/hive/hive-workspace.tsx") &&
    !sharedView
  )
    errors.push("Live and demo must render HiveWorkspaceView.");
  return errors;
}

// Exercise both the allow-list and the negative cases; not a grep-only policy.
assert.deepEqual(
  inspect(
    "src/app/demo/tasks/[taskId]/page.tsx",
    "export default () => <DemoWorkspace task={task} />"
  ),
  []
);
assert.ok(
  inspect(
    "src/app/demo/tasks/[taskId]/page.tsx",
    "export default () => <main>Copied UI</main>"
  ).length
);
assert.ok(
  inspect("src/app/demo/another-chat.tsx", "export default () => <div />")
    .length
);
assert.ok(
  inspect("src/lib/demo-workspace.ts", "fetch('/api/sessions')").length
);
assert.ok(inspect("src/lib/demo-workspace.ts", "new WebSocket(url)").length);
assert.ok(
  inspect("src/components/hive/example.tsx", "fetch('/api/new-control')").length
);
assert.ok(
  inspect(
    "src/lib/demo-workspace.ts",
    "import { useSharedSession } from '@/hooks/use-shared-session'"
  ).length
);
assert.ok(
  inspect(
    "src/components/hive/example.tsx",
    "import x from '@/app/demo/demo-workspace'"
  ).length
);

const root = fileURLToPath(new URL("../", import.meta.url));
function files(directory) {
  return readdirSync(`${root}${directory}`, { withFileTypes: true }).flatMap(
    (entry) =>
      entry.isDirectory()
        ? files(`${directory}/${entry.name}`)
        : [`${directory}/${entry.name}`]
  );
}
const targets = [
  ...files("src/app/demo"),
  ...files("src/components/hive"),
  "src/lib/demo-workspace.ts",
].filter((file) => /\.tsx?$/.test(file));
const errors = targets.flatMap((file) =>
  inspect(file, readFileSync(`${root}${file}`, "utf8")).map(
    (error) => `${file}: ${error}`
  )
);
assert.deepEqual(errors, []);
console.log(
  "PASS: shared workspace ownership, demo isolation and guard self-tests."
);
