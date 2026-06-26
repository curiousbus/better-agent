import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(plain: string): string {
	const salt = randomBytes(SALT_BYTES).toString("hex");
	const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
	return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
	const [scheme, salt, hash] = stored.split(":");
	if (scheme !== "scrypt" || !(salt && hash)) {
		return false;
	}
	const expected = Buffer.from(hash, "hex");
	const actual = scryptSync(plain, salt, KEYLEN);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let cachedDummyHash: string | null = null;

// A valid scrypt hash for an unguessable secret — used to equalize timing on
// the "no such user / no password" path so login can't be used to enumerate.
// Computed lazily (NOT at module load): Workers forbid generating random values
// in global scope, so this must run inside a request handler.
export function dummyPasswordHash(): string {
	if (cachedDummyHash === null) {
		cachedDummyHash = hashPassword(randomBytes(32).toString("hex"));
	}
	return cachedDummyHash;
}
