# Composio Per-User Connections (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A user connects/disconnects composio integrations on the web account page; connected, their agents' composio tools run with their credentials. Design: `docs/superpowers/specs/2026-06-25-composio-connections-sp3-design.md`.

**Architecture:** `ComposioService` gains `connect`/`listConnections`/`disconnect` (via `toolkits.authorize` / `connectedAccounts.list` / `connectedAccounts.delete`). User-facing `composio` router endpoints (`connectableToolkits`, `connections`, `connect`, `disconnect` — disconnect ownership-checked). A web **Integrations** section on the account page drives them. Composio scopes by our account `userId` (already wired in SP1), so connecting "just works" with the existing `tools.execute`.

**Tech Stack:** `@composio/core@0.11`, oRPC, TanStack Router/Query.

## Verified composio SDK facts (installed 0.11 types)

- `composio.toolkits.authorize(userId: string, toolkitSlug: string): Promise<{ id; status?; redirectUrl?: string | null }>` — auto-creates managed auth config; send the user to `redirectUrl`; composio marks ACTIVE server-side after OAuth (no app callback). No `callbackUrl` arg.
- `composio.connectedAccounts.list({ userIds: [userId] }): Promise<{ items: Array<{ id: string; status: string; toolkit: { slug: string }; createdAt: string }>; nextCursor?; totalPages }>`. Status: `INITIALIZING|INITIATED|ACTIVE|FAILED|EXPIRED|INACTIVE|REVOKED`.
- `composio.connectedAccounts.delete(id: string): Promise<unknown>`.

## Global Constraints

- USER endpoints use `userProcedure`; `disconnect` ownership-checked (composio delete is app-level by id). Graceful gating (null `composio` → not-configured/empty/NOT_FOUND; throw → empty). Composio failure never breaks the account page.
- No `any` (narrow read-subset interfaces + `as` casts; `as never`/`as unknown` in tests only); `??` over `||` (use `||` only for genuine boolean OR); functions ≤50; files ≤300; conventional-commits + footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (no grep/head pipe). `pnpm exec biome lint <files>` from repo ROOT.

---

### Task 1: Backend — connect / list / disconnect service + user endpoints

**Files:**
- Modify: `packages/agent/src/tool/composio-tools.ts` (`ComposioConnectionMeta` + 3 methods)
- Modify: `apps/server/src/composio.ts` (`mapConnection` + 3 impls)
- Modify: `apps/server/src/composio.test.ts` (`mapConnection` test)
- Modify: `packages/api/src/routers/composio.ts` (`connectableToolkits`, `connections`, `connect`, `disconnect`)
- Modify: `packages/api/src/routers/composio.test.ts`
- Modify: existing `ComposioService` fakes — `packages/agent/src/tool/composio-tools.test.ts`, `packages/api/src/routers/user-sessions.test.ts` (add the 3 new methods).

**Interfaces:**
- Produces:
```ts
export interface ComposioConnectionMeta { id: string; toolkitSlug: string; status: string; active: boolean; }
// ComposioService gains:
//   connect(userId: string, toolkit: string): Promise<{ redirectUrl: string }>;
//   listConnections(userId: string): Promise<ComposioConnectionMeta[]>;
//   disconnect(connectionId: string): Promise<void>;
```
- Endpoints: `composio.connectableToolkits` → `{ configured, toolkits }`; `composio.connections` → `ComposioConnectionMeta[]`; `composio.connect({toolkit})` → `{ redirectUrl }`; `composio.disconnect({id})` → `{ ok: true }`.

- [ ] **Step 1: Port**

`packages/agent/src/tool/composio-tools.ts` — add `ComposioConnectionMeta` and to `ComposioService`:
```ts
	connect(userId: string, toolkit: string): Promise<{ redirectUrl: string }>;
	listConnections(userId: string): Promise<ComposioConnectionMeta[]>;
	disconnect(connectionId: string): Promise<void>;
```

- [ ] **Step 2: Failing `mapConnection` test**

