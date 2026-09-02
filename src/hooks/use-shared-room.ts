"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createInitialRoomState,
  type MemberId,
  type RoomAction,
} from "@/lib/room";
import type { RoomSnapshot } from "@/lib/room-store";

const fallbackSnapshot: RoomSnapshot = {
  room: createInitialRoomState(0),
  activeMembers: [],
  typingMembers: [],
};

type ClientRoomAction = Exclude<RoomAction, { type: "connect-repository" }>;

type RoomDispatchAction = ClientRoomAction extends infer Action
  ? Action extends ClientRoomAction
    ? Omit<Action, "actor">
    : never
  : never;

export function useSharedRoom(memberId: MemberId) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(fallbackSnapshot);
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const typingRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const publish = useCallback((nextSnapshot: RoomSnapshot) => {
    setSnapshot(nextSnapshot);
    setSyncing(false);
    setSyncError(false);
    channelRef.current?.postMessage(nextSnapshot);
  }, []);

  const post = useCallback(async (payload: object) => {
    try {
      const response = await fetch("/api/rooms/orbit-nav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Room action failed");
      const nextSnapshot = (await response.json()) as RoomSnapshot;
      publish(nextSnapshot);
      return nextSnapshot;
    } catch {
      setSyncing(true);
      setSyncError(true);
      return null;
    }
  }, [publish]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/rooms/orbit-nav", { cache: "no-store" });
      if (!response.ok) throw new Error("Room refresh failed");
      const nextSnapshot = (await response.json()) as RoomSnapshot;
      setSnapshot(nextSnapshot);
      setSyncing(false);
      setSyncError(false);
    } catch {
      setSyncing(true);
      setSyncError(true);
    }
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("hive-room-orbit-nav");
      channel.onmessage = (event: MessageEvent<RoomSnapshot>) => {
        setSnapshot(event.data);
        setSyncing(false);
      };
      channelRef.current = channel;
    }

    void post({ type: "heartbeat", memberId, typing: typingRef.current });
    const pollTimer = window.setInterval(() => void refresh(), 1_200);
    const heartbeatTimer = window.setInterval(
      () => void post({ type: "heartbeat", memberId, typing: typingRef.current }),
      5_000,
    );

    return () => {
      window.clearInterval(pollTimer);
      window.clearInterval(heartbeatTimer);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [memberId, post, refresh]);

  const dispatch = useCallback((action: RoomDispatchAction) => {
    return post({ ...action, actor: memberId });
  }, [memberId, post]);

  const setTyping = useCallback((typing: boolean) => {
    if (typingRef.current === typing) return;
    typingRef.current = typing;
    void post({ type: "heartbeat", memberId, typing });
  }, [memberId, post]);

  return { snapshot, syncing, syncError, dispatch, setTyping };
}
