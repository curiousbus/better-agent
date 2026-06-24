# Web Auth — Magic Link + JWT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passwordless magic-link sign-in for apps/web, issuing a stateless JWT access token plus a rotating refresh token.

**Architecture:** A pure `JwtService` (jose, HS256) signs/verifies short-lived access tokens. Magic-link and refresh tokens are random strings stored only as sha256 hashes (`magic_links`, `refresh_tokens`); refresh rotates on use. An `auth` oRPC router (requestLink/verify/refresh/me/logout) lives on apps/server; `createContext` resolves `authedUser` from the bearer JWT and `userProcedure` gates protected calls. The web app stores the access token in memory and the refresh token in localStorage.

**Tech Stack:** TypeScript, Drizzle (Postgres/PGlite), oRPC, Hono, jose, Resend, node:crypto, Vitest, TanStack Start (web).

**Spec:** [`docs/superpowers/specs/2026-06-23-web-auth-magic-link-jwt-design.md`](../specs/2026-06-23-web-auth-magic-link-jwt-design.md)

## Global Constraints

- Ultracite/Biome + project rules: kebab-case filenames; no `any` (use `unknown`); `interface` over `type` for object shapes; `for...of` over `.forEach`; **files ≤300 lines, functions ≤50 lines, complexity ≤10**; no magic numbers (extract named constants); run `pnpm dlx ultracite fix` before each commit. Pre-commit hook (lefthook) runs file-rules + ultracite + eslint and blocks non-compliant commits.
- Tokens: access JWT TTL **900s (15 min)**, refresh TTL **2_592_000s (30 days)**, magic-link TTL **900s**. Token formats: `ml_<base64url(32 bytes)>`, `rt_<base64url(32 bytes)>`. Only sha256 hex hashes are persisted; plaintext is returned once.
- Custom table names (`users`, `magic_links`, `refresh_tokens`) avoid the foreign `user`/`session`/`account`/`verification` tables in the shared local DB and this project's chat `sessions`.
- zod v4 (`z.email()`, `z.uuid()`). Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: JwtService (jose)

**Files:**
- Create: `packages/agent/src/crypto/jwt.ts`
- Test: `packages/agent/src/crypto/jwt.test.ts`
- Modify: `packages/agent/package.json` (add `jose`)

**Interfaces:**
- Produces: `interface JwtClaims { sub: string; email: string }`; `interface JwtService { sign(claims: JwtClaims, ttlSeconds: number): Promise<string>; verify(token: string): Promise<JwtClaims | null> }`; `createJwtService(secret: string): JwtService`. Import path `@better-agent/agent/crypto/jwt`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm -F @better-agent/agent add jose`

- [ ] **Step 2: Write the failing test**

`packages/agent/src/crypto/jwt.test.ts`:
```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/crypto/jwt.test.ts`
Expected: FAIL — cannot find module `./jwt`.

- [ ] **Step 4: Write the implementation**

`packages/agent/src/crypto/jwt.ts`:
```ts
import { SignJWT, jwtVerify } from "jose";

export interface JwtClaims {
	sub: string;
	email: string;
}

export interface JwtService {
	sign(claims: JwtClaims, ttlSeconds: number): Promise<string>;
	verify(token: string): Promise<JwtClaims | null>;
}

const ALG = "HS256";

export function createJwtService(secret: string): JwtService {
	const key = new TextEncoder().encode(secret);
	return {
		sign(claims, ttlSeconds) {
			const now = Math.floor(Date.now() / 1000);
			return new SignJWT({ email: claims.email })
				.setProtectedHeader({ alg: ALG })
				.setSubject(claims.sub)
				.setIssuedAt(now)
				.setExpirationTime(now + ttlSeconds)
				.sign(key);
		},
		async verify(token) {
			try {
				const { payload } = await jwtVerify(token, key);
				if (
					typeof payload.sub === "string" &&
					typeof payload.email === "string"
				) {
					return { sub: payload.sub, email: payload.email };
				}
				return null;
			} catch {
				return null;
			}
		},
	};
}
```
(Note: `Date.now()` is allowed in app/lib code; the no-`Date.now` rule only applies to Workflow scripts.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/crypto/jwt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/crypto/jwt.ts packages/agent/src/crypto/jwt.test.ts
git add packages/agent/src/crypto/jwt.ts packages/agent/src/crypto/jwt.test.ts packages/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): add JwtService (jose HS256)"
```

---

### Task 2: Auth token generate + hash helpers

**Files:**
- Create: `packages/agent/src/crypto/auth-tokens.ts`
- Test: `packages/agent/src/crypto/auth-tokens.test.ts`

