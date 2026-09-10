import { z } from "zod";
import type { TaskSessionState } from "./task-session.ts";

const bindingSchema = z.object({
  sessionId: z.string().min(1), ownerId: z.string().min(1),
  repositoryId: z.number().int().positive(),
}).strict();

/** Operator-managed, explicitly scoped credential. Never discovered from a local login. */
export function claudeSubscriptionToken(
  task: TaskSessionState,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const token = env.HIVE_CLAUDE_OAUTH_TOKEN?.trim();
  const scope = env.HIVE_CLAUDE_SUBSCRIPTION_SCOPE?.trim();
  if (!scope && !token) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(scope ?? ""); } catch { /* Report no credential values. */ }
  const binding = bindingSchema.safeParse(parsed);
  if (!binding.success) throw new Error("Claude subscription task binding is not configured correctly.");
  if (binding.data.sessionId !== task.sessionId) return undefined;
  if (task.createdBy !== binding.data.ownerId || task.repository?.id !== binding.data.repositoryId ||
    task.repository.visibility !== "private") {
    throw new Error("Claude subscription is not authorized for this task and repository.");
  }
  if (!token || !/^sk-ant-oat01-[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Reconnect the Claude subscription before running this task.");
  }
  return token;
}
