import "server-only";

import { streamText } from "ai";

import { hiveAgentFailureMessage, HiveAgentError } from "@/lib/hive-agent";
import { consumeAgentText } from "@/lib/agent-stream";
import { buildHivePrompt } from "@/lib/hive-prompt";
import type { MemberId, TaskSessionState } from "@/lib/task-session";
import { usesPlatformSubscriptions } from "./platform-models.ts";
import { runHivePlanningHarness } from "./hive-planning-harness.ts";
import type { CodexAccess } from "./codex-subscription-broker.ts";

const DEFAULT_MODEL = "openai/gpt-5-mini";

export async function runHiveConversation(
  session: TaskSessionState,
  actor: MemberId,
  actorName?: string,
  onText: (body: string) => void = () => undefined,
  steer?: string,
  codexSubscription?: CodexAccess,
) {
  const instructions = [
    "You are Hive, a coding agent shared by a small software team.",
    "The current task session does not have a repository attached yet.",
    "Help the team clarify intent, constraints, and acceptance criteria before implementation.",
    "Never claim to have inspected files, run commands, or changed code.",
    "Keep the response concise and ask at most one precise question when more direction is required.",
  ].join(" ");
  const prompt = buildHivePrompt(session, actor, steer, actorName, "planning");
  if (usesPlatformSubscriptions(process.env)) {
    return (await runHivePlanningHarness(session, prompt, instructions, onText, codexSubscription)) || "What outcome should this task produce before we attach a repository?";
  }
  try {
    const result = streamText({
      model: process.env.HIVE_CHAT_MODEL?.trim() || DEFAULT_MODEL,
      system: instructions,
      prompt,
      providerOptions: {
        gateway: {
          user: actor,
          tags: ["app:hive", "mode:planning", `session:${session.sessionId}`],
        },
      },
    });
    await consumeAgentText(result.fullStream, onText);

    return (
      (await result.text).trim() ||
      "What outcome should this task produce before we attach a repository?"
    );
  } catch (error) {
    throw new HiveAgentError(hiveAgentFailureMessage(error), error);
  }
}
