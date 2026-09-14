"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

const cacheOptions = {
  provider: () => new Map(),
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
};

export function WorkspaceReadCache({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  // A new workspace version drops both content and pending-request bookkeeping.
  // This memory belongs to this Files pane, never a global or persistent cache.
  return (
    <SWRConfig key={scope} value={cacheOptions}>
      {children}
    </SWRConfig>
  );
}