`apps/server/src/composio.test.ts` — add:
```ts
import { mapConnection } from "./composio";

describe("mapConnection", () => {
	it("maps a connected account and flags ACTIVE", () => {
		expect(
			mapConnection({ id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } })
		).toEqual({ id: "ca_1", toolkitSlug: "gmail", status: "ACTIVE", active: true });
	});
	it("flags a non-ACTIVE status as inactive", () => {
		expect(
			mapConnection({ id: "ca_2", status: "INITIATED", toolkit: { slug: "slack" } }).active
		).toBe(false);
	});
});
```

- [ ] **Step 3: Run (fail)** — `pnpm -F server test composio` → FAIL.

- [ ] **Step 4: Implement in `apps/server/src/composio.ts`**

Add the read-subset + pure mapper + 3 service methods:
```ts
interface ConnectedAccountItem {
	id: string;
	status: string;
	toolkit: { slug: string };
}

export function mapConnection(item: ConnectedAccountItem): ComposioConnectionMeta {
	return {
		id: item.id,
		toolkitSlug: item.toolkit.slug,
		status: item.status,
		active: item.status === "ACTIVE",
	};
}
```
In the `createComposioService` returned object:
```ts
async connect(userId, toolkit) {
	const req = await composio.toolkits.authorize(userId, toolkit);
	return { redirectUrl: req.redirectUrl ?? "" };
},
async listConnections(userId) {
	const res = (await composio.connectedAccounts.list({ userIds: [userId] })) as {
		items: ConnectedAccountItem[];
	};
	return res.items.map(mapConnection);
},
async disconnect(connectionId) {
	await composio.connectedAccounts.delete(connectionId);
},
```
Import `ComposioConnectionMeta`. NOTE: verify the real `toolkits.authorize` / `connectedAccounts.list` / `.delete` shapes against the installed `@composio/core@0.11` types and adjust the read-subset + casts if they differ (NO `any`).

- [ ] **Step 5: Run (pass)** — `pnpm -F server test composio` → PASS.

- [ ] **Step 6: Fix fakes**

Add to the fake `ComposioService` objects in `packages/agent/src/tool/composio-tools.test.ts` and `packages/api/src/routers/user-sessions.test.ts`:
```ts
	connect: () => Promise.resolve({ redirectUrl: "" }),
	listConnections: () => Promise.resolve([]),
	disconnect: () => Promise.resolve(),
```

- [ ] **Step 7: Failing router tests**

`packages/api/src/routers/composio.test.ts` — these endpoints are `userProcedure` (any signed-in user; NOT admin). Add a `buildUserClient(composio)` helper (an `authedUser` that need not be admin; mirror the existing harness but the user can be a plain user). Tests:
- `connect({ toolkit: "gmail" })` with a fake whose `connect` returns `{ redirectUrl: "https://x" }` → returns `{ redirectUrl: "https://x" }`.
- `connections()` → returns the fake's `listConnections` result.
- `disconnect({ id })` where the id IS in the caller's `listConnections` → calls `svc.disconnect` (assert via a spy) and returns `{ ok: true }`.
- `disconnect({ id: "not-mine" })` where the id is NOT in `listConnections` → rejects NOT_FOUND, and `svc.disconnect` is NOT called.
- `composio: null` → `connectableToolkits()` = `{ configured: false, toolkits: [] }`; `connections()` = `[]`; `connect()` rejects NOT_FOUND.
- `connectableToolkits()` filters `listToolkits()` to `needsAuth: true` only.

- [ ] **Step 8: Implement the router endpoints**

In `packages/api/src/routers/composio.ts` add (keep `listToolkits` admin as-is; import `userProcedure`, `z`, `ORPCError`):
```ts
connectableToolkits: userProcedure.handler(async ({ context }) => {
	const svc = context.services.composio;
	if (!svc) { return { configured: false, toolkits: [] }; }
	try {
		const all = await svc.listToolkits();
		return { configured: true, toolkits: all.filter((t) => t.needsAuth) };
	} catch { return { configured: true, toolkits: [] }; }
}),

connections: userProcedure.handler(async ({ context }) => {
	const svc = context.services.composio;
	if (!svc) { return []; }
	try { return await svc.listConnections(context.authedUser.id); }
	catch { return []; }
}),

connect: userProcedure
	.input(z.object({ toolkit: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const svc = context.services.composio;
		if (!svc) { throw new ORPCError("NOT_FOUND", { message: "Composio is not configured" }); }
		try { return await svc.connect(context.authedUser.id, input.toolkit); }
		catch { throw new ORPCError("BAD_REQUEST", { message: "Could not start the connection" }); }
	}),

disconnect: userProcedure
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const svc = context.services.composio;
		if (!svc) { throw new ORPCError("NOT_FOUND", { message: "Composio is not configured" }); }
		const mine = await svc.listConnections(context.authedUser.id);
		if (!mine.some((c) => c.id === input.id)) {
			throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
		}
		await svc.disconnect(input.id);
		return { ok: true };
	}),
```

