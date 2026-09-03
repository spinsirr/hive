import {
  bigint,
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

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  githubUserId: bigint("github_user_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  initials: text("initials").notNull(),
  avatarUrl: text("avatar_url"),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
});

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
