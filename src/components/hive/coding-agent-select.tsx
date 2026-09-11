"use client";

import { Popover } from "@base-ui/react/popover";
import { Slider } from "@base-ui/react/slider";
import { LockKeyhole, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CodingRuntime } from "@/lib/task-session";
import { selectedCodingModel, type CodingModelOption } from "@/lib/coding-models";
import type { CodingEffort } from "@/lib/coding-effort";
import { CodingAgentIcon } from "@/components/hive/coding-agent-icon";

const effortLabels: Record<CodingEffort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const engines: { runtime: CodingRuntime; label: string }[] = [{ runtime: "claude-code", label: "Claude Code" }, { runtime: "codex", label: "Codex" }];
const triggerClass = "flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[#606060] outline-none transition-colors hover:bg-[#e9e9e9] hover:text-[#171717] focus-visible:ring-2 focus-visible:ring-[#3178ef] data-popup-open:bg-[#e9e9e9] disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none";
const menuClass = "max-w-[calc(100vw-2rem)] rounded-xl p-1 shadow-[0_8px_24px_rgba(0,0,0,0.1)] ring-black/8 motion-reduce:animate-none";
const itemClass = "gap-2 rounded-lg py-2 pl-2 pr-8 text-xs data-checked:bg-[#f0f0f0] data-highlighted:bg-[#f4f4f4] data-disabled:text-[#999] [&_[data-slot=dropdown-menu-radio-item-indicator]]:right-2";
const modelLabel = (model: CodingModelOption) => model.runtime === "claude-code" ? model.label.replace(/^Claude /, "") : model.label;

