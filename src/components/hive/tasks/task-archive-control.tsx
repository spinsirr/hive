"use client";

import { Archive, ArchiveRestore, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TaskArchiveControl({
  title,
  archived,
  disabled = false,
  onChange,
}: {
  title: string;
  archived: boolean;
  disabled?: boolean;
  onChange: (archived: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const action = archived ? "Restore" : "Archive";
  async function confirm() {
    if (saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      await onChange(!archived);
      setOpen(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The task could not be updated. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            aria-label={`${action} task: ${title}`}
            disabled={disabled}
            className="h-8 px-2 text-xs"
            size="sm"
            variant="ghost"
            title={
              disabled
                ? "Finish the current run, queued instructions and recovery first"
                : `${action} for everyone`
            }
          />
        }
      >
        {archived ? (
          <ArchiveRestore className="size-3.5" />
        ) : (
          <Archive className="size-3.5" />
        )}
        <span className="hidden sm:inline">{action}</span>
      </DialogTrigger>
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{action} this task for everyone?</DialogTitle>
          <DialogDescription>
            {archived
              ? "Everyone in this task will be able to send messages, steer Hive and change the workspace again. Nothing runs automatically."
              : "This task moves to Archived and becomes read-only for the whole team. Messages, files and history are kept. Any task member can restore it later."}
          </DialogDescription>
        </DialogHeader>
        <p className="break-words text-sm font-medium">{title}</p>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button disabled={saving} variant="outline" />}>
            Cancel
          </DialogClose>
          <Button disabled={saving || disabled} onClick={() => void confirm()}>
            {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {saving ? "Saving…" : `${action} task`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