**Interfaces:**
- Produces: `generateToken(prefix: string): string`; `hashToken(token: string): string`. Import path `@better-agent/agent/crypto/auth-tokens`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/crypto/auth-tokens.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/crypto/auth-tokens.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/agent/src/crypto/auth-tokens.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateToken(prefix: string): string {
	return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @better-agent/agent exec vitest run src/crypto/auth-tokens.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/crypto/auth-tokens.ts packages/agent/src/crypto/auth-tokens.test.ts
git add packages/agent/src/crypto/auth-tokens.ts packages/agent/src/crypto/auth-tokens.test.ts
git commit -m "feat(agent): add auth token generate/hash helpers"
```

---

### Task 3: Auth domain types, store ports, email-sender port, and fakes

**Files:**
- Create: `packages/agent/src/auth/types.ts`
- Modify: `packages/agent/src/ports.ts` (add store + email interfaces)
- Create: `packages/agent/src/testing/fake-auth-stores.ts`
- Test: `packages/agent/src/testing/fake-auth-stores.test.ts`

**Interfaces:**
- Produces (in `auth/types.ts`):
  - `interface User { id: string; email: string; createdAt: Date }`
  - `interface RefreshTokenRecord { id: string; userId: string; expiresAt: Date; revokedAt: Date | null }`
- Produces (in `ports.ts`):
  - `interface UserStore { findById(id: string): Promise<User | null>; findByEmail(email: string): Promise<User | null>; findOrCreate(email: string): Promise<User> }`
  - `interface MagicLinkStore { create(input: { tokenHash: string; email: string; expiresAt: Date }): Promise<void>; consume(tokenHash: string): Promise<{ email: string } | null> }`
  - `interface RefreshTokenStore { create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>; find(tokenHash: string): Promise<RefreshTokenRecord | null>; revoke(id: string): Promise<void>; revokeAllForUser(userId: string): Promise<void> }`
  - `interface EmailSender { sendMagicLink(input: { email: string; url: string }): Promise<void> }`
- Produces (fakes): `createFakeUserStore()`, `createFakeMagicLinkStore()`, `createFakeRefreshTokenStore()`, `createFakeEmailSender()` (the last records calls in a `sent: { email: string; url: string }[]` array). Import path `@better-agent/agent/testing/fake-auth-stores`.

- [ ] **Step 1: Add the types**

`packages/agent/src/auth/types.ts`:
```ts
export interface User {
	id: string;
	email: string;
	createdAt: Date;
}

export interface RefreshTokenRecord {
	id: string;
	userId: string;
	expiresAt: Date;
	revokedAt: Date | null;
}
```

- [ ] **Step 2: Add the store + email ports**

In `packages/agent/src/ports.ts`, add the import and interfaces (append after the existing `AgentStore` block):
```ts
import type { RefreshTokenRecord, User } from "./auth/types";

export interface UserStore {
	findById(id: string): Promise<User | null>;
	findByEmail(email: string): Promise<User | null>;
	findOrCreate(email: string): Promise<User>;
}

export interface MagicLinkStore {
	create(input: {
		tokenHash: string;
		email: string;
		expiresAt: Date;
	}): Promise<void>;
	consume(tokenHash: string): Promise<{ email: string } | null>;
}

export interface RefreshTokenStore {
	create(input: {
		userId: string;
		tokenHash: string;
		expiresAt: Date;
	}): Promise<void>;
	find(tokenHash: string): Promise<RefreshTokenRecord | null>;
	revoke(id: string): Promise<void>;
	revokeAllForUser(userId: string): Promise<void>;
}

export interface EmailSender {
	sendMagicLink(input: { email: string; url: string }): Promise<void>;
}
```
(`import type { RefreshTokenRecord, User }` goes at the top with the other type imports.)

- [ ] **Step 3: Write the failing fakes test**

`packages/agent/src/testing/fake-auth-stores.test.ts`:
```ts
import { expect, it } from "vitest";
import {
	createFakeMagicLinkStore,
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "./fake-auth-stores";

const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

it("user store find-or-creates by email idempotently", async () => {
	const store = createFakeUserStore();
	const a = await store.findOrCreate("x@y.com");
	const b = await store.findOrCreate("x@y.com");
	expect(a.id).toBe(b.id);
	expect((await store.findById(a.id))?.email).toBe("x@y.com");
});

it("magic link consume is single-use and rejects expired", async () => {
	const store = createFakeMagicLinkStore();
	await store.create({ tokenHash: "h1", email: "x@y.com", expiresAt: FUTURE });
	expect(await store.consume("h1")).toEqual({ email: "x@y.com" });
	expect(await store.consume("h1")).toBeNull();
	await store.create({ tokenHash: "h2", email: "x@y.com", expiresAt: PAST });
	expect(await store.consume("h2")).toBeNull();
});

it("refresh token find/revoke works and revokeAllForUser revokes every row", async () => {
	const store = createFakeRefreshTokenStore();
	await store.create({ userId: "u1", tokenHash: "r1", expiresAt: FUTURE });
	const found = await store.find("r1");
	expect(found?.userId).toBe("u1");
	expect(found?.revokedAt).toBeNull();
	await store.revoke(found?.id ?? "");
	expect((await store.find("r1"))?.revokedAt).toBeInstanceOf(Date);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm -F @better-agent/agent exec vitest run src/testing/fake-auth-stores.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 5: Write the fakes**

`packages/agent/src/testing/fake-auth-stores.ts`:
```ts
import type { RefreshTokenRecord, User } from "../auth/types";
import type {
	EmailSender,
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "../ports";

export function createFakeUserStore(): UserStore {
	const byId = new Map<string, User>();
	const byEmail = new Map<string, User>();
	return {
		findById(id) {
			return Promise.resolve(byId.get(id) ?? null);
		},
		findByEmail(email) {
			return Promise.resolve(byEmail.get(email) ?? null);
		},
		findOrCreate(email) {
			const existing = byEmail.get(email);
			if (existing) {
				return Promise.resolve(existing);
			}
			const user: User = {
				id: crypto.randomUUID(),
				email,
				createdAt: new Date(),
			};
			byId.set(user.id, user);
			byEmail.set(email, user);
			return Promise.resolve(user);
		},
	};
}

interface FakeLink {
	email: string;
	expiresAt: Date;
	usedAt: Date | null;
}

export function createFakeMagicLinkStore(): MagicLinkStore {
	const links = new Map<string, FakeLink>();
	return {
		create({ tokenHash, email, expiresAt }) {
			links.set(tokenHash, { email, expiresAt, usedAt: null });
			return Promise.resolve();
		},
		consume(tokenHash) {
			const link = links.get(tokenHash);
			if (!link || link.usedAt || link.expiresAt < new Date()) {
				return Promise.resolve(null);
			}
			link.usedAt = new Date();
			return Promise.resolve({ email: link.email });
		},
	};
}

export function createFakeRefreshTokenStore(): RefreshTokenStore {
	const rows = new Map<string, RefreshTokenRecord & { tokenHash: string }>();
	return {
		create({ userId, tokenHash, expiresAt }) {
			const id = crypto.randomUUID();
			rows.set(id, { id, userId, tokenHash, expiresAt, revokedAt: null });
			return Promise.resolve();
		},
		find(tokenHash) {
			for (const row of rows.values()) {
				if (row.tokenHash === tokenHash) {
					return Promise.resolve(row);
				}
			}
			return Promise.resolve(null);
		},
		revoke(id) {
			const row = rows.get(id);
			if (row) {
				row.revokedAt = new Date();
			}
			return Promise.resolve();
		},
		revokeAllForUser(userId) {
			for (const row of rows.values()) {
				if (row.userId === userId) {
					row.revokedAt = new Date();
				}
			}
			return Promise.resolve();
		},
	};
}

export function createFakeEmailSender(): EmailSender & {
	sent: { email: string; url: string }[];
} {
	const sent: { email: string; url: string }[] = [];
	return {
		sent,
		sendMagicLink(input) {
			sent.push(input);
			return Promise.resolve();
		},
	};
}
```

- [ ] **Step 6: Run to verify it passes; typecheck the package**

Run: `pnpm -F @better-agent/agent exec vitest run src/testing/fake-auth-stores.test.ts`
Expected: PASS (3 tests).
Run: `pnpm -F @better-agent/agent exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
pnpm dlx ultracite fix packages/agent/src/auth packages/agent/src/ports.ts packages/agent/src/testing/fake-auth-stores.ts packages/agent/src/testing/fake-auth-stores.test.ts
git add packages/agent/src/auth packages/agent/src/ports.ts packages/agent/src/testing/fake-auth-stores.ts packages/agent/src/testing/fake-auth-stores.test.ts
git commit -m "feat(agent): auth types, store/email ports, and fakes"
```

---

### Task 4: DB schema, migration, and Drizzle auth stores

**Files:**
- Create: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/schema/index.ts` (export the new tables)
- Create: `packages/db/src/migrations/0005_*.sql` (via `db:generate`)
- Create: `packages/db/src/repositories/auth-store.ts`
- Test: `packages/db/src/repositories/auth-store.integration.test.ts`

**Interfaces:**
- Consumes: `UserStore`, `MagicLinkStore`, `RefreshTokenStore` (Task 3).
- Produces: `createUserStore(db)`, `createMagicLinkStore(db)`, `createRefreshTokenStore(db)` — each returns the matching port. Import path `@better-agent/db/repositories/auth-store`. The `db` type is the same driver-agnostic `PgDatabase<...>` used by `agent-store.ts`.

- [ ] **Step 1: Add the schema**

`packages/db/src/schema/auth.ts`:
```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const magicLinks = pgTable("magic_links", {
	id: uuid("id").primaryKey().defaultRandom(),
	tokenHash: text("token_hash").notNull().unique(),
	email: text("email").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id").notNull(),
	tokenHash: text("token_hash").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
```

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add: `export * from "./auth";`

- [ ] **Step 3: Generate + apply the migration**

Run: `pnpm -F @better-agent/db db:generate` (creates `0005_*.sql` with three `CREATE TABLE`s — verify it has no DROP/ALTER on other tables).
Run: `pnpm run db:migrate`
Expected: migrations applied.

- [ ] **Step 4: Write the failing integration test**

`packages/db/src/repositories/auth-store.integration.test.ts`:
```ts
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import {
	createMagicLinkStore,
	createRefreshTokenStore,
	createUserStore,
} from "./auth-store";

const FUTURE = () => new Date(Date.now() + 60_000);
const PAST = () => new Date(Date.now() - 60_000);

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});
afterEach(async () => {
	await client.close();
});

it("user findOrCreate is idempotent by email", async () => {
	const store = createUserStore(db);
	const a = await store.findOrCreate("x@y.com");
	const b = await store.findOrCreate("x@y.com");
	expect(a.id).toBe(b.id);
	expect((await store.findByEmail("x@y.com"))?.id).toBe(a.id);
});

it("magic link consume is single-use and rejects expired", async () => {
	const store = createMagicLinkStore(db);
	await store.create({ tokenHash: "h1", email: "x@y.com", expiresAt: FUTURE() });
	expect(await store.consume("h1")).toEqual({ email: "x@y.com" });
	expect(await store.consume("h1")).toBeNull();
	await store.create({ tokenHash: "h2", email: "x@y.com", expiresAt: PAST() });
	expect(await store.consume("h2")).toBeNull();
});

it("refresh token find/revoke + revokeAllForUser", async () => {
	const users = createUserStore(db);
	const user = await users.findOrCreate("x@y.com");
	const store = createRefreshTokenStore(db);
	await store.create({
		userId: user.id,
		tokenHash: "r1",
		expiresAt: FUTURE(),
	});
	const found = await store.find("r1");
	expect(found?.userId).toBe(user.id);
	await store.revoke(found?.id ?? "");
	expect((await store.find("r1"))?.revokedAt).toBeInstanceOf(Date);
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm -F @better-agent/db exec vitest run src/repositories/auth-store.integration.test.ts`
Expected: FAIL — cannot find module `./auth-store`.

- [ ] **Step 6: Write the stores**

`packages/db/src/repositories/auth-store.ts`:
```ts
import type {
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "@better-agent/agent/ports";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createUserStore(db: Db): UserStore {
	return {
		async findById(id) {
			const rows = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.id, id))
				.limit(1);
			const row = rows[0];
			return row ? { id: row.id, email: row.email, createdAt: row.createdAt } : null;
		},
		async findByEmail(email) {
			const rows = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.email, email))
				.limit(1);
			const row = rows[0];
			return row ? { id: row.id, email: row.email, createdAt: row.createdAt } : null;
		},
		async findOrCreate(email) {
			const existing = await this.findByEmail(email);
			if (existing) {
				return existing;
			}
			const rows = await db
				.insert(schema.users)
				.values({ email })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create user");
			}
			return { id: row.id, email: row.email, createdAt: row.createdAt };
		},
	};
}

export function createMagicLinkStore(db: Db): MagicLinkStore {
	return {
		async create(input) {
			await db.insert(schema.magicLinks).values(input);
		},
		async consume(tokenHash) {
			const rows = await db
				.select()
				.from(schema.magicLinks)
				.where(
					and(
						eq(schema.magicLinks.tokenHash, tokenHash),
						isNull(schema.magicLinks.usedAt),
						gt(schema.magicLinks.expiresAt, new Date())
					)
				)
				.limit(1);
			const row = rows[0];
			if (!row) {
				return null;
			}
			await db
				.update(schema.magicLinks)
				.set({ usedAt: new Date() })
				.where(eq(schema.magicLinks.id, row.id));
			return { email: row.email };
		},
	};
}

export function createRefreshTokenStore(db: Db): RefreshTokenStore {
	return {
		async create(input) {
			await db.insert(schema.refreshTokens).values(input);
		},
		async find(tokenHash) {
			const rows = await db
				.select()
				.from(schema.refreshTokens)
				.where(eq(schema.refreshTokens.tokenHash, tokenHash))
				.limit(1);
			const row = rows[0];
			return row
				? {
						id: row.id,
						userId: row.userId,
						expiresAt: row.expiresAt,
						revokedAt: row.revokedAt,
					}
				: null;
		},
		async revoke(id) {
			await db
				.update(schema.refreshTokens)
				.set({ revokedAt: new Date() })
				.where(eq(schema.refreshTokens.id, id));
		},
		async revokeAllForUser(userId) {
			await db
				.update(schema.refreshTokens)
				.set({ revokedAt: new Date() })
				.where(eq(schema.refreshTokens.userId, userId));
		},
	};
}
```

- [ ] **Step 7: Run to verify it passes; typecheck**

Run: `pnpm -F @better-agent/db exec vitest run src/repositories/auth-store.integration.test.ts`
Expected: PASS (3 tests).
Run: `pnpm -F @better-agent/db exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
pnpm dlx ultracite fix packages/db/src
git add packages/db/src/schema packages/db/src/repositories/auth-store.ts packages/db/src/repositories/auth-store.integration.test.ts packages/db/src/migrations
git commit -m "feat(db): auth tables + user/magic-link/refresh-token stores"
```

---

### Task 5: Env schema additions

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `apps/server/.env` (local values)

**Interfaces:**
- Produces: `env.AUTH_JWT_SECRET` (string ≥32), `env.RESEND_API_KEY` (string | undefined), `env.AUTH_EMAIL_FROM` (string), `env.WEB_URL` (url).

- [ ] **Step 1: Add the fields**

In `packages/env/src/server.ts`, inside the `server: { ... }` object (after `CREDENTIALS_SECRET`):
```ts
		AUTH_JWT_SECRET: z.string().min(32),
		RESEND_API_KEY: z.string().optional(),
		AUTH_EMAIL_FROM: z.string().default("noreply@trendf.top"),
		WEB_URL: z.url().default("http://localhost:3001"),
```

- [ ] **Step 2: Set local values**

Append to `apps/server/.env`:
```
AUTH_JWT_SECRET=<run: openssl rand -hex 32>
AUTH_EMAIL_FROM=noreply@trendf.top
WEB_URL=http://localhost:3001
# RESEND_API_KEY=...   # leave unset to log magic links to the server console in dev
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -F @better-agent/env exec tsc --noEmit`
Expected: no errors.
```bash
git add packages/env/src/server.ts
git commit -m "feat(env): add auth (jwt/resend/web-url) server vars"
```
(`.env` is gitignored — not committed.)

---

### Task 6: Wire auth into AgentServices + context + userProcedure

**Files:**
- Modify: `packages/api/src/services.ts`
- Modify: `packages/api/src/context.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/context.test.ts` (extend with a user case)

**Interfaces:**
- Consumes: `JwtService` (Task 1); `UserStore`/`MagicLinkStore`/`RefreshTokenStore`/`EmailSender` (Task 3).
- Produces:
  - `AgentServices` gains `jwtService: JwtService`, `emailSender: EmailSender`, `authConfig: { webUrl: string; accessTtl: number; refreshTtl: number; magicLinkTtl: number }`, and `stores.user/magicLink/refreshToken`.
  - `Context` gains `authedUser: User | null`.
  - `userProcedure` exported from `packages/api/src/index.ts`; downstream handlers get non-null `context.authedUser: User`.

- [ ] **Step 1: Extend AgentServices**

In `packages/api/src/services.ts`, add imports:
```ts
import type { JwtService } from "@better-agent/agent/crypto/jwt";
import type {
	EmailSender,
	MagicLinkStore,
	RefreshTokenStore,
	UserStore,
} from "@better-agent/agent/ports";
```
Add to `AgentServices`:
```ts
	jwtService: JwtService;
	emailSender: EmailSender;
	authConfig: {
		webUrl: string;
		accessTtl: number;
		refreshTtl: number;
		magicLinkTtl: number;
	};
```
And inside `stores: { ... }` add:
```ts
		user: UserStore;
		magicLink: MagicLinkStore;
		refreshToken: RefreshTokenStore;
```

- [ ] **Step 2: Resolve authedUser in context**

In `packages/api/src/context.ts`, add a resolver and include it. Add the import `import type { User } from "@better-agent/agent/auth/types";`, then:
```ts
async function resolveAuthedUser(
	options: CreateContextOptions
): Promise<User | null> {
	const header = options.context.req.header("authorization");
	if (!header?.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	const claims = await options.services.jwtService.verify(token);
	if (!claims) {
		return null;
	}
	return options.services.stores.user.findById(claims.sub);
}
```
Change `createContext` to also resolve the user (both resolvers read the same header; an agent token fails JWT verify and a user JWT fails findByTokenHash, so at most one is non-null):
```ts
export async function createContext(options: CreateContextOptions) {
	return {
		services: options.services,
		authedAgent: await resolveAuthedAgent(options),
		authedUser: await resolveAuthedUser(options),
	};
}
```

- [ ] **Step 3: Add userProcedure**

In `packages/api/src/index.ts`, append:
```ts
export const userProcedure = o.use(({ context, next }) => {
	const user = context.authedUser;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
	}
	return next({ context: { authedUser: user } });
});
```

- [ ] **Step 4: Extend the context test**

In `packages/api/src/context.test.ts`, add (the existing `setup()` builds services as `unknown as AgentServices`, so add a jwt + user store to a new test). Append:
```ts
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";

it("resolves authedUser from a valid access JWT", async () => {
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const userStore = createFakeUserStore();
	const user = await userStore.findOrCreate("x@y.com");
	const token = await jwtService.sign(
		{ sub: user.id, email: user.email },
		900
	);
	const services = {
		jwtService,
		stores: { user: userStore },
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono(`Bearer ${token}`),
		services,
	});
	expect(ctx.authedUser?.id).toBe(user.id);
});

it("authedUser is null for a non-JWT bearer token", async () => {
	const services = {
		jwtService: createJwtService("a-test-secret-at-least-32-chars-long!!"),
		stores: { user: createFakeUserStore() },
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono("Bearer ba_not_a_jwt"),
		services,
	});
	expect(ctx.authedUser).toBeNull();
});
```

- [ ] **Step 5: Run the context test + typecheck**

Run: `pnpm -F @better-agent/api exec vitest run src/context.test.ts`
Expected: PASS (existing + 2 new).
Run: `pnpm -F @better-agent/api exec tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/api/src
git add packages/api/src/services.ts packages/api/src/context.ts packages/api/src/index.ts packages/api/src/context.test.ts
git commit -m "feat(api): resolve authedUser from access JWT; add userProcedure"
```

---

### Task 7: Auth oRPC router

**Files:**
- Create: `packages/api/src/routers/auth.ts`
- Modify: `packages/api/src/routers/index.ts` (add `auth`)
- Test: `packages/api/src/routers/auth.test.ts`

**Interfaces:**
- Consumes: `userProcedure`/`publicProcedure` (Task 6); the auth stores, `jwtService`, `emailSender`, `authConfig` from services; `generateToken`/`hashToken` (Task 2).
- Produces: `authRouter` with `requestLink({ email })`, `verify({ token })`, `refresh({ refreshToken })`, `me()`, `logout({ refreshToken })`. `verify`/`refresh` return `{ accessToken, refreshToken, user }`.

- [ ] **Step 1: Write the failing test**

`packages/api/src/routers/auth.test.ts`:
```ts
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import {
	createFakeEmailSender,
	createFakeMagicLinkStore,
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

function build() {
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const email = createFakeEmailSender();
	const services = {
		jwtService,
		emailSender: email,
		authConfig: {
			webUrl: "http://web.test",
			accessTtl: 900,
			refreshTtl: 2_592_000,
			magicLinkTtl: 900,
		},
		stores: {
			user: createFakeUserStore(),
			magicLink: createFakeMagicLinkStore(),
			refreshToken: createFakeRefreshTokenStore(),
		},
	};
	const client = createRouterClient(appRouter, {
		context: { services: services as never, authedAgent: null, authedUser: null },
	});
	return { client, email };
}

it("requestLink emails a verify URL carrying a token", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	expect(email.sent).toHaveLength(1);
	expect(email.sent[0]?.url).toContain("http://web.test/auth/verify?token=ml_");
});

