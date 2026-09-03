import path from "node:path";

import type { RoomState } from "./room.ts";

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
  room: Pick<RoomState, "workspace">,
  sessionId: string,
) {
  const storedName = room.workspace.sandboxName;
  const knownNames = [
    `hive-room-${sessionId}`,
    `ai-sdk-harness-session-${sessionId}`,
  ];
  return storedName && knownNames.includes(storedName)
    ? storedName
    : knownNames[0];
}
