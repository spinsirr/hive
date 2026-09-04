CREATE TABLE "github_installations" (
	"id" bigint PRIMARY KEY NOT NULL,
	"installed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_session_members" (
	"session_id" text NOT NULL,
	"member_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_session_members_session_id_member_id_pk" PRIMARY KEY("session_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" RENAME TO "auth_sessions";--> statement-breakpoint
ALTER TABLE "room_presence" RENAME TO "task_session_presence";--> statement-breakpoint
ALTER TABLE "rooms" RENAME TO "task_sessions";--> statement-breakpoint
ALTER TABLE "task_session_presence" RENAME COLUMN "room_id" TO "session_id";--> statement-breakpoint
ALTER TABLE "task_session_presence" DROP CONSTRAINT "room_presence_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT "sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_session_presence" DROP CONSTRAINT "room_presence_room_id_member_id_pk";--> statement-breakpoint
ALTER TABLE "task_session_presence" ADD CONSTRAINT "task_session_presence_session_id_member_id_pk" PRIMARY KEY("session_id","member_id");--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN "title" text DEFAULT 'Untitled task' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN "lifecycle" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_session_members" ADD CONSTRAINT "task_session_members_session_id_task_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."task_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_session_members" ADD CONSTRAINT "task_session_members_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_session_presence" ADD CONSTRAINT "task_session_presence_session_id_task_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."task_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "task_session_members" ("session_id", "member_id", "joined_at")
SELECT presence."session_id", presence."member_id", MIN(presence."last_seen")
FROM "task_session_presence" presence
INNER JOIN "users" ON "users"."id" = presence."member_id"
GROUP BY presence."session_id", presence."member_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "task_sessions"
SET "title" = INITCAP(REPLACE("id", '-', ' '))
WHERE "title" = 'Untitled task';--> statement-breakpoint
UPDATE "task_sessions"
SET "created_by" = members."member_id"
FROM (
	SELECT DISTINCT ON ("session_id") "session_id", "member_id"
	FROM "task_session_members"
	ORDER BY "session_id", "joined_at" ASC
) members
WHERE "task_sessions"."id" = members."session_id"
	AND "task_sessions"."created_by" IS NULL;
