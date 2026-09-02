CREATE TABLE "room_presence" (
	"room_id" text NOT NULL,
	"member_id" text NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"typing" boolean DEFAULT false NOT NULL,
	CONSTRAINT "room_presence_room_id_member_id_pk" PRIMARY KEY("room_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"revision" integer NOT NULL,
	"stage" text NOT NULL,
	"messages" jsonb NOT NULL,
	"decision" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_presence" ADD CONSTRAINT "room_presence_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;