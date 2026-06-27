ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "kind" = 'staff' WHERE "is_admin" = true;