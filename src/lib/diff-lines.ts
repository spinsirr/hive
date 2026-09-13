export type DiffLine = {
  text: string;
  change: "added" | "removed" | "context" | "meta";
  /** Line number in the old file, when this line existed there. */
  oldLine?: number;
  /** Line number in the new file, when this line exists there. */
  newLine?: number;
};

/**
 * Attach real file line numbers to a unified diff. Only lines inside a hunk are
 * classified as changes; headers, hunk markers, truncation notices and anything
 * outside a hunk are metadata.
 */
export function annotateUnifiedDiff(diff: string): DiffLine[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;
  return diff.split("\n").map((text): DiffLine => {
    if (text.startsWith("diff ")) {
      oldLine = undefined;
      newLine = undefined;
      return { text, change: "meta" };
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text, change: "meta" };
    }
    if (oldLine === undefined || newLine === undefined)
      return { text, change: "meta" };
    if (text.startsWith("+"))
      return { text, change: "added", newLine: newLine++ };
    if (text.startsWith("-"))
      return { text, change: "removed", oldLine: oldLine++ };
    if (text.startsWith(" "))
      return {
        text,
        change: "context",
        oldLine: oldLine++,
        newLine: newLine++,
      };
    // "\ No newline at end of file", Hive's truncation notice, blank separators.
    return { text, change: "meta" };
  });
}
