CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"status" text DEFAULT 'future' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sprint_id" uuid;--> statement-breakpoint
CREATE INDEX "sprints_user_id" ON "sprints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sprints_user_status" ON "sprints" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_user_sprint_status_position" ON "tasks" USING btree ("user_id","sprint_id","status","position");
--> statement-breakpoint
UPDATE "tasks" t SET "seq" = sub.rn FROM (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM "tasks"
) sub WHERE t.id = sub.id;