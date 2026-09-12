import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { createReplyWriter } from "@/lib/agent-stream";
import { codeReferenceSchema } from "@/lib/code-reference";
import { isCodingEffort } from "@/lib/coding-effort";
import { HiveAgentError } from "@/lib/hive-agent";
import { runHiveConversation } from "@/lib/hive-conversation";
import { hiveErrorCopy } from "@/lib/hive-error-copy";
import { isClientSubmissionId } from "@/lib/message-draft";
import { runHiveCodingTask } from "@/lib/hive-runner";
import { readCodexSubscription } from "@/lib/codex-subscription-store";
import { usesPlatformSubscriptions } from "@/lib/platform-models";
import { buildHiveRunInput } from "@/lib/hive-prompt";
import { createHiveToolToken, hiveToolEndpoint } from "@/lib/hive-tool-token";
import { MESSAGE_BODY_LIMIT, type TaskSessionAction } from "@/lib/task-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import { normalizeTaskTitle } from "@/lib/task-title";
import { publicTaskSessionSnapshot } from "@/lib/task-session-snapshot";
import { WorkspaceRestoreError } from "@/lib/workspace-restore-state";
import { subagentCapability } from "@/lib/subagent-control";
import type { HiveSubagent } from "@/lib/hive-subagents";
import {
  appendHiveReply,
  applyTaskSessionAction,
  checkpointAgentReply,
  checkpointSubagents,
  getPublicTaskSessionSnapshot,
  isTaskSessionMember,
  TaskSessionAccessError,
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
  return sessionResponse(await getPublicTaskSessionSnapshot(auth.sessionId));
}

