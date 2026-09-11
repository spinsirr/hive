import { ChevronDown, ListChecks } from "lucide-react";

import type { WorkspaceState } from "@/lib/task-session";
import { cn } from "@/lib/utils";

export function RunsPane({ commands }: { commands: WorkspaceState["commands"] }) {
  if (commands.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-[#fafafa] p-8 text-center">
        <div>
          <ListChecks className="mx-auto size-6 text-[#737373]" />
          <p className="mt-3 text-sm font-medium">No commands in this turn</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white">
      {commands.map((command, index) => {
        const exitedCleanly = command.exitCode === 0;
        return (
          <details
            className="group border-b border-[#e9e9e9] last:border-b-0"
            key={`${index}-${command.command}`}
          >
            <summary className="grid cursor-pointer list-none grid-cols-[24px_minmax(0,1fr)_auto_auto_16px] items-center gap-3 px-4 py-3.5 transition hover:bg-[#fafafa] [&::-webkit-details-marker]:hidden">
              <span className="grid size-6 place-items-center rounded-full border border-[#dedede] text-xs text-[#737373]">
                {index + 1}
              </span>
              <code className="truncate font-mono text-xs text-[#292929]">
                {command.command}
              </code>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium",
                  exitedCleanly ? "text-[#3d3d3d]" : "text-[#737373]",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    exitedCleanly ? "bg-[#171717]" : "bg-[#a1a1a1]",
                  )}
                />
                {command.exitCode === null ? "Incomplete" : `Exit ${command.exitCode}`}
              </span>
              <span className="text-xs tabular-nums text-[#999]">
                {command.durationMs ? `${command.durationMs}ms` : "—"}
              </span>
              <ChevronDown className="size-3.5 text-[#999] transition-transform group-open:rotate-180" />
            </summary>
            <pre className="overflow-x-auto border-t border-[#242424] bg-[#0a0a0a] px-4 py-4 font-mono text-xs leading-5 text-[#d8d8d8]">
              {command.output || "No output"}
            </pre>
          </details>
        );
      })}
    </div>
  );
}
