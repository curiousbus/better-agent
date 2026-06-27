import { createJwtService } from "@better-agent/agent/crypto/jwt";
import { verifyPassword } from "@better-agent/agent/crypto/password";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { authzAdmins } from "./schema";

const ADMIN_TTL_SECONDS = 86_400;

export async function adminLogin(
	db: Db,
	jwtSecret: string,
	email: string,
	password: string
): Promise<string | null> {
	const rows = await db
		.select()
		.from(authzAdmins)
		.where(eq(authzAdmins.email, email))
		.limit(1);
	const admin = rows[0];
	if (!(admin && verifyPassword(password, admin.passwordHash))) {
		return null;
	}
	return createJwtService(jwtSecret).sign(
		{ email: admin.email, sub: admin.id },
		ADMIN_TTL_SECONDS
	);
}

export async function isValidAdminToken(
	jwtSecret: string,
	token: string | undefined
): Promise<boolean> {
	if (!token) {
		return false;
	}
	const claims = await createJwtService(jwtSecret).verify(token);
	return claims !== null;
}
