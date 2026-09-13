"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/task-session";

export type WorkspaceTab = "diff" | "files" | "runs" | "checkpoints";
type DetailView =
  { kind: "workspace" } | { kind: "thread" | "review"; messageId: string };
type Navigation = {
  pane: "chat" | "workspace";
  tab: WorkspaceTab;
  detail: DetailView;
};
const initial: Navigation = {
  pane: "chat",
  tab: "diff",
  detail: { kind: "workspace" },
};

/** Mobile pane selection and the desktop detail destination change atomically. */
export function useWorkspaceNavigation(messages: ChatMessage[]) {
  const [navigation, setNavigation] = useState<Navigation>(initial);
  const trigger = useRef<HTMLElement | null>(null);
  const backToReviewRef = useRef<HTMLButtonElement>(null);
  const visibleThreadRef = useRef<string | null>(null);
  const { pane, tab, detail } = navigation;
  const selected =
    detail.kind === "workspace"
      ? undefined
      : messages.find((message) => message.id === detail.messageId);
  const reviewContext =
    detail.kind === "review" && selected?.interaction?.kind === "review"
      ? selected
      : undefined;
  const threadMessage = detail.kind === "thread" ? selected : undefined;
  const selectedThreadId = threadMessage?.id ?? null;
  useEffect(() => {
    visibleThreadRef.current = pane === "workspace" ? selectedThreadId : null;
  }, [pane, selectedThreadId]);
  useEffect(() => {
    if (detail.kind === "review") backToReviewRef.current?.focus();
  }, [detail]);
  const setTab = useCallback(
    (tab: WorkspaceTab) => setNavigation((current) => ({ ...current, tab })),
    []
  );
  const showConversation = useCallback(
    () => setNavigation((current) => ({ ...current, pane: "chat" })),
    []
  );
  const showWorkspace = useCallback(
    () => setNavigation((current) => ({ ...current, pane: "workspace" })),
    []
  );
  const openThread = useCallback((messageId: string) => {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setNavigation((current) => ({
      ...current,
      pane: "workspace",
      detail: { kind: "thread", messageId },
    }));
  }, []);
  const closeThread = useCallback(() => {
    const messageId = detail.kind === "workspace" ? null : detail.messageId;
    setNavigation((current) => ({
      ...current,
      pane: "chat",
      detail: { kind: "workspace" },
    }));
    requestAnimationFrame(() => {
      const target = trigger.current?.isConnected
        ? trigger.current
        : Array.from(
            document.querySelectorAll<HTMLElement>("[data-thread-trigger]")
          ).find((element) => element.dataset.threadTrigger === messageId);
      target?.focus();
    });
  }, [detail]);
  const openQuestion = useCallback(
    (message: ChatMessage) => {
      if (message.threadId) openThread(message.threadId);
      else
        setNavigation((current) => ({
          ...current,
          pane: "chat",
          detail: { kind: "workspace" },
        }));
      requestAnimationFrame(() => {
        const target = Array.from(
          document.querySelectorAll<HTMLElement>("[data-message-id]")
        ).find((element) => element.dataset.messageId === message.id);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "center", behavior: "instant" });
      });
    },
    [openThread]
  );
  const viewChanges = useCallback(
    () =>
      setNavigation((current) =>
        current.detail.kind === "thread"
          ? {
              pane: "workspace",
              tab: "diff",
              detail: { kind: "review", messageId: current.detail.messageId },
            }
          : current
      ),
    []
  );
  const backToReview = useCallback(
    () =>
      setNavigation((current) =>
        current.detail.kind === "review"
          ? {
              ...current,
              pane: "workspace",
              detail: { kind: "thread", messageId: current.detail.messageId },
            }
          : current
      ),
    []
  );
  const openCheckpoints = useCallback(
    () =>
      setNavigation({
        pane: "workspace",
        tab: "checkpoints",
        detail: { kind: "workspace" },
      }),
    []
  );
  const resetNavigation = useCallback(() => setNavigation(initial), []);
  return {
    pane,
    tab,
    setTab,
    showConversation,
    showWorkspace,
    threadMessage,
    selectedThreadId,
    reviewContext,
    openThread,
    closeThread,
    openQuestion,
    viewChanges,
    backToReview,
    openCheckpoints,
    resetNavigation,
    visibleThreadRef,
    backToReviewRef,
  };
}
