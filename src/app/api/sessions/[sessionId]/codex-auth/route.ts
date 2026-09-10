import { verifyHiveToolToken } from "@/lib/hive-tool-token";
import { readCodexSubscription, SubscriptionAccessDenied } from "@/lib/codex-subscription-store";
import { SUBSCRIPTION_MODEL } from "@/lib/codex-subscription-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, private", "Pragma": "no-cache" };

// Internal runtime capability only: no cookie login, GET, CORS, or MCP tool that
// returns tokens. The long-lived native refresh credential never leaves host control.
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const secret = process.env.HIVE_INVITE_SECRET?.trim();
  const scope = token && secret ? verifyHiveToolToken(token, sessionId, secret) : null;
  if (!scope) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const auth = await readCodexSubscription(scope, request.headers.get("x-hive-refresh") === "1");
    return auth ? Response.json(auth, { headers }) : Response.json({ reason: "not_configured" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof SubscriptionAccessDenied) return Response.json({ error: "Forbidden" }, { status: 403, headers });
    // SDK/OAuth errors can contain credentials. Only a fixed reason is logged.
    console.warn("Hive subscription unavailable", { sessionId, runId: scope.runId });
    return Response.json({ reason: "subscription_unavailable", model: SUBSCRIPTION_MODEL }, { status: 503, headers });
  }
}
