import path from "node:path";

import {
  HarnessAgent,
  type HarnessAgentResumeSessionState,
} from "@ai-sdk/harness/agent";
import { createCodex } from "@ai-sdk/harness-codex";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { Sandbox } from "@vercel/sandbox";
import type { Experimental_SandboxSession } from "ai";

import { hiveAgentFailureMessage, HiveAgentError } from "@/lib/hive-agent";
import { getRepositoryCloneCredentials } from "@/lib/github-app";
import { buildCodexPrompt } from "@/lib/hive-prompt";
import { resolvePersistentSandboxName } from "@/lib/hive-session";
import {
  createAgentSessionId,
  type MemberId,
  type RoomState,
  type WorkspaceCommand,
  type WorkspaceFile,
} from "@/lib/room";

const DEFAULT_MODEL = "openai/gpt-5.1-codex-mini";
const CODEX_BRIDGE_PORT = 4319;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_DIFF_CHARS = 60_000;
const MAX_CHANGED_FILES = 12;
const CODEX_BRIDGE_DEPENDENCY_CHECK =
  'node --input-type=module -e "await import(\'ws\'); await import(\'@openai/codex-sdk\')"';

function truncate(value: string, max = MAX_OUTPUT_CHARS) {
  return value.length <= max
    ? value
    : `${value.slice(0, max)}\n\n[output truncated by Hive]`;
}

function repositoryDirectory(repositoryUrl: string) {
  const pathname = new URL(repositoryUrl).pathname.replace(/\/+$/, "");
  const directory = path.posix.basename(pathname).replace(/\.git$/, "");
  if (!directory || directory === "." || directory === "..") {
    throw new Error("Repository URL does not contain a valid directory name.");
  }
  return directory;
}

