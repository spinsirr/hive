import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CollaborationDemo } from "../../collaboration/collaboration-demo";
import { ConversationDemo } from "../../conversation/conversation-demo";
import { demoTaskMessages } from "@/lib/demo-task-conversation";
import { findDemoTask } from "@/lib/ui-demo";

export const metadata: Metadata = {
  title: "Hive — Sample task",
  description: "Explore a sample task with teammates, threads, and shared review. No live agents or repository changes.",
  robots: { index: false, follow: false },
};

export default async function DemoTaskPage({ params, searchParams }: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ title?: string | string[] }>;
}) {
  const { taskId } = await params;
  const title = taskId === "new" ? (await searchParams).title : undefined;
  const task = findDemoTask(taskId, typeof title === "string" ? title : undefined);
  if (!task) notFound();
  const messages = demoTaskMessages(task);

  if (task.id === "demo-menu" || task.id === "demo-focus") {
    return <CollaborationDemo key={task.id} title={task.title} repositoryName={task.repositoryName ?? "No repository attached"} initialRequest={messages[0].body} />;
  }
  return <ConversationDemo key={`${task.id}:${task.title}`} title={task.title} repositoryName={task.repositoryName} initialMessages={messages} />;
}
