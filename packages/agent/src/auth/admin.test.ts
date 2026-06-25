import { expect, it } from "vitest";
import { isAdminEmail, SUPER_ADMIN_EMAIL } from "./admin";

it("super admin is always true even with empty allowlist", () => {
	expect(isAdminEmail(SUPER_ADMIN_EMAIL, [])).toBe(true);
});

it("super admin is matched case-insensitively", () => {
	expect(isAdminEmail(SUPER_ADMIN_EMAIL.toUpperCase(), [])).toBe(true);
});

it("allowlisted email returns true", () => {
	expect(isAdminEmail("ops@example.com", ["ops@example.com"])).toBe(true);
});

it("allowlist matching is case-insensitive", () => {
	expect(isAdminEmail("OPS@EXAMPLE.COM", ["ops@example.com"])).toBe(true);
});

it("non-admin email returns false", () => {
	expect(isAdminEmail("user@example.com", ["ops@example.com"])).toBe(false);
});

it("empty allowlist with non-super-admin returns false", () => {
	expect(isAdminEmail("anyone@example.com", [])).toBe(false);
});
