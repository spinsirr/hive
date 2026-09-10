export class SubscriptionUnavailable extends Error {
  constructor(reason, threadId) {
    super("Codex subscription unavailable.");
    this.reason = reason;
    this.threadId = threadId;
  }
}

export function subscriptionPreferred(start) {
  return start.mcpServers?.hive?.http_headers?.["X-Hive-Auth"] === "prefer-chatgpt";
}

export async function readSubscriptionTokens(start, signal, forceRefresh = false) {
  const server = start.mcpServers?.hive;
  const url = new URL(server.url);
  if (!url.pathname.endsWith("/agent-tools")) throw new Error("Invalid runtime authentication endpoint.");
  url.pathname = url.pathname.replace(/\/agent-tools$/, "/codex-auth");
  url.search = "";
  let response;
  try {
    response = await fetch(url, { method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: server.http_headers.Authorization, ...(forceRefresh ? { "X-Hive-Refresh": "1" } : {}) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(forceRefresh ? 9_000 : 110_000)]),
    });
  } catch {
    signal.throwIfAborted();
    throw new SubscriptionUnavailable("authentication_unavailable");
  }
  if (response.status === 401 || response.status === 403) throw new Error("This runtime no longer has access to the task.");
  if (!response.ok) throw new SubscriptionUnavailable("authentication_unavailable");
  let body;
  try { body = await response.json(); } catch { throw new SubscriptionUnavailable("authentication_unavailable"); }
  if (typeof body.accessToken !== "string" || !body.accessToken || typeof body.chatgptAccountId !== "string" || !body.chatgptAccountId) {
    throw new SubscriptionUnavailable("authentication_unavailable");
  }
  return { accessToken: body.accessToken, chatgptAccountId: body.chatgptAccountId };
}

export function subscriptionLimited(result, now = Date.now()) {
  // Other model-specific buckets may be exhausted independently. Only use the
  // native account-wide limit, never infer zero from absent/missing fields.
  const limits = result?.rateLimits;
  return [limits?.primary, limits?.secondary].some((window) =>
    typeof window?.usedPercent === "number" && window.usedPercent >= 100 &&
    (window.resetsAt == null || window.resetsAt * 1000 > now));
}

export function subscriptionFailureReason(error) {
  const code = error?.codexErrorInfo;
  const serialized = typeof code === "string" ? code : JSON.stringify(code ?? "");
  if (/usageLimitExceeded|rateLimitExceeded|quotaExceeded/i.test(serialized)) return "quota_unavailable";
  if (/unauthorized|authentication/i.test(serialized)) return "authentication_unavailable";
  if (/httpStatusCode["\s:]+(401|402|429)\b/.test(serialized)) return "quota_or_auth_unavailable";
  return null;
}

export function codexProcessEnvironment(subscription, source = process.env) {
  if (!subscription) return source;
  const env = { ...source };
  for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "AI_GATEWAY_API_KEY", "AI_GATEWAY_BASE_URL", "VERCEL_OIDC_TOKEN"]) delete env[name];
  return env;
}
