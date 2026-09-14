import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { handle } from "hono/vercel";
import { zValidator } from "@hono/zod-validator";
import {
  apiError,
  privateResponse,
  taskMember,
  type SessionApi,
} from "@/server/http/session-middleware";

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
  TaskSessionAccessError,
} from "@/server/sessions/task-session-store";
import type { TaskSessionSnapshot } from "@/lib/session/task-session-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function sessionResponse(snapshot: TaskSessionSnapshot) {
  return Response.json(publicTaskSessionSnapshot(snapshot));
}

const app = new Hono<SessionApi>()
  .use("*", privateResponse, csrf())
  .onError(apiError)
  .get("/api/sessions/:sessionId", taskMember, async (c) =>
    sessionResponse(await getPublicTaskSessionSnapshot(c.get("sessionId")))
  )
  .post(
    "/api/sessions/:sessionId",
    taskMember,
    zValidator("json", clientTaskSessionActionSchema, (result, c) => {
      if (!result.success)
        return c.json(
          {
            error: result.error.issues[0]?.message ?? "Invalid session action",
          },
          400
        );
    }),
    async (c) => {
      const sessionId = c.get("sessionId");
      const member = c.get("member");
      const vercelOidcToken =
        c.req.header("x-vercel-oidc-token")?.trim() || undefined;
      const action: TaskSessionAction = {
        ...c.req.valid("json"),
        actor: member.id,
      };
      const actionAt = Date.now();
      let applied;
      try {
        applied = await applyTaskSessionAction(
          sessionId,
          action,
          member,
          actionAt
        );
      } catch (error) {
        if (error instanceof MessageEditError)
          return Response.json(
            { error: error.message },
            { status: error.status }
          );
        if (error instanceof TaskSessionAccessError)
          return Response.json({ error: error.message }, { status: 403 });
        if (error instanceof WorkspaceRestoreError)
          return Response.json(
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
          error instanceof HiveAgentError
            ? error.message
            : hiveErrorCopy.generic;
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
  );

export const GET = handle(app);
export const POST = handle(app);
