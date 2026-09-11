import { Code2 } from "lucide-react";
import { annotateUnifiedDiff } from "@/lib/diff-lines";
import { cn } from "@/lib/utils";

export function DiffPane({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center"><div><Code2 className="mx-auto size-6 text-[#737373]" /><p className="mt-3 text-sm font-medium">No git diff yet</p><p className="mt-1 text-xs text-[#8f8f8f]">Ask Hive to make a change in the connected repository.</p></div></div>;
  }
  return (
    <div className="h-full overflow-auto bg-white p-5">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-[#e2e2e2]">
        <div className="border-b border-[#ebebeb] bg-[#fafafa] px-3 py-2 font-mono text-xs">git diff --no-ext-diff HEAD</div>
        <div className="overflow-x-auto py-2 font-mono text-xs leading-6">
          <div className="w-max min-w-full">
            {annotateUnifiedDiff(diff).map(({ text, change, oldLine, newLine }, index) => {
              const gutter = cn(
                "w-11 shrink-0 select-none px-2 text-right text-[#8c959f]",
                change === "added" && "bg-[#aceebb66] text-[#116329]",
                change === "removed" && "bg-[#ffcecb66] text-[#a40e26]",
              );
              return (
                <div
                  className={cn("flex", change === "added" && "bg-[#dafbe1] text-[#116329]", change === "removed" && "bg-[#ffebe9] text-[#a40e26]", change === "meta" && "text-[#737373]")}
                  data-change={change}
                  key={`${index}-${text}`}
                >
                  {/* Real file line numbers: old file on the left, new file on the right. */}
                  <span aria-label={oldLine === undefined ? undefined : `Old line ${oldLine}`} className={gutter}>{oldLine ?? ""}</span>
                  <span aria-label={newLine === undefined ? undefined : `New line ${newLine}`} className={cn(gutter, "border-r", change === "added" ? "border-[#b4dfc0]" : change === "removed" ? "border-[#f3c0bc]" : "border-[#eeeeee]")}>{newLine ?? ""}</span>
                  <code className="whitespace-pre px-3">{text || " "}</code>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
