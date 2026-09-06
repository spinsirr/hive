import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { createReplyWriter } from "@/lib/agent-stream";
import { HiveAgentError } from "@/lib/hive-agent";
import { runHiveConversation } from "@/lib/hive-conversation";
import { hiveErrorCopy } from "@/lib/hive-error-copy";
import { isClientSubmissionId } from "@/lib/message-draft";
import { runHiveCodingTask } from "@/lib/hive-runner";
import { buildHiveRunInput } from "@/lib/hive-prompt";
import type { TaskSessionAction } from "@/lib/task-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import { publicTaskSessionSnapshot } from "@/lib/task-session-snapshot";
import {
  appendHiveReply,
  applyTaskSessionAction,
  checkpointAgentReply,
  getTaskSessionSnapshot,
  heartbeat,
  isTaskSessionMember,
} from "@/lib/task-session-store";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type TaskSessionRouteContext = {
  params: Promise<{ sessionId: string }>;
};

function sessionResponse(snapshot: TaskSessionSnapshot) {
  return NextResponse.json(publicTaskSessionSnapshot(snapshot), {
    headers: { "Cache-Control": "no-store" },
  });
}

async function authenticatedSession(
  request: NextRequest,
  context: TaskSessionRouteContext,
) {
  const { sessionId } = await context.params;
  if (!isTaskSessionId(sessionId)) return null;
  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value,
  );
  if (!member || !(await isTaskSessionMember(sessionId, member.id))) return null;
  return { member, sessionId: sessionId };
}

export async function GET(request: NextRequest, context: TaskSessionRouteContext) {
  const auth = await authenticatedSession(request, context);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return sessionResponse(await getTaskSessionSnapshot(auth.sessionId));
}

