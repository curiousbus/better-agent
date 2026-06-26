import { drizzle } from "drizzle-orm/node-postgres";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace object
import * as schema from "./schema";

export function createNodeDb(url: string) {
	return drizzle(url, { schema });
}
