"use client";

import { ChevronRight, MessageSquarePlus, PanelLeft, RotateCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useWorkspaceRead } from "@/hooks/use-workspace-read";
import { cn } from "@/lib/utils";
import type { WorkspaceEntry } from "@/lib/workspace-files";
import type { CodeReference } from "@/lib/code-reference";
import { CodeAnnotationComposer, type AnnotateCode } from "./code-annotation-composer";
import { WorkspaceFileIcon } from "./workspace-file-icon";
import { WorkspaceReadCache } from "./workspace-read-cache";

import styles from "./workspace-files.module.css";

const CodeViewer = dynamic(() => import("./code-viewer"), {
  ssr: false,
  loading: () => <Notice>Loading code viewer…</Notice>,
});

type TreeProps = {
  sessionId: string;
  revision: string;
  selected: string;
  expanded: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onRefresh: () => void;
};

function Directory({ path, depth = 0, ...tree }: TreeProps & { path: string; depth?: number }) {
  const { data, error, pending, loadingMore, loadMore } = useWorkspaceRead({ sessionId: tree.sessionId, revision: tree.revision, kind: "directory", path });
  return (
    <ul aria-label={path || "Workspace root"} className="min-w-full text-xs">
      {pending ? <li className="px-3 py-2 text-[#737373]" role="status">Loading files…</li> : null}
      {data?.kind === "directory" ? data.entries.map((entry) => <Entry key={entry.path} entry={entry} depth={depth} {...tree} />) : null}
      {data?.kind === "directory" && data.entries.length === 0 ? <li className="px-3 py-2 text-[#737373]">Empty folder</li> : null}
      {error ? (
        <li className="px-3 py-2 text-[#737373]" role="status">
          <p className="leading-5">{error}</p>
          <button className="mt-1 underline underline-offset-4" onClick={tree.onRefresh} type="button">Try again</button>
        </li>
      ) : null}
      {data?.kind === "directory" && data.nextOffset !== null ? (
        <li><button className="w-full px-3 py-2 text-left text-[#737373] hover:text-[#171717] disabled:opacity-50" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? "Loading…" : "Load more files"}</button></li>
      ) : null}
    </ul>
  );
}

const unavailable: Partial<Record<WorkspaceEntry["kind"], string>> = {
  restricted: "Git internals and credential files are not previewed",
  symlink: "Symbolic links are not opened",
  other: "Only regular text files can be previewed",
};

