# Tools Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A top-level admin **Tools** page showing composio connection status + a searchable catalog of available toolkits (slug, name, description, auth badge). Design: `docs/superpowers/specs/2026-06-25-tools-admin-page-design.md`.

**Architecture:** New `ComposioService.listToolkits()` (app-level, no userId) → admin-gated `composio.listToolkits` endpoint returning `{ configured, toolkits[] }` (graceful: null key → not configured; fetch error → empty) → an admin `/tools` route + sidebar item. Per-agent enabling stays in the SP2 agent wizard.

**Tech Stack:** `@composio/core@0.11`, oRPC, TanStack Router/Query, Tailwind.

## Global Constraints

- Mirror existing patterns: nullable `composio` service gate; `adminProcedure` for admin-only data; flat admin page like `apps/admin/src/routes/users.tsx` (no cards).
- Composio failure must DEGRADE gracefully (never crash the admin): null → `configured:false`; throw → `{ configured:true, toolkits:[] }`.
- No `any` (narrow local read-subset interfaces + `as` casts of SDK returns; `as unknown` in tests only); `??` over `||`; functions ≤50; files ≤300; conventional-commits + footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (no grep/head pipe). `pnpm exec biome lint <files>` from repo ROOT.

## Verified composio SDK facts (from installed `@composio/core@0.11` `.d.mts`)

- `composio.toolkits.get(query?: { sortBy?: "alphabetically"|"usage"; limit?: number; category?: string; cursor?: string })` → returns a FLAT array `ToolKitItem[]` (no envelope). No `userId`.
- `ToolKitItem` (read-subset we need): `{ name: string; slug: string; noAuth?: boolean; authSchemes?: string[]; meta?: { description?: string } }`.
- Auth badge logic: `needsAuth = !item.noAuth && (item.authSchemes ?? []).some((s) => s !== "NO_AUTH")`.
- Missing key throws at SDK init (`ComposioNoAPIKeyError`) — we never construct when the key is absent (the `buildComposio()` gate). Invalid key throws at call time — caught at the router boundary.

---

### Task 1: Backend — `listToolkits` service + admin endpoint

**Files:**
- Modify: `packages/agent/src/tool/composio-tools.ts` (`ComposioToolkitMeta` + `ComposioService.listToolkits`)
- Modify: `apps/server/src/composio.ts` (pure `mapToolkit` + `listToolkits` impl)
- Modify: `apps/server/src/composio.test.ts` (mapToolkit tests)
- Create: `packages/api/src/routers/composio.ts` + `packages/api/src/routers/composio.test.ts`
- Modify: `packages/api/src/routers/index.ts` (register `composio`)
- Modify: existing `ComposioService` fakes (`packages/agent/src/tool/composio-tools.test.ts`, `packages/api/src/routers/user-sessions.test.ts`) — add `listToolkits` so they still satisfy the interface.

**Interfaces:**
- Produces:
```ts
export interface ComposioToolkitMeta {
	slug: string;
	name: string;
	description: string;
	needsAuth: boolean;
}
// ComposioService gains: listToolkits(): Promise<ComposioToolkitMeta[]>;
```
- Endpoint `composio.listToolkits` → `{ configured: boolean; toolkits: ComposioToolkitMeta[] }`.

- [ ] **Step 1: Port**

`packages/agent/src/tool/composio-tools.ts` — add the `ComposioToolkitMeta` interface (above `ComposioService`) and add to `ComposioService`:
```ts
	/** List the composio toolkit catalog (app-level; no per-user scope). */
	listToolkits(): Promise<ComposioToolkitMeta[]>;
```

- [ ] **Step 2: Write the failing mapper test**

