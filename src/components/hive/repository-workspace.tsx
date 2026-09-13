"use client";
import {
  Code2,
  FileCode2,
  FolderGit2,
  History,
  ListChecks,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useHiveClient } from "@/components/hive/hive-client";
import { DiffPane } from "@/components/hive/diff-pane";
import { WorkspaceFiles } from "@/components/hive/workspace-files";
import { WorkspaceCheckpoints } from "@/components/hive/workspace-checkpoints";
import { RunsPane } from "@/components/hive/workspace-runs";
import type { AnnotateCode } from "@/components/hive/code-annotation-composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type WorkspaceRecoveryStatus } from "@/hooks/use-workspace-recovery";
import { workspaceReadRevision } from "@/lib/workspace-files";
import { type RepositoryState, type WorkspaceState } from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-contract";
import { cn } from "@/lib/utils";
import { type WorkspaceTab } from "@/hooks/use-workspace-navigation";

type RepositoryOption = {
  id: number;
  name: string;
  defaultBranch: string;
  visibility: "private" | "public";
};

const tabs: Array<{ key: WorkspaceTab; label: string; icon: typeof Code2 }> = [
  { key: "diff", label: "Diff", icon: Code2 },
  { key: "files", label: "Files", icon: FileCode2 },
  { key: "runs", label: "Runs", icon: ListChecks },
  { key: "checkpoints", label: "Checkpoints", icon: History },
];

