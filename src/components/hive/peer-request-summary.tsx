import { CircleHelp } from "lucide-react";
import { resolveMember, type ChatMessage, type TeamMember } from "@/lib/task-session";

export function PeerRequestSummary({ message, members }: { message: ChatMessage; members: TeamMember[] }) {
  const interaction = message.interaction;
  if (!interaction) return null;
  if (interaction.kind === "review") return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#737373]">
    <span>{interaction.targetMemberId ? `Review for ${resolveMember(interaction.targetMemberId, members).shortName}` : "Review for the team"}</span>
    <span className="rounded-full border border-[#dedede] px-2 py-0.5">{interaction.resolved ? `Verified by ${resolveMember(interaction.resolved.by, members).shortName}` : interaction.status === "preparing" ? "Preparing changes" : interaction.status === "unavailable" ? "Run interrupted" : "Needs review"}</span>
  </div>;
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#737373]">
    <CircleHelp aria-hidden="true" className="size-3.5" />
    <span>{interaction.answer ? `Answered by ${resolveMember(interaction.answer.by, members).shortName}` : interaction.targetMemberId ? `Question for ${resolveMember(interaction.targetMemberId, members).shortName}` : "Question for the team"}</span>
    {!interaction.answer ? <span className="rounded-full border border-[#eadfc4] bg-[#fffaf0] px-2 py-0.5 text-[#86652a]">Needs answer</span> : null}
  </div>;
}
