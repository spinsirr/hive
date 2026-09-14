"use client";

import { createContext, useContext } from "react";
import type { HiveClient } from "@/lib/session/task-session-contract";

const liveClient: HiveClient = {
  request: (path, init) => fetch(path, init),
  reload: () => window.location.reload(),
};

export const HiveClientContext = createContext<HiveClient>(liveClient);
export const useHiveClient = () => useContext(HiveClientContext);
