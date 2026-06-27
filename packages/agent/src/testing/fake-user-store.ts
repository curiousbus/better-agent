import type { AdminUserRow, User, UserKind } from "../auth/types";
import type { UserStore } from "../ports";

interface FakeUserRecord extends User {
	emailVerifiedAt: Date | null;
	isAdmin: boolean;
	kind: UserKind;
	passwordHash: string | null;
}

function toUser(record: FakeUserRecord): User {
	return { id: record.id, email: record.email, createdAt: record.createdAt };
}

function makeUserRecord(
	email: string,
	passwordHash: string | null = null,
	kind: UserKind = "customer"
): FakeUserRecord {
	return {
		id: crypto.randomUUID(),
		email,
		createdAt: new Date(),
		passwordHash,
		emailVerifiedAt: null,
		isAdmin: kind === "staff",
		kind,
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
		kind: record.kind,
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
		kind: record.kind,
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

function fakeSetStaff(maps: UserMaps, userId: string): void {
	const record = maps.byId.get(userId);
	if (record) {
		record.kind = "staff";
		record.isAdmin = true;
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
		createWithPassword(email, passwordHash, kind) {
			const record = makeUserRecord(email, passwordHash, kind);
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
		listByKind(kind) {
			const rows = [...maps.byId.values()]
				.filter((r) => r.kind === kind)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
			return Promise.resolve(rows.map(toAdminUserRow));
		},
		setStaff: (userId) => Promise.resolve(fakeSetStaff(maps, userId)),
		isAdmin: (userId) =>
			Promise.resolve(maps.byId.get(userId)?.isAdmin ?? false),
		deleteById: (userId) => Promise.resolve(fakeDeleteById(maps, userId)),
	};
}
