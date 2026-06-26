# Per-User Composio (rework) — Design Spec

> Date: 2026-06-26. Reworks the composio integration from an admin-owned single-key model into a per-user one. Each user brings their own composio API key, connects their own tools, and any agent they chat with can use whatever they've connected. Removes the admin-side composio config (per-agent toolkits, admin global key, admin Tools catalog page).

## Why

composio scopes connections by `userId`, but everything still ran through ONE composio account (the admin's key): one bill, one rate limit, admin controls everyone's connections. And the agent's allowed tools were admin-configured while auth was user-configured — two disconnected halves the user couldn't reconcile. The correct model: **the user owns their composio account + tools; their agents use what they've connected.** No admin-side tool config.

## Target architecture

1. **Per-user composio API key.** Stored encrypted in the existing `settings` table under the namespaced key `composio:{userId}` (reuses `SettingsStore` + `SecretBox`; no migration). NEVER returned to the client (only a `configured` status).
2. **Per-user resolver.** `AgentServices.composio` changes from `() => Promise<ComposioService | null>` to `(userId: string) => Promise<ComposioService | null>`. It reads that user's key from settings (no env, no admin-global), memoizing a `Composio` client per `(userId, key)`. Null when the user has no key.
3. **User-driven tools.** An agent's composio tools for a turn = the tools of the toolkits the user has an ACTIVE connection to. `safeComposioDefs(service, userId)` lists the user's connections, derives the active toolkit slugs, and builds tool defs for those (empty → no tools). No per-agent toolkit list.
4. **composio router (all `userProcedure`, scoped to `authedUser.id`):**
   - `keyStatus` → `{ configured: boolean }` (is a key set for this user; never the value).
   - `setKey({ apiKey })` → store for the user.
   - `clearKey()` → delete.
   - `connectableToolkits` / `connections` / `connect` / `disconnect` → resolve `await services.composio(authedUser.id)` first. (Disconnect stays ownership-checked.)
   - REMOVE the admin `listToolkits` (the admin Tools page is gone).
5. **Removed (admin-side composio config):**
   - admin `settings` router + page + sidebar nav (it only held the composio key) + `services.envSecretKeys`.
   - admin `tools` catalog page + sidebar nav.
   - agent wizard "Tools" step (the per-agent toolkit selection UI).
   - the runtime's use of `agents.composio_toolkits` (the turn no longer reads it). The DB column + `AgentConfig.composioToolkits` field + the agent form fields are left in place as dead/unused (no migration, minimal churn) and can be dropped later.
6. **Account page** becomes the single composio surface: a "Composio" section to set/clear the user's API key (status badge + password input), above the existing Integrations section (connect/disconnect toolkits), which now resolves with the user's own key.

## Flow

User → Account → sets their composio API key → Integrations lists connectable toolkits (their catalog) → connects e.g. Gmail (their composio account) → chats with any agent → the turn loads tools for the user's connected toolkits, executed under the user's key.

## Scope / boundaries

- In: per-user key storage + resolver + endpoints; user-driven tool loading; account key UI; removal of admin composio config (settings page, tools page, agent toolkit step) + the admin `listToolkits`.
- Out: dropping the now-dead `agents.composio_toolkits` column / `AgentConfig.composioToolkits` field (left as dead to avoid a migration + wide fixture churn); per-agent user-controlled tool filtering (everything connected is available to every agent, per the product decision); multi-instance resolver cache invalidation (per-user in-memory memo, re-reads the key each resolve).

## Security

- Per-user key encrypted at rest (`SecretBox`), never returned (only `configured`). `setKey`/`clearKey`/`keyStatus` are `userProcedure` scoped to `authedUser.id` — a user can only set/read-status/clear their OWN key. `disconnect` stays ownership-checked. Each user's composio calls run under their own key (isolation by account, not just `userId`).

## Testing

- Resolver: a user with a key → a service; same key memoized; no key → null; different users get different services.
- composio router: `setKey` then `keyStatus.configured === true`; `clearKey` → false; never returns the value; `connect`/`connections` use the per-user resolver (fake) scoped to the caller.
- `safeComposioDefs`: derives active toolkit slugs from connections and builds defs; no active connections → []; null service → []; throw → [].
- Removed pieces: the admin settings/tools router+page tests are deleted; agents tests no longer assert composio_toolkits round-trip (left dead).
- Account page: build + tsc (presentational; user verifies the real OAuth/key flow).

## Self-review notes

- `AgentServices.composio` signature change `(userId) => …` ripples to the composio router (4 handlers) + `user-sessions` + all fixtures (`composio: () => …` → `composio: () => …` unchanged shape, but now takes a userId arg — fixtures pass `(_userId) =>`).
- The `settings` table + `SettingsStore` are retained (repurposed for per-user keys); only the admin settings ROUTER/page are removed.
- Graceful everywhere: no key → no tools, no errors; per-user throughout.
