import type { AdminUserRow, User } from "../auth/types";
import type { UserStore } from "../ports";

interface FakeUserRecord extends User {
	emailVerifiedAt: Date | null;
	isAdmin: boolean;
	passwordHash: string | null;
}

function toUser(record: FakeUserRecord): User {
	return { id: record.id, email: record.email, createdAt: record.createdAt };
}

function makeUserRecord(
	email: string,
	passwordHash: string | null = null
): FakeUserRecord {
	return {
		id: crypto.randomUUID(),
		email,
		createdAt: new Date(),
		passwordHash,
		emailVerifiedAt: null,
		isAdmin: false,
	};
}

function insertRecord(
	byId: Map<string, FakeUserRecord>,
	byEmail: Map<string, FakeUserRecord>,
	record: FakeUserRecord
): void {
	byId.set(record.id, record);
	byEmail.set(record.email, record);
}

function toCredential(record: FakeUserRecord) {
	return {
		id: record.id,
		email: record.email,
		passwordHash: record.passwordHash,
	};
}

function toAdminUserRow(record: FakeUserRecord): AdminUserRow {
	return {
		id: record.id,
		email: record.email,
		createdAt: record.createdAt,
		emailVerified: record.emailVerifiedAt !== null,
		hasPassword: record.passwordHash !== null,
		isAdmin: record.isAdmin,
	};
}

function lookupUser(
	map: Map<string, FakeUserRecord>,
	key: string
): User | null {
	const r = map.get(key);
	return r ? toUser(r) : null;
}

function lookupCredential(byEmail: Map<string, FakeUserRecord>, email: string) {
	const r = byEmail.get(email);
	return r ? toCredential(r) : null;
}

interface UserMaps {
	byEmail: Map<string, FakeUserRecord>;
	byId: Map<string, FakeUserRecord>;
}

function fakeFindOrCreate(maps: UserMaps, email: string): User {
	const existing = maps.byEmail.get(email);
	if (existing) {
		return toUser(existing);
	}
	const record = makeUserRecord(email);
	insertRecord(maps.byId, maps.byEmail, record);
	return toUser(record);
}

function fakeMarkEmailVerified(maps: UserMaps, userId: string): void {
	const record = maps.byId.get(userId);
	if (record) {
		record.emailVerifiedAt = new Date();
	}
}

function fakeSetAdmin(maps: UserMaps, userId: string, isAdmin: boolean): void {
	const record = maps.byId.get(userId);
	if (record) {
		record.isAdmin = isAdmin;
	}
}

function fakeDeleteById(maps: UserMaps, userId: string): void {
	const record = maps.byId.get(userId);
	if (record) {
		maps.byId.delete(userId);
		maps.byEmail.delete(record.email);
	}
}

export function createFakeUserStore(): UserStore {
	const maps: UserMaps = {
		byId: new Map<string, FakeUserRecord>(),
		byEmail: new Map<string, FakeUserRecord>(),
	};

	return {
		findById: (id) => Promise.resolve(lookupUser(maps.byId, id)),
		findByEmail: (email) => Promise.resolve(lookupUser(maps.byEmail, email)),
		findOrCreate: (email) => Promise.resolve(fakeFindOrCreate(maps, email)),
		createWithPassword(email, passwordHash) {
			const record = makeUserRecord(email, passwordHash);
			insertRecord(maps.byId, maps.byEmail, record);
			return Promise.resolve(toUser(record));
		},
		setPasswordHash(userId, passwordHash) {
			const record = maps.byId.get(userId);
			if (record) {
				record.passwordHash = passwordHash;
			}
			return Promise.resolve();
		},
		findCredentialByEmail: (email) =>
			Promise.resolve(lookupCredential(maps.byEmail, email)),
		hasPassword: (userId) =>
			Promise.resolve(maps.byId.get(userId)?.passwordHash != null),
		markEmailVerified: (userId) =>
			Promise.resolve(fakeMarkEmailVerified(maps, userId)),
		isEmailVerified: (userId) =>
			Promise.resolve(maps.byId.get(userId)?.emailVerifiedAt != null),
		listAll() {
			const rows = [...maps.byId.values()].sort(
				(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
			);
			return Promise.resolve(rows.map(toAdminUserRow));
		},
		setAdmin: (userId, isAdmin) =>
			Promise.resolve(fakeSetAdmin(maps, userId, isAdmin)),
		isAdmin: (userId) =>
			Promise.resolve(maps.byId.get(userId)?.isAdmin ?? false),
		deleteById: (userId) => Promise.resolve(fakeDeleteById(maps, userId)),
	};
}
