import { Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function DiffPane({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center"><div><Code2 className="mx-auto size-6 text-[#737373]" /><p className="mt-3 text-sm font-medium">No git diff yet</p><p className="mt-1 text-xs text-[#8f8f8f]">Ask Hive to make a change in the connected repository.</p></div></div>;
  }
  return (
    <div className="h-full overflow-auto bg-white p-5">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-[#e2e2e2]">
        <div className="border-b border-[#ebebeb] bg-[#fafafa] px-3 py-2 font-mono text-[11px]">git diff --no-ext-diff HEAD</div>
        <div className="overflow-x-auto py-2 font-mono text-[12px] leading-6">
          <div className="w-max min-w-full">
            {diff.split("\n").map((line, index) => {
              const change = line.startsWith("+") && !line.startsWith("+++ ") ? "added"
                : line.startsWith("-") && !line.startsWith("--- ") ? "removed" : "context";
              return (
                <div className={cn("flex", change === "added" && "bg-[#dafbe1] text-[#116329]", change === "removed" && "bg-[#ffebe9] text-[#a40e26]")} data-change={change} key={`${index}-${line}`}>
                  <span className={cn("w-12 shrink-0 select-none border-r border-[#eeeeee] px-2 text-right text-[#8c959f]", change === "added" && "border-[#b4dfc0] bg-[#aceebb66] text-[#116329]", change === "removed" && "border-[#f3c0bc] bg-[#ffcecb66] text-[#a40e26]")}>{index + 1}</span>
                  <code className="whitespace-pre px-3">{line || " "}</code>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