export async function POST(request: NextRequest, context: TaskSessionRouteContext) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
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

  if (
    payload.type !== "rename-task" &&
    payload.type !== "archive-task" &&
    payload.type !== "restore-task" &&
    payload.type !== "send-message" &&
    payload.type !== "answer-question" &&
    payload.type !== "resolve-peer-review" &&
    payload.type !== "continue-peer-response" &&
    payload.type !== "select-harness" &&
    payload.type !== "set-coding-effort" &&
    payload.type !== "annotate-message" &&
    payload.type !== "annotate-code" &&
    payload.type !== "steer-message-annotation" &&
    payload.type !== "steer-thread" &&
    payload.type !== "apply-next-steer" &&
    payload.type !== "remove-queued-steer" &&
    payload.type !== "reorder-queued-steer" &&
    payload.type !== "steer-agent" &&
    payload.type !== "recover-stalled-run" &&
    payload.type !== "reset"
  ) {
    return NextResponse.json({ error: "Unknown session action" }, { status: 400 });
  }

  if (payload.type === "rename-task" && (!("title" in payload) || typeof payload.title !== "string" || !normalizeTaskTitle(payload.title))) {
    return NextResponse.json({ error: "Use a task name between 1 and 120 characters." }, { status: 400 });
  }

  if (payload.type === "answer-question" && (!("messageId" in payload) || typeof payload.messageId !== "string" || payload.messageId.length > 200 ||
    ("replyThreadId" in payload && payload.replyThreadId !== undefined && (typeof payload.replyThreadId !== "string" || !payload.replyThreadId || payload.replyThreadId.length > 200)) ||
    !("body" in payload) || typeof payload.body !== "string" || !payload.body.trim() || payload.body.trim().length > 4000 ||
    !("clientId" in payload) || !isClientSubmissionId(payload.clientId))) {
    return NextResponse.json({ error: "Choose a question and provide an answer with a submission ID." }, { status: 400 });
  }
  if (payload.type === "continue-peer-response" && (!("steerId" in payload) || typeof payload.steerId !== "string" || payload.steerId.length > 200)) {
    return NextResponse.json({ error: "Choose a queued answer." }, { status: 400 });
  }
  if (payload.type === "resolve-peer-review" && (!("messageId" in payload) || typeof payload.messageId !== "string" || payload.messageId.length > 200 ||
    !("revision" in payload) || typeof payload.revision !== "string" || !payload.revision || payload.revision.length > 200)) {
    return NextResponse.json({ error: "Choose the code revision you reviewed." }, { status: 400 });
  }

  if (payload.type === "select-harness" &&
    (!("runtime" in payload) || (payload.runtime !== "codex" && payload.runtime !== "claude-code"))) {
    return NextResponse.json({ error: "Choose Codex or Claude Code" }, { status: 400 });
  }

  if (payload.type === "set-coding-effort" && (!("effort" in payload) || !isCodingEffort(payload.effort))) {
    return NextResponse.json({ error: "Choose a supported thinking effort" }, { status: 400 });
  }
  if ((payload.type === "select-harness" || payload.type === "set-coding-effort") &&
    ("modelId" in payload && (typeof payload.modelId !== "string" || !payload.modelId || payload.modelId.length > 120))) {
    return NextResponse.json({ error: "Choose a supported model" }, { status: 400 });
  }

  if (
    (payload.type === "send-message" || payload.type === "annotate-message" || payload.type === "annotate-code") &&
    (!("clientId" in payload) || !isClientSubmissionId(payload.clientId))
  ) {
    return NextResponse.json({ error: "A valid submission ID is required" }, { status: 400 });
  }

  if (
    (payload.type === "send-message" || payload.type === "annotate-message" || payload.type === "annotate-code") &&
    (!("body" in payload) || typeof payload.body !== "string" || !payload.body.trim())
  ) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }
  if (payload.type === "send-message" && "body" in payload && typeof payload.body === "string" && payload.body.trim().length > MESSAGE_BODY_LIMIT) {
    return NextResponse.json({ error: `Messages can contain up to ${MESSAGE_BODY_LIMIT.toLocaleString("en-US")} characters.` }, { status: 400 });
  }

  if (
    (payload.type === "annotate-message" ||
      payload.type === "steer-message-annotation" || payload.type === "steer-thread") &&
    (!("messageId" in payload) || typeof payload.messageId !== "string")
  ) {
    return NextResponse.json({ error: "Message ID is required" }, { status: 400 });
  }

  if (payload.type === "steer-thread" && (!("throughReplyId" in payload) || typeof payload.throughReplyId !== "string")) {
    return NextResponse.json({ error: "Select the replies to include in this steer." }, { status: 400 });
  }
  if (payload.type === "annotate-message" && "body" in payload && typeof payload.body === "string" && payload.body.trim().length > 4000) {
    return NextResponse.json({ error: "Thread replies can contain up to 4,000 characters." }, { status: 400 });
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

  if (payload.type === "annotate-code" && (
    !("reference" in payload) || !codeReferenceSchema.safeParse(payload.reference).success ||
    !("body" in payload) || typeof payload.body !== "string" || payload.body.length > 500
  )) return NextResponse.json({ error: "Select up to 100 lines and write an annotation of up to 500 characters." }, { status: 400 });

  const action = { ...payload, actor: member.id } as TaskSessionAction;
  const actionAt = Date.now();
  let applied;
  try { applied = await applyTaskSessionAction(sessionId, action, member, actionAt); }
  catch (error) {
    if (error instanceof TaskSessionAccessError) return NextResponse.json({ error: error.message }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof WorkspaceRestoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const { snapshot, startedRun } = applied;
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
    action.type === "apply-next-steer" || action.type === "steer-thread" || action.type === "answer-question" || action.type === "continue-peer-response"
      ? snapshot.session.activeSteer
      : undefined;

  const replyId = snapshot.session.workspace.liveReply!.id;
  // Progress checkpoints are best effort; the completed reply is saved below.
  const writer = createReplyWriter(
    (body, sequence) => checkpointAgentReply(sessionId, replyId, body, sequence),
    250,
    (error) => console.error("Hive reply checkpoint failed", { taskSessionId: sessionId, error }),
  );
  let subagents: HiveSubagent[] | undefined;
  let subagentSequence = 0;
  let acceptingProgress = true;
  const subagentWriter = createReplyWriter(
    (value) => checkpointSubagents(sessionId, replyId, JSON.parse(value)), 250,
    () => console.error("Hive subagent progress checkpoint failed", { taskSessionId: sessionId }),
  );

  try {
    const { actor: runActor, actorName, steer, memoryQuery } = buildHiveRunInput(
      snapshot.session,
      action,
      snapshot.members,
    );
    let codexSubscription;
    if (usesPlatformSubscriptions(process.env) && snapshot.session.workspace.agentSession?.runtime !== "claude-code") {
      try {
        codexSubscription = await readCodexSubscription({ sessionId, memberId: member.id, runId: replyId });
      } catch {
        // Vault/provider failures must never include credentials or change billing.
        throw new HiveAgentError("Reconnect the Codex subscription.", new Error("Platform credential unavailable."));
      }
    }
    if (!snapshot.session.repository) {
      const reply = await runHiveConversation(
        snapshot.session,
        runActor,
        actorName,
        writer.push,
        steer,
        codexSubscription,
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

    const toolSecret = process.env.HIVE_INVITE_SECRET?.trim();
    const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL?.trim();
    const toolConnection = toolSecret && callbackUrl ? {
      url: hiveToolEndpoint(sessionId, callbackUrl),
      token: createHiveToolToken({ sessionId, memberId: member.id, runId: replyId }, toolSecret),
      controlCapability: subagentCapability(sessionId, replyId, toolSecret),
      runId: replyId,
    } : undefined;
    const runResult = await runHiveCodingTask(snapshot.session, runActor, steer, {
      codexSubscription,
      actorName,
      memoryQuery,
      vercelOidcToken,
      onText: writer.push,
      onSubagents(update) {
        if (!acceptingProgress || update.runId !== replyId || update.sequence <= subagentSequence || update.tasks.some((task) => task.runId !== replyId)) return;
        subagentSequence = update.sequence;
        subagents = update.tasks;
        subagentWriter.push(JSON.stringify(update));
      },
      toolConnection,
    });
    await writer.close();
    acceptingProgress = false;
    await subagentWriter.close();
    return sessionResponse(
      await appendHiveReply(sessionId, runResult.summary, {
        forReplyId: replyId,
        forMessageId: sourceMessageId,
        forMessageAnnotation: sourceMessageAnnotation,
        forActiveSteerAt: activeSteer?.appliedAt,
        forSteerAt: sourceSteerAt,
        runResult,
        subagents,
      }),
    );
  } catch (error) {
    acceptingProgress = false;
    await subagentWriter.close().catch(() => undefined);
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
        subagents,
        runError: message,
        runCheckpoint:
          error instanceof HiveAgentError ? error.checkpoint : undefined,
      }),
    );
  }
}
