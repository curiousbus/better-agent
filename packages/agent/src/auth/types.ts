// Two separate populations: customers sign up on apps/web; staff are
// back-office (apps/admin) users, created only by an admin. Staff are admins.
export type UserKind = "customer" | "staff";

export interface User {
	createdAt: Date;
	email: string;
	id: string;
}

export interface AdminUserRow {
	createdAt: Date;
	email: string;
	emailVerified: boolean;
	hasPassword: boolean;
	id: string;
	isAdmin: boolean;
	kind: UserKind;
}

export interface RefreshTokenRecord {
	createdAt: Date;
	expiresAt: Date;
	id: string;
	revokedAt: Date | null;
	tokenHash: string;
	userAgent: string | null;
	userId: string;
}
