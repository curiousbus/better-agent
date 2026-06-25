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

function toUserRow(row: { id: string; email: string; createdAt: Date }) {
	return { id: row.id, email: row.email, createdAt: row.createdAt };
}

async function dbFindUserByEmail(db: Db, email: string) {
	const rows = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, email))
		.limit(1);
	const row = rows[0];
	return row ? toUserRow(row) : null;
}

async function dbFindOrCreate(db: Db, email: string) {
	const existing = await dbFindUserByEmail(db, email);
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
		return toUserRow(row);
	}
	// Lost an insert race: another request created it concurrently.
	const fallback = await dbFindUserByEmail(db, email);
	if (!fallback) {
		throw new Error("Failed to create user");
	}
	return fallback;
}

async function dbCreateWithPassword(
	db: Db,
	email: string,
	passwordHash: string
) {
	const inserted = await db
		.insert(schema.users)
		.values({ email, passwordHash })
		.returning();
	const row = inserted[0];
	if (!row) {
		throw new Error("Failed to create user");
	}
	return toUserRow(row);
}

async function dbFindCredentialByEmail(db: Db, email: string) {
	const rows = await db
		.select({
			id: schema.users.id,
			email: schema.users.email,
			passwordHash: schema.users.passwordHash,
		})
		.from(schema.users)
		.where(eq(schema.users.email, email))
		.limit(1);
	const row = rows[0];
	return row
		? { id: row.id, email: row.email, passwordHash: row.passwordHash }
		: null;
}

async function dbHasPassword(db: Db, userId: string) {
	const rows = await db
		.select({ passwordHash: schema.users.passwordHash })
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1);
	return rows[0] ? rows[0].passwordHash !== null : false;
}

export function createUserStore(db: Db): UserStore {
	return {
		async findById(id) {
			const rows = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.id, id))
				.limit(1);
			return rows[0] ? toUserRow(rows[0]) : null;
		},
		findByEmail: (email) => dbFindUserByEmail(db, email),
		findOrCreate: (email) => dbFindOrCreate(db, email),
		createWithPassword: (email, passwordHash) =>
			dbCreateWithPassword(db, email, passwordHash),
		async setPasswordHash(userId, passwordHash) {
			await db
				.update(schema.users)
				.set({ passwordHash, updatedAt: new Date() })
				.where(eq(schema.users.id, userId));
		},
		findCredentialByEmail: (email) => dbFindCredentialByEmail(db, email),
		hasPassword: (userId) => dbHasPassword(db, userId),
		async markEmailVerified(userId) {
			await db
				.update(schema.users)
				.set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
				.where(eq(schema.users.id, userId));
		},
		async isEmailVerified(userId) {
			const rows = await db
				.select({ emailVerifiedAt: schema.users.emailVerifiedAt })
				.from(schema.users)
				.where(eq(schema.users.id, userId))
				.limit(1);
			return rows[0] ? rows[0].emailVerifiedAt !== null : false;
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
