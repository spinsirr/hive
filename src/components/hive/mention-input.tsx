"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

import { shouldSubmitMessage } from "@/lib/message-keyboard";
import type { TeamMember } from "@/lib/task-session";
import { activeTeammateMention, insertTeammateMention, matchingTeammates, teammateMentionHandle } from "@/lib/teammate-mention";

export function MentionInput({ value, onChange, onSubmit, members, currentMember, disabled, readOnly, label = "Ask Hive or mention a teammate", placeholder, maxLength, autoFocus = false, className }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  members: TeamMember[];
  currentMember: string;
  disabled: boolean;
  readOnly: boolean;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const initiallyFocused = useRef(false);
  useEffect(() => {
    if (autoFocus && !disabled && !initiallyFocused.current) {
      textarea.current?.focus();
      initiallyFocused.current = true;
    }
  }, [autoFocus, disabled]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mention = activeTeammateMention(value, selection.start, selection.end);
  const suggestions = matchingTeammates(members, currentMember, mention?.query ?? "");
  const open = focused && !disabled && !readOnly && !composing && !dismissed && mention !== null;

  return (
    <Autocomplete.Root
      autoHighlight="always"
      disabled={disabled}
      filter={null}
      itemToStringValue={teammateMentionHandle}
      items={suggestions}
      mode="none"
      onOpenChange={(nextOpen) => { if (!nextOpen) setDismissed(true); }}
      onValueChange={(nextValue, details) => {
        if (details.reason === "item-press" && mention) {
          const next = insertTeammateMention(value, mention, nextValue);
          onChange(next.body);
          setDismissed(true);
          requestAnimationFrame(() => {
            textarea.current?.focus();
            textarea.current?.setSelectionRange(next.caret, next.caret);
          });
          return;
        }
        onChange(nextValue);
        setDismissed(false);
        const input = textarea.current;
        if (input) setSelection({ start: input.selectionStart, end: input.selectionEnd });
      }}
      open={open}
      readOnly={readOnly}
      value={value}
    >
      <Autocomplete.Input
        aria-label={label}
        aria-multiline="true"
        className={cn("field-sizing-content max-h-[min(12rem,30dvh)] min-h-[5.25rem] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 outline-none placeholder:text-[#999] sm:text-sm", className)}
        onBlur={() => setFocused(false)}
        onCompositionEnd={() => setComposing(false)}
        onCompositionStart={() => setComposing(true)}
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onKeyDown={(event) => {
          if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
            event.preventBaseUIHandler();
            return;
          }
          if (event.key === "Escape") {
            event.preventBaseUIHandler();
            if (open) {
              event.preventDefault();
              setDismissed(true);
            }
            return;
          }
          if (event.key === "Enter" && event.shiftKey) {
            event.preventBaseUIHandler();
            return;
          }
          if (open && event.key === "Enter") {
            // Selecting a teammate never submits the conversation message.
            if (suggestions.length === 0) {
              event.preventDefault();
              event.preventBaseUIHandler();
            }
            return;
          }
          if (shouldSubmitMessage(event)) {
            event.preventDefault();
            event.preventBaseUIHandler();
            onSubmit();
          }
        }}
        onSelect={(event) => setSelection({ start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 })}
        placeholder={placeholder ?? (disabled ? "Messaging is paused." : "Ask Hive or @mention a teammate…")}
        maxLength={maxLength}
        render={<textarea ref={textarea} rows={3} />}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner align="start" className="z-50" side="top" sideOffset={10}>
          <Autocomplete.Popup className="w-72 max-w-[var(--available-width)] overflow-hidden rounded-lg border border-[#dedede] bg-white p-1 shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
            <Autocomplete.Empty>
              <p className="px-3 py-3 text-xs text-[#737373]">{members.some((member) => member.id !== currentMember) ? "No matching teammates" : "Invite a teammate to mention them"}</p>
            </Autocomplete.Empty>
            <Autocomplete.List aria-label="Mention a teammate" className="max-h-52 overflow-y-auto">
              {(member: TeamMember) => (
                <Autocomplete.Item className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-highlighted:bg-[#f2f2f2]" key={member.id} value={member}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[#dedede] bg-[#fafafa] text-xs font-medium">{member.initials}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-[#171717]">{member.name}</span>
                    <span className="block truncate text-xs text-[#737373]">@{teammateMentionHandle(member)}</span>
                  </span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
