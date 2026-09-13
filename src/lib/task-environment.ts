import { Sandbox } from "@vercel/sandbox";
import type { HarnessV1, HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import type { HarnessAgentSession } from "@ai-sdk/harness/agent";
import { resolvePersistentSandboxName } from "./hive-sandbox.ts";
import { WORKSPACE_CHECKPOINT_LIMIT, type SavedWorkspaceCheckpoint, type TaskSessionState } from "./task-session.ts";
import { coldResumeState, TASK_ENVIRONMENT_IDLE_MS, type TaskEnvironment } from "./task-environment-policy.ts";

function assertTaskSandbox(task: TaskSessionState, sandbox: Sandbox) {
  if (sandbox.tags?.session !== task.sessionId) throw new Error("Environment does not belong to this task.");
}

/** Own the VM lifecycle independently of the request-local Harness handle. */
export function createTaskEnvironment(task: TaskSessionState, existing?: Sandbox) {
  let sandbox = existing;
  let network: HarnessV1NetworkSandboxSession | undefined;
  return {
    wrap(harness: HarnessV1): HarnessV1 {
      return { ...harness, async doStart(options) {
        const session = options.sandboxSession;
        if (!("id" in session) || !("setRequestTransformations" in session)) throw new Error("A network sandbox is required.");
        network = session as HarnessV1NetworkSandboxSession;
        sandbox ??= await Sandbox.get({ name: network.id, resume: false });
        assertTaskSandbox(task, sandbox);
        // The Harness bootstrap cache forks ephemeral VMs. Only the task's
        // isolated fork becomes persistent; never store task data in its template.
        if (!sandbox.persistent || sandbox.timeout !== TASK_ENVIRONMENT_IDLE_MS) {
          await sandbox.update({ persistent: true, timeout: TASK_ENVIRONMENT_IDLE_MS,
            snapshotExpiration: 0, keepLastSnapshots: { count: WORKSPACE_CHECKPOINT_LIMIT, expiration: 0 } });
        }
        const sameVm = task.workspace.environment?.vmId === sandbox.currentSession().sessionId;
        return harness.doStart({ ...options,
          resumeFrom: sameVm ? options.resumeFrom : coldResumeState(options.resumeFrom),
        });
      } };
    },
    async park(session: Pick<HarnessAgentSession, "detach">) {
      if (!sandbox || !network?.setRequestTransformations) throw new Error("The task environment was not acquired.");
      // Every new turn installs freshly authorized, run-scoped forwarding.
      // Waiting for another message must not leave inference credentials usable.
      await network.setRequestTransformations([]);
      const resumeFrom = await session.detach();
      if (resumeFrom.continueFrom) throw new Error("Cannot park an unfinished agent turn.");
      return { sandboxName: sandbox.name, resumeFrom,
        environment: { vmId: sandbox.currentSession().sessionId, idleUntil: sandbox.expiresAt!.getTime() } };
    },
    async stop() { await sandbox?.stop(); },
  };
}

/** Call while holding the task row lock: concurrent messages must not add time twice. */
export async function refreshTaskEnvironment(task: TaskSessionState, now = Date.now()): Promise<TaskEnvironment | undefined> {
  if (!task.workspace.environment || !task.workspace.agentSession || task.workspace.restore) return task.workspace.environment;
  let sandbox: Sandbox;
  try { sandbox = await Sandbox.get({ name: resolvePersistentSandboxName(task, task.workspace.agentSession.id), resume: false, signal: AbortSignal.timeout(8_000) }); }
  catch {
    console.warn("[task-environment] Could not extend idle deadline", { sessionId: task.sessionId });
    return task.workspace.environment;
  }
  assertTaskSandbox(task, sandbox);
  if (sandbox.status !== "running") return task.workspace.environment;
  const current = sandbox.currentSession();
  if (current.sessionId !== task.workspace.environment.vmId) return task.workspace.environment;
  const deadline = sandbox.expiresAt!.getTime();
  const extension = Math.max(0, now + TASK_ENVIRONMENT_IDLE_MS - deadline);
  // The raw Session API targets this exact VM and does NOT auto-resume on a
  // timeout race (Sandbox.extendTimeout does). A late message cannot reopen it.
  if (extension > 0) {
    try { await current.extendTimeout(extension, { signal: AbortSignal.timeout(8_000) }); }
    catch {
      // A concurrent provider expiry or lifetime limit must not discard a
      // teammate's message or an already completed agent result. Do not retry
      // via an auto-resuming API; the next explicit run can restore the VM.
      console.warn("[task-environment] Idle extension unavailable", { sessionId: task.sessionId });
      return { vmId: current.sessionId, idleUntil: deadline };
    }
  }
  return { vmId: current.sessionId, idleUntil: deadline + extension };
}

/** The provider saves on idle shutdown, even when no browser or host is alive. */
export async function readTaskIdleCheckpoint(task: TaskSessionState, now = Date.now()): Promise<SavedWorkspaceCheckpoint | undefined> {
  const pending = task.workspace.idleCheckpoint;
  if (!pending || !task.repository || task.workspace.restore || now < (task.workspace.environment?.idleUntil ?? 0)) return;
  const signal = AbortSignal.timeout(8_000);
  const sandbox = await Sandbox.get({ name: pending.result.sandboxName, resume: false, signal });
  assertTaskSandbox(task, sandbox);
  const { snapshots } = await sandbox.listSnapshots({ limit: 10, sortOrder: "desc", signal });
  const saved = snapshots.find((entry) => entry.sourceSessionId === pending.vmId && entry.status === "created" &&
    entry.createdAt >= pending.completedAt && (!entry.expiresAt || entry.expiresAt > now));
  if (!saved) {
    if (sandbox.status !== "running") throw new Error("The idle environment is still saving its checkpoint. Try again shortly.");
    return;
  }
  return { id: saved.id, createdAt: saved.createdAt, result: { ...pending.result,
    environment: undefined,
    agentSession: { ...pending.result.agentSession, resumeFrom: coldResumeState(pending.result.agentSession.resumeFrom) },
  } };
}
