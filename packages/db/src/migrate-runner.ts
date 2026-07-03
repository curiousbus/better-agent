import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodeDb } from "./node-db";

/** Apply pending drizzle migrations against the given database. Used by the
 * k8s migrate Job (node runtime); drizzle-kit is not needed at runtime. */
export async function runMigrations(
	databaseUrl: string,
	migrationsFolder: string
): Promise<void> {
	const db = createNodeDb(databaseUrl);
	await migrate(db, { migrationsFolder });
}
