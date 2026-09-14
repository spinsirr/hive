"use client";

import { useCallback, useMemo, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { useHiveClient } from "@/components/hive/hive-client";
import type { HiveClient } from "@/lib/session/task-session-contract";

import {
  workspaceReadResponse,
  type WorkspaceReadResponse,
} from "@/lib/workspace/workspace-files";

type ReadKey = readonly [
  sessionId: string,
  kind: "directory" | "file",
  path: string,
  revision: string,
  offset: number,
];

export function useWorkspaceRead({
  sessionId,
  kind,
  path,
  revision,
  enabled = true,
}: {
  sessionId: string;
  kind: "directory" | "file";
  path: string;
  revision: string;
  enabled?: boolean;
}) {
  const client = useHiveClient();
  const read = useCallback((key: ReadKey) => readPath(key, client), [client]);
  const key = JSON.stringify([sessionId, kind, path, revision]);
  const loadingRequest = useRef<string | null>(null);
  const {
    data: pages,
    error,
    isValidating,
    setSize,
  } = useSWRInfinite<WorkspaceReadResponse, Error>(
    (index, previous): ReadKey | null => {
      if (!enabled) return null;
      if (index === 0) return [sessionId, kind, path, revision, 0];
      if (previous?.kind !== "directory" || previous.nextOffset === null)
        return null;
      return [sessionId, kind, path, revision, previous.nextOffset];
    },
    read,
    { revalidateFirstPage: false, keepPreviousData: false }
  );
  const data = useMemo(() => {
    if (!pages) return undefined;
    const first = pages[0];
    if (first?.kind !== "directory") return first;
    const directories = pages.filter((page) => page.kind === "directory");
    const entries = new Map(
      directories
        .flatMap((page) => page.entries)
        .map((entry) => [entry.path, entry])
    );
    return {
      ...first,
      entries: [...entries.values()],
      nextOffset: directories.at(-1)!.nextOffset,
    };
  }, [pages]);

  const loadMore = async () => {
    if (
      !enabled ||
      isValidating ||
      loadingRequest.current === key ||
      data?.kind !== "directory" ||
      data.nextOffset === null
    )
      return;
    loadingRequest.current = key;
    try {
      await setSize((pages?.length ?? 0) + 1);
    } catch {
      // SWR exposes the failed page through `error`; loaded pages remain visible.
    } finally {
      if (loadingRequest.current === key) loadingRequest.current = null;
    }
  };

  return {
    data,
    error: error?.message,
    pending: enabled && !data && !error,
    loadingMore: Boolean(data && isValidating),
    loadMore,
  };
}

async function readPath(
  [sessionId, kind, path, , offset]: ReadKey,
  client: HiveClient
) {
  const query = new URLSearchParams({ kind, path, offset: String(offset) });
  const response = await client.request(
    `/api/sessions/${encodeURIComponent(sessionId)}/files?${query}`,
    { cache: "no-store", signal: AbortSignal.timeout(50_000) }
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "Workspace could not be read. Try again."
    );
  const result = workspaceReadResponse.safeParse(body);
  if (!result.success || result.data.kind !== kind || result.data.path !== path)
    throw new Error("Workspace could not be read. Try again.");
  return result.data;
}
