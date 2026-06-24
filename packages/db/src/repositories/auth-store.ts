import type {
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "@better-agent/agent/ports";
import { and, eq, gt, isNull } from "drizzle-orm";
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
			const rows = await db.insert(schema.users).values({ email }).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create user");
			}
			return { id: row.id, email: row.email, createdAt: row.createdAt };
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

export function createRefreshTokenStore(db: Db): RefreshTokenStore {
	return {
		async create(input) {
			await db.insert(schema.refreshTokens).values(input);
		},
		async find(tokenHash) {
			const rows = await db
				.select()
				.from(schema.refreshTokens)
				.where(eq(schema.refreshTokens.tokenHash, tokenHash))
				.limit(1);
			const row = rows[0];
			return row
				? {
						id: row.id,
						userId: row.userId,
						expiresAt: row.expiresAt,
						revokedAt: row.revokedAt,
					}
				: null;
		},
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
	};
}
