import {
  resolveMember,
  type MemberId,
  type TaskSessionState,
} from "./task-session.ts";

function latestTask(session: TaskSessionState, actor: MemberId, steer?: string) {
  if (steer) return steer;
  return (
    session.messages.findLast(
      (message) =>
        message.role === "human" && message.memberId === actor,
    )?.body ?? "Inspect the repository and report what needs attention."
  );
}

export function buildHivePrompt(
  session: TaskSessionState,
  actor: MemberId,
  steer?: string,
  actorName?: string,
  mode: "planning" | "coding" = "coding",
) {
  const currentTeammate =
    actorName ??
    session.messages.findLast(
      (message) => message.role === "human" && message.memberId === actor,
    )?.name ??
    resolveMember(actor).name;
  const teamContext = session.messages
    .filter((message) => message.status !== "error")
    .slice(-12)
    .map((message) => `[${message.name}]: ${message.body}`)
    .join("\n");

  return [
    `Current teammate: ${currentTeammate}`,
    "Shared team context (for attribution, not a second agent history):",
    teamContext,
    mode === "planning" ? "Latest request to discuss:" : "Task to execute now:",
    `[${currentTeammate}]: ${latestTask(session, actor, steer)}`,
  ].join("\n\n");
}
