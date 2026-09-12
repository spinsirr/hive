import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { codexSubscriptions, taskSessionMembers, taskSessions } from "@/db/schema";
import type { HiveToolScope } from "./hive-tool-token.ts";
import { codexAuthNeedsRefresh, externalCodexTokens, openCodexAuth, sealCodexAuth } from "./codex-subscription-credentials.ts";
import { CODEX_SUBSCRIPTION_MODEL } from "./coding-models.ts";
import { refreshCodexSubscription } from "./codex-subscription-refresh.ts";

export class SubscriptionAccessDenied extends Error {}

async function authorizedTask(scope: HiveToolScope) {
  const [task] = await db.select({ ownerId: taskSessions.createdBy, repository: taskSessions.repository }).from(taskSessions)
    .innerJoin(taskSessionMembers, and(eq(taskSessionMembers.sessionId, taskSessions.id), eq(taskSessionMembers.memberId, scope.memberId)))
    .where(and(eq(taskSessions.id, scope.sessionId), eq(taskSessions.stage, "running"),
      sql`${taskSessions.workspace}->'liveReply'->>'id' = ${scope.runId}`,
      sql`(${taskSessions.workspace}->'restore' IS NULL OR ${taskSessions.workspace}->'restore' = 'null'::jsonb)`));
  if (!task) throw new SubscriptionAccessDenied("This run no longer has access.");
  return task;
}

export async function readCodexSubscription(scope: HiveToolScope, forceRefresh = false) {
  const task = await authorizedTask(scope);
  const bindings = await db.select().from(codexSubscriptions).limit(2);
  // Do not silently choose between operator accounts or share refresh ownership.
  if (bindings.length !== 1) throw new Error("Reconnect the platform Codex subscription.");
  const [binding] = bindings;
  if (binding.refreshLock) throw new Error("Subscription reconnect or refresh is required.");
  const secret = process.env.HIVE_CODEX_AUTH_SECRET?.trim() ?? "";
  let auth = await openCodexAuth(binding.encryptedAuth, binding, secret);
  if (forceRefresh || codexAuthNeedsRefresh(auth)) {
    const lock = randomUUID();
    const claimed = await db.update(codexSubscriptions).set({ refreshLock: lock }).where(and(
      eq(codexSubscriptions.accountHash, binding.accountHash), isNull(codexSubscriptions.refreshLock),
      eq(codexSubscriptions.encryptedAuth, binding.encryptedAuth),
    )).returning({ id: codexSubscriptions.accountHash });
    if (!claimed.length) throw new Error("Subscription refresh is already in progress.");
    // Leave the lock set on every uncertain failure. It is unsafe to retry the
    // old refresh token after a worker loss or failed credential write-back.
    auth = await refreshCodexSubscription(auth);
    const encryptedAuth = await sealCodexAuth(auth, binding, secret);
    const saved = await db.update(codexSubscriptions).set({ encryptedAuth, refreshLock: null, updatedAt: new Date() })
      .where(and(eq(codexSubscriptions.accountHash, binding.accountHash), eq(codexSubscriptions.refreshLock, lock)))
      .returning({ id: codexSubscriptions.accountHash });
    if (!saved.length) throw new Error("Subscription refresh could not be retained.");
  }
  // Membership/run may have changed during refresh. Never release a credential
  // to a stale runtime, even if the native refresh itself succeeded.
  const current = await authorizedTask(scope);
  if (current.ownerId !== task.ownerId || JSON.stringify(current.repository) !== JSON.stringify(task.repository)) throw new SubscriptionAccessDenied("Repository access changed.");
  return { model: CODEX_SUBSCRIPTION_MODEL, ...externalCodexTokens(auth) };
}
