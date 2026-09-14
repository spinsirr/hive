import { type NextRequest, NextResponse } from "next/server";

import {
  getSessionMember,
  HIVE_SESSION_COOKIE,
} from "@/server/auth/auth-session";
import { createReplyWriter } from "@/server/agents/agent-stream";
import { HiveAgentError } from "@/server/agents/hive-agent";
import { runHiveConversation } from "@/server/agents/hive-conversation";
import { hiveErrorCopy } from "@/lib/agents/hive-error-copy";
import { runHiveCodingTask } from "@/server/agents/hive-runner";
import { readCodexSubscription } from "@/server/agents/codex/codex-subscription-store";
import { usesPlatformSubscriptions } from "@/server/agents/platform-models";
import { buildHiveRunInput } from "@/server/agents/hive-prompt";
import {
  createHiveToolToken,
  hiveToolEndpoint,
} from "@/server/agents/tools/hive-tool-token";
import {
  MessageEditError,
  type TaskSessionAction,
} from "@/lib/session/task-session";
import { isTaskSessionId } from "@/lib/tasks/task-session-id";
import { clientTaskSessionActionSchema } from "@/lib/session/task-session-actions";
import { publicTaskSessionSnapshot } from "@/lib/session/task-session-snapshot";
import { WorkspaceRestoreError } from "@/lib/workspace/workspace-restore-state";
import { subagentCapability } from "@/server/agents/tools/subagent-control";
import type { HiveSubagent } from "@/lib/agents/hive-subagents";
import {
  appendHiveReply,
  applyTaskSessionAction,
  checkpointAgentReply,
  checkpointSubagents,
  getPublicTaskSessionSnapshot,
  isTaskSessionMember,
  TaskSessionAccessError,
} from "@/server/sessions/task-session-store";
import type { TaskSessionSnapshot } from "@/lib/session/task-session-contract";

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
  context: TaskSessionRouteContext
) {
  const { sessionId } = await context.params;
  if (!isTaskSessionId(sessionId)) return null;
  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  if (!member || !(await isTaskSessionMember(sessionId, member.id)))
    return null;
  return { member, sessionId: sessionId };
}

export async function GET(
  request: NextRequest,
  context: TaskSessionRouteContext
) {
  const auth = await authenticatedSession(request, context);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return sessionResponse(await getPublicTaskSessionSnapshot(auth.sessionId));
}

export async function POST(
  request: NextRequest,
  context: TaskSessionRouteContext
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const auth = await authenticatedSession(request, context);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { member, sessionId } = auth;
  const vercelOidcToken =
    request.headers.get("x-vercel-oidc-token")?.trim() || undefined;
  const payload: unknown = await request.json().catch(() => null);
  const parsed = clientTaskSessionActionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid session action" },
      { status: 400 }
    );
  }
  const action: TaskSessionAction = { ...parsed.data, actor: member.id };
  const actionAt = Date.now();
  let applied;
  try {
    applied = await applyTaskSessionAction(sessionId, action, member, actionAt);
  } catch (error) {
    if (error instanceof MessageEditError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    if (error instanceof TaskSessionAccessError)
      return NextResponse.json(
        { error: error.message },
        { status: 403, headers: { "Cache-Control": "private, no-store" } }
      );
    if (error instanceof WorkspaceRestoreError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    throw error;
  }
  const { snapshot, startedRun } = applied;
  if (!startedRun) return sessionResponse(snapshot);

  const replyId = snapshot.session.workspace.liveReply!.id;
  // Progress checkpoints are best effort; the completed reply is saved below.
  const writer = createReplyWriter(
    (body, sequence) =>
      checkpointAgentReply(sessionId, replyId, body, sequence),
    250,
    (error) =>
      console.error("Hive reply checkpoint failed", {
        taskSessionId: sessionId,
        error,
      })
  );
  let subagents: HiveSubagent[] | undefined;
  let subagentSequence = 0;
  let acceptingProgress = true;
  const subagentWriter = createReplyWriter(
    (value) => checkpointSubagents(sessionId, replyId, JSON.parse(value)),
    250,
    () =>
      console.error("Hive subagent progress checkpoint failed", {
        taskSessionId: sessionId,
      })
  );

  try {
    const {
      actor: runActor,
      actorName,
      steer,
      memoryQuery,
    } = buildHiveRunInput(snapshot.session, action, snapshot.members);
    let codexSubscription;
    if (
      usesPlatformSubscriptions(process.env) &&
      snapshot.session.workspace.agentSession?.runtime !== "claude-code"
    ) {
      try {
        codexSubscription = await readCodexSubscription({
          sessionId,
          memberId: member.id,
          runId: replyId,
        });
      } catch {
        // Vault/provider failures must never include credentials or change billing.
        throw new HiveAgentError(
          "Reconnect the Codex subscription.",
          new Error("Platform credential unavailable.")
        );
      }
    }
    const toolSecret = process.env.HIVE_INVITE_SECRET?.trim();
    const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL?.trim();
    const toolConnection =
      toolSecret && callbackUrl
        ? {
            url: hiveToolEndpoint(sessionId, callbackUrl),
            token: createHiveToolToken(
              { sessionId, memberId: member.id, runId: replyId },
              toolSecret
            ),
            controlCapability: subagentCapability(
              sessionId,
              replyId,
              toolSecret
            ),
            runId: replyId,
          }
        : undefined;
    if (!snapshot.session.repository) {
      const result = await runHiveConversation(
        snapshot.session,
        runActor,
        actorName,
        writer.push,
        steer,
        codexSubscription,
        toolConnection
      );
      await writer.close();
      return sessionResponse(
        await appendHiveReply(sessionId, result.summary, {
          ...("agentSession" in result ? { planningResult: result } : {}),
          forReplyId: replyId,
        })
      );
    }

    const runResult = await runHiveCodingTask(
      snapshot.session,
      runActor,
      steer,
      {
        codexSubscription,
        actorName,
        memoryQuery,
        vercelOidcToken,
        onText: writer.push,
        onSubagents(update) {
          if (
            !acceptingProgress ||
            update.runId !== replyId ||
            update.sequence <= subagentSequence ||
            update.tasks.some((task) => task.runId !== replyId)
          )
            return;
          subagentSequence = update.sequence;
          subagents = update.tasks;
          subagentWriter.push(JSON.stringify(update));
        },
        toolConnection,
      }
    );
    await writer.close();
    acceptingProgress = false;
    await subagentWriter.close();
    return sessionResponse(
      await appendHiveReply(sessionId, runResult.summary, {
        forReplyId: replyId,
        runResult,
        subagents,
      })
    );
  } catch (error) {
    acceptingProgress = false;
    await subagentWriter.close().catch(() => undefined);
    await writer.close().catch(() => undefined);
    console.error(
      "Hive agent generation failed",
      error instanceof HiveAgentError ? error.cause : error
    );
    const message =
      error instanceof HiveAgentError ? error.message : hiveErrorCopy.generic;
    return sessionResponse(
      await appendHiveReply(sessionId, message, {
        forReplyId: replyId,
        status: "error",
        subagents,
        runError: message,
        runCheckpoint:
          error instanceof HiveAgentError ? error.checkpoint : undefined,
      })
    );
  }
}
