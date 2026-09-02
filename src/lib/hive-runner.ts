import { createHash } from "node:crypto";
import path from "node:path";

import { Sandbox } from "@vercel/sandbox";
import { stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";

import { hiveAgentFailureMessage, HiveAgentError } from "@/lib/hive-agent";
import { getRepositoryCloneCredentials } from "@/lib/github-app";
import {
  memberDirectory,
  type MemberId,
  type RoomState,
  type WorkspaceCommand,
  type WorkspaceFile,
} from "@/lib/room";

const DEFAULT_MODEL = "poolside/laguna-s-2.1-free";
const MAX_OUTPUT_CHARS = 20_000;
const MAX_DIFF_CHARS = 60_000;
const MAX_CHANGED_FILES = 12;

function truncate(value: string, max = MAX_OUTPUT_CHARS) {
  return value.length <= max
    ? value
    : `${value.slice(0, max)}\n\n[output truncated by Hive]`;
}

function safeRepositoryPath(value: string) {
  const normalized = value.trim().replace(/^\.\//, "");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.startsWith(".git/") ||
    normalized === ".git"
  ) {
    throw new Error("Path must stay inside the repository workspace.");
  }
  return normalized;
}

function sandboxName(repositoryUrl: string) {
  const digest = createHash("sha256")
    .update(repositoryUrl)
    .digest("hex")
    .slice(0, 12);
  return `hive-orbit-nav-${digest}`;
}

function latestTask(room: RoomState, actor: MemberId, steer?: string) {
  if (steer) return steer;
  return (
    room.messages.findLast(
      (message) =>
        message.role === "human" && message.memberId === actor,
    )?.body ?? "Inspect the repository and report what needs attention."
  );
}

function teamContext(room: RoomState) {
  return room.messages
    .filter((message) => message.status !== "error")
    .slice(-12)
    .map((message) => `[${message.name}]: ${message.body}`)
    .join("\n");
}

async function commandOutput(
  sandbox: Sandbox,
  command: string,
  args: string[],
  timeoutMs = 120_000,
) {
  const result = await sandbox.runCommand(command, args, { timeoutMs });
  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  return {
    exitCode: result.exitCode,
    output: truncate([stdout, stderr].filter(Boolean).join("\n").trim()),
    durationMs: result.durationMs,
  };
}

async function collectArtifacts(
  sandbox: Sandbox,
  commands: WorkspaceCommand[],
) {
  const changedFileResult = await commandOutput(sandbox, "bash", [
    "-lc",
    "git diff --name-only --diff-filter=ACMRTUXB HEAD; git ls-files --others --exclude-standard",
  ]);
  const changedFiles = [...new Set(changedFileResult.output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  )].slice(0, MAX_CHANGED_FILES);

  const diffResult = await commandOutput(sandbox, "bash", [
    "-lc",
    "git diff --no-ext-diff HEAD; while IFS= read -r file; do git diff --no-index -- /dev/null \"$file\" || true; done < <(git ls-files --others --exclude-standard)",
  ]);

  const files: WorkspaceFile[] = [];
  for (const filePath of changedFiles) {
    const content = await sandbox.readFileToBuffer({ path: filePath });
    if (!content) continue;
    files.push({ path: filePath, content: truncate(content.toString("utf8")) });
  }

  return {
    changedFiles,
    files,
    diff: truncate(diffResult.output, MAX_DIFF_CHARS),
    commands,
  };
}

export async function runHiveCodingTask(
  room: RoomState,
  actor: MemberId,
  steer?: string,
) {
  if (!room.repository) {
    throw new HiveAgentError(
      "Connect a GitHub repository before asking Hive to execute code.",
      new Error("Repository is not connected."),
    );
  }

  const name = room.workspace.sandboxName ?? sandboxName(room.repository.url);
  const commands: WorkspaceCommand[] = [];

  try {
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

    const cloneCredentials = await getRepositoryCloneCredentials(room.repository);
    const sandbox = await Sandbox.getOrCreate({
      name,
      source: {
        type: "git",
        url: room.repository.url,
        ...cloneCredentials,
        depth: 20,
      },
      persistent: true,
      timeout: 10 * 60 * 1000,
      resources: { vcpus: 1 },
      snapshotExpiration: 24 * 60 * 60 * 1000,
      keepLastSnapshots: { count: 2 },
      tags: { app: "hive", room: room.roomId },
    });

    const tools = {
      listFiles: tool({
        description:
          "List repository files before choosing what to inspect. Excludes .git and dependency directories.",
        inputSchema: z.object({
          directory: z.string().default("."),
          maxDepth: z.number().int().min(1).max(6).default(3),
        }),
        execute: async ({ directory, maxDepth }) => {
          const safeDirectory =
            directory === "." ? "." : safeRepositoryPath(directory);
          const result = await commandOutput(sandbox, "find", [
            safeDirectory,
            "-maxdepth",
            String(maxDepth),
            "-type",
            "f",
            "-not",
            "-path",
            "*/.git/*",
            "-not",
            "-path",
            "*/node_modules/*",
          ]);
          return result.output;
        },
      }),
      readFile: tool({
        description: "Read a UTF-8 text file inside the connected repository.",
        inputSchema: z.object({ path: z.string().min(1) }),
        execute: async ({ path: filePath }) => {
          const safePath = safeRepositoryPath(filePath);
          const content = await sandbox.readFileToBuffer({ path: safePath });
          if (!content) throw new Error(`${safePath} was not found.`);
          return truncate(content.toString("utf8"));
        },
      }),
      writeFile: tool({
        description:
          "Create or replace a UTF-8 text file inside the repository. Read a file before replacing it.",
        inputSchema: z.object({
          path: z.string().min(1),
          content: z.string(),
        }),
        execute: async ({ path: filePath, content }) => {
          const safePath = safeRepositoryPath(filePath);
          const directory = path.posix.dirname(safePath);
          if (directory !== ".") {
            await sandbox.runCommand("mkdir", ["-p", directory]);
          }
          await sandbox.writeFiles([{ path: safePath, content }]);
          return `Wrote ${Buffer.byteLength(content)} bytes to ${safePath}.`;
        },
      }),
      runCommand: tool({
        description:
          "Run a shell command in the isolated repository workspace. Use this for package inspection, formatting, type checks, and tests. Never commit, push, deploy, or print environment variables.",
        inputSchema: z.object({
          command: z.string().min(1).max(1_000),
        }),
        execute: async ({ command }) => {
          const result = await commandOutput(sandbox, "bash", ["-lc", command]);
          commands.push({ command, ...result });
          return result;
        },
      }),
    };

    const agent = new ToolLoopAgent({
      id: "hive-coding-agent",
      model: process.env.HIVE_MODEL?.trim() || DEFAULT_MODEL,
      instructions: [
        "You are Hive, one coding agent shared live by a small software team.",
        "Work against the connected repository using tools; never claim an action you did not perform.",
        "Inspect relevant files before editing. Make the smallest coherent change that satisfies the team's request.",
        "Run the most relevant available checks after editing. Do not commit, push, deploy, access secrets, or alter git history.",
        "If the request is ambiguous, inspect enough context to ask one precise question instead of guessing.",
        "Finish with a concise summary that names the real files changed and checks actually run.",
      ].join(" "),
      tools,
      stopWhen: stepCountIs(14),
      temperature: 0.2,
      maxOutputTokens: 500,
      providerOptions: {
        gateway: {
          tags: ["app:hive", "feature:coding-run"],
          user: actor,
        },
      },
    });

    const result = await agent.generate({
      prompt: [
        `Connected repository: ${room.repository.url}`,
        `Current teammate: ${memberDirectory[actor].name}`,
        "Shared transcript:",
        teamContext(room),
        "Task to execute now:",
        latestTask(room, actor, steer),
      ].join("\n\n"),
    });
    const artifacts = await collectArtifacts(sandbox, commands);

    return {
      sandboxName: name,
      summary:
        result.text.trim() ||
        (artifacts.changedFiles.length > 0
          ? `Changed ${artifacts.changedFiles.join(", ")}. Review the real diff in the shared workspace.`
          : "I inspected the repository and did not make a code change."),
      ...artifacts,
    };
  } catch (error) {
    if (error instanceof HiveAgentError) throw error;
    throw new HiveAgentError(hiveAgentFailureMessage(error), error);
  }
}
