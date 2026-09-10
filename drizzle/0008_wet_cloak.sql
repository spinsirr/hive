CREATE TABLE "codex_subscriptions" (
	"account_hash" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"encrypted_auth" text NOT NULL,
	"refresh_lock" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_subscriptions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "codex_subscriptions" ADD CONSTRAINT "codex_subscriptions_session_id_task_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."task_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_subscriptions" ADD CONSTRAINT "codex_subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;