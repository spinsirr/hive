import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const dom = new JSDOM("<!doctype html><body></body>");
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLSelectElement", "Event", "Node"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
registerHooks({ load(url, context, next) {
  if (!url.endsWith(".tsx")) return next(url, context);
  return { format: "module", shortCircuit: true, source: transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
const { createElement: h } = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { CodingAgentSelect } = await import("../src/components/hive/coding-agent-select.tsx");
const choices = [];
const props = { value: "codex", disabled: false, onChange: value => choices.push(value) };
try {
  const rendered = render(h(CodingAgentSelect, props));
  const select = screen.getByRole("combobox", { name: "Coding agent" });
  assert.equal(select.value, "codex");
  assert.deepEqual([...select.options].map(option => option.text), ["Codex", "Claude Code"]);
  fireEvent.change(select, { target: { value: "claude-code" } });
  assert.deepEqual(choices, ["claude-code"]);
  rendered.rerender(h(CodingAgentSelect, { ...props, value: "claude-code", disabled: true }));
  assert.equal(select.value, "claude-code");
  assert.equal(select.disabled, true);
  assert.match(select.title, /original coding agent and history/);
  console.log("PASS: the accessible coding-agent selector reflects the shared choice and locks the native history after coding starts.");
} finally { cleanup(); dom.window.close(); }
