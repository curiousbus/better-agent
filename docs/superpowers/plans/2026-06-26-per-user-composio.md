# Per-User Composio (rework) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make composio per-user — each user sets their own API key, connects their own tools, and any agent they chat with uses what they've connected. Remove admin-side composio config. Design: `docs/superpowers/specs/2026-06-26-per-user-composio-design.md`.

**Architecture:** Per-user composio key in the `settings` table under `composio:{userId}` (encrypted). `AgentServices.composio` becomes `(userId) => Promise<ComposioService | null>`. A turn's tools come from the user's active connections. Remove the admin settings page, admin tools page, agent wizard tools step, and the admin `listToolkits`.

**Tech Stack:** oRPC, Drizzle, `@composio/core`, TanStack Router/Query, SecretBox.

## Global Constraints

- Per-user key encrypted at rest, NEVER returned (only a `configured` boolean). `userProcedure`, scoped to `authedUser.id`. `disconnect` stays ownership-checked.
- No `any` (`as never`/`as unknown` in tests only); `??` over `||` (genuine boolean OR may use `||`); functions ≤50; files ≤300; flat UI; conventional-commits + footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (no grep/head pipe). `pnpm exec biome lint <files>` from repo ROOT (it may exit 1 printing "No issues found" — project baseline). NO barrel files (no re-export-only modules). Avoid array-index keys.

---

### Task 1: Per-user composio key, resolver, and user-driven tools (backend)

**Files:**
- Modify: `packages/agent/src/tool/composio-tools.ts` (add `composioKeyName`)
- Modify: `apps/server/src/optional-services.ts` (`buildComposioResolver` → per-user)
- Modify: `apps/server/src/index.ts` (resolver wiring; drop `envSecretKeys`)
- Modify: `packages/api/src/services.ts` (`composio` signature; drop `envSecretKeys`)
- Modify: `packages/api/src/routers/composio.ts` (key endpoints; per-user resolve; remove admin `listToolkits`)
- Modify: `packages/api/src/routers/composio.test.ts`
- Modify: `packages/api/src/routers/user-sessions.ts` (`safeComposioDefs` derives from connections)
- Modify: `packages/api/src/routers/user-sessions.test.ts`
- Modify: `apps/server/src/composio-resolver.test.ts`

**Interfaces:**
- `AgentServices.composio: (userId: string) => Promise<ComposioService | null>`.
- `export const composioKeyName = (userId: string) => \`composio:${userId}\`;` (in `composio-tools.ts`).

- [ ] **Step 1: key name helper** — in `composio-tools.ts` add `export const composioKeyName = (userId: string) => \`composio:${userId}\`;`.

- [ ] **Step 2: per-user resolver** — `apps/server/src/optional-services.ts`, replace `buildComposioResolver`:
```ts
import { composioKeyName } from "@better-agent/agent/tool/composio-tools";

export function buildComposioResolver(settings: SettingsStore) {
	const cache = new Map<string, { key: string; service: ComposioService }>();
	return async (userId: string): Promise<ComposioService | null> => {
		const key = await settings.get(composioKeyName(userId));
		if (!key) {
			cache.delete(userId);
			return null;
		}
		const cached = cache.get(userId);
		if (cached?.key !== key) {
			cache.set(userId, { key, service: createComposioService({ apiKey: key }) });
		}
		return cache.get(userId)?.service ?? null;
	};
}
```
(No more `env.COMPOSIO_API_KEY` fallback. `createComposioService({ apiKey })` already takes only `apiKey`.)

- [ ] **Step 3: services type** — `services.ts`: `composio: (userId: string) => Promise<ComposioService | null>;`. DELETE the `envSecretKeys: string[];` field. `apps/server/src/index.ts`: keep `composio: buildComposioResolver(settings)` (now per-user); DELETE the `envSecretKeys: …` line from the services object.

