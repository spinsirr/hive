import { randomUUID } from "node:crypto";

import { isTaskSessionId } from "./task-session-id.ts";
import { isMemberId, type MemberId } from "./task-session.ts";

export type LivePresence = { activeMembers: MemberId[]; typingMembers: MemberId[] };
export type PresenceAnnouncement = {
  kind: "presence";
  sessionId: string;
  instanceId: string;
  members: [MemberId, boolean][];
  request: boolean;
};

export const PRESENCE_RENEW_MS = 30_000;
export const PRESENCE_EXPIRY_MS = 90_000;

export function isPresenceAnnouncement(value: unknown): value is PresenceAnnouncement {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<PresenceAnnouncement>;
  return event.kind === "presence" && isTaskSessionId(event.sessionId) &&
    typeof event.instanceId === "string" && /^[a-f0-9-]{36}$/.test(event.instanceId) &&
    typeof event.request === "boolean" && Array.isArray(event.members) &&
    event.members.length <= 100 && event.members.every((entry) =>
      Array.isArray(entry) && entry.length === 2 && isMemberId(entry[0]) && typeof entry[1] === "boolean");
}

/** Ephemeral, connection-owned presence. NOTIFY is a relay, never a table write/read. */
export class SessionPresence {
  private instanceId = randomUUID();
  private local = new Map<string, Map<symbol, { memberId: MemberId; typing: boolean }>>();
  private remote = new Map<string, Map<string, { members: [MemberId, boolean][]; expiresAt: number }>>();
  private renewal?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private publish: (event: PresenceAnnouncement) => void;
  private changed: (sessionId: string, presence: LivePresence) => void;

  constructor(
    publish: (event: PresenceAnnouncement) => void,
    changed: (sessionId: string, presence: LivePresence) => void,
  ) {
    this.publish = publish;
    this.changed = changed;
  }

  join(sessionId: string, memberId: MemberId) {
    if (this.disposed) throw new Error("Presence connection is closed.");
    const connections = this.local.get(sessionId) ?? new Map();
    const key = Symbol();
    const connection = { memberId, typing: false };
    connections.set(key, connection);
    this.local.set(sessionId, connections);
    this.changed(sessionId, this.snapshot(sessionId));
    // Existing instances answer once so a new instance learns their live members.
    this.announce(sessionId, true);
    this.renewal ??= setInterval(() => {
      for (const id of this.local.keys()) this.announce(id);
    }, PRESENCE_RENEW_MS);
    this.renewal.unref();

    return {
      setTyping: (typing: boolean) => {
        if (this.disposed || !connections.has(key) || connection.typing === typing) return;
        connection.typing = typing;
        this.changed(sessionId, this.snapshot(sessionId));
        this.announce(sessionId);
      },
      leave: () => {
        if (this.disposed || !connections.delete(key)) return;
        this.changed(sessionId, this.snapshot(sessionId));
        this.announce(sessionId);
        if (!connections.size) {
          this.local.delete(sessionId);
          this.remote.delete(sessionId);
          this.scheduleExpiry();
        }
        if (!this.local.size) {
          clearInterval(this.renewal);
          this.renewal = undefined;
        }
      },
    };
  }

  receive(event: PresenceAnnouncement) {
    if (this.disposed || event.instanceId === this.instanceId || !this.local.has(event.sessionId)) return;
    const before = JSON.stringify(this.snapshot(event.sessionId));
    const instances = this.remote.get(event.sessionId) ?? new Map();
    if (event.members.length) {
      instances.set(event.instanceId, { members: event.members, expiresAt: Date.now() + PRESENCE_EXPIRY_MS });
      this.remote.set(event.sessionId, instances);
    } else {
      instances.delete(event.instanceId);
      if (!instances.size) this.remote.delete(event.sessionId);
    }
    const after = this.snapshot(event.sessionId);
    // Lease renewal must not fan out into per-viewer authorization or task queries.
    if (JSON.stringify(after) !== before) this.changed(event.sessionId, after);
    if (event.request) this.announce(event.sessionId);
    this.scheduleExpiry();
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.renewal);
    clearTimeout(this.expiry);
    this.renewal = undefined;
    this.expiry = undefined;
    this.local.clear();
    this.remote.clear();
  }

  private localMembers(sessionId: string): [MemberId, boolean][] {
    const members = new Map<MemberId, boolean>();
    for (const { memberId, typing } of this.local.get(sessionId)?.values() ?? []) {
      members.set(memberId, Boolean(members.get(memberId) || typing));
    }
    return [...members.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  private snapshot(sessionId: string): LivePresence {
    const members = new Map(this.localMembers(sessionId));
    for (const instance of this.remote.get(sessionId)?.values() ?? []) {
      for (const [memberId, typing] of instance.members) members.set(memberId, Boolean(members.get(memberId) || typing));
    }
    const activeMembers = [...members.keys()].sort();
    return { activeMembers, typingMembers: activeMembers.filter((id) => members.get(id)) };
  }

  private announce(sessionId: string, request = false) {
    this.publish({ kind: "presence", instanceId: this.instanceId, sessionId, members: this.localMembers(sessionId), request });
  }

  private scheduleExpiry() {
    clearTimeout(this.expiry);
    let next = Infinity;
    for (const instances of this.remote.values()) {
      for (const instance of instances.values()) next = Math.min(next, instance.expiresAt);
    }
    if (!Number.isFinite(next)) return;
    this.expiry = setTimeout(() => {
      for (const [sessionId, instances] of this.remote) {
        let expired = false;
        for (const [id, instance] of instances) {
          if (instance.expiresAt <= Date.now()) { instances.delete(id); expired = true; }
        }
        if (!instances.size) this.remote.delete(sessionId);
        if (expired) this.changed(sessionId, this.snapshot(sessionId));
      }
      this.scheduleExpiry();
    }, Math.max(0, next - Date.now()));
    this.expiry.unref();
  }
}
