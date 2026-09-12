"use client";

import { useState } from "react";
import Link from "next/link";
import { TaskDashboard } from "@/components/hive/task-dashboard";
import { Button, buttonVariants } from "@/components/ui/button";
import { demoLoadedAt, demoTaskHref, demoTasks, newDemoTask } from "@/lib/ui-demo";

export function DashboardDemo() {
  const [tasks, setTasks] = useState(demoTasks);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  async function createAction(formData: FormData) {
    const task = newDemoTask(String(formData.get("title") ?? ""), crypto.randomUUID());
    if (!task) return;
    setTasks((current) => [task, ...current]);
    setNotice(`“${task.title}” added in this demo only.`);
  }

  function showScenario(empty: boolean) {
    setTasks(empty ? [] : demoTasks);
    setNotice(empty ? "Showing an empty dashboard." : "Sample tasks restored.");
    setRevision((value) => value + 1);
  }

  return (
    <>
      <aside aria-label="UI demo controls" className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-[#e8e8e8] bg-[#f4f4f4] px-5 py-2 text-xs text-[#737373] sm:px-8">
        <p><span className="font-medium text-[#171717]">UI demo</span><span className="mx-2" aria-hidden="true">·</span>Sample data. No connected repository or agent.</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button className="h-7 px-2 text-xs" onClick={() => showScenario(true)} variant="ghost">Empty state</Button>
          <Button className="h-7 px-2 text-xs" onClick={() => showScenario(false)} variant="ghost">Reset demo</Button>
          <Link className={buttonVariants({ variant: "outline", size: "sm", className: "ml-2 text-xs" })} href="/" prefetch={false}>Open Hive</Link>
        </div>
      </aside>
      <TaskDashboard
        createAction={createAction}
        homeHref="/demo"
        key={revision}
        loadedAt={demoLoadedAt}
        memberInitials="AL"
        memberName="Alex · Demo team"
        previewTaskHref={demoTaskHref}
        tasks={tasks}
      />
      <p className="sr-only" role="status">{notice}</p>
    </>
  );
}
