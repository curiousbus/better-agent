# Auth Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Rate-limit the public auth endpoints (`requestLink`, `verify`, `refresh`) by client IP and email to stop brute-force / magic-link bombing / enumeration — the one hardening the web-auth design left as future work.

**Architecture:** A `RateLimiter` port (fixed-window counter) in `@better-agent/agent/auth`, in-memory by default, Redis (`INCR`+`PEXPIRE`) in `apps/server`, selected by `env.REDIS_URL` — same shape as `session-lock`/`cancellation`. The handler-facing `Context` gains `clientIp` (from `x-forwarded-for`). Auth handlers call the limiter before doing work; exceeding throws `TOO_MANY_REQUESTS`.

**Tech Stack:** TypeScript, oRPC (`ORPCError`), ioredis (`catalog:`), ioredis-mock, vitest.

## Global Constraints

- `ioredis` stays out of `packages/agent` — Redis impl in `apps/server` behind the interface.
- `rateLimiter` is REQUIRED on `AgentServices` (handlers need it); server always wires one.
- Window 15 min. Limits (named consts): requestLink 5/email + 20/IP; verify 10/IP; refresh 30/IP.
- Generic responses preserved: `requestLink` still returns `{ok:true}` regardless; the limiter throws `TOO_MANY_REQUESTS` BEFORE any email/user lookup so it leaks nothing extra.
- Functions ≤50, file ≤300, no `any`, conventional-commits, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit bare/redirected (never pipe through grep/head).

---

### Task 1: RateLimiter port + Context IP + handler enforcement (single-instance)

**Files:**
- Create: `packages/agent/src/auth/rate-limiter.ts`
- Create test: `packages/agent/src/auth/rate-limiter.test.ts`
- Modify: `packages/api/src/context.ts` (`clientIp`)
- Modify: `packages/api/src/services.ts` (`AgentServices.rateLimiter`)
- Modify: `packages/api/src/routers/auth.ts` (enforce limits)
- Modify: `packages/api/src/routers/auth.test.ts` (provide an in-memory limiter; add a 429 test)
- Modify: `apps/server/src/index.ts` (wire in-memory limiter)

**Interfaces:**
- Produces: `RateLimiter` (`hit(key, limit, windowMs): Promise<boolean>` — false = exceeded), `createInMemoryRateLimiter(now?)`.

- [ ] **Step 1: `rate-limiter.ts`**

```ts
export interface RateLimiter {
	/** Records a hit for `key`; resolves false when the window's limit is exceeded. */
	hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export function createInMemoryRateLimiter(
	now: () => number = () => Date.now()
): RateLimiter {
	const buckets = new Map<string, { count: number; resetAt: number }>();
	return {
		hit(key, limit, windowMs) {
			const t = now();
			const bucket = buckets.get(key);
			if (!bucket || bucket.resetAt <= t) {
				buckets.set(key, { count: 1, resetAt: t + windowMs });
				return Promise.resolve(true);
			}
			bucket.count += 1;
			return Promise.resolve(bucket.count <= limit);
		},
	};
}
```

- [ ] **Step 2: unit tests `rate-limiter.test.ts`**

```ts
import { expect, it } from "vitest";
import { createInMemoryRateLimiter } from "./rate-limiter";

const WINDOW = 1000;

it("allows up to the limit then blocks within the window", async () => {
	const rl = createInMemoryRateLimiter(() => 0);
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(false);
});

it("resets after the window elapses", async () => {
	let clock = 0;
	const rl = createInMemoryRateLimiter(() => clock);
	expect(await rl.hit("k", 1, WINDOW)).toBe(true);
	expect(await rl.hit("k", 1, WINDOW)).toBe(false);
	clock = WINDOW + 1;
	expect(await rl.hit("k", 1, WINDOW)).toBe(true);
});

it("tracks keys independently", async () => {
	const rl = createInMemoryRateLimiter(() => 0);
	expect(await rl.hit("a", 1, WINDOW)).toBe(true);
	expect(await rl.hit("b", 1, WINDOW)).toBe(true);
});
```

Run: `pnpm -F @better-agent/agent test -- rate-limiter` → PASS.

- [ ] **Step 3: `Context.clientIp` (`packages/api/src/context.ts`)**

Add a helper and include it in the returned context:

```ts
function clientIp(options: CreateContextOptions): string {
	const fwd = options.context.req.header("x-forwarded-for");
	return fwd?.split(",")[0]?.trim() || "unknown";
}
```
In `createContext`'s return object add `clientIp: clientIp(options),`.

- [ ] **Step 4: `AgentServices.rateLimiter` (`packages/api/src/services.ts`)**

Add `rateLimiter: RateLimiter;` to the interface, importing `import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";`.

- [ ] **Step 5: enforce in `auth.ts`**

Add consts + a helper, and call it at the top of each handler:

```ts
import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const LIMIT_LINK_EMAIL = 5;
const LIMIT_LINK_IP = 20;
const LIMIT_VERIFY_IP = 10;
const LIMIT_REFRESH_IP = 30;

async function enforce(
	limiter: RateLimiter,
	key: string,
	limit: number
): Promise<void> {
	if (!(await limiter.hit(key, limit, RATE_WINDOW_MS))) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: "Too many requests. Try again later.",
		});
	}
}
```

