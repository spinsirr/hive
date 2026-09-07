export type DashboardTask = {
  id: string;
  title: string;
  lifecycle: "active" | "completed";
  repositoryName: string | null;
  updatedAt: number;
};

export function dashboardTasks(tasks: DashboardTask[], lifecycle: DashboardTask["lifecycle"]) {
  return tasks.filter((task) => task.lifecycle === lifecycle).sort((a, b) => b.updatedAt - a.updatedAt);
}

// Use the server's load time on both sides of hydration. This is a snapshot,
// not a presence indicator or a promise that the dashboard updates live.
export function taskUpdatedLabel(timestamp: number, loadedAt: number) {
  const minutes = Math.max(0, Math.floor((loadedAt - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
