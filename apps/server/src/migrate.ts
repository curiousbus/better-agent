import { runMigrations } from "@better-agent/db/migrate-runner";
import { env } from "@better-agent/env/server";
import { initLogger, log } from "evlog";

// Runs pending drizzle migrations against DATABASE_URL, then exits. Used by
// the k8s migrate Job (same server image, `node dist/migrate.mjs`) so prod
// deploys never need drizzle-kit at runtime.
initLogger({ env: { service: "better-agent-migrate" } });

const migrationsFolder = process.env.MIGRATIONS_DIR ?? "./migrations";

try {
	await runMigrations(env.DATABASE_URL, migrationsFolder);
	log.info("migrate", `Migrations applied from ${migrationsFolder}`);
	process.exit(0);
} catch (error) {
	log.error("migrate", error instanceof Error ? error.message : String(error));
	process.exit(1);
}
