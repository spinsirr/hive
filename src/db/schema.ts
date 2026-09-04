import {
  bigint,
  boolean,
  index,
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
} from "@/lib/task-session";

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

export const authSessions = pgTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
});

export const taskSessions = pgTable("task_sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled task"),
  lifecycle: text("lifecycle")
    .$type<"active" | "completed">()
    .notNull()
    .default("active"),
  createdBy: text("created_by").$type<MemberId>(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", {
    mode: "date",
    withTimezone: true,
  }),
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

export const taskSessionMembers = pgTable(
  "task_session_members",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .$type<MemberId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.memberId] }),
    index("task_session_members_member_id_idx").on(table.memberId),
  ],
);

export const githubInstallations = pgTable("github_installations", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  installedBy: text("installed_by")
    .$type<MemberId>()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const taskSessionPresence = pgTable(
  "task_session_presence",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .$type<MemberId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastSeen: timestamp("last_seen", { mode: "date", withTimezone: true }).notNull(),
    typing: boolean("typing").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.memberId] })],
);
