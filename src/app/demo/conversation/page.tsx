import type { Metadata } from "next";
import { DemoWorkspace } from "../demo-workspace";
import { demoTasks } from "@/lib/ui-demo";

export const metadata: Metadata = {
  title: "Hive — Conversation UI preview",
  description:
    "Try Hive's conversation controls with sample data. No model calls or repository changes.",
  robots: { index: false, follow: false },
};

export default function ConversationPreview() {
  return <DemoWorkspace task={demoTasks[1]} />;
}
