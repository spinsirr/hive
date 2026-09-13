import type { HiveClient } from "../components/hive/hive-client.tsx";
import type { PrivateTaskSessionSnapshot as TaskSessionSnapshot } from "./task-session-contract.ts";
import type { DashboardTask } from "./task-dashboard.ts";
import { demoTaskMessages } from "./demo-task-conversation.ts";
import {
  codingModelOptions,
  CODEX_SUBSCRIPTION_MODEL,
} from "./coding-models.ts";
import {
  ARCHIVED_TASK_MESSAGE,
  appendHiveReply,
  applyHiveRunResult,
  createInitialTaskSessionState,
  hiveReplyThreadId,
  isHiveRunActive,
  reduceTaskSession,
  type HiveRunResult,
  type TaskSessionAction,
  type TeamMember,
} from "./task-session.ts";
import { requestPeerInput } from "./peer-collaboration.ts";
import {
  beginWorkspaceRestore,
  completeWorkspaceRestore,
  restoreWorkspaceRequest,
  workspaceRestoreBlockReason,
} from "./workspace-restore-state.ts";

export const demoMembers: TeamMember[] = [
  {
    id: "demo-alex",
    name: "Alex",
    shortName: "Alex",
    initials: "AL",
    githubLogin: "alex",
  },
  {
    id: "demo-casey",
    name: "Casey",
    shortName: "Casey",
    initials: "CA",
    githubLogin: "casey",
  },
];
const models = codingModelOptions(CODEX_SUBSCRIPTION_MODEL, true);
const epoch = Date.UTC(2026, 8, 10, 17, 42);
const sourcePath = "src/components/settings-nav.tsx";
const before =
  'export function SettingsNav() {\n  return <nav aria-label="Settings">Settings</nav>;\n}\n';
const after =
  'export function SettingsNav() {\n  return <nav aria-label="Settings" tabIndex={0}>Settings</nav>;\n}\n';
const sampleFiles = [
  {
    path: "README.md",
    content:
      "# Sample workspace\n\nInvented files for the Hive demo. No repository is connected.\n",
  },
  {
    path: "package.json",
    content: '{\n  "name": "sample-workspace",\n  "private": true\n}\n',
  },
  { path: sourcePath, content: before },
];

function result(
  session: TaskSessionSnapshot["session"],
  now: number,
  changed: boolean
): HiveRunResult {
  const runtime = session.workspace.agentSession?.runtime ?? "codex";
  return {
    snapshot: { id: `sample-checkpoint-${now}`, createdAt: now },
    sandboxName: "sample-workspace",
    agentSession: {
      id: session.workspace.agentSession?.id ?? "sample-agent",
      runtime,
      resumeFrom: {
        type: "resume-session",
        specificationVersion: "harness-v1",
        harnessId: runtime,
        data: { sample: true },
      },
    },
    summary:
      "Simulated result: the sample workspace is ready for review. No model ran and no repository was changed.",
    diff: changed
      ? `diff --git a/${sourcePath} b/${sourcePath}\n--- a/${sourcePath}\n+++ b/${sourcePath}\n@@ -1,3 +1,3 @@\n export function SettingsNav() {\n-  return <nav aria-label="Settings">Settings</nav>;\n+  return <nav aria-label="Settings" tabIndex={0}>Settings</nav>;\n }\n`
      : "",
    files: [
      { path: sourcePath, content: changed ? after : before },
      ...sampleFiles.filter((file) => file.path !== sourcePath),
    ],
    commands: changed
      ? [
          {
            command: "npm test",
            output:
              "Sample output only — no command executed.\n3 sample checks passed.",
            exitCode: 0,
          },
        ]
      : [],
    changedFiles: changed ? [sourcePath] : [],
  };
}

function repositoryAction(name: string, actor: string): TaskSessionAction {
  return {
    type: "connect-repository",
    actor,
    repositoryId: 1,
    repositoryName: name,
    repositoryUrl: `https://github.com/${name}`,
    repositoryBranch: "main",
    installationId: 1,
    visibility: "public",
    githubUserId: 1,
    githubLogin: "alex",
  };
}

