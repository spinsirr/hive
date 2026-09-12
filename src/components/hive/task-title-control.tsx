"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { normalizeTaskTitle, TASK_TITLE_LIMIT, taskTitleLabel } from "@/lib/task-title";

export function TaskTitleControl({ title, disabled, onRename }: {
  title: string;
  disabled: boolean;
  onRename: (title: string) => Promise<void>;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const label = taskTitleLabel(title);
  return <Dialog open={open} onOpenChange={(next) => {
    if (saving) return;
    if (next) { setDraft(title); setError(""); }
    setOpen(next);
  }}>
    <DialogTrigger disabled={disabled} render={<button type="button" className="group flex max-w-full items-center gap-1.5 rounded-sm text-left text-xs font-medium text-[#3d3d3d] outline-offset-4 enabled:hover:text-foreground focus-visible:outline-2" />} aria-label={`Rename task: ${label}`} title={disabled ? label : "Rename task"}>
      <span className="truncate">{label}</span>
      {!disabled ? <Pencil aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" /> : null}
    </DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <form onSubmit={async (event) => {
        event.preventDefault();
        const next = normalizeTaskTitle(draft);
        if (!next || saving || disabled) return;
        setSaving(true);
        setError("");
        try { await onRename(next); setOpen(false); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "Could not rename this task. Try again."); }
        finally { setSaving(false); }
      }}>
        <DialogHeader>
          <DialogTitle>Rename task</DialogTitle>
          <DialogDescription>Change the name for everyone. The task link and conversation stay the same.</DialogDescription>
        </DialogHeader>
        <div className="py-5">
          <label className="mb-2 block text-xs font-medium" htmlFor={inputId}>Task name</label>
          <input id={inputId} autoFocus autoComplete="off" className="h-10 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 sm:text-sm" maxLength={TASK_TITLE_LIMIT} required value={draft} disabled={saving || disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
          }} />
          {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose disabled={saving} render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={saving || disabled || !normalizeTaskTitle(draft)}>
            {saving ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}{saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
