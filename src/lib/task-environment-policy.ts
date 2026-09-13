import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";

/** A provider-enforced deadline, not a timer in a serverless request. */
export const TASK_ENVIRONMENT_IDLE_MS = 30 * 60_000;

export type TaskEnvironment = { vmId: string; idleUntil: number };

/** A filesystem restore preserves native history, but never a running process. */
export function coldResumeState(state: HarnessAgentResumeSessionState | undefined) {
  if (!state || !state.data || typeof state.data !== "object" || !("bridge" in state.data)) return state;
  const data = { ...state.data };
  delete data.bridge;
  return { ...state, data };
}
