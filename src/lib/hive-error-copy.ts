export const hiveErrorCopy = {
  billing: "Billing verification required.",
  credit: "AI Gateway credit required.",
  disconnected: "AI Gateway isn’t connected.",
  claudeDisconnected: "Reconnect the Claude subscription.",
  generic: "Run failed. Try again.",
  lost: "Hive's execution process was lost. Partial output and queued steers were kept; nothing was rerun.",
  model: "Model unavailable on this plan.",
  rateLimit: "Rate limit reached. Try again shortly.",
} as const;

export function displayHiveErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized === "start a new claude task to change its authentication.") return message;
  if (normalized.includes("reconnect the claude subscription")) return hiveErrorCopy.claudeDisconnected;
  if (normalized.includes("execution process was lost")) return hiveErrorCopy.lost;
  if (normalized.includes("billing verification")) return hiveErrorCopy.billing;
  if (
    normalized.includes("not available on this account tier") ||
    normalized.includes("model unavailable")
  ) {
    return hiveErrorCopy.model;
  }
  if (
    normalized.includes("available credit") ||
    normalized.includes("credit required")
  ) {
    return hiveErrorCopy.credit;
  }
  if (
    normalized.includes("not connected") ||
    normalized.includes("isn’t connected")
  ) {
    return hiveErrorCopy.disconnected;
  }
  if (
    normalized.includes("rate-limited") ||
    normalized.includes("rate limit") ||
    normalized.includes("429")
  ) {
    return hiveErrorCopy.rateLimit;
  }
  return hiveErrorCopy.generic;
}
