import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { HiveAgentError } from "@/lib/hive-agent";
import { hiveErrorCopy } from "@/lib/hive-error-copy";
import { runHiveCodingTask } from "@/lib/hive-runner";
import {
  isDirectedAtTeammate,
  resolveMember,
  type RoomAction,
} from "@/lib/room";
import { isRoomId } from "@/lib/room-id";
import {
  appendHiveReply,
  applyRoomAction,
  getRoomSnapshot,
  heartbeat,
} from "@/lib/room-store";
import type { RoomSnapshot } from "@/lib/room-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type RoomRouteContext = {
  params: Promise<{ roomId: string }>;
};

function publicSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  const session = snapshot.room.workspace.agentSession;
  return {
    ...snapshot,
    room: {
      ...snapshot.room,
      workspace: {
        ...snapshot.room.workspace,
        agentSession: session
          ? { id: session.id, runtime: session.runtime }
          : undefined,
      },
    },
  };
}

function roomResponse(snapshot: RoomSnapshot) {
  return NextResponse.json(publicSnapshot(snapshot), {
    headers: { "Cache-Control": "no-store" },
  });
}

async function authenticatedRoom(request: NextRequest, context: RoomRouteContext) {
  const { roomId } = await context.params;
  if (!isRoomId(roomId)) return null;
  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value,
  );
  return member ? { member, roomId } : null;
}

export async function GET(request: NextRequest, context: RoomRouteContext) {
  const auth = await authenticatedRoom(request, context);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return roomResponse(await getRoomSnapshot(auth.roomId));
}

export async function POST(request: NextRequest, context: RoomRouteContext) {
  const auth = await authenticatedRoom(request, context);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { member, roomId } = auth;
  const vercelOidcToken =
    request.headers.get("x-vercel-oidc-token")?.trim() || undefined;
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("type" in payload)) {
    return NextResponse.json({ error: "Invalid room action" }, { status: 400 });
  }

  if (payload.type === "heartbeat") {
    const typing = "typing" in payload && payload.typing === true;
    return roomResponse(await heartbeat(roomId, member.id, typing));
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
    payload.type !== "reset"
  ) {
    return NextResponse.json({ error: "Unknown room action" }, { status: 400 });
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

  const action = { ...payload, actor: member.id } as RoomAction;
  const actionAt = Date.now();
  const snapshot = await applyRoomAction(roomId, action, member, actionAt);

  const shouldGenerateForMessage =
    action.type === "send-message" &&
    !isDirectedAtTeammate(action.body, action.actor, snapshot.members) &&
    snapshot.room.workspace.startedAt === actionAt;
  const shouldGenerateForSteer =
    action.type === "steer-agent" &&
    snapshot.room.annotation.steeredAt === actionAt;
  const messageAnnotation =
    action.type === "steer-message-annotation"
      ? snapshot.room.messages
          .find((message) => message.id === action.messageId)
          ?.annotations?.find(
            (annotation) => annotation.id === action.annotationId,
          )
      : undefined;
  const shouldGenerateForMessageAnnotation =
    action.type === "steer-message-annotation" &&
    messageAnnotation?.steeredAt === actionAt;
  const shouldGenerateForQueuedSteer =
    action.type === "apply-next-steer" &&
    snapshot.room.activeSteer?.appliedAt === actionAt;

  if (
    !shouldGenerateForMessage &&
    !shouldGenerateForSteer &&
    !shouldGenerateForMessageAnnotation &&
    !shouldGenerateForQueuedSteer
  ) {
    return roomResponse(snapshot);
  }

  const sourceMessageId =
    action.type === "send-message"
      ? snapshot.room.messages.findLast(
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
  const annotatedMessage =
    action.type === "steer-message-annotation"
      ? snapshot.room.messages.find(
          (message) => message.id === action.messageId,
        )
      : undefined;
  const activeSteer =
    action.type === "apply-next-steer"
      ? snapshot.room.activeSteer
      : undefined;

  if (!snapshot.room.repository) {
    return roomResponse(
      await appendHiveReply(
        roomId,
        "Connect a repository through the Hive GitHub App before asking Hive to inspect or change code.",
        {
          forMessageId: sourceMessageId,
          forMessageAnnotation: sourceMessageAnnotation,
          forActiveSteerAt: activeSteer?.appliedAt,
          forSteerAt: sourceSteerAt,
          status: "error",
        },
      ),
    );
  }

  try {
    const steer =
      action.type === "steer-agent"
        ? snapshot.room.annotation.text
        : action.type === "steer-message-annotation" && messageAnnotation
          ? [
              messageAnnotation.body,
              annotatedMessage?.body
                ? `Attached to teammate message: ${annotatedMessage.body}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")
          : action.type === "apply-next-steer" && activeSteer
            ? [
                activeSteer.body,
                activeSteer.sourceLabel
                  ? `Source: ${activeSteer.sourceLabel}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n")
            : undefined;
    const runActor =
      action.type === "apply-next-steer" && activeSteer
        ? activeSteer.authorId
        : action.actor;
    const runResult = await runHiveCodingTask(snapshot.room, runActor, steer, {
      actorName: resolveMember(runActor, snapshot.members).name,
      vercelOidcToken,
    });
    return roomResponse(
      await appendHiveReply(roomId, runResult.summary, {
        forMessageId: sourceMessageId,
        forMessageAnnotation: sourceMessageAnnotation,
        forActiveSteerAt: activeSteer?.appliedAt,
        forSteerAt: sourceSteerAt,
        runResult,
      }),
    );
  } catch (error) {
    console.error(
      "Hive agent generation failed",
      error instanceof HiveAgentError ? error.cause : error,
    );
    const message =
      error instanceof HiveAgentError
        ? error.message
        : hiveErrorCopy.generic;
    return roomResponse(
      await appendHiveReply(roomId, message, {
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