In `requestLink` handler, FIRST lines (before generating the token):
```ts
			const limiter = context.services.rateLimiter;
			await enforce(limiter, `link:ip:${context.clientIp}`, LIMIT_LINK_IP);
			await enforce(limiter, `link:email:${input.email}`, LIMIT_LINK_EMAIL);
```
In `verify`, first line:
```ts
			await enforce(
				context.services.rateLimiter,
				`verify:ip:${context.clientIp}`,
				LIMIT_VERIFY_IP
			);
```
In `refresh`, first line:
```ts
			await enforce(
				context.services.rateLimiter,
				`refresh:ip:${context.clientIp}`,
				LIMIT_REFRESH_IP
			);
```
(`ORPCError` is already imported.) Verify `"TOO_MANY_REQUESTS"` typechecks as an oRPC error code; if not, use `"BAD_REQUEST"` with the message and note it in the report.

- [ ] **Step 6: update `auth.test.ts`**

Read the existing harness first. Wherever it builds the test `services`/context, add `rateLimiter: createInMemoryRateLimiter()` and ensure the context carries a `clientIp` (e.g. `"ip"`). Add one test: call `requestLink` `LIMIT_LINK_EMAIL + 1` times with the same email/ip and assert the last call rejects with a `TOO_MANY_REQUESTS` ORPCError. Keep existing tests green (they now also pass a limiter).

- [ ] **Step 7: wire in-memory limiter in `apps/server/src/index.ts`**

```ts
import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
```
In `buildServices`, create one (`const rateLimiter = buildRateLimiter();` — see Task 2; for Task 1 just `createInMemoryRateLimiter()`) and add `rateLimiter,` to the returned services object.

- [ ] **Step 8: verify + commit**

```bash
pnpm -F @better-agent/agent check-types && pnpm check-types
pnpm -F @better-agent/agent test -- rate-limiter
pnpm -F @better-agent/api test -- auth
pnpm exec biome lint packages/agent/src/auth/rate-limiter.ts packages/agent/src/auth/rate-limiter.test.ts packages/api/src/context.ts packages/api/src/services.ts packages/api/src/routers/auth.ts packages/api/src/routers/auth.test.ts apps/server/src/index.ts
git add packages/agent/src/auth/rate-limiter.ts packages/agent/src/auth/rate-limiter.test.ts packages/api/src/context.ts packages/api/src/services.ts packages/api/src/routers/auth.ts packages/api/src/routers/auth.test.ts apps/server/src/index.ts
git commit -m "$(printf 'feat(api): rate-limit the public auth endpoints\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: agent + root tsc clean; rate-limiter + auth tests pass; lint clean.

---

### Task 2: Redis rate limiter (cross-instance)

**Files:**
- Create: `apps/server/src/redis-rate-limiter.ts`
- Create test: `apps/server/src/redis-rate-limiter.test.ts`
- Modify: `apps/server/src/index.ts` (select by `env.REDIS_URL`)

- [ ] **Step 1: `redis-rate-limiter.ts`**

```ts
import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";
import type { Redis } from "ioredis";

export function createRedisRateLimiter(redis: Redis): RateLimiter {
	return {
		async hit(key, limit, windowMs) {
			const count = await redis.incr(`ratelimit:${key}`);
			if (count === 1) {
				await redis.pexpire(`ratelimit:${key}`, windowMs);
			}
			return count <= limit;
		},
	};
}
```

- [ ] **Step 2: test `redis-rate-limiter.test.ts`** (ioredis-mock)

```ts
import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisRateLimiter } from "./redis-rate-limiter";

const WINDOW = 1000;

it("allows up to the limit then blocks", async () => {
	const rl = createRedisRateLimiter(new RedisMock());
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(true);
	expect(await rl.hit("k", 2, WINDOW)).toBe(false);
});

it("tracks keys independently", async () => {
	const rl = createRedisRateLimiter(new RedisMock());
	expect(await rl.hit("a", 1, WINDOW)).toBe(true);
	expect(await rl.hit("b", 1, WINDOW)).toBe(true);
});
```

Run: `pnpm -F server test -- redis-rate-limiter` → PASS.

- [ ] **Step 3: select by `env.REDIS_URL` in `apps/server/src/index.ts`**

Add a builder mirroring `buildSessionLock`, and use it for the services `rateLimiter`:
```ts
import { createRedisRateLimiter } from "./redis-rate-limiter";

function buildRateLimiter() {
	return env.REDIS_URL
		? createRedisRateLimiter(new Redis(env.REDIS_URL))
		: createInMemoryRateLimiter();
}
```
Use `const rateLimiter = buildRateLimiter();` in `buildServices` (replace the Task 1 inline `createInMemoryRateLimiter()`), pass `rateLimiter,` to services.

- [ ] **Step 4: verify + commit**

```bash
pnpm -F server check-types
pnpm -F server test -- redis-rate-limiter
pnpm exec biome lint apps/server/src/redis-rate-limiter.ts apps/server/src/redis-rate-limiter.test.ts apps/server/src/index.ts
git add apps/server/src/redis-rate-limiter.ts apps/server/src/redis-rate-limiter.test.ts apps/server/src/index.ts
git commit -m "$(printf 'feat(server): redis-backed cross-instance auth rate limiter\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review Notes
- Coverage: rate limiting on all 3 public auth endpoints (T1 S5); per-IP + per-email (requestLink); Redis cross-instance (T2). `clientIp` from `x-forwarded-for` (T1 S3).
- Type consistency: `RateLimiter.hit(key, limit, windowMs): Promise<boolean>` identical across rate-limiter.ts, services.ts, auth.ts, redis impl. `enforce` throws on `false`.
- Ordering: T1 ships a working single-instance limiter; T2 swaps the impl for cross-instance.
- YAGNI: fixed-window (not sliding); no per-route config object; no headers like Retry-After (message only).
