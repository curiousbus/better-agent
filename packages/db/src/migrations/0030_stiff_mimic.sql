CREATE TABLE "bridge_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_messages" ADD CONSTRAINT "bridge_messages_session_id_bridge_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."bridge_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_messages_session_id_seq_idx" ON "bridge_messages" USING btree ("session_id","seq");