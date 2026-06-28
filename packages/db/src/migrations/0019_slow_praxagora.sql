CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attachments_message_id" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "attachments_session_id" ON "attachments" USING btree ("session_id");