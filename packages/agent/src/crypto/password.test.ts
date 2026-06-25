import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
	it("round-trips: correct password verifies true", () => {
		const hash = hashPassword("correct-horse-battery-staple");
		expect(verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
	});

	it("wrong password verifies false", () => {
		const hash = hashPassword("correct-horse-battery-staple");
		expect(verifyPassword("wrong-password", hash)).toBe(false);
	});

	it("tampered stored hash verifies false", () => {
		const hash = hashPassword("my-password");
		// Corrupt the hash portion
		const tampered = `${hash.slice(0, -4)}0000`;
		expect(verifyPassword("my-password", tampered)).toBe(false);
	});

	it("garbage stored string verifies false", () => {
		expect(verifyPassword("password", "not-a-valid-hash")).toBe(false);
		expect(verifyPassword("password", "")).toBe(false);
		expect(verifyPassword("password", "sha256:salt:hash")).toBe(false);
	});

	it("two hashes of the same password differ (random salt)", () => {
		const a = hashPassword("same-password");
		const b = hashPassword("same-password");
		expect(a).not.toBe(b);
	});

	it("DUMMY_PASSWORD_HASH is a valid scrypt hash format", () => {
		const parts = DUMMY_PASSWORD_HASH.split(":");
		expect(parts[0]).toBe("scrypt");
		expect(parts).toHaveLength(3);
	});
});