`apps/server/src/composio.test.ts` — add (the mapper is pure; the SDK call needs a live key, untested):
```ts
import { mapToolkit } from "./composio";

describe("mapToolkit", () => {
	it("maps a toolkit and flags OAuth as needing connection", () => {
		expect(
			mapToolkit({ name: "GitHub", slug: "github", authSchemes: ["OAUTH2"], meta: { description: "d" } })
		).toEqual({ slug: "github", name: "GitHub", description: "d", needsAuth: true });
	});
	it("treats noAuth toolkits as ready (no connection needed)", () => {
		expect(
			mapToolkit({ name: "HN", slug: "hackernews", noAuth: true, meta: {} })
		).toEqual({ slug: "hackernews", name: "HN", description: "", needsAuth: false });
	});
	it("treats a NO_AUTH-only scheme as ready", () => {
		expect(mapToolkit({ name: "X", slug: "x", authSchemes: ["NO_AUTH"] }).needsAuth).toBe(false);
	});
});
```

- [ ] **Step 3: Run the test (fail)**

Run: `pnpm -F server test composio` → FAIL (`mapToolkit` not exported).

- [ ] **Step 4: Implement in `apps/server/src/composio.ts`**

Add a read-subset interface + pure mapper + the service method:
```ts
interface ToolKitItem {
	name: string;
	slug: string;
	noAuth?: boolean;
	authSchemes?: string[];
	meta?: { description?: string };
}

export function mapToolkit(item: ToolKitItem): ComposioToolkitMeta {
	const needsAuth =
		!item.noAuth && (item.authSchemes ?? []).some((s) => s !== "NO_AUTH");
	return {
		slug: item.slug,
		name: item.name,
		description: item.meta?.description ?? "",
		needsAuth,
	};
}
```
Import `ComposioToolkitMeta` from `@better-agent/agent/tool/composio-tools`. In the object returned by `createComposioService`, add:
```ts
async listToolkits() {
	const toolkits = await composio.toolkits.get({ sortBy: "alphabetically", limit: 100 });
	return (toolkits as ToolKitItem[]).map(mapToolkit);
},
```
NOTE for the implementer: verify `composio.toolkits.get`'s real return/params against the installed `@composio/core@0.11` types; if the array element shape differs from `ToolKitItem`, adjust the read-subset interface + the Step 2 test to match (NO `any` — narrow interface + `as` cast). Keep `mapToolkit` pure.

- [ ] **Step 5: Run the mapper test (pass)**

Run: `pnpm -F server test composio` → PASS.

- [ ] **Step 6: Write the failing router test**

