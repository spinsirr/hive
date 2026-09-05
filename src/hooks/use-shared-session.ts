"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentReply, TaskSessionAction } from "@/lib/task-session";
import type { TaskSessionSnapshot } from "@/lib/task-session-store";
import { receiveAgentReply, receiveTaskSessionSnapshot } from "@/lib/task-session-snapshot";

type ClientTaskSessionAction = Exclude<
  TaskSessionAction,
  { type: "connect-repository" }
>;

type SessionDispatchAction = ClientTaskSessionAction extends infer Action
  ? Action extends ClientTaskSessionAction
    ? Omit<Action, "actor">
    : never
  : never;

export function useSharedSession(sessionId: string, initialSnapshot: TaskSessionSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const typingRef = useRef(false);
  const connectedRef = useRef(false);

  const publish = useCallback((nextSnapshot: TaskSessionSnapshot) => {
    setSnapshot((current) => receiveTaskSessionSnapshot(current, nextSnapshot));
    setSyncing(!connectedRef.current);
    setSyncError(false);
  }, []);

  const heartbeat = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "heartbeat", typing: typingRef.current }),
      });
      if (response.status === 401) window.location.reload();
      if (!response.ok) throw new Error("Session heartbeat failed");
      // A successful presence write does not mean the live subscription is connected.
    } catch {
      setSyncError(true);
    }
  }, [sessionId]);

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
      setSnapshot((current) => receiveTaskSessionSnapshot(current, nextSnapshot));
      setSyncing(!connectedRef.current);
      setSyncError(false);
    } catch {
      setSyncing(true);
      setSyncError(true);
    }
  }, [sessionId]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let connecting: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    const url = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/live`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    function connect() {
      if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      clearTimeout(retry);
      const current = new WebSocket(url);
      socket = current;
      connecting = setTimeout(() => current.close(), 15_000);
      current.onopen = () => {
        if (stopped || current !== socket) { current.close(); return; }
        clearTimeout(connecting);
        connectedRef.current = true;
        delay = 500;
      };
      current.onmessage = (message: MessageEvent<string>) => {
        if (stopped || current !== socket) return;
        try {
          const event = JSON.parse(message.data) as
            | { type: "snapshot"; snapshot: TaskSessionSnapshot }
            | { type: "reply"; sessionId: string; reply: AgentReply | null };
          if (event.type === "snapshot") publish(event.snapshot);
          if (event.type === "reply") setSnapshot((previous) => receiveAgentReply(previous, event.sessionId, event.reply));
          setSyncing(false);
          setSyncError(false);
        } catch {
          current.close();
        }
      };
      current.onclose = (event) => {
        if (stopped || current !== socket) return;
        clearTimeout(connecting);
        connectedRef.current = false;
        setSyncing(true);
        if (event.code === 4401) { window.location.reload(); return; }
        setSyncError(!navigator.onLine);
        retry = setTimeout(connect, delay + Math.random() * 250);
        delay = Math.min(delay * 2, 10_000);
      };
      current.onerror = () => current.close();
    }
    function reconnect() {
      connect();
      void refresh();
    }

    connect();
    void heartbeat();
    const heartbeatTimer = window.setInterval(
      () => void heartbeat(),
      5_000,
    );
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);

    return () => {
      stopped = true;
      connectedRef.current = false;
      clearTimeout(retry);
      clearTimeout(connecting);
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      socket?.close();
    };
  }, [heartbeat, publish, refresh, sessionId]);

  const dispatch = useCallback(
    (action: SessionDispatchAction) => post(action),
    [post],
  );

  const setTyping = useCallback((typing: boolean) => {
    if (typingRef.current === typing) return;
    typingRef.current = typing;
    void heartbeat();
  }, [heartbeat]);

  return { snapshot, syncing, syncError, dispatch, setTyping };
}
