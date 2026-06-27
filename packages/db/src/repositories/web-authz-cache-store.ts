import type { WebAuthzCacheStore } from "@better-agent/agent/ports";
import { eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createWebAuthzCacheStore(db: Db): WebAuthzCacheStore {
	return {
		async get(subject) {
			const rows = await db
				.select()
				.from(schema.webAuthzCache)
				.where(eq(schema.webAuthzCache.subject, subject))
				.limit(1);
			return rows[0] ?? null;
		},
		async set(subject, authorized) {
			await db
				.insert(schema.webAuthzCache)
				.values({ subject, authorized, checkedAt: new Date() })
				.onConflictDoUpdate({
					target: schema.webAuthzCache.subject,
					set: { authorized, checkedAt: new Date() },
				});
		},
		async clear(subjects) {
			if (subjects.length === 0) {
				return;
			}
			await db
				.delete(schema.webAuthzCache)
				.where(inArray(schema.webAuthzCache.subject, subjects));
		},
	};
}
