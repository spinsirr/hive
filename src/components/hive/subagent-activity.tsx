"use client";

import { useState } from "react";
import {
  Check,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  Square,
} from "lucide-react";
import { AgentResponse } from "@/components/hive/agent-response";
import { Button } from "@/components/ui/button";
import { useHiveClient } from "@/components/hive/hive-client";
import { isSubagentActive, type HiveSubagent } from "@/lib/hive-subagents";

const labels: Record<HiveSubagent["status"], string> = {
  starting: "Starting",
  running: "Working",
  stopping: "Stopping…",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  unconfirmed: "Unconfirmed",
};

function SubagentRow({
  task,
  sessionId,
  live,
}: {
  task: HiveSubagent;
  sessionId: string;
  live: boolean;
}) {
  const client = useHiveClient();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const active = isSubagentActive(task);
  async function stop() {
    setRequesting(true);
    setError("");
    try {
      const response = await client.request(
        `/api/sessions/${encodeURIComponent(sessionId)}/subagents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: task.id, runId: task.runId }),
        }
      );
      if (!response.ok)
        throw new Error(
          "Stop could not be confirmed. Check the current status before retrying."
        );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Stop could not be confirmed."
      );
    } finally {
      setRequesting(false);
    }
  }
  return (
    <div className="relative border-l border-[#e5e5e5] pl-3">
      <details className="group min-w-0">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-sm pr-20 text-xs text-[#666] outline-offset-2 focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-3 shrink-0 transition-transform group-open:rotate-90"
          />
          {active ? (
            <LoaderCircle
              aria-hidden
              className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
            />
          ) : task.status === "completed" ? (
            <Check aria-hidden className="size-3 shrink-0" />
          ) : (
            <GitBranch aria-hidden className="size-3 shrink-0" />
          )}
          <span className="font-medium text-[#333]">
            {task.kind === "review" ? "Code review" : "Research"}
          </span>
          <span className="ml-auto shrink-0" role="status">
            {labels[task.status]}
          </span>
        </summary>
        <div className="space-y-3 py-2 pl-5 pr-2 text-xs text-[#666]">
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {task.task}
          </p>
          {task.result ? (
            <div className="max-h-80 overflow-y-auto">
              <AgentResponse>{task.result}</AgentResponse>
            </div>
          ) : (
            <p>
              {active
                ? "The result will appear here when this subagent finishes."
                : "No result was received."}
            </p>
          )}
          {task.status === "unconfirmed" ? (
            <p>The run ended without a confirmed subagent result.</p>
          ) : null}
        </div>
      </details>
      {live && active ? (
        <Button
          aria-label={`Stop ${task.kind} subagent`}
          className="absolute right-0 top-1 h-7 gap-1.5 rounded px-2 text-xs"
          disabled={requesting || task.status === "stopping"}
          onClick={() => void stop()}
          size="sm"
          variant="ghost"
        >
          <Square className="size-3" />
          {requesting || task.status === "stopping" ? "Stopping" : "Stop"}
        </Button>
      ) : null}
      {error ? (
        <p className="py-1 text-xs text-[#666]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SubagentActivity({
  tasks,
  sessionId,
  live = false,
}: {
  tasks: HiveSubagent[];
  sessionId: string;
  live?: boolean;
}) {
  return (
    <div aria-label="Hive subagents" className="w-full min-w-0 space-y-1">
      {tasks.map((task) => (
        <SubagentRow
          key={task.id}
          live={live}
          sessionId={sessionId}
          task={task}
        />
      ))}
    </div>
  );
}
