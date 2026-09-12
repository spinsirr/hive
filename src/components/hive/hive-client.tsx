"use client";

import { createContext, useContext } from "react";

/** Scoped IO for workspace controls; demos never replace browser globals. */
export type HiveClient = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  reload: () => void;
};

const liveClient: HiveClient = {
  request: (path, init) => fetch(path, init),
  reload: () => window.location.reload(),
};

export const HiveClientContext = createContext<HiveClient>(liveClient);
export const useHiveClient = () => useContext(HiveClientContext);
