import type { RefreshTokenRecord, User } from "../auth/types";
import type {
	EmailSender,
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "../ports";

export function createFakeUserStore(): UserStore {
	const byId = new Map<string, User>();
	const byEmail = new Map<string, User>();
	return {
		findById(id) {
			return Promise.resolve(byId.get(id) ?? null);
		},
		findByEmail(email) {
			return Promise.resolve(byEmail.get(email) ?? null);
		},
		findOrCreate(email) {
			const existing = byEmail.get(email);
			if (existing) {
				return Promise.resolve(existing);
			}
			const user: User = {
				id: crypto.randomUUID(),
				email,
				createdAt: new Date(),
			};
			byId.set(user.id, user);
			byEmail.set(email, user);
			return Promise.resolve(user);
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
