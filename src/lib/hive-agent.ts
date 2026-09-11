import { APICallError } from "ai";

import { hiveErrorCopy } from "./hive-error-copy.ts";
import type { HiveSessionCheckpoint } from "@/lib/task-session";

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
  if (typeof error === "string") return [error];
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

export function hiveAgentFailureMessage(error: unknown, authentication: "gateway" | "claude-subscription" | "codex-subscription" = "gateway") {
  const statusCode = errorStatusCode(error);
  const details = errorMessages(error).join(" ").toLowerCase();
  if (authentication !== "gateway" && /subscription limit reached|usage limit|quota_unavailable/.test(details)) return hiveErrorCopy.subscriptionLimit;
  if (authentication === "codex-subscription" && (statusCode === 401 || statusCode === 403 || /reconnect.*codex|authentication_unavailable/.test(details))) return hiveErrorCopy.codexDisconnected;
  if (authentication === "claude-subscription" && (statusCode === 401 || statusCode === 403 || /invalid.*oauth|oauth.*expired|authentication_error|invalid bearer/.test(details))) {
    return hiveErrorCopy.claudeDisconnected;
  }

  if (
    details.includes("customer_verification_required") ||
    details.includes("valid credit card on file")
  ) {
    return hiveErrorCopy.billing;
  }
  if (
    details.includes("restrictedmodelserror") ||
    details.includes("free tier users do not have access to this model")
  ) {
    return hiveErrorCopy.model;
  }
  if (statusCode === 402) {
    return hiveErrorCopy.credit;
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    details.includes("vercel_oidc_token") ||
    details.includes("no authentication provided") ||
    details.includes("unauthenticated request to ai gateway")
  ) {
    return hiveErrorCopy.disconnected;
  }
  if (statusCode === 429 || details.includes("429 too many requests")) {
    return hiveErrorCopy.rateLimit;
  }

  return hiveErrorCopy.generic;
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