function Entry({ entry, depth, ...tree }: TreeProps & { entry: WorkspaceEntry; depth: number }) {
  const directory = entry.kind === "directory";
  const open = tree.expanded.has(entry.path);
  const reason = unavailable[entry.kind];
  return (
    <li>
      <button
        aria-current={!directory && tree.selected === entry.path ? "true" : undefined}
        aria-expanded={directory ? open : undefined}
        aria-label={reason ? `${entry.name}: ${reason}` : entry.name}
        className={cn("flex h-8 w-full items-center gap-1.5 rounded px-2 text-left text-[#525252] hover:bg-[#ededed] focus-visible:outline-2 focus-visible:outline-[#737373] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent", tree.selected === entry.path && "bg-[#eaeaea] text-[#171717]")}
        disabled={Boolean(reason)}
        onClick={() => directory ? tree.onToggle(entry.path) : tree.onSelect(entry.path)}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={reason ? `${entry.path} — ${reason}` : entry.path}
        type="button"
      >
        {directory ? <ChevronRight className={cn("size-3 shrink-0", open && "rotate-90")} /> : <span className="w-3 shrink-0" />}
        <WorkspaceFileIcon path={entry.path} kind={entry.kind} expanded={open} />
        <span className="truncate">{entry.name}</span>
      </button>
      {directory && open ? <Directory path={entry.path} depth={depth + 1} {...tree} /> : null}
    </li>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-6 text-center text-xs leading-5 text-[#737373]" role="status">{children}</div>;
}

function SelectedFile({ sessionId, path, revision, onSelectionChange, onRefresh }: {
  sessionId: string; path: string; revision: string;
  onSelectionChange: (reference: CodeReference | null) => void; onRefresh: () => void;
}) {
  const { data, error, pending } = useWorkspaceRead({ sessionId, kind: "file", path, revision, enabled: Boolean(path) });
  if (!path) return <Notice>Select a file to view its contents.</Notice>;
  if (pending) return <Notice>Loading file…</Notice>;
  if (error) return <Notice><div><p>{error}</p><button className="mt-2 underline underline-offset-4" onClick={onRefresh} type="button">Try again</button></div></Notice>;
  return data?.kind === "file" ? <CodeViewer key={data.path} path={data.path} content={data.content} onSelectionChange={onSelectionChange} /> : null;
}

export function WorkspaceFiles({ sessionId, revision, initialPath = "", memberId, deliveredIds, disabled, active = true, locked = false, onAnnotate }: {
  sessionId: string; revision: string; initialPath?: string;
  memberId: string; deliveredIds: ReadonlySet<string>; disabled: boolean; active?: boolean; locked?: boolean; onAnnotate: AnnotateCode;
}) {
  const [selected, setSelected] = useState(initialPath);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<{ reference: CodeReference; revision: string } | null>(null);
  const [annotation, setAnnotation] = useState<CodeReference | null>(null);
  const [expanded, setExpanded] = useState(() => new Set(initialPath.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))));
  const readRevision = `${revision}:${refresh}`;
  const selectedReference = selection?.revision === readRevision ? selection.reference : null;
  const onRefresh = () => { setSelection(null); setRefresh((value) => value + 1); };
  const selectFile = (path: string) => { setSelection(null); setSelected(path); };
  const onToggle = (path: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  // Keep data and selection, but fully unmount Monaco when hidden: its React
  // wrapper disposes the editor in effect cleanup and cannot resume that instance.
  return (
    <WorkspaceReadCache scope={JSON.stringify([sessionId, memberId, readRevision, locked])}>
      {active ? (
        <div className={styles.browser}>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#ebebeb] px-2 text-[11px] text-[#737373]">
            <Button aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"} aria-pressed={explorerOpen} className="size-7 shrink-0" onClick={() => setExplorerOpen(!explorerOpen)} size="icon" title={explorerOpen ? "Hide file explorer" : "Show file explorer"} variant="ghost"><PanelLeft className="size-3.5" /></Button>
            {selected ? <WorkspaceFileIcon path={selected} /> : null}
            <span className="min-w-0 flex-1 truncate font-mono" title={selected || "Workspace"}>{selected || "Workspace"}</span>
            <Button aria-label="Annotate selected code" className="h-7 shrink-0 px-2 text-[11px]" disabled={disabled || locked || !selectedReference || selectedReference.path !== selected} onClick={() => setAnnotation(selectedReference)} size="sm" title="Select up to 100 lines to annotate" variant="ghost"><MessageSquarePlus className="size-3.5" /> Annotate</Button>
            <Button aria-label="Refresh workspace files" className="size-7 shrink-0" disabled={locked} onClick={onRefresh} size="icon" title="Refresh workspace files" variant="ghost"><RotateCw className="size-3.5" /></Button>
          </div>
          {locked ? <Notice>The workspace is being restored.</Notice> : <div className={styles.body}>
            {explorerOpen ? <nav aria-label="Workspace files" className={styles.explorer}><Directory sessionId={sessionId} revision={readRevision} path="" expanded={expanded} selected={selected} onSelect={selectFile} onToggle={onToggle} onRefresh={onRefresh} /></nav> : null}
            <div className={styles.editor}>
              <SelectedFile sessionId={sessionId} path={selected} revision={readRevision} onRefresh={onRefresh} onSelectionChange={(reference) => setSelection(reference ? { reference, revision: readRevision } : null)} />
            </div>
          </div>}
          {annotation && !disabled && !locked ? <CodeAnnotationComposer reference={annotation} sessionId={sessionId} memberId={memberId} deliveredIds={deliveredIds} onSubmit={onAnnotate} onClose={() => setAnnotation(null)} /> : null}
        </div>
      ) : null}
    </WorkspaceReadCache>
  );
}
