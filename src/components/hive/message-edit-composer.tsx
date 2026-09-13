"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MESSAGE_BODY_LIMIT,
  type ChatMessage,
  type MessageEdit,
} from "@/lib/task-session";

export type MessageEditTarget = {
  message: ChatMessage;
  queuedSteerId?: string;
};

export function MessageEditComposer({
  message,
  queuedSteerId,
  disabled,
  onSave,
  onCancel,
}: {
  message: ChatMessage;
  queuedSteerId?: string;
  disabled: boolean;
  onSave: (edit: MessageEdit) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSave =
    !disabled &&
    !saving &&
    Boolean(body.trim()) &&
    body.trim().length <= MESSAGE_BODY_LIMIT;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        messageId: message.id,
        body: body.trim(),
        expectedRevision: message.edits?.length ?? 0,
        ...(queuedSteerId ? { queuedSteerId } : {}),
      });
      onCancel();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn’t save. Your edit is still here."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label="Edit message"
      id={`message-editor-${message.id}`}
      className="w-full min-w-0 rounded-xl border border-border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Pencil aria-hidden="true" className="size-3.5" />
        <span className="min-w-0 flex-1">
          {queuedSteerId ? "Editing queued message" : "Editing message"}
        </span>
      </div>
      <Textarea
        aria-label="Message text"
        autoFocus
        className="max-h-64 min-h-24 resize-y bg-background text-base leading-6 sm:text-sm"
        disabled={disabled}
        maxLength={MESSAGE_BODY_LIMIT}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
        readOnly={saving}
        value={body}
      />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto basis-full text-xs leading-5 text-muted-foreground sm:basis-auto sm:flex-1">
          {queuedSteerId
            ? "Updates the queued request. Keeps its place in line."
            : "Keeps edit history. Does not rerun Hive."}
        </p>
        <Button
          className="text-xs"
          disabled={saving}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button className="text-xs" disabled={!canSave} type="submit">
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