- [ ] **Step 9: Verify + commit**

```bash
pnpm check-types
pnpm -F server test composio
pnpm -F @better-agent/api test
pnpm -F server build
pnpm exec biome lint apps/server/src/composio.ts apps/server/src/composio.test.ts packages/agent/src/tool/composio-tools.ts packages/agent/src/tool/composio-tools.test.ts packages/api/src/routers/composio.ts packages/api/src/routers/composio.test.ts packages/api/src/routers/user-sessions.test.ts
git add packages/agent/src/tool/composio-tools.ts apps/server/src/composio.ts apps/server/src/composio.test.ts packages/api/src/routers/composio.ts packages/api/src/routers/composio.test.ts packages/api/src/routers/user-sessions.test.ts
git commit -m "$(printf 'feat(api): composio per-user connect/list/disconnect endpoints\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; server + api tests pass; server build clean; lint clean.

---

### Task 2: Web — account Integrations section

**Files:**
- Modify: `apps/web/src/routes/account.tsx`

- [ ] **Step 1: Integrations section**

Read `account.tsx` first (it composes sections like `PasswordSection`; uses `orpc`/`client` + `useQuery`/`useMutation` + `toast`). Add an `IntegrationsSection` component and render it in `AccountPage`:
- `const toolkits = useQuery(orpc.composio.connectableToolkits.queryOptions());`
- `const connections = useQuery(orpc.composio.connections.queryOptions());`
- If `toolkits.data?.configured === false` → render nothing (or a muted "Composio 未配置" line). 
- Else map each connectable toolkit to a flat row: name/slug + a status badge derived from whether `connections.data` has an `active` connection for that `toolkitSlug`, and a button:
  - Not connected → **Connect**: `const { redirectUrl } = await client.composio.connect({ toolkit: slug }); if (redirectUrl) { window.location.href = redirectUrl; }` (on error → `toast.error`).
  - Connected → **Disconnect**: `useMutation(orpc.composio.disconnect.mutationOptions())` `.mutate({ id })` with `onSuccess` → invalidate `orpc.composio.connections.key()`; `onError` → `toast.error`.
- Flat styling (mirror the existing account sections — no nested cards). Extract an `IntegrationRow` to keep functions ≤50 lines. No `any`; derive row types from the router client like other web code.

- [ ] **Step 2: Verify + commit**

```bash
pnpm -F web build
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/routes/account.tsx
git add apps/web/src/routes/account.tsx
git commit -m "$(printf 'feat(web): connect composio integrations on the account page\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web build + tsc clean; lint clean. (Presentational + external OAuth — do NOT drive a browser; the user smoke-tests the real connect flow with a live key.)

---

## Self-Review Notes
- Coverage: connect/list/disconnect service + pure `mapConnection` (T1); user-facing endpoints w/ graceful gating + disconnect ownership check (T1); web Integrations UI (T2).
- Type consistency: `ComposioConnectionMeta` once in `composio-tools.ts`, consumed by impl/router/page; `connectableToolkits` reuses `listToolkits()` filtered to `needsAuth`.
- Security: `disconnect` verifies the connection belongs to the caller before deleting (composio delete is app-level by id).
- Graceful: null → not-configured/empty/NOT_FOUND; throw → empty / BAD_REQUEST toast; never breaks the account page. Per-user via `authedUser.id`.
- YAGNI: managed-auth `authorize` (no authConfig management / callbackUrl), first-page connections only, no admin cross-user view.
- Smoke (human): `COMPOSIO_API_KEY` set → Account → Integrations → Connect Gmail → finish OAuth → return → Connected; the user's agents' Gmail tools then run as them.
