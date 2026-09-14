import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import {
  isTaskSessionMember,
  withTaskSubagentControl,
} from "@/lib/task-session-store";
import { controlSubagent } from "@/lib/subagent-control";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
const stopRequest = z
  .object({ id: z.string().uuid(), runId: z.string().min(1).max(120) })
  .strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  if (
    !isTaskSessionId(sessionId) ||
    !member ||
    !(await isTaskSessionMember(sessionId, member.id))
  )
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers }
    );
  const body = await request.text();
  if (body.length > 2048)
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400, headers }
    );
  let input;
  try {
    input = stopRequest.parse(JSON.parse(body));
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400, headers }
    );
  }
  try {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(20_000),
    ]);
    const task = await withTaskSubagentControl(sessionId, (session) =>
      controlSubagent(
        session,
        input.runId,
        { action: "stop", id: input.id },
        signal
      )
    );
    return NextResponse.json({ task }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Stop could not be confirmed. Check the task's current state before retrying.",
      },
      { status: 409, headers }
    );
  }
}
