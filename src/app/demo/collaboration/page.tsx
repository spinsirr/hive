import type { Metadata } from "next";
import { DemoWorkspace } from "../demo-workspace";
import { demoTasks } from "@/lib/demo/ui-demo";

export const metadata: Metadata = {
  title: "Hive — Peer programming preview",
  description:
    "Try questions, teammate replies, and shared review in a local UI simulation.",
  robots: { index: false, follow: false },
};

export default function CollaborationPreview() {
  return <DemoWorkspace task={demoTasks[0]} />;
}
