"use client";

import { ArrowRight, FolderGit2, Users } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { CreateSessionButton } from "@/components/hive/tasks/create-session-button";
import { TaskArchiveControl } from "@/components/hive/tasks/task-archive-control";
import { useHiveClient } from "@/components/hive/hive-client";
import { Button } from "@/components/ui/button";
import {
  dashboardTasks,
  taskUpdatedLabel,
  type DashboardTask,
} from "@/lib/tasks/task-dashboard";
import { taskTitleLabel } from "@/lib/tasks/task-title";

function NewTask({
  createAction,
}: {
  createAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={createAction}>
      <CreateSessionButton />
    </form>
  );
}

export function TaskDashboard({
  tasks,
  memberName,
  memberInitials,
  loadedAt,
  createAction,
  homeHref = "/",
  previewTaskHref,
  onArchiveTask,
}: {
  tasks: DashboardTask[];
  memberName: string;
  memberInitials: string;
  loadedAt: number;
  createAction: (formData: FormData) => Promise<void>;
  homeHref?: string;
  previewTaskHref?: (task: DashboardTask) => string;
  onArchiveTask?: (id: string, archived: boolean) => Promise<void>;
}) {
  const client = useHiveClient();
  const [showArchived, setShowArchived] = useState(false);
  const [updates, setUpdates] = useState<
    Record<string, Pick<DashboardTask, "archivedAt" | "updatedAt">>
  >({});
  const [notice, setNotice] = useState("");
  const filterRef = useRef<HTMLButtonElement>(null);
  const all = dashboardTasks(
    tasks.map((task) =>
      task.id in updates ? { ...task, ...updates[task.id] } : task
    )
  );
  const archivedCount = all.filter((task) => Boolean(task.archivedAt)).length;
  const visible = all.filter(
    (task) => Boolean(task.archivedAt) === showArchived
  );
  async function changeArchive(task: DashboardTask, archived: boolean) {
    let update = {
      archivedAt: archived ? loadedAt : null,
      updatedAt: loadedAt,
    };
    if (onArchiveTask) await onArchiveTask(task.id, archived);
    else {
      const response = await client.request(
        `/api/sessions/${encodeURIComponent(task.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: archived ? "archive-task" : "restore-task",
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error || "Could not update this task. Try again."
        );
      if (Boolean(payload.session?.archived) !== archived)
        throw new Error(
          "The task could not be updated. Refresh and try again."
        );
      update = {
        archivedAt: payload.session.archived?.at ?? null,
        updatedAt: payload.session.updatedAt,
      };
    }
    setUpdates((current) => ({ ...current, [task.id]: update }));
    setNotice(
      `${taskTitleLabel(task.title)} ${archived ? "archived for everyone" : "restored"}.`
    );
    filterRef.current?.focus();
  }

  return (
    <main className="min-h-dvh bg-[#fafafa] text-[#171717]">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-[#e8e8e8] bg-white px-5 sm:px-8">
        <Link
          aria-label="Hive home"
          className="flex items-center gap-2.5"
          href={homeHref}
        >
          <span className="grid size-7 place-items-center rounded-md bg-[#171717] text-white">
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 3.5 15 5.25v3.5l-3 1.75-3-1.75v-3.5L12 3.5ZM8 11l3 1.75v3.5L8 18l-3-1.75v-3.5L8 11Zm8 0 3 1.75v3.5L16 18l-3-1.75v-3.5L16 11Z"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth="1.45"
              />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-[-0.03em]">Hive</span>
        </Link>
        <div className="flex min-w-0 items-center gap-2 text-xs text-[#737373]">
          <span className="truncate">{memberName}</span>
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full border border-[#dedede] text-xs font-medium text-[#333]"
          >
            {memberInitials}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em]">
              {previewTaskHref ? "Sample tasks" : "Tasks"}
            </h1>
            <p className="mt-1.5 text-sm text-[#737373]">
              {previewTaskHref
                ? "Open a sample task to try Hive. No live agents or repository changes."
                : "Your shared work with Hive."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!previewTaskHref ? (
              <Link
                className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-[#737373] transition hover:bg-[#eeeeee] hover:text-[#171717] focus-visible:outline-2 focus-visible:outline-offset-2"
                href="/demo"
                prefetch={false}
              >
                <Users aria-hidden="true" className="size-3.5" /> Explore demo
              </Link>
            ) : null}
            <NewTask createAction={createAction} />
          </div>
        </div>

        <div
          aria-label="Task status"
          className="mb-4 flex items-center gap-2"
          role="group"
        >
          {[false, true].map((archived) => (
            <Button
              key={String(archived)}
              ref={archived === showArchived ? filterRef : undefined}
              aria-pressed={archived === showArchived}
              className="gap-2 text-xs"
              onClick={() => setShowArchived(archived)}
              variant={archived === showArchived ? "secondary" : "ghost"}
            >
              {archived ? "Archived" : "Active"}{" "}
              <span className="text-muted-foreground">
                {archived ? archivedCount : all.length - archivedCount}
              </span>
            </Button>
          ))}
        </div>
        <p className="sr-only" role="status">
          {notice}
        </p>
        <section
          aria-label="Task list"
          className="overflow-hidden rounded-lg border border-[#e1e1e1] bg-white"
        >
          <div
            aria-hidden="true"
            className="grid grid-cols-[minmax(0,1fr)_60px_40px] gap-2 border-b border-[#ebebeb] bg-[#fcfcfc] px-4 py-3 text-xs text-[#888] sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_80px_16px_90px] sm:gap-4 sm:px-5"
          >
            <span>Task</span>
            <span className="hidden sm:block">Repository</span>
            <span>Updated</span>
          </div>
          {visible.length > 0 ? (
            <ul className="divide-y divide-[#eeeeee]">
              {visible.map((task) => {
                const title = taskTitleLabel(task.title);
                const rowClassName =
                  "group grid min-h-20 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_60px] items-center gap-2 py-4 pl-4 text-left transition-colors hover:bg-[#fafafa] focus-visible:bg-[#fafafa] focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_80px_16px] sm:gap-4 sm:pl-5";
                const content = (
                  <>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium tracking-[-0.015em]">
                        <span className="truncate" title={title}>
                          {title}
                        </span>
                        {previewTaskHref ? (
                          <span className="shrink-0 rounded bg-[#f2f2f2] px-1.5 py-0.5 text-xs font-normal tracking-normal text-[#737373]">
                            Demo
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 truncate text-xs text-[#888] sm:hidden">
                        {task.repositoryName ?? "No repository attached"}
                      </p>
                    </div>
                    <span className="hidden min-w-0 items-center gap-1.5 text-xs text-[#737373] sm:flex">
                      <FolderGit2
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                      />
                      <span className="truncate">
                        {task.repositoryName ?? "Not attached"}
                      </span>
                    </span>
                    <time
                      className="text-xs text-[#888]"
                      dateTime={new Date(task.updatedAt).toISOString()}
                    >
                      {taskUpdatedLabel(task.updatedAt, loadedAt)}
                    </time>
                    <ArrowRight
                      aria-hidden="true"
                      className="hidden size-3.5 text-[#aaa] group-hover:text-[#171717] sm:block"
                    />
                  </>
                );
                return (
                  <li
                    className="flex items-center gap-2 pr-4 sm:gap-4 sm:pr-5"
                    key={task.id}
                  >
                    <Link
                      aria-label={
                        previewTaskHref
                          ? `Open sample task: ${title}`
                          : undefined
                      }
                      className={rowClassName}
                      href={
                        previewTaskHref
                          ? previewTaskHref(task)
                          : `/sessions/${task.id}`
                      }
                      prefetch={previewTaskHref ? false : undefined}
                    >
                      {content}
                    </Link>
                    <div className="flex w-10 shrink-0 justify-end sm:w-[90px]">
                      <TaskArchiveControl
                        title={title}
                        archived={Boolean(task.archivedAt)}
                        onChange={(archived) => changeArchive(task, archived)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="grid min-h-60 place-items-center px-6 py-10 text-center">
              <div>
                <p className="text-sm font-medium">
                  {showArchived
                    ? "No archived tasks"
                    : "Start your first shared task"}
                </p>
                <p className="mt-2 max-w-xs text-xs leading-5 text-[#888]">
                  {showArchived
                    ? "Archived tasks stay here for the whole team. Restore one whenever you’re ready to continue."
                    : "Create a task, then invite a teammate to work with Hive."}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
