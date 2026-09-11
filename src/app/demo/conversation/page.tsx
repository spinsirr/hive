import type { Metadata } from "next";
import { ConversationDemo } from "./conversation-demo";

export const metadata: Metadata = {
  title: "Hive — Conversation UI preview",
  description: "Try Hive's conversation controls with sample data. No model calls or repository changes.",
  robots: { index: false, follow: false },
};

export default function ConversationPreview() { return <ConversationDemo />; }
