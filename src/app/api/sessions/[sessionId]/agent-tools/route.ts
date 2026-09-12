import { handleHiveMcp } from "@/lib/hive-mcp";
import { verifyHiveToolToken } from "@/lib/hive-tool-token";
import { appendHiveToolReply, createHivePeerRequest, readHiveToolContext, withTaskSubagentControl } from "@/lib/task-session-store";
import { controlSubagent } from "@/lib/subagent-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const secret = process.env.HIVE_INVITE_SECRET?.trim();
  const scope = token && secret ? verifyHiveToolToken(token, sessionId, secret) : null;
  if (!scope) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  // Bound parsing even when Content-Length was omitted or forged.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bounded = new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks), signal: request.signal });
  return handleHiveMcp(bounded, scope, {
    read: readHiveToolContext, reply: appendHiveToolReply, request: createHivePeerRequest,
    control: (scope, input, signal) => withTaskSubagentControl(sessionId, (session) => controlSubagent(session, scope.runId, input, AbortSignal.any([signal, AbortSignal.timeout(20_000)]))),
  });
}
