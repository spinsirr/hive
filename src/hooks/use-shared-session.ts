"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentReply } from "@/lib/session/task-session";
import type {
  TaskSessionSnapshot,
  LivePresence,
} from "@/lib/session/task-session-contract";

import {
  receiveAgentReply,
  receiveTaskSessionSnapshot,
} from "@/lib/session/task-session-snapshot";

import type { ClientTaskSessionAction as SessionDispatchAction } from "@/lib/session/task-session-actions";

class SessionActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function useSharedSession(
  sessionId: string,
  initialSnapshot: TaskSessionSnapshot
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const typingRef = useRef(false);
  const connectedRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);

  const publish = useCallback(
    (nextSnapshot: TaskSessionSnapshot, fromLive = false) => {
      setSnapshot((current) => {
        const next = receiveTaskSessionSnapshot(current, nextSnapshot);
        // HTTP responses contain durable task data, not authoritative live connections.
        return fromLive
          ? next
          : {
              ...next,
              activeMembers: current.activeMembers,
              typingMembers: current.typingMembers,
            };
      });
      setSyncing(!connectedRef.current);
      setSyncError(false);
    },
    []
  );

  const post = useCallback(
    async (payload: object, options?: { throwOnError?: boolean }) => {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (response.status === 401) window.location.reload();
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          throw new SessionActionError(
            response.status,
            typeof failure?.error === "string"
              ? failure.error
              : "Session action failed"
          );
        }
        const nextSnapshot = (await response.json()) as TaskSessionSnapshot;
        publish(nextSnapshot);
        return nextSnapshot;
      } catch (error) {
        // A rejected edit is not a lost connection; keep the live task visible.
        if (!(error instanceof SessionActionError) || error.status >= 500) {
          setSyncing(true);
          setSyncError(true);
        }
        if (options?.throwOnError) throw error;
        return null;
      }
    },
    [publish, sessionId]
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        {
          cache: "no-store",
        }
      );
      if (response.status === 401) window.location.reload();
      if (!response.ok) throw new Error("Session refresh failed");
      const nextSnapshot = (await response.json()) as TaskSessionSnapshot;
      publish(nextSnapshot);
    } catch {
      setSyncing(true);
      setSyncError(true);
    }
  }, [publish, sessionId]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let connecting: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    const url = new URL(
      `/api/sessions/${encodeURIComponent(sessionId)}/live`,
      window.location.href
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    function connect() {
      if (
        stopped ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      )
        return;
      clearTimeout(retry);
      const current = new WebSocket(url);
      socket = current;
      socketRef.current = current;
      connecting = setTimeout(() => current.close(), 15_000);
      current.onopen = () => {
        if (stopped || current !== socket) {
          current.close();
          return;
        }
        clearTimeout(connecting);
        connectedRef.current = true;
        delay = 500;
        if (typingRef.current)
          current.send(JSON.stringify({ type: "typing", typing: true }));
      };
      current.onmessage = (message: MessageEvent<string>) => {
        if (stopped || current !== socket) return;
        try {
          const event = JSON.parse(message.data) as
            | { type: "snapshot"; snapshot: TaskSessionSnapshot }
            | { type: "reply"; sessionId: string; reply: AgentReply | null }
            | { type: "presence"; sessionId: string; presence: LivePresence };
          if (event.type === "snapshot") publish(event.snapshot, true);
          if (event.type === "reply")
            setSnapshot((previous) =>
              receiveAgentReply(previous, event.sessionId, event.reply)
            );
          if (event.type === "presence")
            setSnapshot((previous) =>
              event.sessionId === previous.session.sessionId
                ? {
                    ...previous,
                    activeMembers: event.presence.activeMembers,
                    typingMembers: event.presence.typingMembers,
                  }
                : previous
            );
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
        setSnapshot((previous) => ({
          ...previous,
          activeMembers: [],
          typingMembers: [],
        }));
        setSyncing(true);
        if (event.code === 4401) {
          window.location.reload();
          return;
        }
        setSyncError(!navigator.onLine);
        retry = setTimeout(connect, delay + Math.random() * 250);
        delay = Math.min(delay * 2, 10_000);
      };
      current.onerror = () => current.close();
    }
    function reconnect() {
      if (socket?.readyState === WebSocket.OPEN) return;
      connect();
      void refresh();
    }

    connect();
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);

    return () => {
      stopped = true;
      connectedRef.current = false;
      socketRef.current = null;
      clearTimeout(retry);
      clearTimeout(connecting);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      socket?.close();
    };
  }, [publish, refresh, sessionId]);

  const dispatch = useCallback(
    (action: SessionDispatchAction, options?: { throwOnError?: boolean }) =>
      post(action, options),
    [post]
  );

  const setTyping = useCallback((typing: boolean) => {
    if (typingRef.current === typing) return;
    typingRef.current = typing;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "typing", typing }));
    }
  }, []);

  return {
    snapshot,
    syncing,
    syncError,
    dispatch,
    setTyping,
    receiveSnapshot: publish,
  };
}
