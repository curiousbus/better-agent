export interface User {
	createdAt: Date;
	email: string;
	id: string;
}

export interface RefreshTokenRecord {
	expiresAt: Date;
	id: string;
	revokedAt: Date | null;
	userId: string;
}
