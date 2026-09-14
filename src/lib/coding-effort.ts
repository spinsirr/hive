/** Transport vocabulary. Picker options must come from the selected model. */
export const codingEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type CodingEffort = (typeof codingEfforts)[number];

export function isCodingEffort(value: unknown): value is CodingEffort {
  return (
    typeof value === "string" &&
    (codingEfforts as readonly string[]).includes(value)
  );
}
