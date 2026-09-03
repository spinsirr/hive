import type { RoomState } from "./room.ts";

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
