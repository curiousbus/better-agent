ALTER TABLE "composio_accounts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "composio_accounts" ADD CONSTRAINT "composio_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composio_accounts_user_id_idx" ON "composio_accounts" USING btree ("user_id");