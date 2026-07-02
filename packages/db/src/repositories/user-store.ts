import type { UserKind } from "@better-agent/agent/auth/types";
import type { UserStore } from "@better-agent/agent/ports";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toUserRow(row: {
	id: string;
	email: string;
	createdAt: Date;
	blocked: boolean;
}) {
	return {
		id: row.id,
		email: row.email,
		createdAt: row.createdAt,
		blocked: row.blocked,
	};
}

function toAdminUserRow(row: {
	id: string;
	email: string;
	createdAt: Date;
	emailVerifiedAt: Date | null;
	passwordHash: string | null;
	isAdmin: boolean;
	kind: UserKind;
	blocked: boolean;
	blockedAt: Date | null;
}) {
	return {
		id: row.id,
		email: row.email,
		createdAt: row.createdAt,
		emailVerified: row.emailVerifiedAt !== null,
		hasPassword: row.passwordHash !== null,
		isAdmin: row.isAdmin,
		kind: row.kind,
		blocked: row.blocked,
		blockedAt: row.blockedAt,
	};
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
	passwordHash: string,
	kind: UserKind
) {
	const inserted = await db
		.insert(schema.users)
		.values({ email, passwordHash, kind, isAdmin: kind === "staff" })
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
			kind: schema.users.kind,
			blocked: schema.users.blocked,
		})
		.from(schema.users)
		.where(eq(schema.users.email, email))
		.limit(1);
	const row = rows[0];
	return row
		? {
				id: row.id,
				email: row.email,
				passwordHash: row.passwordHash,
				kind: row.kind,
				blocked: row.blocked,
			}
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

async function dbIsEmailVerified(db: Db, userId: string) {
	const rows = await db
		.select({ emailVerifiedAt: schema.users.emailVerifiedAt })
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1);
	return rows[0] ? rows[0].emailVerifiedAt !== null : false;
}

async function dbSetBlocked(db: Db, userId: string, blocked: boolean) {
	await db
		.update(schema.users)
		.set({
			blocked,
			blockedAt: blocked ? new Date() : null,
			updatedAt: new Date(),
		})
		.where(eq(schema.users.id, userId));
}

async function dbIsAdmin(db: Db, userId: string) {
	const rows = await db
		.select({ isAdmin: schema.users.isAdmin })
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1);
	return rows[0]?.isAdmin ?? false;
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
		createWithPassword: (email, hash, kind) =>
			dbCreateWithPassword(db, email, hash, kind),
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
		isEmailVerified: (userId) => dbIsEmailVerified(db, userId),
		async listByKind(kind) {
			const rows = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.kind, kind))
				.orderBy(desc(schema.users.createdAt));
			return rows.map(toAdminUserRow);
		},
		async setStaff(userId) {
			await db
				.update(schema.users)
				.set({ kind: "staff", isAdmin: true, updatedAt: new Date() })
				.where(eq(schema.users.id, userId));
		},
		isAdmin: (userId) => dbIsAdmin(db, userId),
		setBlocked: (userId, blocked) => dbSetBlocked(db, userId, blocked),
		async deleteById(userId) {
			await db.delete(schema.users).where(eq(schema.users.id, userId));
		},
	};
}
