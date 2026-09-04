DELETE FROM "task_session_presence" presence
WHERE NOT EXISTS (
	SELECT 1 FROM "users" WHERE "users"."id" = presence."member_id"
);--> statement-breakpoint
ALTER TABLE "task_session_presence" ADD CONSTRAINT "task_session_presence_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_session_members_member_id_idx" ON "task_session_members" USING btree ("member_id");
