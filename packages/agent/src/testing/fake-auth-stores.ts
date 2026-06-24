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

export function createFakeRefreshTokenStore(): RefreshTokenStore {
	const rows = new Map<string, RefreshTokenRecord & { tokenHash: string }>();
	return {
		create({ userId, tokenHash, expiresAt }) {
			const id = crypto.randomUUID();
			rows.set(id, { id, userId, tokenHash, expiresAt, revokedAt: null });
			return Promise.resolve();
		},
		find(tokenHash) {
			for (const row of rows.values()) {
				if (row.tokenHash === tokenHash) {
					return Promise.resolve(row);
				}
			}
			return Promise.resolve(null);
		},
		revoke(id) {
			const row = rows.get(id);
			if (row) {
				row.revokedAt = new Date();
			}
			return Promise.resolve();
		},
		revokeAllForUser(userId) {
			for (const row of rows.values()) {
				if (row.userId === userId) {
					row.revokedAt = new Date();
				}
			}
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
