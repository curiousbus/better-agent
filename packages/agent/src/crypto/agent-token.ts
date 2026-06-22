import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "ba_";
const TOKEN_BYTES = 32;

export interface TokenService {
	generate(): { token: string; hash: string };
	hash(token: string): string;
}

export function createTokenService(): TokenService {
	const hash = (token: string): string =>
		createHash("sha256").update(token).digest("hex");
	return {
		hash,
		generate() {
			const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
			return { token, hash: hash(token) };
		},
	};
}
