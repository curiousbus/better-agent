import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace object
import * as schema from "./schema";

export function createNeonDb(url: string) {
	return drizzle(new Pool({ connectionString: url }), { schema });
}
