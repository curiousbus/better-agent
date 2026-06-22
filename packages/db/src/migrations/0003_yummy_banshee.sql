ALTER TABLE "agents" ADD COLUMN "token_hash" text;--> statement-breakpoint
UPDATE "agents" SET "token_hash" = md5("id"::text || random()::text) WHERE "token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_token_hash_unique" ON "agents" USING btree ("token_hash");
