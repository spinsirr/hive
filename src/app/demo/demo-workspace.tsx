"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { HiveWorkspaceView } from "@/components/hive/hive-workspace";
import { HiveClientContext } from "@/components/hive/hive-client";
import { Button } from "@/components/ui/button";
import { createDemoWorkspace, demoMembers } from "@/lib/demo-workspace";
import type { DashboardTask } from "@/lib/task-dashboard";

export function DemoWorkspace({ task }: { task: DashboardTask }) {
  const [demo] = useState(() => createDemoWorkspace(task));
  const snapshot = useSyncExternalStore(demo.subscribe, demo.getSnapshot, demo.getSnapshot);
  const [member, setMember] = useState(demoMembers[0]);
  const runId = snapshot.session.workspace.liveReply?.id;
  useEffect(() => {
    if (!runId) return;
    const timer = setTimeout(() => demo.finishRun(runId), 900);
    return () => clearTimeout(timer);
  }, [demo, runId]);
  const chooseMember = useCallback((id: string) => {
    demo.setMember(id);
    setMember(demoMembers.find((candidate) => candidate.id === id)!);
  }, [demo]);
  return <HiveClientContext value={demo.client}>
    <HiveWorkspaceView
      currentMember={member}
      sessionId={snapshot.session.sessionId}
      sessionTitle={task.title}
      inviteToken=""
      homeHref="/demo"
      connectionLabel="Demo"
      accountActionsDisabled
      connection={{ snapshot, dispatch: demo.dispatch, receiveSnapshot: demo.receiveSnapshot, setTyping: demo.setTyping, syncing: false, syncError: false }}
      notice={<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground" aria-label="Demo controls">
        <span>Demo · Sample data and simulated results · No model calls</span>
        <div className="flex items-center gap-1">
          <span className="mr-1">You are</span>
          {demoMembers.map((candidate) => <Button key={candidate.id} aria-pressed={candidate.id === member.id} className="h-7 px-2 text-xs" onClick={() => chooseMember(candidate.id)} size="sm" variant={candidate.id === member.id ? "secondary" : "ghost"}>{candidate.shortName}</Button>)}
          <Button className="h-7 px-2 text-xs" onClick={demo.restart} size="sm" variant="ghost">Restart demo</Button>
        </div>
      </div>}
    />
  </HiveClientContext>;
}
