CREATE TABLE "web_authz_cache" (
	"subject" text PRIMARY KEY NOT NULL,
	"authorized" boolean NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
