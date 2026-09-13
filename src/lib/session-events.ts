import { sql } from "drizzle-orm";
import { Client, type Notification } from "pg";

import { isTaskSessionId } from "./task-session-id.ts";
import {
  isPresenceAnnouncement,
  SessionPresence,
  type LivePresence,
} from "./session-presence.ts";
import type { MemberId } from "./task-session.ts";

export type SessionEventKind = "snapshot" | "reply";
type Subscription = {
  sessionId: string;
  memberId: MemberId;
  onChange: (kind: SessionEventKind) => void;
  onPresence: (presence: LivePresence) => void;
  onDisconnect: () => void;
};

const CHANNEL = "hive_session_events";

/** Execute inside the mutation transaction: delivery happens only after commit. */
export function sessionNotification(
  sessionId: string,
  kind: SessionEventKind = "snapshot"
) {
  return sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ sessionId, kind })})`;
}

function createListener() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is required for live sessions.");
  const url = new URL(connectionString);
  // Neon uses the same credentials/database on its pooled and direct endpoints.
  // LISTEN needs a session-bound connection, not PgBouncer's transaction pool.
  url.hostname = url.hostname.replace(/-pooler\./, ".");
  if (url.searchParams.get("sslmode") === "require")
    url.searchParams.set("sslmode", "verify-full");
  return new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    keepAlive: true,
  });
}

/** One direct LISTEN connection per active function instance, shared by its viewers. */
export class SessionEventHub {
  private subscriptions = new Set<Subscription>();
  private client?: Client;
  private ready?: Promise<void>;
  private presence?: SessionPresence;
  private finish?: () => void;

  async subscribe(subscription: Subscription) {
    this.subscriptions.add(subscription);
    let connection: ReturnType<SessionPresence["join"]> | undefined;
    const unsubscribe = () => {
      this.subscriptions.delete(subscription);
      connection?.leave();
      connection = undefined;
      if (this.subscriptions.size === 0) this.disconnect();
    };
    try {
      if (!this.client) {
        const client = createListener();
        this.client = client;
        let published: Promise<unknown> = Promise.resolve();
        this.finish = () => {
          // The final socket's leave must reach other instances before ending LISTEN.
          void published
            .catch(() => undefined)
            .then(() => client.end())
            .catch(() => undefined);
        };
        const fail = () => {
          if (this.client !== client) return;
          const listeners = [...this.subscriptions];
          this.subscriptions.clear();
          this.disconnect();
          for (const listener of listeners) listener.onDisconnect();
        };
        const presence = new SessionPresence(
          (event) => {
            const payload = JSON.stringify(event);
            if (Buffer.byteLength(payload) >= 8_000) {
              fail();
              return;
            }
            published = published.then(() =>
              client.query("select pg_notify($1, $2)", [CHANNEL, payload])
            );
            void published.catch(fail);
          },
          (sessionId, current) => {
            for (const listener of this.subscriptions) {
              if (listener.sessionId === sessionId)
                listener.onPresence(current);
            }
          }
        );
        this.presence = presence;
        client.on("notification", (notification: Notification) => {
          if (notification.channel !== CHANNEL || !notification.payload) return;
          let event: { sessionId?: unknown; kind?: unknown };
          try {
            event = JSON.parse(notification.payload);
          } catch {
            return;
          }
          if (!event || typeof event !== "object") return;
          if (isPresenceAnnouncement(event)) {
            presence.receive(event);
            return;
          }
          if (
            !isTaskSessionId(event.sessionId) ||
            (event.kind !== "snapshot" && event.kind !== "reply")
          )
            return;
          for (const listener of this.subscriptions) {
            if (listener.sessionId === event.sessionId)
              listener.onChange(event.kind);
          }
        });
        client.on("error", fail);
        client.on("end", fail);
        this.ready = client.connect().then(async () => {
          await client.query(`LISTEN ${CHANNEL}`);
        });
      }
      await this.ready;
      if (!this.presence || !this.subscriptions.has(subscription))
        throw new Error("Live subscription closed during setup.");
      connection = this.presence.join(
        subscription.sessionId,
        subscription.memberId
      );
      return {
        unsubscribe,
        setTyping: (typing: boolean) => connection?.setTyping(typing),
      };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  private disconnect() {
    const finish = this.finish;
    this.client = undefined;
    this.finish = undefined;
    this.ready = undefined;
    this.presence?.dispose();
    this.presence = undefined;
    finish?.();
  }
}

const globals = globalThis as typeof globalThis & {
  __hiveSessionEvents?: SessionEventHub;
};
export const sessionEvents = (globals.__hiveSessionEvents ??=
  new SessionEventHub());
