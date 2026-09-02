import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  ActiveSteer,
  Annotation,
  ChatMessage,
  MemberId,
  RepositoryState,
  RunStage,
  SteeringQueueItem,
  WorkspaceState,
} from "@/lib/room";

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  revision: integer("revision").notNull(),
  stage: text("stage").$type<RunStage>().notNull(),
  messages: jsonb("messages").$type<ChatMessage[]>().notNull(),
  annotation: jsonb("decision").$type<Annotation>().notNull(),
  steeringQueue: jsonb("steering_queue")
    .$type<SteeringQueueItem[]>()
    .notNull()
    .default([]),
  activeSteer: jsonb("active_steer").$type<ActiveSteer>(),
  repository: jsonb("repository").$type<RepositoryState>(),
  workspace: jsonb("workspace")
    .$type<WorkspaceState>()
    .notNull()
    .default({
      status: "disconnected",
      diff: "",
      files: [],
      commands: [],
      changedFiles: [],
    }),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

export const roomPresence = pgTable(
  "room_presence",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    memberId: text("member_id").$type<MemberId>().notNull(),
    lastSeen: timestamp("last_seen", { mode: "date", withTimezone: true }).notNull(),
    typing: boolean("typing").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.memberId] })],
);
