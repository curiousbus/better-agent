import { hashPassword } from "@better-agent/agent/crypto/password";
import { createNodeDb } from "@better-agent/db/node-db";
import { createUserStore } from "@better-agent/db/repositories/auth-store";

// Seeds (or updates) a single built-in admin account with an email + password
// so the admin app can be signed into without any email-link flow. Run from the
// deploy Action after migrations. Reads everything from the environment; never
// prints the password (CI logs are public).
async function seedAdmin(): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
	const password = process.env.SEED_ADMIN_PASSWORD;

	if (!databaseUrl) {
		throw new Error("seed-admin: DATABASE_URL is required");
	}
	if (!email) {
		throw new Error("seed-admin: SEED_ADMIN_EMAIL is required");
	}
	if (!password) {
		throw new Error("seed-admin: SEED_ADMIN_PASSWORD is required");
	}

	const db = createNodeDb(databaseUrl);
	const users = createUserStore(db);
	const hash = hashPassword(password);

	const existing = await users.findByEmail(email);
	if (existing) {
		await users.setPasswordHash(existing.id, hash);
		await users.setStaff(existing.id);
	} else {
		// createWithPassword("staff") seeds kind=staff + isAdmin=true.
		await users.createWithPassword(email, hash, "staff");
	}

	await db.$client.end();
	process.stdout.write(
		`seed-admin: ${existing ? "updated" : "created"} admin ${email}\n`
	);
}

seedAdmin().catch((error) => {
	process.stderr.write(`seed-admin failed: ${(error as Error).message}\n`);
	process.exit(1);
});
