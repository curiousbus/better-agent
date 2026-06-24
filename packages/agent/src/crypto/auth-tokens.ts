import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateToken(prefix: string): string {
	return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
