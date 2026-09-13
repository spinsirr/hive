export const TASK_TITLE_LIMIT = 120;
export const UNTITLED_TASK_LABEL = "Untitled task";

export function normalizeTaskTitle(value: string): string | null {
  const trimmed = value.trim();
  return trimmed && trimmed.length <= TASK_TITLE_LIMIT
    ? trimmed.replace(/\s+/gu, " ")
    : null;
}

export function taskTitleLabel(title: string): string {
  return title || UNTITLED_TASK_LABEL;
}

/** A first-message excerpt, not a model-generated summary. Empty stored titles
 * mean not yet named; every nonempty title (including a manual rename) is final
 * until a member changes it. No extra flag, model turn or URL change is needed.
 */
export function taskTitleFromMessage(body: string): string {
  const text = body.trim().replace(/\s+/gu, " ");
  const characters = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ({ segment }) => segment
  );
  if (characters.length <= 72 && text.length <= TASK_TITLE_LIMIT) return text;
  let excerpt = "";
  for (const character of characters.slice(0, 71)) {
    if (excerpt.length + character.length >= TASK_TITLE_LIMIT) break;
    excerpt += character;
  }
  return `${excerpt.trimEnd()}…`;
}
