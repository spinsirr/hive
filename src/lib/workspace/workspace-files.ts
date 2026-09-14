import { z } from "zod";
import type { WorkspaceState } from "../session/task-session.ts";

export function workspaceReadRevision(workspace: WorkspaceState) {
  return JSON.stringify([
    workspace.sandboxName,
    workspace.agentSession?.id,
    workspace.startedAt,
    workspace.completedAt,
    workspace.restore?.id,
    workspace.lastRestore?.id,
  ]);
}

export const workspaceReadRequest = z
  .object({
    kind: z.enum(["directory", "file"]),
    path: z
      .string()
      .max(4096)
      .refine(
        (value) =>
          value === "" ||
          // eslint-disable-next-line no-control-regex -- Workspace paths must reject ASCII control characters.
          (!/[\\\x00-\x1f\x7f]/.test(value) &&
            value
              .split("/")
              .every((part) => part !== "" && part !== "." && part !== "..")),
        "Use a relative workspace path."
      ),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .refine((value) => value.kind === "directory" || value.path.length > 0);

export const workspaceEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["directory", "file", "symlink", "restricted", "other"]),
});

export const workspaceReadResponse = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("directory"),
    path: z.string(),
    entries: z.array(workspaceEntrySchema),
    nextOffset: z.number().int().nullable(),
  }),
  z.object({
    kind: z.literal("file"),
    path: z.string(),
    content: z.string(),
    bytes: z.number(),
  }),
]);

export type WorkspaceReadRequest = z.infer<typeof workspaceReadRequest>;
export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;
export type WorkspaceReadResponse = z.infer<typeof workspaceReadResponse>;

export const workspaceCheckpointsResponse = z.object({
  checkpoints: z.array(
    z.object({
      id: z.string(),
      createdAt: z.number(),
      sizeBytes: z.number(),
      current: z.boolean(),
      restorable: z.boolean(),
    })
  ),
  retentionCount: z.number().nullable(),
  version: z.number(),
  blockedReason: z.string().nullable(),
  restore: z
    .object({
      id: z.string(),
      snapshotId: z.string(),
      status: z.enum(["restoring", "unconfirmed"]),
      retryAfter: z.number(),
    })
    .nullable(),
});

export type WorkspaceCheckpointsResponse = z.infer<
  typeof workspaceCheckpointsResponse
>;
