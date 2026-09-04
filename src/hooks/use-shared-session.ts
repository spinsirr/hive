"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createInitialTaskSessionState,
  type TaskSessionAction,
} from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";

type ClientTaskSessionAction = Exclude<
  TaskSessionAction,
  { type: "connect-repository" }
>;

type SessionDispatchAction = ClientTaskSessionAction extends infer Action
  ? Action extends ClientTaskSessionAction
    ? Omit<Action, "actor">
    : never
  : never;

export function useSharedSession(sessionId: string) {
  const [snapshot, setSnapshot] = useState<TaskSessionSnapshot>(() => ({
    session: createInitialTaskSessionState(0, sessionId),
    activeMembers: [],
    members: [],
    typingMembers: [],
  }));
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const typingRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const publish = useCallback((nextSnapshot: TaskSessionSnapshot) => {
    setSnapshot(nextSnapshot);
    setSyncing(false);
    setSyncError(false);
    channelRef.current?.postMessage(nextSnapshot);
  }, []);

  const post = useCallback(async (payload: object) => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) window.location.reload();
      if (!response.ok) throw new Error("Session action failed");
      const nextSnapshot = (await response.json()) as TaskSessionSnapshot;
      publish(nextSnapshot);
      return nextSnapshot;
    } catch {
      setSyncing(true);
      setSyncError(true);
      return null;
    }
  }, [publish, sessionId]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (response.status === 401) window.location.reload();
      if (!response.ok) throw new Error("Session refresh failed");
      const nextSnapshot = (await response.json()) as TaskSessionSnapshot;
      setSnapshot(nextSnapshot);
      setSyncing(false);
      setSyncError(false);
    } catch {
      setSyncing(true);
      setSyncError(true);
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`hive-session-${sessionId}`);
      channel.onmessage = (event: MessageEvent<TaskSessionSnapshot>) => {
        setSnapshot(event.data);
        setSyncing(false);
      };
      channelRef.current = channel;
    }

    void post({ type: "heartbeat", typing: typingRef.current });
    const pollTimer = window.setInterval(() => void refresh(), 1_200);
    const heartbeatTimer = window.setInterval(
      () => void post({ type: "heartbeat", typing: typingRef.current }),
      5_000,
    );

    return () => {
      window.clearInterval(pollTimer);
      window.clearInterval(heartbeatTimer);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [post, refresh, sessionId]);

  const dispatch = useCallback(
    (action: SessionDispatchAction) => post(action),
    [post],
  );

  const setTyping = useCallback((typing: boolean) => {
    if (typingRef.current === typing) return;
    typingRef.current = typing;
    void post({ type: "heartbeat", typing });
  }, [post]);

  return { snapshot, syncing, syncError, dispatch, setTyping };
}
