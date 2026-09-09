import type { DashboardTask } from "./task-dashboard.ts";

// Fixed, invented fixtures. This module has no dependency on task storage,
// authentication, repositories, or the agent runtime.
export const demoLoadedAt = Date.UTC(2026, 8, 7, 12);

export const demoTasks: DashboardTask[] = [
  { id: "demo-menu", title: "Polish the settings menu", repositoryName: "sample-team/website", updatedAt: demoLoadedAt - 3 * 60_000 },
  { id: "demo-thread", title: "Make thread replies easier to follow", repositoryName: "sample-team/app", updatedAt: demoLoadedAt - 2 * 3_600_000 },
  { id: "demo-onboarding", title: "Work through the onboarding flow", repositoryName: null, updatedAt: demoLoadedAt - 86_400_000 },
  { id: "demo-focus", title: "Fix keyboard focus states", repositoryName: "sample-team/website", updatedAt: demoLoadedAt - 2 * 86_400_000 },
];

export function newDemoTask(title: string, id: string): DashboardTask | null {
  const name = title.trim();
  if (!name || name.length > 120) return null;
  return { id: `demo-${id}`, title: name, repositoryName: null, updatedAt: demoLoadedAt };
}
