import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Cache of each web user's authorization decision from the authz service. NOT
// the source of truth — has a TTL (re-validated against authz when stale) and is
// cleared immediately when authz pushes a revocation.
export const webAuthzCache = pgTable("web_authz_cache", {
	subject: text("subject").primaryKey(),
	authorized: boolean("authorized").notNull(),
	checkedAt: timestamp("checked_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
