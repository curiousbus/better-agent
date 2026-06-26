# Tools Admin Page — Design Spec

> Date: 2026-06-25. Follow-on to composio SP1/SP2. The user asked for a dedicated admin "tool 配置页面"; SP2 put per-agent toolkit config in the agent wizard ("每 agent 各配各的"). This adds the standalone discovery page that was the original ask. Per-agent enabling stays in the agent wizard.

## Goal

A top-level **Tools** page in the admin app that shows composio connection status and a **searchable catalog of available composio toolkits** (slug, display name, description, an auth badge for "needs connection" vs "ready"). It's a discovery/reference surface: admins browse what's available and copy slugs into an agent's Tools step. Optionally, the agent wizard's toolkit suggestions are sourced from this live catalog instead of the hardcoded list.

## Why a page (vs the wizard)

SP2's per-agent config (agent wizard → "Tools" step) is the *enabling* surface and stays. This page is the *catalog/status* surface the user asked for — discovery + "is composio connected?" — without contradicting "每 agent 各配各的" (it doesn't globally enable anything; agents still pick their own subset).

## Architecture

1. **Port** (`packages/agent/src/tool/composio-tools.ts`): add
   ```ts
   export interface ComposioToolkitMeta {
     slug: string;
     name: string;
     description: string;
     needsAuth: boolean;   // true → requires per-user OAuth (SP3); false → app-key only
   }
   export interface ComposioService {
     // …existing listTools/execute…
     listToolkits(): Promise<ComposioToolkitMeta[]>;   // app-level, no userId
   }
   ```
2. **apps/server impl** (`apps/server/src/composio.ts`): implement `listToolkits()` via the composio SDK's toolkit-catalog API (exact call pinned in the plan from research), mapping to `ComposioToolkitMeta[]` (slug/name/description + an auth flag). Pure mapper extracted + unit-tested like `mapOpenAiTool`.
3. **Router** (`packages/api/src/routers/composio.ts`, NEW; register in `routers/index.ts` as `composio`): 
   ```ts
   listToolkits: adminProcedure.handler(async ({ context }) => {
     const svc = context.services.composio;
     if (!svc) { return { configured: false, toolkits: [] }; }
     try { return { configured: true, toolkits: await svc.listToolkits() }; }
     catch { return { configured: true, toolkits: [] }; }   // graceful: connected-but-failed
   })
   ```
   adminProcedure-gated (the catalog is admin-only).
4. **Admin route** (`apps/admin/src/routes/tools.tsx`, NEW): `useQuery(orpc.composio.listToolkits...)`. If `!configured` → a flat notice: "Composio 未配置 — 在 server 设置 `COMPOSIO_API_KEY` 后这里会列出可用工具。" Else: a search `Input` filtering by name/slug/description, then a flat list of toolkit rows (name + mono slug + description + a badge: "needs connection" when `needsAuth`, else "ready"). Empty (configured but no toolkits / fetch failed) → "暂无可用工具(或拉取失败)". Mirror `users.tsx`'s flat-row pattern; no cards.
5. **Sidebar** (`apps/admin/src/components/sidebar.tsx`): add `{ kind: "item", item: { to: "/tools", label: "Tools", icon: Wrench } }` (lucide `Wrench`).
6. **(Optional, secondary) wizard suggestions from the catalog** (`agent-wizard-tools.tsx`): replace the hardcoded `SUGGESTED_TOOLKITS` with the top slugs from `orpc.composio.listToolkits` when available, falling back to the static list when unconfigured/empty. Keep it non-blocking (the wizard must still work with composio off).

## Scope / boundaries

- In: composio status + toolkit catalog browse (admin), gated + graceful; sidebar nav.
- Out: per-tool drill-down within a toolkit; categories filter; per-user connect/OAuth (SP3); editing global config from the page (per-agent stays authoritative). The optional wizard-suggestion wiring is the only change to existing SP2 UI.

## Error / disable behavior

- `composio: null` → `{ configured: false }` → page shows the "set COMPOSIO_API_KEY" notice. No errors.
- `listToolkits` throws (bad key, network) → `{ configured: true, toolkits: [] }` → page shows the empty/failed notice. Never crashes the admin.

## Testing

- `composio.test.ts` (api): with a fake `composio` service, `listToolkits` returns `{ configured: true, toolkits }`; with `composio: null`, `{ configured: false, toolkits: [] }`; a throwing service → `{ configured: true, toolkits: [] }`.
- `apps/server/composio.test.ts`: the toolkit-meta mapper is pure + unit-tested (the SDK call itself needs a live key — user smoke-tests).
- Admin page: build + tsc (presentational; user verifies visually — no browser automation per policy).

## Self-review notes

- Type consistency: `ComposioToolkitMeta` defined once in `composio-tools.ts`, consumed by the apps/server impl, the router, and the admin page (via the router client type).
- Graceful everywhere: null → unconfigured; throw → empty; admin page never breaks.
- YAGNI: catalog browse only; no per-tool view, no categories, no global config editing.
- Smoke (human): set `COMPOSIO_API_KEY`, open admin → Tools → see the toolkit catalog with search + auth badges.
