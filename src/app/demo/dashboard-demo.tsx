"use client";

import { useState } from "react";
import { TaskDashboard } from "@/components/hive/task-dashboard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DashboardTask } from "@/lib/task-dashboard";
import { demoLoadedAt, demoTasks, newDemoTask } from "@/lib/ui-demo";

export function DashboardDemo() {
  const [tasks, setTasks] = useState(demoTasks);
  const [selectedTask, setSelectedTask] = useState<DashboardTask | null>(null);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [taskTrigger, setTaskTrigger] = useState<HTMLElement | null>(null);

  async function createAction(formData: FormData) {
    const task = newDemoTask(String(formData.get("title") ?? ""), crypto.randomUUID());
    if (!task) return;
    setTasks((current) => [task, ...current]);
    setNotice(`“${task.title}” added to Active in this demo only.`);
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
        <div className="flex gap-1">
          <Button className="h-7 px-2 text-xs" onClick={() => showScenario(true)} variant="ghost">Empty state</Button>
          <Button className="h-7 px-2 text-xs" onClick={() => showScenario(false)} variant="ghost">Reset demo</Button>
        </div>
      </aside>
      <TaskDashboard
        createAction={createAction}
        homeHref="/demo"
        key={revision}
        loadedAt={demoLoadedAt}
        memberInitials="AL"
        memberName="Alex · Demo team"
        onOpenTask={(task) => {
          setTaskTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
          setSelectedTask(task);
        }}
        tasks={tasks}
      />
      <p className="sr-only" role="status">{notice}</p>
      <Dialog onOpenChange={(open) => { if (!open) setSelectedTask(null); }} open={selectedTask !== null}>
        <DialogContent finalFocus={() => taskTrigger}>
          <DialogHeader>
            <DialogTitle>{selectedTask?.title}</DialogTitle>
            <DialogDescription>Sample task · Dashboard preview</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 py-2 text-xs">
            <dt className="text-[#737373]">Status</dt><dd className="capitalize">{selectedTask?.lifecycle}</dd>
            <dt className="text-[#737373]">Repository</dt><dd>{selectedTask?.repositoryName ?? "Not attached"}</dd>
          </dl>
          <p className="text-xs leading-5 text-[#737373]">This demo covers the dashboard. Task conversations and workspaces belong to the connected app; opening this preview does not start Hive. Demo changes reset on refresh.</p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Back to tasks</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
