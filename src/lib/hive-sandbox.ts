import path from "node:path";

import type { TaskSessionState } from "./task-session.ts";

export function repositoryDirectory(repositoryUrl: string) {
  const pathname = new URL(repositoryUrl).pathname.replace(/\/+$/, "");
  const directory = path.posix.basename(pathname).replace(/\.git$/, "");
  if (!directory || directory === "." || directory === "..") {
    throw new Error("Repository URL does not contain a valid directory name.");
  }
  return directory;
}

export function isRepositoryWorkingCopy(
  sessionWorkDir: string,
  gitTopLevel: string
) {
  return (
    path.posix.normalize(gitTopLevel.trim()) ===
    path.posix.normalize(sessionWorkDir)
  );
}

export function resolvePersistentSandboxName(
  session: { workspace: Pick<TaskSessionState["workspace"], "sandboxName"> },
  sessionId: string
) {
  const storedName = session.workspace.sandboxName;
  const knownNames = [
    `hive-session-${sessionId}`,
    `ai-sdk-harness-session-${sessionId}`,
  ];
  return storedName && knownNames.includes(storedName)
    ? storedName
    : knownNames[0];
}
