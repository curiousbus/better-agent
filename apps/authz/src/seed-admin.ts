import { hashPassword } from "@better-agent/agent/crypto/password";
import { eq } from "drizzle-orm";
import { createDb } from "./db";
import { authzAdmins } from "./schema";

// Seeds (or updates) the single built-in authz admin. Run from the deploy Action
// after migrations. Never prints the password (CI logs are public).
async function seed(): Promise<void> {
	const url = process.env.AUTHZ_DATABASE_URL;
	const email = process.env.AUTHZ_ADMIN_EMAIL?.trim().toLowerCase();
	const password = process.env.AUTHZ_ADMIN_PASSWORD;
	if (!url) {
		throw new Error("seed: AUTHZ_DATABASE_URL is required");
	}
	if (!email) {
		throw new Error("seed: AUTHZ_ADMIN_EMAIL is required");
	}
	if (!password) {
		throw new Error("seed: AUTHZ_ADMIN_PASSWORD is required");
	}

	const db = createDb(url);
	const hash = hashPassword(password);
	const existing = await db
		.select()
		.from(authzAdmins)
		.where(eq(authzAdmins.email, email))
		.limit(1);
	if (existing[0]) {
		await db
			.update(authzAdmins)
			.set({ passwordHash: hash })
			.where(eq(authzAdmins.email, email));
	} else {
		await db.insert(authzAdmins).values({ email, passwordHash: hash });
	}
	await db.$client.end();
	process.stdout.write(
		`authz seed: ${existing[0] ? "updated" : "created"} admin ${email}\n`
	);
}

seed().catch((error) => {
	process.stderr.write(`authz seed failed: ${(error as Error).message}\n`);
	process.exit(1);
});
