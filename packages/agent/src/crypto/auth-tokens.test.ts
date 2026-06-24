import { expect, it } from "vitest";
import { generateToken, hashToken } from "./auth-tokens";

it("generateToken applies the prefix and is unique", () => {
	expect(generateToken("ml_").startsWith("ml_")).toBe(true);
	expect(generateToken("rt_")).not.toBe(generateToken("rt_"));
});

it("hashToken is deterministic sha256 hex (64 chars)", () => {
	expect(hashToken("ml_abc")).toBe(hashToken("ml_abc"));
	expect(hashToken("ml_abc")).toHaveLength(64);
	expect(hashToken("ml_abc")).not.toBe(hashToken("ml_abd"));
});
