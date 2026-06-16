import { describe, expect, it } from "vitest";
import { createSecretBox } from "./secret-box";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("secret-box", () => {
	it("round-trips a plaintext", () => {
		const box = createSecretBox(SECRET);
		const cipher = box.encrypt("sk-test-123");
		expect(cipher).not.toContain("sk-test-123");
		expect(box.decrypt(cipher)).toBe("sk-test-123");
	});

	it("produces different ciphertext each call (random iv)", () => {
		const box = createSecretBox(SECRET);
		expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
	});

	it("rejects tampered ciphertext", () => {
		const box = createSecretBox(SECRET);
		const cipher = box.encrypt("secret");
		const tampered = `${cipher.slice(0, -2)}00`;
		expect(() => box.decrypt(tampered)).toThrow();
	});
});
