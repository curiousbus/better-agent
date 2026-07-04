CREATE TABLE "bridge_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"agent_kind" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"token_hash" text NOT NULL,
	"last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "bridge_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "bridge_sessions" ADD CONSTRAINT "bridge_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_sessions" ADD CONSTRAINT "bridge_sessions_token_id_bridge_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."bridge_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_tokens" ADD CONSTRAINT "bridge_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_sessions_user_id_idx" ON "bridge_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bridge_tokens_user_id_idx" ON "bridge_tokens" USING btree ("user_id");