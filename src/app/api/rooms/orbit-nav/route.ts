import { NextResponse } from "next/server";

import { HiveAgentError } from "@/lib/hive-agent";
import { runHiveCodingTask } from "@/lib/hive-runner";
import {
  isDirectedAtTeammate,
  isMemberId,
  type RoomAction,
} from "@/lib/room";
import {
  appendHiveReply,
  applyRoomAction,
  getRoomSnapshot,
  heartbeat,
} from "@/lib/room-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function parseGitHubRepository(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      parts.length !== 2 ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const owner = parts[0];
    const repository = parts[1].replace(/\.git$/, "");
    if (!owner || !repository) return null;
    return {
      url: `https://github.com/${owner}/${repository}.git`,
      name: `${owner}/${repository}`,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json(await getRoomSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("type" in payload)) {
    return NextResponse.json({ error: "Invalid room action" }, { status: 400 });
  }

  if (payload.type === "heartbeat") {
    if (!("memberId" in payload) || !isMemberId(payload.memberId)) {
      return NextResponse.json({ error: "Invalid member" }, { status: 400 });
    }
    const typing = "typing" in payload && payload.typing === true;
    return NextResponse.json(await heartbeat(payload.memberId, typing));
  }

  if (!("actor" in payload) || !isMemberId(payload.actor)) {
    return NextResponse.json({ error: "Invalid actor" }, { status: 400 });
  }

  if (
    payload.type !== "send-message" &&
    payload.type !== "connect-repository" &&
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

  const repository =
    payload.type === "connect-repository" && "repositoryUrl" in payload
      ? parseGitHubRepository(payload.repositoryUrl)
      : null;
  if (payload.type === "connect-repository" && !repository) {
    return NextResponse.json(
      { error: "Enter a public GitHub repository URL" },
      { status: 400 },
    );
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

  const action = (
    payload.type === "connect-repository" && repository
      ? {
          type: "connect-repository",
          actor: payload.actor,
          repositoryUrl: repository.url,
          repositoryName: repository.name,
        }
      : payload
  ) as RoomAction;
  const actionAt = Date.now();
  const snapshot = await applyRoomAction(action, actionAt);

  const shouldGenerateForMessage =
    action.type === "send-message" &&
    !isDirectedAtTeammate(action.body, action.actor);
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
    return NextResponse.json(snapshot);
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
    return NextResponse.json(
      await appendHiveReply(
        "Connect a public GitHub repository before asking Hive to inspect or change code.",
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
    const runResult = await runHiveCodingTask(
      snapshot.room,
      action.actor,
      steer,
    );
    return NextResponse.json(
      await appendHiveReply(runResult.summary, {
        forMessageId: sourceMessageId,
        forMessageAnnotation: sourceMessageAnnotation,
        forActiveSteerAt: activeSteer?.appliedAt,
        forSteerAt: sourceSteerAt,
        runResult,
      }),
    );
  } catch (error) {
    console.error("Hive agent generation failed", error);
    const message =
      error instanceof HiveAgentError
        ? error.message
        : "I saved the team’s input, but I couldn’t reach AI Gateway. The shared session is still live.";
    return NextResponse.json(
      await appendHiveReply(message, {
        forMessageId: sourceMessageId,
        forMessageAnnotation: sourceMessageAnnotation,
        forActiveSteerAt: activeSteer?.appliedAt,
        forSteerAt: sourceSteerAt,
        status: "error",
        runError: message,
      }),
    );
  }
}