export function CodingAgentSelect({ value, modelId, models, disabled = false, locked = false, onChange, effort, effortLocked, onEffortChange }: {
  value: CodingRuntime;
  modelId?: string;
  models?: CodingModelOption[];
  disabled?: boolean;
  locked?: boolean;
  onChange: (runtime: CodingRuntime, modelId: string) => void;
  effort: CodingEffort;
  effortLocked: boolean;
  onEffortChange: (effort: CodingEffort, modelId?: string) => void;
}) {
  const current = selectedCodingModel(models ?? [], value, modelId);
  const engineModels = models?.filter((model) => model.runtime === value) ?? [];
  const engineLabel = engines.find((engine) => engine.runtime === value)!.label;
  const codingEfforts = current?.efforts ?? [];
  const defaultEffort = codingEfforts[0];
  const [dragValue, setDragValue] = useState<number | null>(null);
  const index = Math.max(0, Math.min(dragValue ?? codingEfforts.indexOf(effort), codingEfforts.length - 1));
  const previewEffort = codingEfforts[index];
  const changeEffort = (next: CodingEffort) => {
    if (!disabled && !effortLocked && current && codingEfforts.includes(next) && next !== effort) onEffortChange(next, current.modelId);
  };

  return (
    <div className="flex min-w-0 items-center gap-0.5" role="group" aria-label="Coding agent settings">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Choose agent: ${engineLabel}`} className={`${triggerClass} shrink-0`} disabled={disabled || !models?.length}>
          <CodingAgentIcon runtime={value} /><span className="whitespace-nowrap">{engineLabel}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Agent" align="start" side="top" sideOffset={8} className={`w-48 ${menuClass}`}>
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => {
            if (next !== "claude-code" && next !== "codex") return;
            const model = selectedCodingModel(models ?? [], next);
            if (!disabled && !effortLocked && !locked && model && next !== value) onChange(model.runtime, model.modelId);
          }}>
            {engines.map(({ runtime, label }) => <DropdownMenuRadioItem
              key={runtime} value={runtime} aria-label={label} closeOnClick className={itemClass}
              disabled={disabled || effortLocked || (locked && runtime !== value) || !models?.some((model) => model.runtime === runtime)}
            ><CodingAgentIcon runtime={runtime} />{label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {locked ? <p className="mx-2 mt-1 flex gap-1.5 border-t border-[#eee] py-2 text-xs leading-4 text-[#888]"><LockKeyhole aria-hidden="true" className="mt-0.5 size-3 shrink-0" />This task keeps its agent and history. Use a new task to switch engines.</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu key={value}>
        <DropdownMenuTrigger aria-label={`Choose model: ${current?.label ?? "unavailable"}`} title={[current?.modelId, current?.notice].filter(Boolean).join(" · ")} className={triggerClass} disabled={disabled || !engineModels.length}>
          <span className="max-w-40 truncate">{current ? modelLabel(current) : "Model unavailable"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={`${engineLabel} models`} align="end" side="top" sideOffset={8} className={`w-64 ${menuClass}`}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pb-1.5 pt-2 text-xs font-medium text-[#888]">{engineLabel}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current?.modelId ?? ""} onValueChange={(next) => {
              const model = engineModels.find((option) => option.modelId === next);
              if (!disabled && !effortLocked && model && next !== current?.modelId) onChange(model.runtime, model.modelId);
            }}>
              {engineModels.map((model) => {
                const { label, modelId, notice } = model;
                return (
                  <DropdownMenuRadioItem
                    aria-label={label} closeOnClick disabled={disabled || effortLocked}
                    key={modelId} value={modelId} title={modelId}
                    className={itemClass}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{modelLabel(model)}</span>
                      {notice ? <span className="mt-0.5 block text-xs font-normal text-[#888]">{notice}</span> : null}
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {effortLocked ? <p className="mx-2 mt-1 border-t border-[#eee] py-2 text-xs leading-4 text-[#888]">Available after queued work finishes.</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover.Root key={current?.modelId} onOpenChange={() => setDragValue(null)}>
        <Popover.Trigger aria-label={`Thinking effort: ${codingEfforts.length ? effortLabels[codingEfforts[Math.max(0, codingEfforts.indexOf(effort))]] : "Default"}`} title={codingEfforts.length ? undefined : "This model does not expose adjustable effort"} className={`${triggerClass} shrink-0`} disabled={disabled || codingEfforts.length < 2} type="button">
          <span className="whitespace-nowrap">{codingEfforts.length ? effortLabels[codingEfforts[Math.max(0, codingEfforts.indexOf(effort))]] : "Default"}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="end" side="top" sideOffset={8} className="z-50">
            <Popover.Popup className="w-[264px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#e2e2e2] bg-[#fafafa] p-3.5 text-[#171717] shadow-[0_8px_24px_rgba(0,0,0,0.1)] outline-none">
              <div className="mb-3 flex h-6 items-center gap-2">
                <Popover.Title className="flex-1 text-xs font-medium text-[#777]">Thinking</Popover.Title>
                <span className="text-xs font-medium text-[#3178ef]">{effortLabels[previewEffort]}</span>
                <button aria-label={`Reset effort to ${effortLabels[defaultEffort]}`} title={`Reset effort to ${effortLabels[defaultEffort]}`} disabled={disabled || effortLocked || effort === defaultEffort} onClick={() => changeEffort(defaultEffort)} type="button" className="grid size-6 cursor-pointer place-items-center rounded-full text-[#777] outline-none hover:bg-[#eaeaea] focus-visible:ring-2 focus-visible:ring-[#3178ef] disabled:cursor-default disabled:opacity-35"><RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.7} /></button>
              </div>
              <Slider.Root
                min={0} max={codingEfforts.length - 1} step={1} largeStep={1} value={index}
                disabled={disabled || effortLocked} thumbAlignment="edge"
                onValueChange={(next) => setDragValue(next)}
                onValueCommitted={(next) => { changeEffort(codingEfforts[next]); setDragValue(null); }}
                className="w-full data-disabled:opacity-45"
              >
                <Slider.Control className="relative flex h-7 w-full touch-none cursor-pointer items-center data-disabled:cursor-default">
                  <Slider.Track className="relative h-7 w-full rounded-full bg-[#e5e5e5]">
                    <Slider.Indicator data-slot="effort-fill" style={{ opacity: index === 0 ? 0 : 1 }} className="absolute h-full rounded-full bg-[#3c82f6]" />
                    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 inset-x-3.5 flex items-center justify-between">{codingEfforts.map((level) => <span key={level} className="size-1 rounded-full bg-[#9cb5d7]" />)}</div>
                    <Slider.Thumb getAriaLabel={() => "Thinking effort"} getAriaValueText={(_, next) => effortLabels[codingEfforts[next]]} className="top-1/2 size-7 rounded-full border border-black/5 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.14)] outline-none focus-visible:ring-2 focus-visible:ring-[#3178ef]" />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
              {effortLocked ? <Popover.Description className="mt-2 text-xs leading-4 text-[#888]">Available after queued work finishes.</Popover.Description> : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