function RepositorySetup({
  sessionId,
  disabled,
}: {
  sessionId: string;
  disabled: boolean;
}) {
  const client = useHiveClient();
  const [repositories, setRepositories] = useState<RepositoryOption[] | null>(
    null
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectingId, setConnectingId] = useState<number | null>(null);
  const [needsInstallation, setNeedsInstallation] = useState(false);
  const [needsAuthorization, setNeedsAuthorization] = useState(false);
  const [error, setError] = useState("");
  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return repositories ?? [];
    return (repositories ?? []).filter((candidate) =>
      candidate.name.toLowerCase().includes(normalizedQuery)
    );
  }, [query, repositories]);

  const loadRepositories = useCallback(async () => {
    if (disabled) return;
    setLoading(true);
    setError("");
    try {
      const response = await client.request(
        `/api/github/repositories?session_id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );
      if (response.status === 401) {
        client.reload();
        return;
      }
      const payload = (await response.json()) as {
        error?: string;
        needsInstallation?: boolean;
        needsAuthorization?: boolean;
        repositories?: RepositoryOption[];
      };
      setNeedsAuthorization(payload.needsAuthorization === true);
      if (payload.needsAuthorization) {
        setRepositories(null);
        return;
      }
      if (!response.ok || !Array.isArray(payload.repositories)) {
        throw new Error(payload.error || "Repositories are unavailable.");
      }
      setNeedsInstallation(payload.needsInstallation === true);
      setRepositories(payload.repositories);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Repositories are unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId, client, disabled]);

  const connectRepository = useCallback(
    async (repositoryId: number) => {
      if (disabled) return;
      setConnectingId(repositoryId);
      setError("");
      try {
        const response = await client.request(
          `/api/github/repositories?session_id=${encodeURIComponent(sessionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repositoryId }),
          }
        );
        if (response.status === 401) {
          client.reload();
          return;
        }
        const payload = (await response.json()) as {
          error?: string;
          needsAuthorization?: boolean;
        };
        if (payload.needsAuthorization) {
          setNeedsAuthorization(true);
          setRepositories(null);
          setConnectingId(null);
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error || "Repository connection failed.");
        }
      } catch (connectError) {
        setConnectingId(null);
        setError(
          connectError instanceof Error
            ? connectError.message
            : "Repository connection failed."
        );
      }
    },
    [sessionId, client, disabled]
  );

  return (
    <fieldset
      disabled={disabled}
      className="hairline-grid flex h-full min-h-[420px] items-center justify-center bg-[#fafafa] p-8"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#dcdcdc] bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.05)]">
        <FolderGit2 className="size-7" />
        <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em]">
          Attach a repository
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#737373]">
          {disabled
            ? "Restore this archived task before attaching a repository."
            : "Choose a repository you can access on GitHub. Everyone invited to this task can work on its shared copy."}
        </p>

        {disabled ? null : needsAuthorization ? (
          <a
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black"
            href={`/api/github/login?return_to=${encodeURIComponent(`/sessions/${sessionId}`)}`}
          >
            <FolderGit2 className="size-4" /> Reconnect GitHub
          </a>
        ) : needsInstallation ? (
          <a
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white transition hover:bg-black"
            href={`/api/github/install?session_id=${encodeURIComponent(sessionId)}`}
          >
            <FolderGit2 className="size-4" /> Connect your GitHub
          </a>
        ) : repositories ? (
          <div className="mt-5">
            {repositories.length > 5 ? (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8a8a8a]" />
                <Input
                  aria-label="Search repositories"
                  className="h-9 rounded-md border-[#dedede] pl-9 text-base shadow-none sm:text-sm"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search repositories"
                  value={query}
                />
              </div>
            ) : null}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[#e5e5e5]">
              {filteredRepositories.map((candidate) => (
                <button
                  className="flex w-full items-center justify-between gap-4 border-b border-[#eeeeee] px-3 py-3 text-left transition last:border-b-0 hover:bg-[#fafafa] disabled:cursor-wait disabled:opacity-60"
                  disabled={connectingId !== null}
                  key={candidate.id}
                  onClick={() => void connectRepository(candidate.id)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {candidate.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-[#888]">
                      {candidate.defaultBranch} · {candidate.visibility}
                    </span>
                  </span>
                  {connectingId === candidate.id ? (
                    <LoaderCircle className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-[#666]">
                      Select
                    </span>
                  )}
                </button>
              ))}
              {filteredRepositories.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-[#888]">
                  {repositories.length === 0
                    ? "No repositories are authorized for your account."
                    : "No matching repositories."}
                </p>
              ) : null}
            </div>
            <Button
              className="mt-2 h-8 px-2 text-xs"
              disabled={loading || connectingId !== null}
              onClick={() => void loadRepositories()}
              size="sm"
              variant="ghost"
            >
              Refresh repositories
            </Button>
            <a
              className="ml-2 text-xs text-[#666] underline underline-offset-4"
              href={`/api/github/install?session_id=${encodeURIComponent(sessionId)}`}
            >
              Manage GitHub access
            </a>
          </div>
        ) : (
          <Button
            className="mt-5 h-10 rounded-md px-4 text-sm"
            disabled={loading}
            onClick={() => void loadRepositories()}
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderGit2 className="size-4" />
            )}
            {loading ? "Loading repositories…" : "Choose repository"}
          </Button>
        )}
        {error ? (
          <p className="mt-3 text-xs leading-5 text-[#777]">{error}</p>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-[#888]">
          Other tasks and repositories stay private.
        </p>
      </div>
    </fieldset>
  );
}

export function Workspace({
  repository,
  sessionId,
  tab,
  workspace,
  onTabChange,
  fileCollaboration,
  checkpointRevision,
  onRestored,
  recoveryStatus,
  active,
}: {
  repository?: RepositoryState;
  sessionId: string;
  tab: WorkspaceTab;
  workspace: WorkspaceState;
  onTabChange: (tab: WorkspaceTab) => void;
  fileCollaboration: {
    memberId: string;
    deliveredIds: ReadonlySet<string>;
    disabled: boolean;
    onAnnotate: AnnotateCode;
  };
  checkpointRevision: number;
  onRestored: (snapshot: TaskSessionSnapshot) => void;
  recoveryStatus: WorkspaceRecoveryStatus;
  active: boolean;
}) {
  if (!repository) {
    return (
      <section className="h-full min-h-0 bg-white">
        <RepositorySetup
          sessionId={sessionId}
          disabled={fileCollaboration.disabled}
        />
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center border-b border-[#ebebeb] bg-white px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs text-[#777]",
                  tab === item.key && "bg-[#f1f1f1] text-[#171717]"
                )}
                key={item.key}
                aria-pressed={tab === item.key}
                onClick={() => onTabChange(item.key)}
                size="sm"
                variant="ghost"
              >
                <Icon className="size-3.5" /> {item.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "diff" ? <DiffPane diff={workspace.diff} /> : null}
        <WorkspaceFiles
          key={JSON.stringify([sessionId, fileCollaboration.memberId])}
          sessionId={sessionId}
          initialPath={workspace.files[0]?.path}
          revision={workspaceReadRevision(workspace)}
          active={active && tab === "files"}
          locked={Boolean(workspace.restore)}
          {...fileCollaboration}
        />
        {tab === "runs" ? <RunsPane commands={workspace.commands} /> : null}
        {active && tab === "checkpoints" ? (
          <WorkspaceCheckpoints
            key={`${sessionId}:${workspace.lastRestore?.id ?? ""}`}
            sessionId={sessionId}
            revision={checkpointRevision}
            onRestored={onRestored}
            recoveryStatus={recoveryStatus}
          />
        ) : null}
      </div>
    </section>
  );
}
