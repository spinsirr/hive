import type { Metadata } from "next";
import { CollaborationDemo } from "./collaboration-demo";

export const metadata: Metadata = {
  title: "Hive — Peer programming preview",
  description: "Try questions, teammate replies, and shared review in a local UI simulation.",
  robots: { index: false, follow: false },
};

export default function CollaborationPreview() {
  return <CollaborationDemo />;
}
