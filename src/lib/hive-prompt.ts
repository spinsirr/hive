import {
  resolveMember,
  type MemberId,
  type RoomState,
} from "./room.ts";

function latestTask(room: RoomState, actor: MemberId, steer?: string) {
  if (steer) return steer;
  return (
    room.messages.findLast(
      (message) =>
        message.role === "human" && message.memberId === actor,
    )?.body ?? "Inspect the repository and report what needs attention."
  );
}

export function buildCodexPrompt(
  room: RoomState,
  actor: MemberId,
  steer?: string,
  actorName?: string,
) {
  const currentTeammate =
    actorName ??
    room.messages.findLast(
      (message) => message.role === "human" && message.memberId === actor,
    )?.name ??
    resolveMember(actor).name;
  const teamContext = room.messages
    .filter((message) => message.status !== "error")
    .slice(-12)
    .map((message) => `[${message.name}]: ${message.body}`)
    .join("\n");

  return [
    `Current teammate: ${currentTeammate}`,
    "Shared team context (for attribution, not a second agent history):",
    teamContext,
    "Task to execute now:",
    `[${currentTeammate}]: ${latestTask(room, actor, steer)}`,
  ].join("\n\n");
}
