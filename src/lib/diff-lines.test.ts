import assert from "node:assert/strict";
import test from "node:test";

import { annotateUnifiedDiff } from "./diff-lines.ts";

const diff = [
  "diff --git a/nav.tsx b/nav.tsx",
  "index 1111111..2222222 100644",
  "--- a/nav.tsx",
  "+++ b/nav.tsx",
  "@@ -10,4 +10,5 @@ export function Nav() {",
  "   const a = 1;",
  "-  const label = 'Steer';",
  "+  const label = 'Queue steer';",
  "+  const extra = true;",
  "   return label;",
  "\\ No newline at end of file",
  "diff --git a/notes.sql b/notes.sql",
  "--- a/notes.sql",
  "+++ b/notes.sql",
  "@@ -1 +1 @@",
  "--- old comment",
  "+++ new comment",
  "",
].join("\n");

test("gutter numbers follow the hunk headers for old and new files", () => {
  const lines = annotateUnifiedDiff(diff);
  const byText = (text: string) => lines.find((line) => line.text === text)!;
  for (const header of ["diff --git a/nav.tsx b/nav.tsx", "index 1111111..2222222 100644", "--- a/nav.tsx", "+++ b/nav.tsx", "@@ -10,4 +10,5 @@ export function Nav() {", "\\ No newline at end of file", ""]) {
    assert.deepEqual(byText(header), { text: header, change: "meta" }, header);
  }
  assert.deepEqual(byText("   const a = 1;"), { text: "   const a = 1;", change: "context", oldLine: 10, newLine: 10 });
  assert.deepEqual(byText("-  const label = 'Steer';"), { text: "-  const label = 'Steer';", change: "removed", oldLine: 11 });
  assert.deepEqual(byText("+  const label = 'Queue steer';"), { text: "+  const label = 'Queue steer';", change: "added", newLine: 11 });
  assert.deepEqual(byText("+  const extra = true;"), { text: "+  const extra = true;", change: "added", newLine: 12 });
  assert.deepEqual(byText("   return label;"), { text: "   return label;", change: "context", oldLine: 12, newLine: 13 });
});

test("inside a hunk, lines that merely look like file headers are still changes", () => {
  const lines = annotateUnifiedDiff(diff);
  const sql = lines.slice(lines.findIndex((line) => line.text === "@@ -1 +1 @@") + 1);
  assert.deepEqual(sql[0], { text: "--- old comment", change: "removed", oldLine: 1 });
  assert.deepEqual(sql[1], { text: "+++ new comment", change: "added", newLine: 1 });
});

test("text outside any hunk, such as a truncation notice, never receives line numbers", () => {
  const lines = annotateUnifiedDiff("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n\n[output truncated by Hive]");
  assert.deepEqual(lines.at(-1), { text: "[output truncated by Hive]", change: "meta" });
  assert.equal(lines.filter((line) => line.change !== "meta").length, 2);
});
