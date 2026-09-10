import Link from "next/link";
import { SubagentActivity } from "@/components/hive/subagent-activity";
import { HiveMark } from "@/components/hive/hive-mark";
import type { HiveSubagent } from "@/lib/hive-subagents";

const tasks: HiveSubagent[] = [
  {
    id: "12e5269e-4a53-4485-b84d-80094baecf16", runId: "ui-preview", kind: "research", task: "Trace how a teammate's new message joins the queue while Hive is working.", status: "completed", startedAt: 1,
    result: "The queue preserves the author and arrival order. A new message does not interrupt the current run.\n\nThis is sample content for the UI preview, not a repository inspection.",
  },
  {
    id: "00f89e08-0a50-42b0-8a05-3dc37b6429f0", runId: "ui-preview", kind: "review", task: "Review the cancellation flow for stale runs and cross-task access.", status: "completed", startedAt: 1,
    result: "Check that a Stop request is bound to both the task and the active run. An interrupt acknowledgement should display **Stopping**, not **Stopped**.\n\nThis is a sample review, not a completed live check.",
  },
];

export default function SubagentsPreview() {
  return <main className="min-h-dvh bg-[#fafafa] text-[#171717]">
    <header className="flex h-16 items-center gap-3 border-b border-[#e8e8e8] bg-white px-6"><HiveMark className="size-8" /><span className="font-semibold">Hive</span><span className="text-sm text-[#777]">/ Subagents preview</span><Link className="ml-auto text-sm text-[#666] underline underline-offset-4" href="/demo">Sample tasks</Link></header>
    <section className="mx-auto max-w-2xl px-5 py-16">
      <p className="mb-8 text-xs text-[#777]">UI preview · Sample content · No agent or repository is running</p>
      <div className="mb-6 flex items-center gap-2"><HiveMark className="size-6" /><h1 className="text-sm font-semibold">Hive</h1></div>
      <p className="mb-5 text-sm leading-6 text-[#555]">I split the investigation and review into two focused subagents. You can expand their results below.</p>
      <SubagentActivity sessionId="ui-preview" tasks={tasks} />
      <p className="mt-6 rounded-lg border border-[#e8e8e8] bg-white p-4 text-sm leading-6 text-[#555]">I’ll bring their findings back into this conversation. Your team continues to steer one shared agent.</p>
    </section>
  </main>;
}
