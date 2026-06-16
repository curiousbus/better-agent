CREATE TABLE "models_cache" (
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"name" text NOT NULL,
	"context_limit" integer,
	"max_output_tokens" integer,
	"input_price_per_m" real,
	"output_price_per_m" real,
	"capabilities" jsonb NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_cache_provider_id_model_id_pk" PRIMARY KEY("provider_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"api_key_cipher" text NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers_catalog" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"npm" text,
	"default_base_url" text,
	"env_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