- [ ] **Step 4: composio router** — `packages/api/src/routers/composio.ts`. REMOVE the admin `listToolkits` handler and its `adminProcedure` import if now unused. Add `userProcedure` key endpoints + make the existing ones resolve per-user:
```ts
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { composioKeyName } from "@better-agent/agent/tool/composio-tools";
import { userProcedure } from "../index";

export const composioRouter = {
	keyStatus: userProcedure.handler(async ({ context }) => {
		const key = await context.services.stores.settings.get(
			composioKeyName(context.authedUser.id)
		);
		return { configured: key !== null };
	}),
	setKey: userProcedure
		.input(z.object({ apiKey: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.settings.set(
				composioKeyName(context.authedUser.id),
				input.apiKey
			);
			return { ok: true };
		}),
	clearKey: userProcedure.handler(async ({ context }) => {
		await context.services.stores.settings.delete(
			composioKeyName(context.authedUser.id)
		);
		return { ok: true };
	}),
	connectableToolkits: userProcedure.handler(async ({ context }) => {
		const svc = await context.services.composio(context.authedUser.id);
		if (!svc) {
			return { configured: false, toolkits: [] };
		}
		try {
			const all = await svc.listToolkits();
			return { configured: true, toolkits: all.filter((t) => t.needsAuth) };
		} catch {
			return { configured: true, toolkits: [] };
		}
	}),
	connections: userProcedure.handler(async ({ context }) => {
		const svc = await context.services.composio(context.authedUser.id);
		if (!svc) {
			return [];
		}
		try {
			return await svc.listConnections(context.authedUser.id);
		} catch {
			return [];
		}
	}),
	connect: userProcedure
		.input(z.object({ toolkit: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const svc = await context.services.composio(context.authedUser.id);
			if (!svc) {
				throw new ORPCError("NOT_FOUND", { message: "Composio is not configured" });
			}
			try {
				return await svc.connect(context.authedUser.id, input.toolkit);
			} catch {
				throw new ORPCError("BAD_REQUEST", { message: "Could not start the connection" });
			}
		}),
	disconnect: userProcedure
		.input(z.object({ id: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const svc = await context.services.composio(context.authedUser.id);
			if (!svc) {
				throw new ORPCError("NOT_FOUND", { message: "Composio is not configured" });
			}
			const mine = await svc.listConnections(context.authedUser.id);
			if (!mine.some((c) => c.id === input.id)) {
				throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
			}
			await svc.disconnect(input.id);
			return { ok: true };
		}),
};
```

- [ ] **Step 5: user-driven tools** — `packages/api/src/routers/user-sessions.ts`. Change `safeComposioDefs` to take `(service, userId)` and derive toolkits from the user's ACTIVE connections:
```ts
export async function safeComposioDefs(
	service: ComposioService | null,
	userId: string
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		const connections = await service.listConnections(userId);
		const toolkits = [
			...new Set(connections.filter((c) => c.active).map((c) => c.toolkitSlug)),
		];
		if (toolkits.length === 0) {
			return [];
		}
		return await buildComposioToolDefs(service, userId, toolkits);
	} catch {
		return [];
	}
}
```
In `streamUserTurn`, drop the agent-toolkit load and call:
```ts
const composioSvc = await context.services.composio(userId);
const composioDefs = await safeComposioDefs(composioSvc, userId);
```
(Remove the `const agent = await context.services.stores.agent.get(session.agentId)` line if it was only used for `composioToolkits`.)

- [ ] **Step 6: update tests**
- `composio-resolver.test.ts`: the resolver now takes `userId`. With a Map-backed fake `SettingsStore`: `settings.set(composioKeyName("u1"), "sk-x")` → `resolver("u1")` non-null; same key memoized (`===`); `resolver("u2")` (no key) → null; changing u1's key → new instance.
- `composio.test.ts`: fixtures `composio: () => Promise.resolve(X)` become `composio: (_userId: string) => Promise.resolve(X)`. Add a fake `settings` store to services. Remove the admin `listToolkits` tests. Add: `setKey` then `keyStatus` `{configured:true}`, `clearKey` → `{configured:false}`, and `keyStatus`/etc never return the value. Keep `connect`/`connections`/`disconnect` (now resolver-based) + the disconnect ownership NOT_FOUND test.
- `user-sessions.test.ts`: `safeComposioDefs(service, "u1")` — the fake service's `listConnections` returns an active connection so toolkits derive; assert defs built. `safeComposioDefs(null, "u1")` → []; a service whose `listConnections` rejects → []. Update the `composio` services fixture to `(_userId) => Promise.resolve(...)`.

