ALTER TABLE "rooms" ADD COLUMN "steering_queue" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "active_steer" jsonb;