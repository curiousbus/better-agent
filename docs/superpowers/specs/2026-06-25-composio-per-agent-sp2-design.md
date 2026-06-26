# Composio Per-Agent Tool Config (SP2) — Design Spec

> Date: 2026-06-25. Sub-project SP2 of the tool-config feature. Builds on SP1 (`docs/superpowers/specs/2026-06-25-composio-tools-sp1-design.md`, shipped origin/main 6d4e605). SP3 (per-user connect-account OAuth) is later.

## Goal

Each agent configures **which composio toolkits it uses** ("每 agent 各配各的"). The runtime resolves a chat turn's composio tools from the turn's agent's toolkit list (per-user scoped by `userId` as in SP1). Admins set the list in the agent wizard.

## Decisions

- **Storage:** `agents.composio_toolkits` — a `jsonb` `string[]`, `NOT NULL DEFAULT []`. Lives on the agent row (consistent with `params`). Migration via `pnpm db:generate` + `pnpm db:migrate` (shared local DB — never `db:push`).
- **Granularity:** toolkit-level (an agent enables whole toolkits; gets all their tools). Matches `composio.tools.get(userId, { toolkits })`. Per-tool filtering is YAGNI.
- **Resolution + fallback:** the agent's `composioToolkits` is authoritative. When it is empty, the service falls back to the env `COMPOSIO_TOOLKITS` default (preserves SP1's zero-config smoke path). So: `listTools(userId, toolkits)` uses `toolkits.length ? toolkits : defaultToolkits`; empty resolved set → no composio tools.
- **Admin UI:** a "Tools" step in the agent wizard with a tag input (type a toolkit slug + Enter → chip; chips removable) plus a few common-toolkit quick-add suggestions (e.g. `hackernews`, `github`, `gmail`, `slack`). No dynamic composio toolkit-catalog fetch in SP2 (a later polish; avoids depending on another unverified composio API and works even when composio is unconfigured for the admin).

## Architecture / changes

1. **Data model** (`packages/db/src/schema/agents.ts`): add `composioToolkits: jsonb("composio_toolkits").$type<string[]>().notNull().default([])`. Generate + apply migration.
2. **Types** (`packages/agent/src/agent/types.ts`): `AgentConfig` and `AgentInput` gain `composioToolkits: string[]`. `toAgentConfig` (`agent-store.ts`) maps `composioToolkits: row.composioToolkits ?? []`. The store's `create`/`update` already spread input, so the value flows once the column + types exist. The fake agent store (`testing/fake-agent-store.ts`) includes it.
3. **Router** (`packages/api/src/routers/agents.ts`): `agentInput` zod gains `composioToolkits: z.array(z.string()).default([])` (covers both create + update).
4. **Service signature** (SP1 code): `ComposioService.listTools(userId, toolkits: string[])` and `buildComposioToolDefs(service, userId, toolkits)`. The `apps/server` impl keeps a `defaultToolkits` (from env `COMPOSIO_TOOLKITS`) and resolves `toolkits.length ? toolkits : defaultToolkits`.
5. **Turn wiring** (`user-sessions.ts`): `streamUserTurn` captures the session from `requireUserSession`, loads its agent (`stores.agent.get(session.agentId)`), and calls `safeComposioDefs(composio, userId, agent?.composioToolkits ?? [])`. `safeComposioDefs` gains the `toolkits` param and forwards it (still null/throw → []).
6. **Admin UI** (`apps/admin/src/components/agents/*`): `AgentForm` + `EMPTY_AGENT_FORM` + `toAgentInput` + `agentRowToForm` gain `composioToolkits: string[]`; `WIZARD_STEPS` gains `"Tools"`; a `ToolsStep` with a small `ToolkitsInput` (tag editor + suggestions); `isStepValid` for Tools → true (optional).

## Scope / boundaries

- In: per-agent toolkit storage + CRUD + runtime resolution + admin wizard step.
- Out: dynamic composio toolkit catalog/picker (later), per-tool (not per-toolkit) selection, per-user OAuth (SP3), caching `listTools`.

## Testing

- `agents.test.ts`: create + update round-trip `composioToolkits`.
- `composio-tools.test.ts`: `buildComposioToolDefs(service, userId, toolkits)` forwards `toolkits` to `listTools`.
- `user-sessions(-composio).test.ts`: `safeComposioDefs(service, userId, toolkits)` forwards toolkits; null/throw → [].
- `apps/server/composio.test.ts`: mappers unchanged; (the `listTools` toolkit-resolution fallback is exercised only against the SDK — keep the resolution logic trivial/obvious).
- Admin: build + typecheck (no unit test for the presentational wizard; user verifies visually).

## Self-review notes

- Type consistency: `composioToolkits: string[]` added uniformly to `AgentConfig`/`AgentInput`/schema/zod/AgentForm; `listTools`/`buildComposioToolDefs`/`safeComposioDefs` all gain the `toolkits` param.
- Backward-compat: env default fallback preserves SP1 smoke behavior; existing agents read `composio_toolkits` default `[]` → fall back to env default.
- YAGNI: toolkit-level only; static suggestion chips, no catalog fetch.
- Migration is additive + defaulted → safe for existing rows.
