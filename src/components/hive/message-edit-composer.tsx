"use client";

import { Pencil, X } from "lucide-react";
import { useState } from "react";
import { MESSAGE_BODY_LIMIT, type ChatMessage, type MessageEdit } from "@/lib/task-session";

export function MessageEditComposer({ message, queuedSteerId, disabled, onSave, onCancel }: {
  message: ChatMessage;
  queuedSteerId?: string;
  disabled: boolean;
  onSave: (edit: MessageEdit) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSave = !disabled && !saving && Boolean(body.trim()) && body.trim().length <= MESSAGE_BODY_LIMIT;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ messageId: message.id, body: body.trim(), expectedRevision: message.edits?.length ?? 0, ...(queuedSteerId ? { queuedSteerId } : {}) });
      onCancel();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save. Your edit is still here.");
    } finally { setSaving(false); }
  };

  return (
    <form aria-label="Edit message" className="shrink-0 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="overflow-hidden rounded-[22px] border border-[#d4d4d4] bg-[#fafafa] shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2 border-b border-[#e8e8e8] px-4 py-2 text-xs text-[#777]">
          <Pencil aria-hidden="true" className="size-3.5" />
          <span className="min-w-0 flex-1">{queuedSteerId ? "Editing queued message" : "Editing message"}</span>
          <button aria-label="Cancel edit" className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-[#eaeaea] focus-visible:outline-2 disabled:opacity-40" disabled={saving} onClick={onCancel} type="button"><X aria-hidden="true" className="size-3.5" /></button>
        </div>
        <textarea
          aria-label="Message text"
          autoFocus
          className="block max-h-64 min-h-24 w-full resize-y bg-transparent px-4 py-3 text-sm leading-6 outline-none disabled:opacity-60"
          disabled={disabled}
          maxLength={MESSAGE_BODY_LIMIT}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape" && !saving) { event.preventDefault(); onCancel(); }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
          }}
          readOnly={saving}
          value={body}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3">
          <p className="mr-auto basis-full px-1 pb-1 text-xs leading-5 text-[#888] sm:basis-auto sm:flex-1 sm:pb-0">{queuedSteerId ? "Updates the queued request. Keeps its place in line." : "Keeps edit history. Does not rerun Hive."}</p>
          <button className="h-8 cursor-pointer rounded-full px-3 text-xs text-[#666] hover:bg-[#eee] focus-visible:outline-2 disabled:opacity-40" disabled={saving} onClick={onCancel} type="button">Cancel</button>
          <button className="h-8 cursor-pointer rounded-full bg-[#171717] px-4 text-xs font-medium text-white hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-40" disabled={!canSave} type="submit">{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
      {error ? <p className="mt-2 px-3 text-xs text-[#a33]" role="alert">{error}</p> : null}
    </form>
  );
}