function initialSnapshot(task: DashboardTask): TaskSessionSnapshot {
  let session = createInitialTaskSessionState(epoch, `preview-${task.id}`, {
    title: task.title,
    createdBy: demoMembers[0].id,
  });
  if (task.repositoryName) {
    session = reduceTaskSession(
      session,
      repositoryAction(task.repositoryName, demoMembers[0].id),
      epoch,
      demoMembers,
      models
    );
    const initial = result(session, epoch, false);
    session.workspace = {
      ...session.workspace,
      ...initial,
      status: "ready",
      checkpoints: [
        { id: initial.snapshot!.id, createdAt: epoch, result: initial },
      ],
    };
  }
  if (task.title) session.messages = demoTaskMessages(task);
  if (task.id === "demo-thread")
    session.messages[1].subagents = [
      {
        id: "sample-research",
        runId: "preview-run",
        kind: "research",
        task: "Trace how a teammate's message enters the shared queue.",
        status: "completed",
        startedAt: epoch,
        result:
          "Sample finding: messages preserve the author and arrival order. This is invented demo content, not a live investigation.",
      },
      {
        id: "sample-review",
        runId: "preview-run",
        kind: "review",
        task: "Review the cancellation flow for stale runs and cross-task access.",
        status: "completed",
        startedAt: epoch,
        result:
          "Sample review: bind Stop to both the task and active run. No live check was performed.",
      },
    ];
  session.workspace.codingModel = CODEX_SUBSCRIPTION_MODEL;
  if (task.archivedAt)
    session = reduceTaskSession(
      session,
      { type: "archive-task", actor: demoMembers[0].id },
      task.archivedAt,
      demoMembers,
      models
    );
  return {
    session,
    members: demoMembers,
    activeMembers: demoMembers.map((member) => member.id),
    typingMembers: [],
    codingModels: models,
  };
}