- [ ] **Step 7: verify + commit**
```bash
pnpm check-types
pnpm -F server test composio
pnpm -F @better-agent/api test
pnpm -F server build
pnpm exec biome lint <changed files>
git add packages/agent/src/tool/composio-tools.ts apps/server/src/optional-services.ts apps/server/src/index.ts apps/server/src/composio-resolver.test.ts packages/api/src/services.ts packages/api/src/routers/composio.ts packages/api/src/routers/composio.test.ts packages/api/src/routers/user-sessions.ts packages/api/src/routers/user-sessions.test.ts
git commit -m "$(printf 'feat(api): per-user composio key, resolver, and user-driven tools\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; server + api tests pass; server build clean.

---

### Task 2: Remove admin composio config

**Files:**
- Delete: `packages/api/src/routers/settings.ts`, `packages/api/src/routers/settings.test.ts`
- Modify: `packages/api/src/routers/index.ts` (unregister `settings`)
- Delete: `apps/admin/src/routes/settings.tsx`, `apps/admin/src/routes/tools.tsx`
- Modify: `apps/admin/src/components/sidebar.tsx` (remove Settings + Tools nav items)
- Modify: `apps/admin/src/components/agents/agent-form.ts` (remove the "Tools" wizard step), `apps/admin/src/components/agents/agent-wizard.tsx` (remove the Tools render branch)
- Delete: `apps/admin/src/components/agents/agent-wizard-tools.tsx`
- Modify: `apps/admin/src/routeTree.gen.ts` (regenerated by build)

- [ ] **Step 1: delete the admin settings router + page**
- Delete `packages/api/src/routers/settings.ts` + `settings.test.ts`. In `packages/api/src/routers/index.ts` remove the `settings` import + the `settings: settingsRouter,` line.
- Delete `apps/admin/src/routes/settings.tsx`. In `apps/admin/src/components/sidebar.tsx` remove the `{ to: "/settings", … }` item (and its `SlidersHorizontal` import if now unused).

- [ ] **Step 2: delete the admin tools page**
- Delete `apps/admin/src/routes/tools.tsx`. In `sidebar.tsx` remove the `{ to: "/tools", … }` item (and the `Wrench` import if unused).

- [ ] **Step 3: remove the agent wizard Tools step**
- `apps/admin/src/components/agents/agent-form.ts`: remove `"Tools"` from `WIZARD_STEPS` (back to `["Identity","Model","Params"]`). Leave the `composioToolkits` field on `AgentForm`/`EMPTY_AGENT_FORM`/`toAgentInput`/`agentRowToForm` as-is (dead but harmless — it's sent as `[]` and ignored server-side).
- `apps/admin/src/components/agents/agent-wizard.tsx`: remove the `TOOLS_STEP`/`ToolsStep` import + its render branch (step index 3).
- Delete `apps/admin/src/components/agents/agent-wizard-tools.tsx`.

- [ ] **Step 4: verify + commit**
```bash
pnpm check-types
pnpm -F @better-agent/api test
pnpm -F admin build
cd apps/admin && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint <changed files>
git add -A ':!docs/research'
git commit -m "$(printf 'refactor: remove admin composio config (settings, tools, agent toolkits)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean (the dropped `settings`/`composio.listToolkits`/`envSecretKeys` are no longer referenced); api tests pass; admin build clean (route tree regenerated without `/settings` and `/tools`). Include the regenerated `routeTree.gen.ts`.

---

### Task 3: Account page — user composio key

**Files:**
- Create: `apps/web/src/components/account-composio-key.tsx`
- Modify: `apps/web/src/routes/account.tsx` (render it above Integrations)

- [ ] **Step 1: key section component**

`account-composio-key.tsx` — a `ComposioKeySection`: `useQuery(orpc.composio.keyStatus.queryOptions())`. Render a flat section (mirror the existing account sections, no cards): a heading "Composio", a short help line ("用你自己的 composio API key 连接工具,只对你生效。"), a status `Badge` ("Connected"/"Not set" from `configured`), a `type="password"` `Input` + **Save** (`useMutation(orpc.composio.setKey.mutationOptions())` `.mutate({ apiKey })` → on success invalidate `orpc.composio.keyStatus.key()` + `orpc.composio.connectableToolkits.key()` + clear the input + `toast.success`; on error `toast.error`), and a **Clear** button when `configured` (`orpc.composio.clearKey` → invalidate the same keys). Extract a small subcomponent if needed to keep functions ≤50. No `any`; derive nothing risky.

- [ ] **Step 2: render it**

In `apps/web/src/routes/account.tsx`, render `<ComposioKeySection />` ABOVE the existing `<IntegrationsSection />` (so the user sets the key, then connects tools). The Integrations section already gates on `connectableToolkits.configured`, so it stays hidden until a key is set.

- [ ] **Step 3: verify + commit**
```bash
pnpm -F web build
cd apps/web && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/web/src/components/account-composio-key.tsx apps/web/src/routes/account.tsx
git add apps/web/src/components/account-composio-key.tsx apps/web/src/routes/account.tsx
git commit -m "$(printf 'feat(web): set your own composio api key on the account page\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: web build + tsc clean.

---

## Self-Review Notes
- Coverage: per-user key storage + resolver + endpoints + user-driven tools (T1); removal of admin composio config (T2); account key UI (T3).
- Type consistency: `composio: (userId) => …` everywhere it's read; `composioKeyName` shared by the router + resolver; `safeComposioDefs(service, userId)`.
- Security: per-user key encrypted, never returned, userProcedure-scoped; disconnect ownership-checked; calls run under each user's own key.
- YAGNI: dead `composio_toolkits` column/field left in place (no migration); no per-agent user tool filter; everything connected is available to every agent.
- Smoke (human): Account → set composio key → Integrations lists toolkits → connect Gmail → chat with any agent → it can use Gmail, under your key.
