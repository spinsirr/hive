import path from "node:path";

import type { TaskSessionState } from "./task-session.ts";

export function isRepositoryWorkingCopy(
  sessionWorkDir: string,
  gitTopLevel: string,
) {
  return (
    path.posix.normalize(gitTopLevel.trim()) ===
    path.posix.normalize(sessionWorkDir)
  );
}

export function resolvePersistentSandboxName(
  session: Pick<TaskSessionState, "workspace">,
  sessionId: string,
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