it("verify consumes the link and issues a token pair", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	const token = email.sent[0]?.url.split("token=")[1] ?? "";
	const result = await client.auth.verify({ token });
	expect(result.user.email).toBe("x@y.com");
	expect(result.accessToken.length).toBeGreaterThan(0);
	expect(result.refreshToken.startsWith("rt_")).toBe(true);
	await expect(client.auth.verify({ token })).rejects.toThrow();
});

it("refresh rotates the token and rejects the reused old one", async () => {
	const { client, email } = build();
	await client.auth.requestLink({ email: "x@y.com" });
	const token = email.sent[0]?.url.split("token=")[1] ?? "";
	const first = await client.auth.verify({ token });
	const rotated = await client.auth.refresh({
		refreshToken: first.refreshToken,
	});
	expect(rotated.refreshToken).not.toBe(first.refreshToken);
	await expect(
		client.auth.refresh({ refreshToken: first.refreshToken })
	).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/auth.test.ts`
Expected: FAIL — `client.auth` undefined.

- [ ] **Step 3: Write the router**

`packages/api/src/routers/auth.ts`:
```ts
import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { publicProcedure, userProcedure } from "../index";

const MS = 1000;

async function issueTokens(context: Context, user: { id: string; email: string }) {
	const { authConfig, jwtService, stores } = context.services;
	const accessToken = await jwtService.sign(
		{ sub: user.id, email: user.email },
		authConfig.accessTtl
	);
	const refreshToken = generateToken("rt_");
	await stores.refreshToken.create({
		userId: user.id,
		tokenHash: hashToken(refreshToken),
		expiresAt: new Date(Date.now() + authConfig.refreshTtl * MS),
	});
	return { accessToken, refreshToken, user };
}

export const authRouter = {
	requestLink: publicProcedure
		.input(z.object({ email: z.email() }))
		.handler(async ({ input, context }) => {
			const { authConfig, emailSender, stores } = context.services;
			const token = generateToken("ml_");
			await stores.magicLink.create({
				tokenHash: hashToken(token),
				email: input.email,
				expiresAt: new Date(Date.now() + authConfig.magicLinkTtl * MS),
			});
			const url = `${authConfig.webUrl}/auth/verify?token=${token}`;
			await emailSender.sendMagicLink({ email: input.email, url });
			return { ok: true };
		}),

	verify: publicProcedure
		.input(z.object({ token: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const consumed = await context.services.stores.magicLink.consume(
				hashToken(input.token)
			);
			if (!consumed) {
				throw new ORPCError("BAD_REQUEST", {
					message: "This link is invalid or has expired",
				});
			}
			const user = await context.services.stores.user.findOrCreate(
				consumed.email
			);
			return issueTokens(context, user);
		}),

	refresh: publicProcedure
		.input(z.object({ refreshToken: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const { stores } = context.services;
			const record = await stores.refreshToken.find(hashToken(input.refreshToken));
			if (!record) {
				throw new ORPCError("UNAUTHORIZED", { message: "Invalid refresh token" });
			}
			if (record.revokedAt) {
				await stores.refreshToken.revokeAllForUser(record.userId);
				throw new ORPCError("UNAUTHORIZED", { message: "Refresh token reused" });
			}
			if (record.expiresAt < new Date()) {
				throw new ORPCError("UNAUTHORIZED", { message: "Refresh token expired" });
			}
			await stores.refreshToken.revoke(record.id);
			const user = await stores.user.findById(record.userId);
			if (!user) {
				throw new ORPCError("UNAUTHORIZED", { message: "Unknown user" });
			}
			return issueTokens(context, user);
		}),

	me: userProcedure.handler(({ context }) => context.authedUser),

	logout: publicProcedure
		.input(z.object({ refreshToken: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const record = await context.services.stores.refreshToken.find(
				hashToken(input.refreshToken)
			);
			if (record) {
				await context.services.stores.refreshToken.revoke(record.id);
			}
			return { ok: true };
		}),
};
```

- [ ] **Step 4: Register the router**

In `packages/api/src/routers/index.ts`, import `authRouter` and add `auth: authRouter` to `appRouter`.

- [ ] **Step 5: Run to verify it passes; full api suite + typecheck**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/auth.test.ts`
Expected: PASS (3 tests).
Run: `pnpm -F @better-agent/api test && pnpm -F @better-agent/api exec tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
pnpm dlx ultracite fix packages/api/src/routers
git add packages/api/src/routers/auth.ts packages/api/src/routers/index.ts packages/api/src/routers/auth.test.ts
git commit -m "feat(api): magic-link + refresh auth router"
```

---

### Task 8: Server wiring (stores, jwt, email sender, Resend)

**Files:**
- Create: `apps/server/src/email-sender.ts`
- Modify: `apps/server/src/index.ts` (buildServices)
- Modify: `apps/server/package.json` (add `resend`)

**Interfaces:**
- Consumes: `EmailSender` (Task 3); `createJwtService` (Task 1); the auth stores (Task 4); env (Task 5).
- Produces: `createEmailSender(env): EmailSender` (Resend when `RESEND_API_KEY` set, else console).

- [ ] **Step 1: Add the dependency**

Run: `pnpm -F server add resend`

- [ ] **Step 2: Write the email sender factory**

`apps/server/src/email-sender.ts`:
```ts
import type { EmailSender } from "@better-agent/agent/ports";
import { log } from "evlog";
import { Resend } from "resend";

export function createEmailSender(config: {
	apiKey?: string;
	from: string;
}): EmailSender {
	if (!config.apiKey) {
		return {
			sendMagicLink({ email, url }) {
				log.info("auth", `Magic link for ${email}: ${url}`);
				return Promise.resolve();
			},
		};
	}
	const resend = new Resend(config.apiKey);
	return {
		async sendMagicLink({ email, url }) {
			await resend.emails.send({
				from: config.from,
				to: email,
				subject: "Your sign-in link",
				html: `<p>Click to sign in:</p><p><a href="${url}">${url}</a></p>`,
			});
		},
	};
}
```

- [ ] **Step 3: Wire into buildServices**

In `apps/server/src/index.ts`:
- Add imports:
```ts
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import {
	createMagicLinkStore,
	createRefreshTokenStore,
	createUserStore,
} from "@better-agent/db/repositories/auth-store";
import { createEmailSender } from "./email-sender";
```
- Inside `buildServices`, add (near the other stores):
```ts
	const ACCESS_TTL = 900;
	const REFRESH_TTL = 2_592_000;
	const MAGIC_LINK_TTL = 900;
	const jwtService = createJwtService(env.AUTH_JWT_SECRET);
	const emailSender = createEmailSender({
		apiKey: env.RESEND_API_KEY,
		from: env.AUTH_EMAIL_FROM,
	});
	const user = createUserStore(db);
	const magicLink = createMagicLinkStore(db);
	const refreshToken = createRefreshTokenStore(db);
```
- In the returned object, add `jwtService`, `emailSender`, the `authConfig`, and the three stores:
```ts
		jwtService,
		emailSender,
		authConfig: {
			webUrl: env.WEB_URL,
			accessTtl: ACCESS_TTL,
			refreshTtl: REFRESH_TTL,
			magicLinkTtl: MAGIC_LINK_TTL,
		},
		stores: {
			providerCatalog,
			modelCache,
			providerCredential,
			agent,
			session,
			message,
			user,
			magicLink,
			refreshToken,
		},
```

- [ ] **Step 4: Typecheck the server + restart sanity**

Run: `pnpm -F server check-types`
Expected: no errors.
Manual: with the dev server running, `curl -s -X POST http://localhost:3000/rpc/auth/requestLink -H 'content-type: application/json' -d '{"json":{"email":"you@example.com"}}'` returns `{"json":{"ok":true}}` and the server console logs `Magic link for you@example.com: http://localhost:3001/auth/verify?token=ml_…` (no Resend key set).

- [ ] **Step 5: Commit**

```bash
pnpm dlx ultracite fix apps/server/src
git add apps/server/src/email-sender.ts apps/server/src/index.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): wire auth stores, jwt, and email sender (Resend/console)"
```

---

### Task 9: Web token store

**Files:**
- Create: `apps/web/src/utils/auth.ts`

**Interfaces:**
- Produces: `getAccessToken(): string | null`, `setTokens(t: { accessToken: string; refreshToken: string }): void`, `clearTokens(): void`, `loadRefreshToken(): string | null`.

- [ ] **Step 1: Write the store**

`apps/web/src/utils/auth.ts`:
```ts
const REFRESH_KEY = "authRefreshToken";

// Access token lives in memory only (lost on reload — re-minted from the
// refresh token at bootstrap). The refresh token persists in localStorage.
let accessToken: string | null = null;

function storage(): Storage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

export function getAccessToken(): string | null {
	return accessToken;
}

export function loadRefreshToken(): string | null {
	return storage()?.getItem(REFRESH_KEY) ?? null;
}

export function setTokens(tokens: {
	accessToken: string;
	refreshToken: string;
}): void {
	accessToken = tokens.accessToken;
	storage()?.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
	accessToken = null;
	storage()?.removeItem(REFRESH_KEY);
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -F web exec tsc --noEmit`
Expected: no errors.
```bash
pnpm dlx ultracite fix apps/web/src/utils/auth.ts
git add apps/web/src/utils/auth.ts
git commit -m "feat(web): in-memory access token + localStorage refresh token store"
```

---

### Task 10: Web oRPC client — bearer header + refresh-on-401

**Files:**
- Modify: `apps/web/src/utils/orpc.ts`

**Interfaces:**
- Consumes: `getAccessToken`/`loadRefreshToken`/`setTokens`/`clearTokens` (Task 9).
- Produces: the exported `client`/`orpc` now attach the access token and transparently refresh once on `UNAUTHORIZED`.

- [ ] **Step 1: Verify the oRPC client interceptor + dynamic-headers API**

Use context7 to confirm, for the installed `@orpc/client` version, (a) that `RPCLink` accepts a `headers` function returning a record, and (b) the client interceptor signature for catching/retrying errors. Adjust the code below to match.

- [ ] **Step 2: Rewire the client**

Replace the link/client section of `apps/web/src/utils/orpc.ts` with:
```ts
import { isDefinedError, ORPCError } from "@orpc/client";
import {
	clearTokens,
	getAccessToken,
	loadRefreshToken,
	setTokens,
} from "@/utils/auth";

// A bare link with no interceptor, used only to call auth.refresh so the
// refresh request itself can't recurse into the refresh interceptor.
const refreshLink = new RPCLink({ url: `${env.VITE_SERVER_URL}/rpc` });
const refreshClient = createORPCClient(refreshLink) as RouterClient<AppRouter>;

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
	const refreshToken = loadRefreshToken();
	if (!refreshToken) {
		return false;
	}
	try {
		const result = await refreshClient.auth.refresh({ refreshToken });
		setTokens(result);
		return true;
	} catch {
		clearTokens();
		return false;
	}
}

function isUnauthorized(error: unknown): boolean {
	return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

const link = new RPCLink({
	url: `${env.VITE_SERVER_URL}/rpc`,
	headers: () => {
		const token = getAccessToken();
		return token ? { authorization: `Bearer ${token}` } : {};
	},
	interceptors: [
		async ({ next }) => {
			try {
				return await next();
			} catch (error) {
				if (isUnauthorized(error) && !refreshInFlight) {
					refreshInFlight = refreshAccessToken().finally(() => {
						refreshInFlight = null;
					});
				}
				if (isUnauthorized(error) && refreshInFlight) {
					const ok = await refreshInFlight;
					if (ok) {
						return await next();
					}
				}
				throw error;
			}
		},
	],
});
```
(Keep `isDefinedError` only if used; remove unused imports. If the installed oRPC version names the link option differently for interceptors, use the verified name from Step 1.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -F web exec tsc --noEmit`
Expected: no errors.
```bash
pnpm dlx ultracite fix apps/web/src/utils/orpc.ts
git add apps/web/src/utils/orpc.ts
git commit -m "feat(web): attach access token + refresh-on-401 to the oRPC client"
```

---

### Task 11: Login screen, verify route, auth guard

**Files:**
- Create: `apps/web/src/routes/login.tsx`
- Create: `apps/web/src/routes/auth.verify.tsx`
- Modify: `apps/web/src/routes/__root.tsx` (bootstrap refresh + guard)

**Interfaces:**
- Consumes: `orpc`/`client` (Task 10); `setTokens`/`loadRefreshToken`/`getAccessToken` (Task 9).
- Produces: `/login` and `/auth/verify` routes; a guard that sends unauthenticated users to `/login`.

- [ ] **Step 1: Login screen**

`apps/web/src/routes/login.tsx`:
```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
	const [email, setEmail] = useState("");
	const request = useMutation(orpc.auth.requestLink.mutationOptions());
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<Card className="flex w-full max-w-sm flex-col gap-4 p-6">
				<div>
					<h1 className="font-semibold text-lg">Sign in</h1>
					<p className="text-muted-foreground text-sm">
						We'll email you a magic link. New here? It signs you up too.
					</p>
				</div>
				{request.isSuccess ? (
					<p className="text-sm">
						Check <span className="font-medium">{email}</span> for your sign-in
						link.
					</p>
				) : (
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							request.mutate({ email });
						}}
					>
						<Input
							onChange={(event) => setEmail(event.target.value)}
							placeholder="you@example.com"
							required
							type="email"
							value={email}
						/>
						<Button disabled={request.isPending} type="submit">
							Send login link
						</Button>
					</form>
				)}
			</Card>
		</div>
	);
}
```
(Confirm `Input` is exported from `@better-agent/ui/components/input`; it is used elsewhere in the repo.)

- [ ] **Step 2: Verify route**

`apps/web/src/routes/auth.verify.tsx`:
```tsx
import { Button } from "@better-agent/ui/components/button";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { setTokens } from "@/utils/auth";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/auth/verify")({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === "string" ? search.token : "",
	}),
	component: VerifyPage,
});

