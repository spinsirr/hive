import type { ChatMessage } from "./task-session.ts";
import type { DashboardTask } from "./task-dashboard.ts";

// Invented conversations for public demos, never fetched from real task storage.
const scenarios: Record<string, { request: string; response: string; reply: string; question: string; options: string[] }> = {
  "demo-menu": {
    request: "Make the Settings menu more predictable. Casey, could you review the interaction as Hive works?",
    response: "We can keep the active page distinct from hover and preserve your place in the menu.",
    reply: "Keep keyboard focus visible, too.",
    question: "Should the Settings section remain open after navigation?",
    options: ["Keep it open", "Close after navigation"],
  },
  "demo-thread": {
    request: "Make thread replies easier to follow without interrupting the main conversation.",
    response: "This sample keeps replies under their original message, with each author's name. Open the thread below to add a reply or try sharing the discussion with Hive.",
    reply: "Show a short reply preview under the original message so teammates can follow along.",
    question: "How much of the thread should appear in the main conversation?",
    options: ["Show the latest reply", "Show all replies"],
  },
  "demo-onboarding": {
    request: "Let's work through onboarding before attaching a repository. Where should our team start?",
    response: "Start with a shared outcome, invite a teammate, and agree on the first change. A repository can come later. This sample has no connected repository.",
    reply: "Let people explore the task together before asking them to connect GitHub.",
    question: "What should a new teammate see first?",
    options: ["The shared conversation", "A short getting-started checklist"],
  },
  "demo-focus": {
    request: "Fix keyboard focus states in the Settings navigation. Casey, review the selected page and focus ring as Hive works.",
    response: "Let's check navigation behavior and visible keyboard focus together.",
    reply: "The selected page still needs a visible focus ring when tabbing.",
    question: "Should the Settings section remain open after navigation?",
    options: ["Keep it open", "Close after navigation"],
  },
};

export function demoTaskMessages(task: DashboardTask): ChatMessage[] {
  const sample = scenarios[task.id] ?? {
    request: task.title,
    response: "This is your sample task. Try sending a message or opening a thread; everything stays in this preview and resets on refresh. No agent is running.",
    reply: "Let's agree on the outcome before connecting a repository.",
    question: "What would you like to explore first?",
    options: ["Plan the task", "Discuss with a teammate"],
  };
  return [
    { id: "request", role: "human", memberId: "demo-alex", name: "Alex", initials: "AL", time: "10:42 AM", body: sample.request },
    { id: "answer", role: "agent", name: "Hive", initials: "H", time: "10:42 AM", body: sample.response, annotations: [{ id: "reply", authorId: "demo-casey", body: sample.reply, createdAt: 1789054920000, status: "open" }] },
    { id: "sample-question", role: "agent", name: "Hive", initials: "H", time: "10:43 AM", body: sample.question, interaction: { kind: "question", runId: "preview-run", targetMemberId: "demo-alex", options: sample.options } },
  ];
}
