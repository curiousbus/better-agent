ALTER TABLE "bridge_tokens" ADD COLUMN "agent_kind" text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_tokens" ADD COLUMN "token" text;