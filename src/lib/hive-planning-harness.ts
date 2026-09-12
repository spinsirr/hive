import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { HarnessV1 } from "@ai-sdk/harness";
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
import type { HiveToolConnection } from "./hive-conversation-tools.ts";

/** Planning uses the same native engines, without a repository or a shared VM. */
export async function runHivePlanningHarness(
  task: TaskSessionState, prompt: string, instructions: string,
  onText: (body: string) => void, codexSubscription?: CodexAccess,
  tools?: HiveToolConnection,
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
  // The pinned Claude bootstrap OOMs at 2 GiB; 2 vCPUs provide 4 GiB.
  const sandbox = await Sandbox.create({ runtime: "node24", ports: [4319], timeout: 10 * 60 * 1000, resources: { vcpus: runtime === "claude-code" ? 2 : 1 } });
  try {
    const harness: HarnessV1 = runtime === "claude-code"
        ? createHiveClaude({ gatewayAuth: {}, subscriptionToken: claudeToken, effort, supportsEffort: model.efforts.length > 0, adaptiveRequired: model.thinking === "adaptive-required",
            ...(tools ? { mcpServers: { hive: { type: "http", url: tools.url, headers: { Authorization: `Bearer ${tools.token}` } } } } : {}),
          })
        : createHiveCodex({ auth: {}, reasoningEffort: effort, webSearch: false, codexConfig: { model_verbosity: "low" },
            ...(tools ? { mcpServers: { hive: { url: tools.url, http_headers: { Authorization: `Bearer ${tools.token}` }, startup_timeout_sec: 10, tool_timeout_sec: 15 } } } : {}),
          }, undefined, undefined, codexSubscription);
    const agent = new HarnessAgent({
      id: "hive-planning-agent", model: model.modelId, harness,
      ...(runtime === "claude-code" ? { inactiveTools: ["Agent", "SendMessage", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode"] as const } : {}),
      sandbox: createVercelSandbox({ sandbox }),
      sandboxConfig: {
        workDir: "planning",
        onSession: async ({ session, sessionWorkDir, abortSignal }) => {
          if (runtime === "codex") await ensureCodexBridgeDependencies(session, sessionWorkDir, abortSignal);
        },
      },
      instructions: `${instructions} ${tools ? "Use Hive get_context for teammate IDs and existing questions, request_input to ask a structured question inline, and reply_to_thread only for a different existing discussion. No repository is needed for questions. The question card is already visible: end the turn after asking, without repeating it or polling for an answer." : "No collaboration tools are connected; do not claim to have sent a question card."} Do not create files, spawn agents, access secrets, or run commands. Apply routine tools silently; do not announce skills or narrate asking a question.`,
      // Codex only supports allow-all inside its isolated sandbox. Planning has
      // no repository or reusable workspace; MCP exposes conversation tools only.
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
