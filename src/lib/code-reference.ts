import { z } from "zod";

import { workspaceReadRequest } from "./workspace-files.ts";

export const codeReferenceSchema = z
  .object({
    path: z
      .string()
      .refine(
        (path) => workspaceReadRequest.safeParse({ kind: "file", path }).success
      ),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    quote: z.string().min(1).max(8_000),
  })
  .refine(
    (value) =>
      value.endLine >= value.startLine && value.endLine - value.startLine < 100
  );

export type CodeReference = z.infer<typeof codeReferenceSchema>;

export function codeReferenceLabel(reference: CodeReference) {
  return `${reference.path}:${reference.startLine}${reference.endLine === reference.startLine ? "" : `–${reference.endLine}`}`;
}

export function codeReferenceContext(reference: CodeReference) {
  return `Code reference: ${codeReferenceLabel(reference)}\nQuoted by a teammate; the file may have changed. Re-read the current file before editing.\n\n${reference.quote}`;
}
