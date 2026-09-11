import { Check, Circle, Code2, FileCode2, GitBranch, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { demoDiff, phaseCopy, type DemoState } from "./demo-state";

export function WorkspacePreview({ state, className }: { state: DemoState; className?: string }) {
  const status = phaseCopy[state.phase];
  const hasFixture = Boolean(state.answer && state.answer.choice !== "custom" && state.revision > 0);
  return <aside aria-label="Shared workspace preview" className={cn("min-h-0 min-w-0 flex-col border-[#e9e9e7] bg-[#f9faf7] lg:border-l", className)}>
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#e9e9e7] bg-white px-5 text-xs sm:px-6"><Code2 className="size-3.5 text-[#7a7a75]" /><h2 className="font-medium">Shared workspace</h2><span className="ml-auto font-mono text-[10px] text-[#90958a]">SAMPLE</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
      <p className="font-mono text-[10px] tracking-[0.14em] text-[#858d7b]">CURRENT ACTIVITY</p>
      <h3 className="mt-3 text-lg font-medium tracking-[-0.025em]">{status.label}</h3>
      <p className="mt-2 max-w-md text-xs leading-6 text-[#7c8174]">{status.detail}</p>

      <div className="mb-3 mt-6 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 font-medium"><GitBranch className="size-3.5 text-[#7a846b]" />{state.revision ? `Revision v${state.revision}` : "Change preview"}</span><span className="text-[11px] text-[#8d9680]">{state.revision > 1 ? "Previous version superseded" : "Illustrative, not executed"}</span></div>
      <div className="overflow-hidden rounded-xl border border-[#e0e5d9] bg-white">
        <div className="flex items-center gap-2 border-b border-[#e6e9e0] px-3 py-3 font-mono text-[11px] text-[#66705b]"><FileCode2 className="size-3.5 shrink-0 text-[#7c9370]" /><span className="truncate">src/components/settings-nav.tsx</span></div>
        <div aria-label="Sample code diff" className="overflow-x-auto py-3 font-mono text-[11px] leading-5"><div className="min-w-max">{(state.revision > 0 ? demoDiff(state) : [{ kind: "context", text: "// The sample diff appears after the answer" }, { kind: "context", text: "// and the next demo step." }]).map((line, index) => <div className={cn("flex px-3", line.kind === "add" ? "bg-[#e7f3df] text-[#3a6330]" : line.kind === "remove" ? "bg-[#fbecea] text-[#9d4b41]" : "text-[#6f746a]")} key={index}><span aria-hidden="true" className="mr-3 w-4 shrink-0 select-none text-right text-[#adb2a5]">{index + 1}</span><span className="mr-2 w-3 shrink-0 select-none">{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}</span><code className="whitespace-pre">{line.text}</code></div>)}</div></div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#eff2e9] px-3 py-3 text-[11px] leading-5 text-[#7c866c]"><MessageSquare className="mt-0.5 size-3.5 shrink-0" /><p>{state.answer?.choice === "custom" ? "Custom answers are captured, but this preview does not generate code from them." : hasFixture ? "This is a hand-written fixture. No tests ran, no files changed, and no PR was created." : "When Hive requests review, the diff stays alongside the discussion. No tab hunting."}</p></div>
      {state.revision > 1 ? <p className="mt-4 px-1 text-[11px] leading-5 text-[#8b927e]">The sample second revision adds a focus-ring class. Free-form feedback remains visible in the thread; this preview cannot actually implement it.</p> : null}
      <ol aria-label="Collaboration progress" className="mt-6 space-y-3 border-t border-[#e3e7dc] pt-5">{[
        { title: "Agree on the behavior", detail: state.answer ? `Answered by ${state.answer.author}` : "Question open for Casey", done: Boolean(state.answer) },
        { title: "Review the shared change", detail: state.revision ? `Sample revision v${state.revision}` : "After the answer", done: state.revision > 0 },
        { title: "Verify together", detail: state.resolvedBy ? `Resolved by ${state.resolvedBy}` : "A teammate has the last word", done: Boolean(state.resolvedBy) },
      ].map((step) => <li className="flex items-start gap-3" key={step.title}>{step.done ? <Check className="mt-0.5 size-3.5 text-[#677e50]" /> : <Circle className="mt-0.5 size-3.5 text-[#c3cabc]" />}<div><p className="text-xs text-[#4b5541]">{step.title}</p><p className="mt-0.5 text-[11px] text-[#929985]">{step.detail}</p></div></li>)}</ol>
    </div>
  </aside>;
}
