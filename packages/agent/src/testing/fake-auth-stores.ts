import type { RefreshTokenRecord, User } from "../auth/types";
import type {
	EmailSender,
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "../ports";

interface FakeUserRecord extends User {
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

export function createFakeUserStore(): UserStore {
	const byId = new Map<string, FakeUserRecord>();
	const byEmail = new Map<string, FakeUserRecord>();
	const ins = (r: FakeUserRecord) => insertRecord(byId, byEmail, r);

	return {
		findById(id) {
			const r = byId.get(id);
			return Promise.resolve(r ? toUser(r) : null);
		},
		findByEmail(email) {
			const r = byEmail.get(email);
			return Promise.resolve(r ? toUser(r) : null);
		},
		findOrCreate(email) {
			const existing = byEmail.get(email);
			if (existing) {
				return Promise.resolve(toUser(existing));
			}
			const record = makeUserRecord(email);
			ins(record);
			return Promise.resolve(toUser(record));
		},
		createWithPassword(email, passwordHash) {
			const record = makeUserRecord(email, passwordHash);
			ins(record);
			return Promise.resolve(toUser(record));
		},
		setPasswordHash(userId, passwordHash) {
			const record = byId.get(userId);
			if (record) {
				record.passwordHash = passwordHash;
			}
			return Promise.resolve();
		},
		findCredentialByEmail(email) {
			const r = byEmail.get(email);
			return Promise.resolve(r ? toCredential(r) : null);
		},
		hasPassword(userId) {
			const r = byId.get(userId);
			return Promise.resolve(r ? r.passwordHash !== null : false);
		},
	};
}

interface FakeLink {
	email: string;
	expiresAt: Date;
	usedAt: Date | null;
}

export function createFakeMagicLinkStore(): MagicLinkStore {
	const links = new Map<string, FakeLink>();
	return {
		create({ tokenHash, email, expiresAt }) {
			links.set(tokenHash, { email, expiresAt, usedAt: null });
			return Promise.resolve();
		},
		consume(tokenHash) {
			const link = links.get(tokenHash);
			if (!link || link.usedAt || link.expiresAt < new Date()) {
				return Promise.resolve(null);
			}
			link.usedAt = new Date();
			return Promise.resolve({ email: link.email });
		},
	};
}

function activeRows(
	rows: Map<string, RefreshTokenRecord>,
	userId: string
): RefreshTokenRecord[] {
	const now = new Date();
	return [...rows.values()].filter(
		(r) => r.userId === userId && r.revokedAt === null && r.expiresAt > now
	);
}

function revokeMatching(
	rows: Map<string, RefreshTokenRecord>,
	pred: (r: RefreshTokenRecord) => boolean
): void {
	const now = new Date();
	for (const row of rows.values()) {
		if (pred(row)) {
			row.revokedAt = now;
		}
	}
}

function makeRow(
	userId: string,
	tokenHash: string,
	expiresAt: Date,
	userAgent: string | null
): RefreshTokenRecord {
	return {
		id: crypto.randomUUID(),
		userId,
		tokenHash,
		expiresAt,
		revokedAt: null,
		createdAt: new Date(),
		userAgent,
	};
}

function findByHash(
	rows: Map<string, RefreshTokenRecord>,
	tokenHash: string
): RefreshTokenRecord | null {
	for (const row of rows.values()) {
		if (row.tokenHash === tokenHash) {
			return row;
		}
	}
	return null;
}

export function createFakeRefreshTokenStore(): RefreshTokenStore {
	const rows = new Map<string, RefreshTokenRecord>();
	return {
		create({ userId, tokenHash, expiresAt, userAgent = null }) {
			const row = makeRow(userId, tokenHash, expiresAt, userAgent);
			rows.set(row.id, row);
			return Promise.resolve();
		},
		find: (tokenHash) => Promise.resolve(findByHash(rows, tokenHash)),
		revoke(id) {
			const row = rows.get(id);
			if (row) {
				row.revokedAt = new Date();
			}
			return Promise.resolve();
		},
		revokeAllForUser: (userId) => {
			revokeMatching(rows, (r) => r.userId === userId);
			return Promise.resolve();
		},
		listActiveByUser(userId) {
			const active = activeRows(rows, userId);
			active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
			return Promise.resolve(active);
		},
		revokeForUser(id, userId) {
			const row = rows.get(id);
			if (row && row.userId === userId) {
				row.revokedAt = new Date();
			}
			return Promise.resolve();
		},
		revokeOthersForUser: (userId, exceptTokenHash) => {
			revokeMatching(
				rows,
				(r) =>
					r.userId === userId &&
					r.tokenHash !== exceptTokenHash &&
					r.revokedAt === null
			);
			return Promise.resolve();
		},
	};
}

export function createFakeEmailSender(): EmailSender & {
	sent: { email: string; url: string }[];
} {
	const sent: { email: string; url: string }[] = [];
	return {
		sent,
		sendMagicLink(input) {
			sent.push(input);
			return Promise.resolve();
		},
	};
}
