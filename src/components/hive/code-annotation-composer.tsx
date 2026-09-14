"use client";

import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { useMessageDraft } from "@/hooks/use-message-draft";
import { codeReferenceLabel, type CodeReference } from "@/lib/code-reference";
import type { MessageSubmission } from "@/lib/message-draft";
import { shouldSubmitMessage } from "@/lib/message-keyboard";

export type AnnotateCode = (
  reference: CodeReference,
  submission: MessageSubmission
) => Promise<boolean>;

export function CodeAnnotationComposer({
  reference,
  sessionId,
  memberId,
  deliveredIds,
  onSubmit,
  onClose,
}: {
  reference: CodeReference;
  sessionId: string;
  memberId: string;
  deliveredIds: ReadonlySet<string>;
  onSubmit: AnnotateCode;
  onClose: () => void;
}) {
  const send = useCallback(
    async (submission: MessageSubmission) => {
      const delivered = await onSubmit(reference, submission);
      if (delivered) onClose();
      return delivered;
    },
    [onClose, onSubmit, reference]
  );
  const { draft, edit, clear, submit } = useMessageDraft(
    `hive-draft:v1:${sessionId}:${memberId}:code:${codeReferenceLabel(reference)}`,
    deliveredIds,
    send
  );
  const sending = draft?.status === "sending";
  return (
    <form
      className="shrink-0 border-t border-[#ebebeb] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label
        className="mb-2 block truncate text-xs text-[#737373]"
        htmlFor="code-annotation"
        title={codeReferenceLabel(reference)}
      >
        {codeReferenceLabel(reference)}
      </label>
      <textarea
        aria-label="Code annotation"
        autoFocus
        className="min-h-16 w-full resize-y rounded border border-[#dedede] bg-white px-2.5 py-2 text-base leading-6 sm:text-sm outline-none placeholder:text-[#a1a1a1] focus:border-[#737373]"
        disabled={!draft || sending}
        id="code-annotation"
        maxLength={500}
        onChange={(event) => edit(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            shouldSubmitMessage(event)
          ) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Leave a comment for the team…"
        value={draft?.body ?? ""}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-[#737373]" role="status">
          {draft?.status === "unconfirmed"
            ? "Not confirmed. Retry keeps the same annotation."
            : "Share first. Steer Hive from the conversation."}
        </p>
        <div className="flex shrink-0 gap-1">
          <Button
            className="h-7 text-xs"
            disabled={sending}
            onClick={() => {
              clear();
              onClose();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="h-7 text-xs"
            disabled={!draft?.body.trim() || sending}
            size="sm"
            type="submit"
          >
            {sending
              ? "Sharing…"
              : draft?.status === "unconfirmed"
                ? "Retry"
                : "Share annotation"}
          </Button>
        </div>
      </div>
    </form>
  );
}