async function commandOutput(
  sandbox: Experimental_SandboxSession,
  command: string,
  workingDirectory: string,
) {
  const startedAt = Date.now();
  const result = await sandbox.run({
    command,
    workingDirectory,
    abortSignal: AbortSignal.timeout(120_000),
  });
  return {
    exitCode: result.exitCode,
    output: truncate(
      [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    ),
    durationMs: Date.now() - startedAt,
  };
}

async function ensureCodexBridgeDependencies(
  sandbox: Experimental_SandboxSession,
  sessionWorkDir: string,
  abortSignal?: AbortSignal,
) {
  const bootstrapDirectory = path.posix.join(
    path.posix.dirname(sessionWorkDir),
    ".harness-bootstrap/codex",
  );
  let check = await sandbox.run({
    command: CODEX_BRIDGE_DEPENDENCY_CHECK,
    workingDirectory: bootstrapDirectory,
    abortSignal,
  });
  if (check.exitCode === 0) return;

  const install = await sandbox.run({
    command:
      "npm install --no-package-lock --no-audit --no-fund --ignore-scripts=false ws@8.21.0 @openai/codex-sdk@0.149.1",
    workingDirectory: bootstrapDirectory,
    abortSignal,
  });
  if (install.exitCode !== 0) {
    throw new Error(
      `Codex bridge dependency repair failed: ${truncate(
        install.stderr || install.stdout,
      )}`,
    );
  }

  check = await sandbox.run({
    command: CODEX_BRIDGE_DEPENDENCY_CHECK,
    workingDirectory: bootstrapDirectory,
    abortSignal,
  });
  if (check.exitCode !== 0) {
    throw new Error(
      `Codex bridge dependencies are unavailable after install: ${truncate(
        check.stderr || check.stdout,
      )}`,
    );
  }
}

async function ensureRepositoryWorkingCopy(
  sandbox: Experimental_SandboxSession,
  sessionWorkDir: string,
  abortSignal?: AbortSignal,
) {
  const existingRepository = await sandbox.run({
    command: "git rev-parse --show-toplevel",
    workingDirectory: sessionWorkDir,
    abortSignal,
  });
  if (existingRepository.exitCode === 0) return;

  const sandboxRoot = path.posix.dirname(sessionWorkDir);
  const sourceRepository = await sandbox.run({
    command: "git rev-parse --show-toplevel",
    workingDirectory: sandboxRoot,
    abortSignal,
  });
  if (sourceRepository.exitCode !== 0) {
    throw new Error("The connected repository is missing from the sandbox.");
  }

  const clone = await sandbox.run({
    command:
      'rmdir "$TARGET_DIR" && git clone --no-hardlinks . "$TARGET_DIR"',
    workingDirectory: sandboxRoot,
    env: { TARGET_DIR: sessionWorkDir },
    abortSignal,
  });
  if (clone.exitCode !== 0) {
    throw new Error(
      `Hive could not create the persistent repository working copy: ${truncate(
        clone.stderr || clone.stdout,
      )}`,
    );
  }
}

async function collectArtifacts(
  sandbox: Experimental_SandboxSession,
  commands: WorkspaceCommand[],
  workingDirectory: string,
) {
  const changedFileResult = await commandOutput(
    sandbox,
    "git diff --name-only --diff-filter=ACMRTUXB HEAD; git ls-files --others --exclude-standard",
    workingDirectory,
  );
  const changedFiles = [
    ...new Set(
      changedFileResult.output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_CHANGED_FILES);

  const diffResult = await commandOutput(
    sandbox,
    'git diff --no-ext-diff HEAD; while IFS= read -r file; do git diff --no-index -- /dev/null "$file" || true; done < <(git ls-files --others --exclude-standard)',
    workingDirectory,
  );

  const files: WorkspaceFile[] = [];
  for (const filePath of changedFiles) {
    const content = await sandbox.readTextFile({
      path: path.posix.join(workingDirectory, filePath),
    });
    if (content == null) continue;
    files.push({ path: filePath, content: truncate(content) });
  }

  return {
    changedFiles,
    files,
    diff: truncate(diffResult.output, MAX_DIFF_CHARS),
    commands,
  };
}

function toolOutput(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function collectCodexCommands(result: {
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolCallId: string;
    output: unknown;
  }>;
}) {
  const results = new Map(
    result.toolResults.map((item) => [item.toolCallId, item.output]),
  );

  return result.toolCalls.flatMap((call): WorkspaceCommand[] => {
    if (call.toolName !== "bash") return [];
    const input = call.input as { command?: unknown };
    if (typeof input.command !== "string") return [];
    const output = results.get(call.toolCallId);
    const exitCode =
      output && typeof output === "object" && "exitCode" in output
        ? Number(output.exitCode)
        : 0;
    return [
      {
        command: input.command,
        output: truncate(toolOutput(output)),
        exitCode: Number.isFinite(exitCode) ? exitCode : 0,
      },
    ];
  });
}

export async function runHiveCodingTask(
  room: RoomState,
  actor: MemberId,
  steer?: string,
  auth?: { vercelOidcToken?: string },
) {
  if (!room.repository) {
    throw new HiveAgentError(
      "Connect a GitHub repository before asking Hive to execute code.",
      new Error("Repository is not connected."),
    );
  }

  if (
    room.repository.provider !== "github-app" ||
    !room.repository.installationId ||
    !room.repository.id
  ) {
    throw new HiveAgentError(
      "Reconnect the repository through the Hive GitHub App before running code.",
      new Error("Repository is missing GitHub App installation metadata."),
    );
  }

  const sessionId =
    room.workspace.agentSession?.id ??
    createAgentSessionId(room.roomId, room.repository.connectedAt);
  const resumeFrom = room.workspace.agentSession?.resumeFrom as
    | HarnessAgentResumeSessionState
    | undefined;
  const repositoryCwd = repositoryDirectory(room.repository.url);
  const sandboxName = resolvePersistentSandboxName(room, sessionId);
  const gatewayApiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  const codexAuth: "ai-gateway" | Readonly<Record<string, string>> = gatewayApiKey
    ? { AI_GATEWAY_API_KEY: gatewayApiKey }
    : auth?.vercelOidcToken
      ? { VERCEL_OIDC_TOKEN: auth.vercelOidcToken }
      : "ai-gateway";
  let sandboxSession: Experimental_SandboxSession | undefined;
  let persistentSandbox: Sandbox | undefined;
  let sessionEnded = false;

  try {
    const cloneCredentials = await getRepositoryCloneCredentials(room.repository);
    persistentSandbox = await Sandbox.getOrCreate({
      name: sandboxName,
      runtime: "node24",
      ports: [CODEX_BRIDGE_PORT],
      source: {
        type: "git",
        url: room.repository.url,
        ...cloneCredentials,
        depth: 20,
      },
      timeout: 10 * 60 * 1000,
      persistent: true,
      snapshotExpiration: 0,
      keepLastSnapshots: { count: 1, expiration: 0 },
      resources: { vcpus: 1 },
      tags: { app: "hive", room: room.roomId, runtime: "codex" },
    });
    const sandbox = createVercelSandbox({ sandbox: persistentSandbox });
    const agent = new HarnessAgent({
      id: "hive-coding-agent",
      harness: createCodex({
        auth: codexAuth,
        reasoningEffort: "medium",
        webSearch: false,
        codexConfig: { model_verbosity: "low" },
      }),
      model: process.env.HIVE_CODEX_MODEL?.trim() || DEFAULT_MODEL,
      instructions: [
        "You are Hive's Codex execution engine, shared by a small software team.",
        "Work only inside the connected repository and never claim an action you did not perform.",
        "Preserve teammate attribution in the prompt, but treat the latest labeled task as the instruction to execute.",
        "Inspect relevant files before editing and make the smallest coherent change that satisfies the request.",
        "Run the most relevant available checks after editing.",
        "Do not commit, push, deploy, access secrets, alter git history, or leave the repository working directory.",
        "If intent is ambiguous, inspect enough context to ask one precise question instead of guessing.",
        "Finish with a concise summary naming the files changed and checks actually run.",
      ].join(" "),
      permissionMode: "allow-all",
      sandbox,
      sandboxConfig: {
        workDir: repositoryCwd,
        onSession: async ({ session, sessionWorkDir, abortSignal }) => {
          sandboxSession = session;
          await ensureCodexBridgeDependencies(
            session,
            sessionWorkDir,
            abortSignal,
          );
          await ensureRepositoryWorkingCopy(
            session,
            sessionWorkDir,
            abortSignal,
          );
          const check = await session.run({
            command: "git rev-parse --show-toplevel",
            workingDirectory: sessionWorkDir,
          });
          if (check.exitCode !== 0) {
            throw new Error(
              "Codex session did not start inside the connected repository.",
            );
          }
        },
      },
    });

    const session = await agent.createSession({ sessionId, resumeFrom });
    try {
      const result = await agent.generate({
        session,
        prompt: buildCodexPrompt(room, actor, steer),
      });
      if (!sandboxSession) {
        throw new Error("Vercel Sandbox session was not made available to Hive.");
      }
      const commands = collectCodexCommands(result);
      const artifacts = await collectArtifacts(
        sandboxSession,
        commands,
        repositoryCwd,
      );
      const nextResumeFrom = await session.stop();
      sessionEnded = true;
      await persistentSandbox.stop().catch((error) => {
        console.error("Hive sandbox snapshot failed", error);
      });

      return {
        sandboxName,
        agentSession: {
          id: sessionId,
          runtime: "codex" as const,
          resumeFrom: nextResumeFrom,
        },
        summary:
          result.text.trim() ||
          (artifacts.changedFiles.length > 0
            ? `Changed ${artifacts.changedFiles.join(", ")}. Review the real diff in the shared workspace.`
            : "I inspected the repository and did not make a code change."),
        ...artifacts,
      };
    } finally {
      if (!sessionEnded) {
        await session.destroy().catch(() => undefined);
        await persistentSandbox?.stop().catch(() => undefined);
      }
    }
  } catch (error) {
    if (error instanceof HiveAgentError) throw error;
    throw new HiveAgentError(hiveAgentFailureMessage(error), error);
  }
}
