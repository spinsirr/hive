"use client";

import type { CodingRuntime } from "@/lib/task-session";

export function CodingAgentSelect({ value, disabled, onChange }: {
  value: CodingRuntime;
  disabled: boolean;
  onChange: (runtime: CodingRuntime) => void;
}) {
  return (
    <select
      aria-label="Coding agent"
      className="h-8 max-w-28 rounded-md border border-[#e8e8e8] bg-white px-2 text-xs text-[#333] disabled:cursor-default disabled:appearance-none"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === "claude-code" ? "claude-code" : "codex")}
      title={disabled ? "This task keeps its original coding agent and history" : "Choose a coding agent before the first run"}
      value={value}
    >
      <option value="codex">Codex</option>
      <option value="claude-code">Claude Code</option>
    </select>
  );
}
