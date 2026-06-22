import { expect, it } from "vitest";
import { createTokenService } from "./agent-token";

const SHA256_HEX_LENGTH = 64;

it("generate returns a ba_-prefixed token whose hash is its sha256", () => {
	const svc = createTokenService();
	const { token, hash } = svc.generate();
	expect(token.startsWith("ba_")).toBe(true);
	expect(hash).toBe(svc.hash(token));
	expect(hash).toHaveLength(SHA256_HEX_LENGTH);
});

it("generate returns unique tokens", () => {
	const svc = createTokenService();
	expect(svc.generate().token).not.toBe(svc.generate().token);
});

it("hash is deterministic for the same token", () => {
	const svc = createTokenService();
	expect(svc.hash("ba_abc")).toBe(svc.hash("ba_abc"));
});