`packages/api/src/routers/composio.test.ts` — build a router client with an admin caller (mirror `admin.test.ts`'s admin-context harness) and a fake `composio` in services:
```ts
const fakeComposio = {
	listTools: () => Promise.resolve([]),
	execute: () => Promise.resolve({ output: "" }),
	listToolkits: () =>
		Promise.resolve([{ slug: "github", name: "GitHub", description: "d", needsAuth: true }]),
};
```
Assertions:
- admin caller + `composio: fakeComposio` → `listToolkits()` returns `{ configured: true, toolkits: [{ slug: "github", ... }] }`.
- `composio: null` → `{ configured: false, toolkits: [] }`.
- a `listToolkits` that rejects → `{ configured: true, toolkits: [] }`.
- a non-admin caller → rejects (FORBIDDEN/UNAUTHORIZED).

- [ ] **Step 7: Run the router test (fail), then implement**

`packages/api/src/routers/composio.ts`:
```ts
import { adminProcedure } from "../index";

export const composioRouter = {
	listToolkits: adminProcedure.handler(async ({ context }) => {
		const svc = context.services.composio;
		if (!svc) {
			return { configured: false, toolkits: [] };
		}
		try {
			return { configured: true, toolkits: await svc.listToolkits() };
		} catch {
			return { configured: true, toolkits: [] };
		}
	}),
};
```
Register in `packages/api/src/routers/index.ts`: import `composioRouter`, add `composio: composioRouter,` to `appRouter`.

- [ ] **Step 8: Fix the broken fakes**

Adding `listToolkits` to `ComposioService` breaks existing fakes — add `listToolkits: () => Promise.resolve([])` to the fake services in `packages/agent/src/tool/composio-tools.test.ts` and `packages/api/src/routers/user-sessions.test.ts` (and anywhere else `pnpm check-types` flags a `ComposioService` literal).

- [ ] **Step 9: Verify + commit**

```bash
pnpm check-types
pnpm -F server test composio
pnpm -F @better-agent/api test -- composio
pnpm -F @better-agent/api test
pnpm -F server build
pnpm exec biome lint apps/server/src/composio.ts apps/server/src/composio.test.ts packages/agent/src/tool/composio-tools.ts packages/api/src/routers/composio.ts packages/api/src/routers/composio.test.ts packages/api/src/routers/index.ts
git add packages/agent/src/tool/composio-tools.ts apps/server/src/composio.ts apps/server/src/composio.test.ts packages/api/src/routers/composio.ts packages/api/src/routers/composio.test.ts packages/api/src/routers/index.ts packages/api/src/routers/user-sessions.test.ts
git commit -m "$(printf 'feat(api): composio toolkit catalog endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; server + api tests pass; server build clean; lint clean.

---

### Task 2: Admin Tools page + sidebar nav

**Files:**
- Create: `apps/admin/src/routes/tools.tsx`
- Modify: `apps/admin/src/components/sidebar.tsx`

- [ ] **Step 1: Tools page**

`apps/admin/src/routes/tools.tsx` — `createFileRoute("/tools")`. `useQuery(orpc.composio.listToolkits.queryOptions())`. Derive the row type from the router client (like `users.tsx` derives `AdminUserRow`). Render (flat, mirror `users.tsx`):
- Loading → a `Skeleton`/simple "Loading…".
- `data.configured === false` → a flat notice: "Composio 未配置 — 在 server 设置 `COMPOSIO_API_KEY` 后这里会列出可用工具。"
- Else: a search `Input` (state filters `toolkits` by `name`/`slug`/`description`, case-insensitive); below it a flat list of toolkit rows. Each row: `name` (medium) + `slug` (mono, muted) + truncated `description`, and a `Badge` on the right — `variant="outline"` "needs connection" when `needsAuth`, else `variant="secondary"` "ready". Empty (configured but `toolkits` empty, or filtered to none) → a muted "暂无可用工具(或拉取失败)" / "没有匹配的工具". Extract a `ToolkitRow` component (keep functions ≤50 lines). No cards/borders boxing — use the `hover:bg-accent` row style from `users.tsx`.

Helper copy under the heading: "这些是 composio 提供的工具集。在某个 agent 的编辑向导 → Tools 步骤里,把需要的 toolkit slug 加给该 agent。"

- [ ] **Step 2: Sidebar nav**

`apps/admin/src/components/sidebar.tsx` — import `Wrench` from `lucide-react`; add to `SECTIONS` (after Agents):
```ts
	{ kind: "item", item: { to: "/tools", label: "Tools", icon: Wrench } },
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm -F admin build
cd apps/admin && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/admin/src/routes/tools.tsx apps/admin/src/components/sidebar.tsx
git add apps/admin/src/routes/tools.tsx apps/admin/src/components/sidebar.tsx
git commit -m "$(printf 'feat(admin): tools page with composio toolkit catalog\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: admin build + tsc clean; lint clean. (Presentational — do NOT drive a browser; the user verifies visually.)

---

## Self-Review Notes
- Coverage: `listToolkits` port + impl + pure mapper (T1); admin-gated graceful endpoint (T1); admin Tools page + nav (T2).
- Type consistency: `ComposioToolkitMeta` defined once in `composio-tools.ts`; consumed by the apps/server impl, the router, and the admin page (via the router client type). Endpoint shape `{ configured, toolkits }` consumed by the page.
- Graceful: null → `configured:false` (page shows the set-key notice); throw → empty (page shows empty notice); adminProcedure-gated.
- YAGNI: catalog browse only — no per-tool drill-down, no categories filter, no global config editing, no wizard rewiring (agent wizard keeps its static suggestion chips; sourcing them from this catalog is a deferred polish).
- Smoke (human): set `COMPOSIO_API_KEY`, open admin → Tools → search the toolkit catalog with ready/needs-connection badges.
```
