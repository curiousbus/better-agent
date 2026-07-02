import type { AdminUserRow, RefreshTokenRecord, User, UserKind } from "./types";

export interface UserStore {
	createWithPassword(
		email: string,
		passwordHash: string,
		kind: UserKind
	): Promise<User>;
	deleteById(userId: string): Promise<void>;
	findByEmail(email: string): Promise<User | null>;
	findById(id: string): Promise<User | null>;
	findCredentialByEmail(email: string): Promise<{
		id: string;
		email: string;
		passwordHash: string | null;
		kind: UserKind;
		blocked: boolean;
	} | null>;
	findOrCreate(email: string): Promise<User>;
	hasPassword(userId: string): Promise<boolean>;
	isAdmin(userId: string): Promise<boolean>;
	isEmailVerified(userId: string): Promise<boolean>;
	listByKind(kind: UserKind): Promise<AdminUserRow[]>;
	markEmailVerified(userId: string): Promise<void>;
	/** Suspend (or un-suspend) a user. */
	setBlocked(userId: string, blocked: boolean): Promise<void>;
	setPasswordHash(userId: string, passwordHash: string): Promise<void>;
	/** Promote a user to staff (back-office admin). */
	setStaff(userId: string): Promise<void>;
}

export interface MagicLinkStore {
	consume(tokenHash: string): Promise<{ email: string } | null>;
	create(input: {
		tokenHash: string;
		email: string;
		expiresAt: Date;
	}): Promise<void>;
}

export interface RefreshTokenStore {
	create(input: {
		userId: string;
		tokenHash: string;
		expiresAt: Date;
		userAgent?: string | null;
	}): Promise<void>;
	find(tokenHash: string): Promise<RefreshTokenRecord | null>;
	listActiveByUser(userId: string): Promise<RefreshTokenRecord[]>;
	revoke(id: string): Promise<void>;
	revokeAllForUser(userId: string): Promise<void>;
	revokeForUser(id: string, userId: string): Promise<void>;
	revokeOthersForUser(userId: string, exceptTokenHash: string): Promise<void>;
}

export interface PasswordResetStore {
	/** Single-use: returns the userId and marks it used; null if missing/used/expired. */
	consume(tokenHash: string): Promise<{ userId: string } | null>;
	create(input: {
		userId: string;
		tokenHash: string;
		expiresAt: Date;
	}): Promise<void>;
}
