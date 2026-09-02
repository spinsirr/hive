import { APICallError, generateText } from "ai";

import {
  memberDirectory,
  type MemberId,
  type RoomState,
} from "@/lib/room";

const DEFAULT_MODEL = "poolside/laguna-s-2.1-free";
const MAX_CONTEXT_MESSAGES = 18;

type HiveTrigger =
  | { type: "message" }
  | { type: "steer"; annotation: string; source?: string };

function errorStatusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (!error || typeof error !== "object") return undefined;

  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if ("cause" in error) return errorStatusCode(error.cause);
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      const nestedStatusCode = errorStatusCode(nestedError);
      if (nestedStatusCode) return nestedStatusCode;
    }
  }

  return undefined;
}

function errorMessages(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];

  const messages =
    "message" in error && typeof error.message === "string"
      ? [error.message]
      : [];
  if ("cause" in error) messages.push(...errorMessages(error.cause));
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      messages.push(...errorMessages(nestedError));
    }
  }

  return messages;
}

export function hiveAgentFailureMessage(error: unknown) {
  const statusCode = errorStatusCode(error);
  const details = errorMessages(error).join(" ").toLowerCase();

  if (
    details.includes("customer_verification_required") ||
    details.includes("valid credit card on file")
  ) {
    return "I saved the team’s input and reached AI Gateway, but this Vercel account needs billing verification before I can respond.";
  }
  if (
    details.includes("restrictedmodelserror") ||
    details.includes("free tier users do not have access to this model")
  ) {
    return "I saved the team’s input and reached AI Gateway, but the selected model is not available on this account tier.";
  }
  if (statusCode === 402) {
    return "I saved the team’s input, but the AI Gateway account needs available credit before I can respond.";
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    details.includes("vercel_oidc_token") ||
    details.includes("no authentication provided") ||
    details.includes("unauthenticated request to ai gateway")
  ) {
    return "I saved the team’s input, but AI Gateway is not connected to this environment yet.";
  }
  if (statusCode === 429) {
    return "I saved the team’s input, but AI Gateway is rate-limited right now. Try again in a moment.";
  }

  return "I saved the team’s input, but I couldn’t reach AI Gateway. The shared session is still live.";
}

export class HiveAgentError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "HiveAgentError";
  }
}

export async function generateHiveReply(
  room: RoomState,
  actor: MemberId,
  trigger: HiveTrigger,
) {
  const actorName = memberDirectory[actor].name;
  const messages = room.messages
    .filter((message) => message.status !== "error")
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => ({
      role: message.role === "agent" ? ("assistant" as const) : ("user" as const),
      content:
        message.role === "agent"
          ? message.body
          : `[${message.name}]: ${message.body}`,
    }));

  if (trigger.type === "steer") {
    messages.push({
      role: "user",
      content: [
        `[${actorName} promoted an annotation to a steer]: ${trigger.annotation}`,
        trigger.source ? `[Attached to teammate message]: ${trigger.source}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  try {
    const result = await generateText({
      model: process.env.HIVE_MODEL?.trim() || DEFAULT_MODEL,
      system: [
        "You are Hive, one coding agent shared live by a small software team.",
        "Maya Chen and Spencer Zhao inhabit the same transcript, so preserve authorship and respond to the group rather than pretending there is one user.",
        "Be concise, concrete, and collaborative. Call out ambiguity and ask for a steer when product intent is unclear.",
        "You currently have conversation access only: do not claim to have edited files, run tests, inspected a repository, opened a PR, or used tools.",
        "If a teammate describes a desired code change, explain the next action you would take once the coding workspace is connected.",
      ].join(" "),
      messages,
      maxOutputTokens: 320,
      temperature: 0.3,
      providerOptions: {
        gateway: {
          tags: ["app:hive", "feature:shared-session"],
          user: actor,
        },
      },
    });

    const text = result.text.trim();
    if (!text) throw new Error("AI Gateway returned an empty response.");
    return text;
  } catch (error) {
    throw new HiveAgentError(hiveAgentFailureMessage(error), error);
  }
}