export async function POST(request: NextRequest, context: TaskSessionRouteContext) {
  const auth = await authenticatedSession(request, context);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { member, sessionId } = auth;
  const vercelOidcToken =
    request.headers.get("x-vercel-oidc-token")?.trim() || undefined;
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("type" in payload)) {
    return NextResponse.json({ error: "Invalid session action" }, { status: 400 });
  }

  if (payload.type === "heartbeat") {
    const typing = "typing" in payload && payload.typing === true;
    await heartbeat(sessionId, member.id, typing);
    return new NextResponse(null, { status: 204 });
  }

  if (
    payload.type !== "send-message" &&
    payload.type !== "annotate-message" &&
    payload.type !== "steer-message-annotation" &&
    payload.type !== "apply-next-steer" &&
    payload.type !== "remove-queued-steer" &&
    payload.type !== "reorder-queued-steer" &&
    payload.type !== "steer-agent" &&
    payload.type !== "advance-run" &&
    payload.type !== "complete-session" &&
    payload.type !== "reopen-session" &&
    payload.type !== "reset"
  ) {
    return NextResponse.json({ error: "Unknown session action" }, { status: 400 });
  }

  if (
    (payload.type === "send-message" || payload.type === "annotate-message") &&
    (!("clientId" in payload) || !isClientSubmissionId(payload.clientId))
  ) {
    return NextResponse.json({ error: "A valid submission ID is required" }, { status: 400 });
  }

  if (
    (payload.type === "send-message" || payload.type === "annotate-message") &&
    (!("body" in payload) || typeof payload.body !== "string" || !payload.body.trim())
  ) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  if (
    (payload.type === "annotate-message" ||
      payload.type === "steer-message-annotation") &&
    (!("messageId" in payload) || typeof payload.messageId !== "string")
  ) {
    return NextResponse.json({ error: "Message ID is required" }, { status: 400 });
  }

  if (
    payload.type === "steer-message-annotation" &&
    (!("annotationId" in payload) || typeof payload.annotationId !== "string")
  ) {
    return NextResponse.json({ error: "Annotation ID is required" }, { status: 400 });
  }

  if (
    (payload.type === "remove-queued-steer" ||
      payload.type === "reorder-queued-steer") &&
    (!("steerId" in payload) || typeof payload.steerId !== "string")
  ) {
    return NextResponse.json({ error: "Steer ID is required" }, { status: 400 });
  }

  if (
    payload.type === "reorder-queued-steer" &&
    (!("direction" in payload) ||
      (payload.direction !== "up" && payload.direction !== "down"))
  ) {
    return NextResponse.json({ error: "Invalid queue direction" }, { status: 400 });
  }

  const action = { ...payload, actor: member.id } as TaskSessionAction;
  const actionAt = Date.now();
  const { snapshot, startedRun } = await applyTaskSessionAction(sessionId, action, member, actionAt);
  if (!startedRun) return sessionResponse(snapshot);

  const messageAnnotation =
    action.type === "steer-message-annotation"
      ? snapshot.session.messages
          .find((message) => message.id === action.messageId)
          ?.annotations?.find(
            (annotation) => annotation.id === action.annotationId,
          )
      : undefined;
  const sourceMessageId =
    action.type === "send-message"
      ? snapshot.session.messages.findLast(
          (message) =>
            message.id.startsWith(`human-${actionAt}-`) &&
            message.memberId === action.actor,
        )?.id
      : undefined;
  const sourceSteerAt =
    action.type === "steer-agent" ? actionAt : undefined;
  const sourceMessageAnnotation =
    action.type === "steer-message-annotation" && messageAnnotation
      ? {
          messageId: action.messageId,
          annotationId: action.annotationId,
          steeredAt: actionAt,
        }
      : undefined;
  const activeSteer =
    action.type === "apply-next-steer"
      ? snapshot.session.activeSteer
      : undefined;

  const replyId = snapshot.session.workspace.liveReply!.id;
  const writer = createReplyWriter((body, sequence) =>
    checkpointAgentReply(sessionId, replyId, body, sequence),
  );

  try {
    const { actor: runActor, actorName, steer } = buildHiveRunInput(
      snapshot.session,
      action,
      snapshot.members,
    );
    if (!snapshot.session.repository) {
      const reply = await runHiveConversation(
        snapshot.session,
        runActor,
        actorName,
        writer.push,
        steer,
      );
      await writer.close();
      return sessionResponse(
        await appendHiveReply(sessionId, reply, {
          forReplyId: replyId,
          forMessageId: sourceMessageId,
          forMessageAnnotation: sourceMessageAnnotation,
          forActiveSteerAt: activeSteer?.appliedAt,
          forSteerAt: sourceSteerAt,
        }),
      );
    }

    const runResult = await runHiveCodingTask(snapshot.session, runActor, steer, {
      actorName,
      vercelOidcToken,
      onText: writer.push,
    });
    await writer.close();
    return sessionResponse(
      await appendHiveReply(sessionId, runResult.summary, {
        forReplyId: replyId,
        forMessageId: sourceMessageId,
        forMessageAnnotation: sourceMessageAnnotation,
        forActiveSteerAt: activeSteer?.appliedAt,
        forSteerAt: sourceSteerAt,
        runResult,
      }),
    );
  } catch (error) {
    await writer.close().catch(() => undefined);
    console.error(
      "Hive agent generation failed",
      error instanceof HiveAgentError ? error.cause : error,
    );
    const message =
      error instanceof HiveAgentError
        ? error.message
        : hiveErrorCopy.generic;
    return sessionResponse(
      await appendHiveReply(sessionId, message, {
        forReplyId: replyId,
        forMessageId: sourceMessageId,
        forMessageAnnotation: sourceMessageAnnotation,
        forActiveSteerAt: activeSteer?.appliedAt,
        forSteerAt: sourceSteerAt,
        status: "error",
        runError: message,
        runCheckpoint:
          error instanceof HiveAgentError ? error.checkpoint : undefined,
      }),
    );
  }
}
