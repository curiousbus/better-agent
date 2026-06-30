import { describe, expect, it } from "vitest";
import { authHeaders, decodeJwtEmail } from "./api";

describe("authHeaders", () => {
	it("builds the bearer header from a token, omits when absent", () => {
		expect(authHeaders("t")).toEqual({ Authorization: "Bearer t" });
		expect(authHeaders(null)).toEqual({});
	});
});

describe("decodeJwtEmail", () => {
	it("returns the email from a valid JWT payload", () => {
		const payload = btoa(JSON.stringify({ email: "a@b.com" }));
		const token = `header.${payload}.sig`;
		expect(decodeJwtEmail(token)).toBe("a@b.com");
	});

	it("returns null for a malformed token", () => {
		expect(decodeJwtEmail("not-a-jwt")).toBeNull();
		expect(decodeJwtEmail(null)).toBeNull();
		expect(decodeJwtEmail("a.!!!.c")).toBeNull();
	});
});
