"use client";

import { type ReactNode, useSyncExternalStore } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import styles from "./workspace-split.module.css";

// Keep this breakpoint in sync with the conversation/workspace tabs and CSS.
const desktopQuery = "(min-width: 960px)";

function subscribeToViewport(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const isDesktopViewport = () => window.matchMedia(desktopQuery).matches;
const serverViewport = () => false;

export function WorkspaceSplit({
  conversation,
  workspace,
  activePane,
}: {
  conversation: ReactNode;
  workspace: ReactNode;
  activePane: "chat" | "workspace";
}) {
  const desktop = useSyncExternalStore(subscribeToViewport, isDesktopViewport, serverViewport);

  return (
    <ResizablePanelGroup
      className={`${styles.split} min-h-0 flex-1`}
      data-active-pane={activePane}
      disabled={!desktop}
      orientation="horizontal"
      resizeTargetMinimumSize={{ fine: 12, coarse: 24 }}
    >
      <ResizablePanel
        className="h-full min-h-0 min-w-0 overflow-hidden!"
        data-pane="chat"
        defaultSize="50%"
        minSize={desktop ? 400 : 0}
        groupResizeBehavior="preserve-relative-size"
      >
        {conversation}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize conversation and workspace"
        title="Drag to resize · Double-click to reset"
        className="hidden bg-[#ebebeb] min-[960px]:block"
        disabled={!desktop}
      />
      <ResizablePanel
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden!"
        data-pane="workspace"
        minSize={desktop ? 400 : 0}
      >
        {workspace}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
