import { sql } from "drizzle-orm";
import { Client, type Notification } from "pg";

import { isTaskSessionId } from "./task-session-id.ts";

export type SessionEventKind = "snapshot" | "reply" | "presence";
type Subscription = {
  sessionId: string;
  onChange: (kind: SessionEventKind) => void;
  onDisconnect: () => void;
};

const CHANNEL = "hive_session_events";

/** Execute inside the mutation transaction: delivery happens only after commit. */
export function sessionNotification(sessionId: string, kind: SessionEventKind = "snapshot") {
  return sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ sessionId, kind })})`;
}

function createListener() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for live sessions.");
  const url = new URL(connectionString);
  // Neon uses the same credentials/database on its pooled and direct endpoints.
  // LISTEN needs a session-bound connection, not PgBouncer's transaction pool.
  url.hostname = url.hostname.replace(/-pooler\./, ".");
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000, keepAlive: true });
}

/** One direct LISTEN connection per active function instance, shared by its viewers. */
export class SessionEventHub {
  private subscriptions = new Set<Subscription>();
  private client?: Client;
  private ready?: Promise<void>;

  async subscribe(subscription: Subscription) {
    this.subscriptions.add(subscription);
    const unsubscribe = () => {
      this.subscriptions.delete(subscription);
      if (this.subscriptions.size === 0) this.disconnect();
    };
    try {
      if (!this.client) {
        const client = createListener();
        this.client = client;
        client.on("notification", (notification: Notification) => {
          if (notification.channel !== CHANNEL || !notification.payload) return;
          let event: { sessionId?: unknown; kind?: unknown };
          try { event = JSON.parse(notification.payload); } catch { return; }
          if (!event || typeof event !== "object") return;
          if (!isTaskSessionId(event.sessionId) || (event.kind !== "snapshot" && event.kind !== "reply" && event.kind !== "presence")) return;
          for (const listener of this.subscriptions) {
            if (listener.sessionId === event.sessionId) listener.onChange(event.kind);
          }
        });
        const fail = () => {
          if (this.client !== client) return;
          const listeners = [...this.subscriptions];
          this.subscriptions.clear();
          this.disconnect();
          for (const listener of listeners) listener.onDisconnect();
        };
        client.on("error", fail);
        client.on("end", fail);
        this.ready = client.connect().then(async () => { await client.query(`LISTEN ${CHANNEL}`); });
      }
      await this.ready;
      return unsubscribe;
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  private disconnect() {
    const client = this.client;
    this.client = undefined;
    this.ready = undefined;
    void client?.end().catch(() => undefined);
  }
}

const globals = globalThis as typeof globalThis & { __hiveSessionEvents?: SessionEventHub };
export const sessionEvents = globals.__hiveSessionEvents ??= new SessionEventHub();
