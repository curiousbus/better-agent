import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: "../../apps/server/.env" });

export default defineConfig({
	schema: "./src/schema.ts",
	out: "./src/migrations",
	dialect: "postgresql",
	// Track migrations under a dedicated table so authz can safely share a
	// Postgres instance with the main server (until it gets its own database).
	migrations: { table: "__authz_migrations" },
	dbCredentials: {
		url: process.env.AUTHZ_DATABASE_URL || process.env.DATABASE_URL || "",
	},
});
