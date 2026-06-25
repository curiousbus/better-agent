import type {
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "@better-agent/agent/ports";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createUserStore(db: Db): UserStore {
	return {
		async findById(id) {
			const rows = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.id, id))
				.limit(1);
			const row = rows[0];
			return row
				? { id: row.id, email: row.email, createdAt: row.createdAt }
				: null;
		},
		async findByEmail(email) {
			const rows = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.email, email))
				.limit(1);
			const row = rows[0];
			return row
				? { id: row.id, email: row.email, createdAt: row.createdAt }
				: null;
		},
		async findOrCreate(email) {
			const existing = await this.findByEmail(email);
			if (existing) {
				return existing;
			}
			const inserted = await db
				.insert(schema.users)
				.values({ email })
				.onConflictDoNothing()
				.returning();
			const row = inserted[0];
			if (row) {
				return { id: row.id, email: row.email, createdAt: row.createdAt };
			}
			// Lost an insert race: another request created it concurrently.
			const fallback = await this.findByEmail(email);
			if (!fallback) {
				throw new Error("Failed to create user");
			}
			return fallback;
		},
	};
}

export function createMagicLinkStore(db: Db): MagicLinkStore {
	return {
		async create(input) {
			await db.insert(schema.magicLinks).values(input);
		},
		async consume(tokenHash) {
			const rows = await db
				.select()
				.from(schema.magicLinks)
				.where(
					and(
						eq(schema.magicLinks.tokenHash, tokenHash),
						isNull(schema.magicLinks.usedAt),
						gt(schema.magicLinks.expiresAt, new Date())
					)
				)
				.limit(1);
			const row = rows[0];
			if (!row) {
				return null;
			}
			await db
				.update(schema.magicLinks)
				.set({ usedAt: new Date() })
				.where(eq(schema.magicLinks.id, row.id));
			return { email: row.email };
		},
	};
}

function rowToRecord(row: {
	id: string;
	userId: string;
	tokenHash: string;
	expiresAt: Date;
	revokedAt: Date | null;
	createdAt: Date;
	userAgent: string | null;
}) {
	return {
		id: row.id,
		userId: row.userId,
		tokenHash: row.tokenHash,
		expiresAt: row.expiresAt,
		revokedAt: row.revokedAt,
		createdAt: row.createdAt,
		userAgent: row.userAgent,
	};
}

async function findRefreshToken(db: Db, tokenHash: string) {
	const rows = await db
		.select()
		.from(schema.refreshTokens)
		.where(eq(schema.refreshTokens.tokenHash, tokenHash))
		.limit(1);
	const row = rows[0];
	return row ? rowToRecord(row) : null;
}

async function listActiveRefreshTokens(db: Db, userId: string) {
	const rows = await db
		.select()
		.from(schema.refreshTokens)
		.where(
			and(
				eq(schema.refreshTokens.userId, userId),
				isNull(schema.refreshTokens.revokedAt),
				gt(schema.refreshTokens.expiresAt, new Date())
			)
		)
		.orderBy(desc(schema.refreshTokens.createdAt));
	return rows.map(rowToRecord);
}

export function createRefreshTokenStore(db: Db): RefreshTokenStore {
	return {
		async create(input) {
			await db.insert(schema.refreshTokens).values(input);
		},
		find: (tokenHash) => findRefreshToken(db, tokenHash),
		listActiveByUser: (userId) => listActiveRefreshTokens(db, userId),
		async revoke(id) {
			await db
				.update(schema.refreshTokens)
				.set({ revokedAt: new Date() })
				.where(eq(schema.refreshTokens.id, id));
		},
		async revokeAllForUser(userId) {
			await db
				.update(schema.refreshTokens)
				.set({ revokedAt: new Date() })
				.where(eq(schema.refreshTokens.userId, userId));
		},
		async revokeForUser(id, userId) {
			await db
				.update(schema.refreshTokens)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(schema.refreshTokens.id, id),
						eq(schema.refreshTokens.userId, userId)
					)
				);
		},
		async revokeOthersForUser(userId, exceptTokenHash) {
			await db
				.update(schema.refreshTokens)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(schema.refreshTokens.userId, userId),
						isNull(schema.refreshTokens.revokedAt),
						ne(schema.refreshTokens.tokenHash, exceptTokenHash)
					)
				);
		},
	};
}
