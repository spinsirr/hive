import { APICallError } from "ai";

import type { HiveSessionCheckpoint } from "@/lib/room";

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
  if (statusCode === 429 || details.includes("429 too many requests")) {
    return "I saved the team’s input, but AI Gateway is rate-limited right now. Try again in a moment.";
  }

  return "I saved the team’s input, but I couldn’t reach AI Gateway. The shared session is still live.";
}

export class HiveAgentError extends Error {
  readonly cause: unknown;
  readonly checkpoint?: HiveSessionCheckpoint;

  constructor(
    message: string,
    cause: unknown,
    checkpoint?: HiveSessionCheckpoint,
  ) {
    super(message);
    this.name = "HiveAgentError";
    this.cause = cause;
    this.checkpoint = checkpoint;
  }
}
