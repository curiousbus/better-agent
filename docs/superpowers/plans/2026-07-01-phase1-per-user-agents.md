# Phase 1 — Per-User Agents Implementation Plan

**Goal:** Agents are owned by their creator; web users create/manage their own agents (no admin gate); each user sees only their own.

**Global Constraints:** no `any`; magic numbers only -1/0/1; files ≤300 lines; functions ≤50 lines; deps pinned. Migrations via drizzle-kit generate (deploy Action applies them). Work on `dev`.

---

### Task 1: DB ownership (`agents.user_id`) + store
**Files:** `packages/db/src/schema/agents.ts` (add `userId: uuid("user_id").references(() => users.id)` + index), new migration via `pnpm -F @better-agent/db exec drizzle-kit generate`, `packages/db/src/repositories/agent-store.ts` (`create` persists `userId`; add `listByUser(userId)`), `packages/agent/src/ports.ts` (AgentStore: `create` input gains optional `userId`; add `listByUser`). Test: `packages/db/src/repositories/agent-store.integration.test.ts`.
- Add column + index; generate migration; verify SQL.
- `listByUser(userId)` → `where eq(agents.userId, userId)`.
- `create` maps `userId` through.
- Test: create with userId A and B; `listByUser(A)` returns only A's; legacy null-owner row excluded.

### Task 2: API — re-scope agents router to owner
**Files:** `packages/api/src/routers/agents.ts`. Test: `packages/api/src/routers/agents.test.ts` (or new).
- `requireOwnedAgent(context, userId, agentId)` helper → NOT_FOUND if missing or not owned.
- `list` → `authorizedUserProcedure` → `listByUser(authedUser.id)`.
- `create` → `authorizedUserProcedure`, stamp `userId`.
- `get`/`update`/`delete`/`getToken`/`rotateToken` → `authorizedUserProcedure` + `requireOwnedAgent`.
- Test: two users; A lists only own; B gets NOT_FOUND on A's agent for get/update/delete/getToken/rotateToken; create stamps caller.

### Task 3: Web — agents list route + sidebar item
**Files:** `apps/web/src/routes/agents.index.tsx` (new), `apps/web/src/components/sidebar.tsx` (add Agents item). 
- List `orpc.agents.list`; per-row edit (opens wizard, Task 4)/delete/view-token; empty state; create button.
- Sidebar: `{ kind: "item", item: { to: "/agents", label: "Agents", icon: Bot } }`.

### Task 4: Web — agent wizard (create/edit), copied from admin, no composio
**Files:** copy into `apps/web/src/components/agents/` from `apps/admin/src/components/agents/`: `agent-form.ts`, `agent-wizard.tsx`, `agent-wizard-steps.tsx` (drop the ComposioAccountsField usage + the Composio bits), `builtin-tools-field.tsx` (import `BUILTIN_TOOLS` from `@better-agent/agent/tool/builtin-tools` instead of the hardcoded copy), plus token reveal/rotate control if separate. Wire `orpc.agents.create`/`update`/`getToken`/`rotateToken` in the web route. Providers/models from `orpc.providers.*`.
- Keep each file ≤300 lines / functions ≤50 (split as admin does).
- Test: create flow calls create; edit flow calls update.

---
Execution: task-by-task, each with tests + `pnpm dlx ultracite fix` + eslint + `check-types` + commit. Migration applied by the deploy Action on push to `dev`.
