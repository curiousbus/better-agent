import { expect, it } from "vitest";
import { createJwtService } from "./jwt";

const SECRET = "test-secret-at-least-32-characters-long!!";

it("signs a token its own service can verify", async () => {
	const svc = createJwtService(SECRET);
	const token = await svc.sign({ sub: "u1", email: "a@b.com" }, 900);
	expect(await svc.verify(token)).toEqual({ sub: "u1", email: "a@b.com" });
});

it("returns null for a token signed with a different secret", async () => {
	const token = await createJwtService(SECRET).sign(
		{ sub: "u1", email: "a@b.com" },
		900
	);
	expect(await createJwtService(`${SECRET}x`).verify(token)).toBeNull();
});

it("returns null for an expired token", async () => {
	const svc = createJwtService(SECRET);
	const token = await svc.sign({ sub: "u1", email: "a@b.com" }, -1);
	expect(await svc.verify(token)).toBeNull();
});

it("returns null for a malformed token", async () => {
	expect(await createJwtService(SECRET).verify("not-a-jwt")).toBeNull();
});
