import { z } from "zod";
import type { TaskSessionState } from "./task-session.ts";

export type SubagentSession = Pick<TaskSessionState, "sessionId" | "stage" | "repository"> & {
  workspace: Pick<TaskSessionState["workspace"], "startedAt" | "completedAt" | "restore" | "sandboxName"> & {
    agentSession?: { id: string };
    liveReply?: { id: string };
  };
};

export const subagentSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().min(1).max(120),
  kind: z.enum(["research", "review"]),
  task: z.string().min(1).max(4000),
  status: z.enum(["starting", "running", "stopping", "completed", "failed", "stopped", "unconfirmed"]),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  result: z.string().max(12_000),
});
export type HiveSubagent = z.infer<typeof subagentSchema>;
export const subagentUpdateSchema = z.object({
  runId: z.string().min(1).max(120), sequence: z.number().int().positive(),
  tasks: z.array(subagentSchema).max(2),
});
export type HiveSubagentUpdate = z.infer<typeof subagentUpdateSchema>;

export const subagentControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("spawn"), kind: z.enum(["research", "review"]), task: z.string().trim().min(1).max(4000), requestId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal("read"), id: z.string().uuid(), waitMs: z.number().int().min(0).max(10_000).default(10_000) }).strict(),
  z.object({ action: z.literal("stop"), id: z.string().uuid() }).strict(),
]);
export type SubagentControl = z.infer<typeof subagentControlSchema>;
export const isSubagentActive = (task: HiveSubagent) => ["starting", "running", "stopping"].includes(task.status);

/** A lost parent is not proof that its child completed or stopped. */
export function finalizeSubagents(tasks?: HiveSubagent[]) {
  return tasks?.map((task) => isSubagentActive(task) ? { ...task, status: "unconfirmed" as const } : task);
}
