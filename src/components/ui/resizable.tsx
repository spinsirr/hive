"use client";

import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel(props: ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative z-10 w-px bg-border outline-none after:absolute after:inset-y-0 after:-left-1 after:w-[9px] data-[separator=hover]:bg-[#a1a1a1] data-[separator=active]:bg-[#737373] focus-visible:bg-[#737373] focus-visible:ring-2 focus-visible:ring-[#737373]/40",
        className
      )}
      {...props}
    />
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
