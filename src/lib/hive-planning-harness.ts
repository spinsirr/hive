import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { Sandbox } from "@vercel/sandbox";
import { createHiveCodex } from "./codex-harness.ts";
import { createHiveClaude } from "./claude-harness.ts";
import { claudeSubscriptionToken } from "./claude-subscription.ts";
import { platformCodingModels } from "./platform-models.ts";
import { selectedCodingModel } from "./coding-models.ts";
import { consumeAgentText } from "./agent-stream.ts";
import { ensureCodexBridgeDependencies } from "./hive-runner.ts";
import { HiveAgentError, hiveAgentFailureMessage } from "./hive-agent.ts";
import type { CodexAccess } from "./codex-subscription-broker.ts";
import type { TaskSessionState } from "./task-session.ts";

/** Planning uses the same native engines, without a repository or a shared VM. */
export async function runHivePlanningHarness(
  task: TaskSessionState, prompt: string, instructions: string,
  onText: (body: string) => void, codexSubscription?: CodexAccess,
) {
  const runtime = task.workspace.agentSession?.runtime ?? "codex";
  const claudeToken = runtime === "claude-code" ? claudeSubscriptionToken(process.env) : undefined;
  if (runtime === "claude-code" ? !claudeToken : !codexSubscription) {
    throw new HiveAgentError(`Reconnect the ${runtime === "claude-code" ? "Claude" : "Codex"} subscription.`, new Error("Platform credential unavailable."));
  }
  const model = selectedCodingModel(platformCodingModels(process.env), runtime, task.workspace.codingModel);
  if (!model) throw new HiveAgentError("Choose a model available with this task's current connection.", new Error("Model unavailable."));
  const effort = model.efforts.length ? task.workspace.codingEffort ?? model.efforts[0] : undefined;
  if (effort && !model.efforts.includes(effort)) throw new HiveAgentError("Choose a supported effort for this model.", new Error("Unsupported effort."));
  const sandbox = await Sandbox.create({ runtime: "node24", ports: [4319], timeout: 10 * 60 * 1000, resources: { vcpus: 1 } });
  try {
    const agent = new HarnessAgent({
      id: "hive-planning-agent", model: model.modelId,
      harness: runtime === "claude-code"
        ? createHiveClaude({ gatewayAuth: {}, subscriptionToken: claudeToken, effort, supportsEffort: model.efforts.length > 0, adaptiveRequired: model.thinking === "adaptive-required" })
        : createHiveCodex({ auth: {}, reasoningEffort: effort, webSearch: false }, undefined, undefined, codexSubscription),
      sandbox: createVercelSandbox({ sandbox }),
      sandboxConfig: {
        workDir: "planning",
        onSession: async ({ session, sessionWorkDir, abortSignal }) => {
          if (runtime === "codex") await ensureCodexBridgeDependencies(session, sessionWorkDir, abortSignal);
        },
      },
      instructions: `${instructions} Do not use tools, create files, spawn agents, access secrets, or run commands. Respond in text only.`,
      // Codex only supports allow-all inside its isolated sandbox. Planning has
      // no repository, MCP capabilities, or reusable workspace.
      permissionMode: "allow-all",
    });
    const session = await agent.createSession();
    try {
      const result = await agent.stream({ session, prompt });
      return (await consumeAgentText(result.fullStream, onText)).trim();
    } finally { await session.stop(); }
  } catch (error) {
    if (error instanceof HiveAgentError) throw error;
    throw new HiveAgentError(hiveAgentFailureMessage(error, runtime === "claude-code" ? "claude-subscription" : "codex-subscription"), error);
  } finally {
    await sandbox.stop();
  }
}
