// Render the production Runs pane with invented command evidence. No model,
// shell command, account, or live workspace is invoked by these checks.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    const target = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((url) => existsSync(url));
    return next(target?.href ?? specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});

const { RunsPane } = await import("../src/components/hive/workspace-runs.tsx");
const command = (extra) => ({ command: "pnpm test", exitCode: 0, output: "1 test passed", durationMs: 12, ...extra });
const render = (commands) => new JSDOM(renderToStaticMarkup(createElement(RunsPane, { commands })));

const maskedError = render([command({ command: "broken-command || true", output: "syntax error at line 1\n<script>not executable</script>" })]);
try {
  const doc = maskedError.window.document;
  assert.match(doc.querySelector("summary").textContent, /Exit 0/);
  assert.doesNotMatch(doc.querySelector("summary").textContent, /Passed/);
  assert.equal(doc.querySelector("pre").textContent, "syntax error at line 1\n<script>not executable</script>");
  assert.equal(doc.querySelector("script"), null);
  console.log("PASS: exit zero is shown as process evidence, never a test verdict; error output remains intact and escaped.");
} finally {
  maskedError.window.close();
}

const states = render([
  command({ command: "true", output: "" }),
  command({ exitCode: 2, output: "failed assertion" }),
  command({ exitCode: null, output: "partial output" }),
]);
try {
  const rows = [...states.window.document.querySelectorAll("details")];
  assert.equal(rows.length, 3);
  assert.match(rows[0].querySelector("summary").textContent, /Exit 0/);
  assert.equal(rows[0].querySelector("pre").textContent, "No output");
  assert.match(rows[1].querySelector("summary").textContent, /Exit 2/);
  assert.equal(rows[1].querySelector("pre").textContent, "failed assertion");
  assert.match(rows[2].querySelector("summary").textContent, /Incomplete/);
  assert.doesNotMatch(rows[2].querySelector("summary").textContent, /Exit 0/);
  assert.equal(rows[2].querySelector("pre").textContent, "partial output");
  console.log("PASS: nonzero and missing exit codes remain distinct, with disclosure and original output preserved.");
} finally {
  states.window.close();
}

const empty = render([]);
try {
  assert.match(empty.window.document.body.textContent, /No commands in this turn/);
  assert.equal(empty.window.document.querySelector("details"), null);
  console.log("PASS: an empty turn does not invent command evidence.");
} finally {
  empty.window.close();
}

const unreported = render([command({ exitCode: null, resultReceived: true, output: "Native tool output" })]);
assert.match(unreported.window.document.querySelector("summary").textContent, /Exit unavailable/);
assert.doesNotMatch(unreported.window.document.querySelector("summary").textContent, /Incomplete|Passed|Exit 0/);
unreported.window.close();
