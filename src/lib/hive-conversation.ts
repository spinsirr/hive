import "server-only";

import { hasToolCall, stepCountIs, streamText } from "ai";

import { hiveAgentFailureMessage, HiveAgentError } from "@/lib/hive-agent";
import { consumeAgentText } from "@/lib/agent-stream";
import { buildHivePrompt } from "@/lib/hive-prompt";
import type { MemberId, TaskSessionState } from "@/lib/task-session";
import { usesPlatformSubscriptions } from "./platform-models.ts";
import { runHivePlanningHarness } from "./hive-planning-harness.ts";
import type { CodexAccess } from "./codex-subscription-broker.ts";
import { connectHiveConversationTools, type HiveToolConnection } from "./hive-conversation-tools.ts";

const DEFAULT_MODEL = "openai/gpt-5-mini";

export async function runHiveConversation(
  session: TaskSessionState,
  actor: MemberId,
  actorName?: string,
  onText: (body: string) => void = () => undefined,
  steer?: string,
  codexSubscription?: CodexAccess,
  toolConnection?: HiveToolConnection,
) {
  const instructions = [
    "You are Hive, a coding agent shared by a small software team.",
    "The current task session does not have a repository attached yet.",
    "Help the team clarify intent, constraints, and acceptance criteria before implementation.",
    "Never claim to have inspected files, run commands, or changed code.",
    "Keep the response concise and ask at most one precise question when more direction is required.",
    "Use request_input for a structured question when available. Its card is already visible; do not repeat it, announce tools or skills, or poll for an answer.",
  ].join(" ");
  const prompt = buildHivePrompt(session, actor, steer, actorName, "planning");
  if (usesPlatformSubscriptions(process.env)) {
    return runHivePlanningHarness(session, prompt, instructions, onText, codexSubscription, toolConnection);
  }
  let collaboration: Awaited<ReturnType<typeof connectHiveConversationTools>> | undefined;
  try {
    if (toolConnection) collaboration = await connectHiveConversationTools(toolConnection);
    const result = streamText({
      model: process.env.HIVE_CHAT_MODEL?.trim() || DEFAULT_MODEL,
      system: instructions,
      prompt,
      ...(collaboration ? { tools: collaboration.tools, stopWhen: [hasToolCall("request_input"), stepCountIs(4)] } : {}),
      providerOptions: {
        gateway: {
          user: actor,
          tags: ["app:hive", "mode:planning", `session:${session.sessionId}`],
        },
      },
    });
    await consumeAgentText(result.fullStream, onText);

    return (await result.text).trim();
  } catch (error) {
    throw new HiveAgentError(hiveAgentFailureMessage(error), error);
  } finally { await collaboration?.close(); }
}
