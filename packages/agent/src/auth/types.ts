export interface User {
	createdAt: Date;
	email: string;
	id: string;
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