type WithoutActor<T> = T extends { actor: string } ? Omit<T, "actor"> : never;
/** Local data adapter, not a second UI or collaboration state machine. */
export function createDemoWorkspace(task: DashboardTask) {
  let snapshot = initialSnapshot(task);
  let member = demoMembers[0];
  let reviewRunId: string | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: TaskSessionSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const dispatch = async (action: WithoutActor<TaskSessionAction>) => {
    let session = reduceTaskSession(
      snapshot.session,
      { ...action, actor: member.id },
      Date.now(),
      demoMembers,
      models
    );
    if (session === snapshot.session) return snapshot;
    if (isHiveRunActive(session) && !session.workspace.liveReply) {
      const threadId = hiveReplyThreadId(session);
      const runId = `sample-run-${session.version}`;
      // Demonstrate a new review for fresh work, not another review card each
      // time the team hands discussion back to the main agent.
      const source = session.activeSteer?.source;
      reviewRunId =
        action.type === "steer-message-annotation" ||
        source?.kind === "message-thread" ||
        source?.kind === "message-annotation"
          ? undefined
          : runId;
      session = {
        ...session,
        workspace: {
          ...session.workspace,
          liveReply: {
            id: runId,
            threadId,
            body: "",
            sequence: 0,
            startedAt: Date.now(),
          },
        },
      };
    }
    publish({ ...snapshot, session });
    return snapshot;
  };
  const client: HiveClient = {
    reload: () => {},
    async request(path, init) {
      const url = new URL(path, "https://demo.invalid");
      const session = snapshot.session;
      const base = `/api/sessions/${encodeURIComponent(session.sessionId)}`;
      const method = init?.method ?? "GET";
      const json = (value: unknown, status = 200) =>
        Response.json(value, { status });
      if (url.origin !== "https://demo.invalid")
        return json(
          { error: "External requests are disabled in the demo." },
          403
        );
      if (session.archived && method !== "GET")
        return json({ error: ARCHIVED_TASK_MESSAGE }, 409);
      if (url.pathname === `${base}/files` && method === "GET") {
        const path = url.searchParams.get("path") ?? "";
        const files = session.workspace.files;
        if (url.searchParams.get("kind") === "file") {
          const file = files.find((file) => file.path === path);
          return file
            ? json({
                kind: "file",
                ...file,
                bytes: new TextEncoder().encode(file.content).length,
              })
            : json({ error: "Sample file not found." }, 404);
        }
        const prefix = path ? `${path}/` : "";
        const entries = new Map<
          string,
          { name: string; path: string; kind: string }
        >();
        for (const file of files.filter((file) =>
          file.path.startsWith(prefix)
        )) {
          const rest = file.path.slice(prefix.length);
          const name = rest.split("/")[0];
          entries.set(name, {
            name,
            path: `${prefix}${name}`,
            kind: rest.includes("/") ? "directory" : "file",
          });
        }
        return json({
          kind: "directory",
          path,
          entries: [...entries.values()],
          nextOffset: null,
        });
      }
      if (url.pathname === `${base}/checkpoints`) {
        if (method === "GET")
          return json({
            checkpoints: (session.workspace.checkpoints ?? []).map((entry) => ({
              id: entry.id,
              createdAt: entry.createdAt,
              sizeBytes: 0,
              current:
                entry.id === session.workspace.lastRestore?.snapshotId ||
                entry.createdAt === session.workspace.completedAt,
              restorable: true,
            })),
            retentionCount: 3,
            version: session.version,
            blockedReason: workspaceRestoreBlockReason(session),
            restore: null,
          });
        if (method === "POST") {
          try {
            const request = restoreWorkspaceRequest.parse(
              JSON.parse(String(init?.body))
            );
            const restoring = beginWorkspaceRestore(session, request, member);
            publish({
              ...snapshot,
              session: completeWorkspaceRestore(restoring, request.id),
            });
            return json(snapshot);
          } catch (error) {
            return json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : "Sample restore failed.",
              },
              409
            );
          }
        }
      }
      if (
        url.pathname === "/api/github/repositories" &&
        url.searchParams.get("session_id") === session.sessionId
      ) {
        if (method === "GET")
          return json({
            repositories: [
              {
                id: 1,
                name: "sample-team/website",
                defaultBranch: "main",
                visibility: "public",
              },
            ],
          });
        if (
          method === "POST" &&
          JSON.parse(String(init?.body)).repositoryId === 1
        ) {
          const connected = reduceTaskSession(
            session,
            repositoryAction("sample-team/website", member.id),
            Date.now(),
            demoMembers,
            models
          );
          publish({
            ...snapshot,
            session: {
              ...connected,
              workspace: { ...connected.workspace, files: sampleFiles },
            },
          });
          return json({ connected: true });
        }
      }
      // Fail closed: new production endpoints need an explicit demo implementation.
      return json(
        { error: "This action is unavailable in the local demo." },
        403
      );
    },
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    client,
    dispatch,
    receiveSnapshot: publish,
    setTyping: () => {},
    setMember: (id: string) => {
      member = demoMembers.find((candidate) => candidate.id === id) ?? member;
    },
    restart: () => publish(initialSnapshot(task)),
    finishRun(runId: string) {
      let session = snapshot.session;
      if (
        session.archived ||
        session.workspace.liveReply?.id !== runId ||
        !isHiveRunActive(session)
      )
        return;
      if (session.repository) {
        if (!session.workspace.liveReply.threadId && reviewRunId === runId) {
          session = requestPeerInput(
            session,
            { sessionId: session.sessionId, runId, memberId: member.id },
            {
              kind: "review",
              key: "sample-review",
              prompt:
                "Review this sample change together. Does the keyboard focus behavior look right?",
              targetMemberId: demoMembers[1].id,
            },
            demoMembers,
            Date.now()
          ).session;
        }
        session = applyHiveRunResult(
          session,
          result(session, Date.now(), true)
        );
      } else
        session = appendHiveReply(
          session,
          "Simulated reply: discuss the outcome with a teammate, or attach the sample repository to explore Files and review. No model was called."
        );
      publish({ ...snapshot, session });
    },
  };
}
