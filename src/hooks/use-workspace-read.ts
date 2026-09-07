"use client";

import { useEffect, useRef, useState } from "react";

import { workspaceReadResponse, type WorkspaceReadResponse } from "@/lib/workspace-files";

type ReadState = {
  key: string;
  data?: WorkspaceReadResponse;
  error?: string;
  loadingMore?: boolean;
};

export function useWorkspaceRead({ sessionId, kind, path, revision, enabled = true }: {
  sessionId: string;
  kind: "directory" | "file";
  path: string;
  revision: string;
  enabled?: boolean;
}) {
  const key = JSON.stringify([sessionId, kind, path, revision, enabled]);
  const [state, setState] = useState<ReadState>();
  const controller = useRef<AbortController | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    controller.current = abort;
    loadingMore.current = false;
    readPath(sessionId, kind, path, 0, abort.signal).then(
      (data) => { if (!abort.signal.aborted) setState({ key, data }); },
      (error: Error) => { if (!abort.signal.aborted) setState({ key, error: error.message }); },
    );
    return () => { abort.abort(); };
  }, [enabled, key, kind, path, sessionId]);

  // A response for the previous file must never appear under the new filename.
  const current = state?.key === key ? state : undefined;
  const loadMore = async () => {
    const signal = controller.current?.signal;
    const previous = current?.data;
    if (!signal || signal.aborted || loadingMore.current || previous?.kind !== "directory" || previous.nextOffset === null) return;
    loadingMore.current = true;
    setState({ ...current, key, error: undefined, loadingMore: true });
    try {
      const next = await readPath(sessionId, kind, path, previous.nextOffset, signal);
      if (!signal.aborted && next.kind === "directory") {
        const entries = new Map([...previous.entries, ...next.entries].map((entry) => [entry.path, entry]));
        setState({ key, data: { ...next, entries: [...entries.values()] } });
      }
    } catch (error) {
      if (!signal.aborted) setState({ ...current, key, error: error instanceof Error ? error.message : "Couldn’t load more files." });
    } finally {
      if (!signal.aborted) loadingMore.current = false;
    }
  };

  return { data: current?.data, error: current?.error, pending: enabled && !current, loadingMore: current?.loadingMore, loadMore };
}

async function readPath(sessionId: string, kind: "directory" | "file", path: string, offset: number, signal: AbortSignal) {
  const query = new URLSearchParams({ kind, path, offset: String(offset) });
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files?${query}`, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Workspace could not be read. Try again.");
  const result = workspaceReadResponse.safeParse(body);
  if (!result.success || result.data.kind !== kind || result.data.path !== path) throw new Error("Workspace could not be read. Try again.");
  return result.data;
}
