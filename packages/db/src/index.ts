import { env } from "@better-agent/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "./schema";

export function createDb() {
	return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
