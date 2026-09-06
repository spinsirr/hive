import {
  resolveMember,
  type MemberId,
  type TaskSessionAction,
  type TaskSessionState,
  type TeamMember,
} from "./task-session.ts";

export function buildHiveRunInput(
  session: TaskSessionState,
  action: TaskSessionAction,
  members: TeamMember[],
) {
  const activeSteer =
    action.type === "apply-next-steer" ? session.activeSteer : undefined;
  const actor = activeSteer?.authorId ?? action.actor;
  const actorName = resolveMember(actor, members).name;
  const source =
    activeSteer?.source ??
    (action.type === "steer-message-annotation"
      ? {
          kind: "message-annotation" as const,
          messageId: action.messageId,
          annotationId: action.annotationId,
        }
      : action.type === "steer-agent"
        ? { kind: "workspace-annotation" as const }
        : undefined);
  let steer: string | undefined;

  if (source?.kind === "message-annotation") {
    const message = session.messages.find(
      (message) => message.id === source.messageId,
    );
    const annotation = message?.annotations?.find(
      (annotation) => annotation.id === source.annotationId,
    );
    if (!message || !annotation) {
      throw new Error("The steered annotation is no longer available.");
    }
    steer = [
      "Promoted annotation. Authorship below comes from saved team records. Do not infer the annotation author from the parent message or the teammate starting this run.",
      `Annotation author: ${resolveMember(annotation.authorId, members).name}`,
      `Steer requested by: ${actorName}`,
      `Run started by: ${resolveMember(action.actor, members).name}`,
      `Parent message author: ${message.name}`,
      `Annotation to execute:\n${activeSteer?.body ?? annotation.body}`,
      `Parent message (context only):\n${message.body}`,
    ].join("\n\n");
  } else if (source?.kind === "message") {
    const message = session.messages.find(
      (message) => message.id === source.messageId,
    );
    if (!message) throw new Error("The queued message is no longer available.");
    steer = [
      `Message author: ${message.name}`,
      `Run started by: ${resolveMember(action.actor, members).name}`,
      `Message to execute:\n${activeSteer?.body ?? message.body}`,
    ].join("\n\n");
  } else if (source?.kind === "workspace-annotation") {
    steer = [
      `Steer requested by: ${actorName}`,
      `Annotation to execute:\n${activeSteer?.body ?? session.annotation.text}`,
    ].join("\n\n");
  }

  return { actor, actorName, steer };
}

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
