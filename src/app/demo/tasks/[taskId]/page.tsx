import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoWorkspace } from "../../demo-workspace";
import { demoLoadedAt, findDemoTask } from "@/lib/ui-demo";

export const metadata: Metadata = {
  title: "Hive — Sample task",
  description: "Explore a sample task with teammates, threads, and shared review. No live agents or repository changes.",
  robots: { index: false, follow: false },
};

export default async function DemoTaskPage({ params, searchParams }: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ title?: string | string[]; archived?: string | string[] }>;
}) {
  const { taskId } = await params;
  const query = await searchParams;
  const title = taskId === "new" ? query.title : undefined;
  const task = findDemoTask(taskId, typeof title === "string" ? title : undefined);
  if (!task) notFound();
  const sample = { ...task, archivedAt: query.archived === "1" ? demoLoadedAt : null };
  return <DemoWorkspace key={`${task.id}:${task.title}:${sample.archivedAt}`} task={sample} />;
}