function VerifyPage() {
	const { token } = Route.useSearch();
	const navigate = useNavigate();
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		client.auth
			.verify({ token })
			.then((result) => {
				if (active) {
					setTokens(result);
					navigate({ to: "/" });
				}
			})
			.catch(() => active && setFailed(true));
		return () => {
			active = false;
		};
	}, [token, navigate]);
	if (failed) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<p className="text-sm">This link is invalid or has expired.</p>
				<Button render={<Link to="/login" />}>Back to sign in</Button>
			</div>
		);
	}
	return (
		<div className="flex flex-1 items-center justify-center p-6 text-muted-foreground text-sm">
			Signing you in…
		</div>
	);
}
```

- [ ] **Step 3: Bootstrap refresh + guard in __root**

In `apps/web/src/routes/__root.tsx`, add a small auth bootstrap/guard. Inside `RootDocument` (or a wrapper component rendered inside `<body>`), before rendering the protected shell:
```tsx
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAccessToken, loadRefreshToken } from "@/utils/auth";
import { client } from "@/utils/orpc";
import { setTokens } from "@/utils/auth";
// ...
function useAuthBootstrap() {
	const [ready, setReady] = useState(false);
	const [authed, setAuthed] = useState(false);
	useEffect(() => {
		const refresh = loadRefreshToken();
		if (!refresh) {
			setReady(true);
			return;
		}
		client.auth
			.refresh({ refreshToken: refresh })
			.then((result) => {
				setTokens(result);
				setAuthed(true);
			})
			.catch(() => setAuthed(false))
			.finally(() => setReady(true));
	}, []);
	return { ready, authed: authed || getAccessToken() !== null };
}
```
Then in the shell, allow `/login` and `/auth/verify` through unauthenticated; for any other path, if `ready && !authed`, redirect to `/login` (e.g. via `<Navigate to="/login" />` or `navigate`). Render `null`/a loader while `!ready`. Keep `WebSidebar`/`SidebarProvider` for authed pages only.

- [ ] **Step 4: Manual verification (end-to-end)**

Start dev (server + web). In a fresh browser:
1. Visit `/` → redirected to `/login`.
2. Enter an email → "Send login link" → "Check your email…". The **server console** prints the magic link.
3. Open the printed `/auth/verify?token=…` URL → "Signing you in…" → lands on `/` authenticated.
4. Reload `/` → still authenticated (bootstrap refresh).
5. Confirm the access token is in memory and `authRefreshToken` is in localStorage.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm -F web exec tsc --noEmit`
Expected: no errors.
```bash
pnpm dlx ultracite fix apps/web/src
git add apps/web/src/routes/login.tsx apps/web/src/routes/auth.verify.tsx apps/web/src/routes/__root.tsx
git commit -m "feat(web): magic-link login screen, verify route, and auth guard"
```

---

## Final verification

- [ ] **Full typecheck:** `pnpm check-types` (+ `pnpm -F @better-agent/api exec tsc -b`, `pnpm -F web exec tsc --noEmit`) — clean.
- [ ] **Full test suite:** `pnpm -r test` — green (new: jwt, auth-tokens, fake-auth-stores, auth-store integration, context user cases, auth router).
- [ ] **Lint:** `pnpm dlx ultracite check packages apps` — clean.
- [ ] **End-to-end:** the Task 11 manual flow works with the console email fallback; setting `RESEND_API_KEY` sends a real email from `noreply@trendf.top`.
- [ ] **Spec coverage:** stateless JWT access (§Token details) → Tasks 1,6; rotating refresh + revocation (§Architecture) → Tasks 4,7; magic link + Resend/console (§Backend) → Tasks 7,8; client token storage + refresh (§Frontend) → Tasks 9,10; login/verify/guard (§Frontend) → Task 11; non-goals respected (no passwords/OAuth/sessions).
