# Phase 1 — Per-User Agents (design spec)

**Goal:** Agents become owned by the user who creates them. Web customers can create / edit / delete their own agents (identity, model, params, built-in tools) and see only their own; the admin-only gate on agent CRUD is removed. Composio stays out of the web wizard this phase (added in Phase 4).

**Part of** the larger "per-user self-serve" direction (see the tool-config-direction memory). This is Phase 1 of 5.

## Context / current state (verified)

- `agents` table (`packages/db/src/schema/agents.ts`) has **no owner column**. Columns: `id`, `name`, `description`, `systemPrompt`, `providerId`, `modelId`, `params` (jsonb), `composioAccountIds` (jsonb string[]), `builtinTools` (jsonb string[]), `tokenHash` (unique), `tokenCipher` (nullable), timestamps.
- `agent-store` (`packages/db/src/repositories/agent-store.ts`): `list()` is an unfiltered `select from agents`; `create(input)`, `get(id)`, `update`, `remove`, token methods.
- `agents` router (`packages/api/src/routers/agents.ts`): `list` = `authorizedUserProcedure` (unfiltered); `create`/`update`/`delete`/`get`/`getToken`/`rotateToken` = **`adminProcedure`**.
- Procedure kinds (`packages/api/src/index.ts`): `authorizedUserProcedure` = signed-in web user + invite gate (staff bypass). This is what user-owned agent routes will use.
- The agent-token chat plane (`agentProcedure`, `ba_` tokens) resolves an agent by token independent of any owner — unaffected by ownership.
- Built-in tools registry: `packages/agent/src/tool/builtin-tools.ts` exports `BUILTIN_TOOLS` (picker metadata `{id,label,description}`) and `buildBuiltinToolDefs(ids)`. Admin's picker (`apps/admin/src/components/agents/builtin-tools-field.tsx`) currently **duplicates** this list as a hardcoded const.
- Admin agent wizard (presentational, 4 steps): `apps/admin/src/components/agents/{agent-wizard,agent-wizard-steps,agent-form}.tsx`; mutation wiring in `agents-card.tsx`. Web has **no** agent create UI.
- Web sidebar `SECTIONS` (`apps/web/src/components/sidebar.tsx`): Home `/`, Board `/board`. Uses `AppShellSidebar`.

## Design decisions

1. **Ownership column, nullable.** Add `agents.user_id uuid references users(id)`, **nullable**. Existing (legacy global) agents keep `user_id = null` and are simply not listed for any web user (they remain usable via their agent token). No backfill, no delete. A future task can reassign them.
2. **Re-scope the agents router to the owner.** `list` returns only the caller's agents. `create` stamps the caller's id. `update`/`delete`/`get`/`getToken`/`rotateToken` require the agent to be owned by the caller (else `NOT_FOUND`, so ownership never leaks). All move from `adminProcedure` → `authorizedUserProcedure`. Admin no longer special-cases agents (admin's agent UI is removed in Phase 3; this phase just stops gating on admin).
3. **Web agent UI = new `/agents` route.** A list of the user's agents with create/edit/delete and "view token" (reuses the token reveal/rotate that admin has). The wizard is reused by **moving the presentational pieces** (`agent-form.ts`, the step components, `builtin-tools-field`) into `packages/ui` (or a shared web/admin location) so both apps can render them; mutation wiring is written per-app against each app's orpc client. Composio field is **omitted** from the web wizard's Tools step this phase (built-in tools only). If moving is too broad for one phase, copying the presentational wizard into web is the fallback — decided during planning.
4. **Built-in tools picker reads the package registry.** The web picker imports `BUILTIN_TOOLS` from `@better-agent/agent/tool/builtin-tools` instead of a hardcoded copy (kills the duplication for the web side at least).
5. **Sidebar.** Add an "Agents" item to web `SECTIONS` (Home and Board stay; Home→Dashboard rename is Phase 2).

## Data model

```
ALTER TABLE agents ADD COLUMN user_id uuid REFERENCES users(id);
CREATE INDEX agents_user_id_idx ON agents (user_id);
```

`agent-store`:
- `create(input)` accepts optional `userId`; persists it.
- New `listByUser(userId)` → `select ... where user_id = userId`.
- `get(id)` unchanged (ownership asserted in the router).

## API changes (`packages/api/src/routers/agents.ts`)

- Helper `requireOwnedAgent(context, userId, agentId)`: loads the agent; throws `NOT_FOUND` if missing or `agent.userId !== userId`.
- `list` → `authorizedUserProcedure` → `stores.agent.listByUser(authedUser.id)`.
- `create` → `authorizedUserProcedure`; input unchanged; store call adds `userId: authedUser.id`.
- `get` / `update` / `delete` / `getToken` / `rotateToken` → `authorizedUserProcedure`; each calls `requireOwnedAgent` first.
- Token minting on create is unchanged.

## Web UI

- `apps/web/src/routes/agents.index.tsx` (+ any detail route if needed): list of `orpc.agents.list` results, create button → wizard dialog, per-row edit/delete/view-token.
- Reused wizard (identity / model+provider / params / built-in tools). Provider+model options come from the same source admin uses (`orpc.providers.*`).
- `apps/web/src/components/sidebar.tsx`: add `{ to: "/agents", label: "Agents", icon: <Bot or similar> }` to `SECTIONS`.

## Testing

- `agent-store`: `listByUser` returns only that user's agents; `create` persists `userId`. (PGlite integration test.)
- `agents` router: a user lists only their own agents; a second user cannot `get`/`update`/`delete`/`getToken` the first user's agent (`NOT_FOUND`); `create` stamps the caller. (Router test with two fake users.)
- Web: agent list renders the user's agents; create flow calls `orpc.agents.create`. (Component/vitest as the existing board tests do.)

## Out of scope (later phases)

- Composio in the web wizard (Phase 4).
- Activity-event emission on agent create/delete (Phase 3, when the events table exists).
- Removing the admin agent/composio pages (Phase 3).
- Dashboard rename + token icon (Phase 2).

## Global constraints (from the project)

- No `any`; magic numbers only -1/0/1; files ≤300 lines; functions/component callbacks ≤50 lines; deps pinned. Pre-commit runs biome+eslint on staged; pre-push runs full monorepo `check-types`. Migrations via `db:migrate` (not `db:push`); the DB is shared. Work on `dev`; GitHub Action deploys to Workers test.
