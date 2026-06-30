# Agent Task Board v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the v1 board into a real Jira-style board: sprints + backlog, per-user issue keys (`TASK-N`), rich aligned cards with owner avatar, real inline create, working multi-container drag, and one persistent session.

**Architecture:** Unchanged stream/tool mechanics (ONE interface — `userSessions.prompt`; tools are the only backend; minimal tools, stream-as-resolved). v2 changes the data model (add `seq`+`sprintId` to tasks, new `sprints` table) and rebuilds the board UI.

**Tech Stack:** drizzle + PGlite tests, zod v4, oRPC streaming, AI SDK v6 ToolDef, TanStack Router/Query, @dnd-kit (core 6.3.1 / sortable 10.0.0 / utilities 3.2.2), @better-agent/ui (shadcn), vitest.

## Global Constraints

- ONE network interface: the `userSessions.prompt` stream. No REST, no callTool.
- Frontend = `@better-agent/ui` (shadcn) only. **Strict alignment/spacing scale** (the user is emphatic): cards on a fixed grid, controls in fixed aligned slots (not hover-floating). Loading states + transitions everywhere; every failure path toasts; intentional empty states.
- Minimal tools, stream-as-resolved (fan-out reads paint as each resolves).
- User-scoped always: every TaskStore/SprintStore method takes `userId` and filters by it; tools bind to `context.authedUser.id`.
- Issue key `TASK-<seq>`; `seq` is per-user monotonic. Owner avatar = email initial from `orpc.auth.me` (data has `{id,email}` only, no name).
- At most one `active` sprint per user; `startSprint` rejects when another is active.
- Lint: no `any`; no magic numbers except -1/0/1; files ≤300 lines; functions/component-callbacks ≤50 lines; deps pinned; `db:migrate` not `db:push`. Run `pnpm dlx ultracite fix` before each commit.
- Work on `dev`; deploy via GitHub Action (no local deploy).
- Per-package tests: `pnpm -F <pkg> test`. DB tests are `*.integration.test.ts` (fresh PGlite + real migrations).

---

## File Structure

**Backend:**
- `packages/agent/src/task/types.ts` (modify) — add `seq`, `sprintId` to `Task`; add `SprintStatus`, `Sprint`.
- `packages/agent/src/ports.ts` (modify) — extend `TaskStore`; add `SprintStore`.
- `packages/db/src/schema/task-board.ts` (modify) — add columns + `sprints` table.
- `packages/db/src/migrations/*` (generated + hand-edited backfill).
- `packages/db/src/repositories/task-store.ts` (modify).
- `packages/db/src/repositories/sprint-store.ts` (new).
- `packages/agent/src/tool/task-tools.ts` (modify).
- `packages/agent/src/tool/sprint-tools.ts` (new).
- `packages/api/src/services.ts` (modify) — add `sprint: SprintStore`.
- `apps/server/src/services.ts` (modify) — construct `sprintStore`.
- `packages/api/src/routers/user-sessions.ts` (modify) — build task+sprint tool defs in both paths.
- `packages/api/src/routers/tool-calls-stream.ts` (modify) — accept the combined tool defs.

**Frontend (apps/web/src/board):**
- `board-store.ts` (modify) — `BoardTask` gains `seq`, `sprintId`; add backlog bucket + multi-container move resolver.
- `board-client.ts` (modify) — parse seq/sprintId; `loadSprintColumns`, `loadBacklog`.
- `board-page.tsx` (modify) — persistent session.
- `task-card.tsx` (rewrite) — grid card with id/title/desc/avatar/time/menu.
- `task-column.tsx` (modify) — inline create.
- `use-board-handlers.ts` (rewrite) — onDragOver + onDragEnd multi-container.
- `task-board.tsx` (modify) — DndContext with onDragOver; SprintBar; Backlog.
- `sprint-bar.tsx` (new) — active sprint header + create/start/complete.
- `backlog-panel.tsx` (new) — backlog list + inline create + droppable.
- `task-modal.tsx` (modify) — status + sprint fields.
- `use-current-user.ts` (new) — `orpc.auth.me` query → `{ email, initial }`.

---

## Task 1: Schema — seq + sprintId on tasks, sprints table, migration

**Files:** modify `packages/agent/src/task/types.ts`, `packages/db/src/schema/task-board.ts`; generate + hand-edit migration; modify `packages/agent/src/ports.ts` (types only).

- [ ] **Step 1: Domain types.** Replace `packages/agent/src/task/types.ts`:

```ts
export type TaskStatus = "todo" | "in_progress" | "done";
export type SprintStatus = "future" | "active" | "completed";

export interface Task {
	createdAt: string;
	description: string;
	id: string;
	position: number;
	seq: number;
	sprintId: string | null;
	status: TaskStatus;
	title: string;
	updatedAt: string;
	userId: string;
}

export interface Sprint {
	createdAt: string;
	endDate: string | null;
	goal: string;
	id: string;
	name: string;
	startDate: string | null;
	status: SprintStatus;
	updatedAt: string;
	userId: string;
}
```

- [ ] **Step 2: Schema.** In `packages/db/src/schema/task-board.ts`, add `seq` + `sprintId` to `tasks` and add the `sprints` table:

```ts
import {
	doublePrecision,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { SprintStatus, TaskStatus } from "@better-agent/agent/task/types";

export const tasks = pgTable(
	"tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id").notNull(),
		seq: integer("seq").notNull().default(0),
		sprintId: uuid("sprint_id"),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status").$type<TaskStatus>().notNull().default("todo"),
		position: doublePrecision("position").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("tasks_user_id").on(table.userId),
		index("tasks_user_status_position").on(table.userId, table.status, table.position),
		index("tasks_user_sprint_status_position").on(
			table.userId,
			table.sprintId,
			table.status,
			table.position
		),
	]
);

export const sprints = pgTable(
	"sprints",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id").notNull(),
		name: text("name").notNull(),
		goal: text("goal").notNull().default(""),
		startDate: timestamp("start_date", { withTimezone: true }),
		endDate: timestamp("end_date", { withTimezone: true }),
		status: text("status").$type<SprintStatus>().notNull().default("future"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("sprints_user_id").on(table.userId),
		index("sprints_user_status").on(table.userId, table.status),
	]
);
```

- [ ] **Step 3: Generate migration.** Run `pnpm -F @better-agent/db db:generate`. Expected: a new SQL file altering `tasks` (ADD seq, ADD sprint_id, new index) and creating `sprints`.

- [ ] **Step 4: Hand-edit the migration to backfill seq.** Append to the generated SQL (after the ADD COLUMN statements), so existing tasks get distinct keys:

```sql
--> statement-breakpoint
UPDATE "tasks" t SET "seq" = sub.rn FROM (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM "tasks"
) sub WHERE t.id = sub.id;
```

- [ ] **Step 5: Commit.**
```bash
pnpm dlx ultracite fix
git add packages/agent/src/task/types.ts packages/db/src/schema/task-board.ts packages/db/src/migrations
git commit -m "feat(board): add seq + sprintId to tasks, sprints table"
```

---

## Task 2: TaskStore v2 (seq, sprint/backlog scoping, move-with-sprint)

**Files:** modify `packages/agent/src/ports.ts`, `packages/db/src/repositories/task-store.ts`; test `task-store.integration.test.ts`.

**Interfaces — Produces:** `TaskStore` with:
```ts
create(userId, { title; sprintId?: string | null; status?: TaskStatus }): Promise<Task>;
get(userId, id): Promise<Task | null>;
listColumn(userId, sprintId: string | null, status: TaskStatus): Promise<Task[]>;
listBacklog(userId): Promise<Task[]>;
move(userId, id, patch: { sprintId?: string | null; status: TaskStatus; position: number }): Promise<Task | null>;
update(userId, id, { title?; description? }): Promise<Task | null>;
remove(userId, id): Promise<boolean>;
```

- [ ] **Step 1: Port.** Replace the `TaskStore` interface in `ports.ts` with the above (import `Task`/`TaskStatus` already present).

- [ ] **Step 2: Repo.** Update `task-store.ts`. `toTask` maps the new columns (`seq: row.seq`, `sprintId: row.sprintId`). Add a `nextSeq(db, userId)` helper (`max(seq)+1`). `create` assigns `seq` + `sprintId ?? null` + `status ?? "todo"` + `position = nextPosition`. `listColumn` filters `userId AND sprintId (IS NULL when null) AND status`, ordered by position — use `isNull(tasks.sprintId)` when `sprintId === null`, else `eq`. `listBacklog` filters `userId AND sprintId IS NULL`, by position. `move` sets `status`, `position`, and `sprintId` (only when the patch includes the key — use the key's presence: `"sprintId" in patch ? patch.sprintId : undefined` → but drizzle `.set` needs a concrete value; set `sprint_id` only when provided). Keep `owned()` for user scoping. Respect 50-line functions (keep the reader/writer split from v1).

Key drizzle detail for nullable filter:
```ts
import { and, asc, eq, isNull, max } from "drizzle-orm";
const sprintFilter = (sprintId: string | null) =>
	sprintId === null ? isNull(schema.tasks.sprintId) : eq(schema.tasks.sprintId, sprintId);
```

For `nextSeq`:
```ts
async function nextSeq(db: Db, userId: string): Promise<number> {
	const [row] = await db
		.select({ maxSeq: max(schema.tasks.seq) })
		.from(schema.tasks)
		.where(eq(schema.tasks.userId, userId));
	return (row?.maxSeq ?? 0) + 1;
}
```

For `move` with optional sprintId:
```ts
async move(userId, id, patch) {
	const set: Record<string, unknown> = {
		status: patch.status,
		position: patch.position,
		updatedAt: new Date(),
	};
	if ("sprintId" in patch) {
		set.sprintId = patch.sprintId ?? null;
	}
	const rows = await db.update(schema.tasks).set(set).where(owned(userId, id)).returning();
	return rows[0] ? toTask(rows[0]) : null;
}
```

- [ ] **Step 3: Tests.** Rewrite `task-store.integration.test.ts` covering: create assigns monotonic seq per user; create into a sprint vs backlog; `listColumn(sprintId, status)` scopes correctly; `listBacklog` returns only null-sprint tasks; `move` changes sprintId+status+position; cross-user isolation. (Hardcoded UUID constants; bare `it`.)

- [ ] **Step 4: Run + commit.**
```bash
pnpm -F @better-agent/db test src/repositories/task-store.integration.test.ts
pnpm dlx ultracite fix
git add packages/agent/src/ports.ts packages/db/src/repositories/task-store.ts packages/db/src/repositories/task-store.integration.test.ts
git commit -m "feat(board): TaskStore v2 — seq, sprint/backlog scoping, move-with-sprint"
```

---

## Task 3: SprintStore + one-active enforcement

**Files:** modify `packages/agent/src/ports.ts`; create `packages/db/src/repositories/sprint-store.ts`; test `sprint-store.integration.test.ts`.

**Interfaces — Produces:** `SprintStore`:
```ts
list(userId): Promise<Sprint[]>;
get(userId, id): Promise<Sprint | null>;
active(userId): Promise<Sprint | null>;
create(userId, { name; goal?; startDate?; endDate? }): Promise<Sprint>;
update(userId, id, patch: { name?; goal?; startDate?; endDate? }): Promise<Sprint | null>;
setStatus(userId, id, status: SprintStatus): Promise<Sprint | null>;
remove(userId, id): Promise<boolean>;
```

- [ ] **Step 1: Port.** Add `SprintStore` to `ports.ts`; import `Sprint`, `SprintStatus`.

- [ ] **Step 2: Repo.** `createSprintStore(db)` mirroring task-store. `active(userId)` = first row where `userId AND status="active"`. `setStatus` updates status+updatedAt; `create` accepts ISO date strings → store as `new Date(...)` (or null). `toSprint` maps Date→ISO. (The one-active RULE is enforced in the TOOL layer, not the store — the store's `setStatus` is a primitive; see Task 5. But provide `active()` for the tool to check.)

- [ ] **Step 3: Tests.** create/get/list/active/setStatus/remove; cross-user isolation; `active()` returns the active sprint and null when none.

- [ ] **Step 4: Run + commit.**
```bash
pnpm -F @better-agent/db test src/repositories/sprint-store.integration.test.ts
pnpm dlx ultracite fix
git add packages/agent/src/ports.ts packages/db/src/repositories/sprint-store.ts packages/db/src/repositories/sprint-store.integration.test.ts
git commit -m "feat(board): SprintStore + active-sprint lookup"
```

---

## Task 4: Task tools v2 + sprint tools + wiring

**Files:** modify `packages/agent/src/tool/task-tools.ts`; create `packages/agent/src/tool/sprint-tools.ts`; modify `packages/api/src/services.ts`, `apps/server/src/services.ts`, `packages/api/src/routers/user-sessions.ts`; tests.

**Interfaces — Produces:** `buildTaskToolDefs(taskStore, userId)` (updated names/params) + `buildSprintToolDefs(sprintStore, userId)`. `services.stores.sprint: SprintStore`.

- [ ] **Step 1: Task tools v2.** Update `task-tools.ts` per the v1 factory pattern (each tool a module-scope factory for the 50-line cap):
  - `listSprintColumn` — params `{ sprintId: {type:["string","null"]}, status }` required `["sprintId","status"]` → `store.listColumn(userId, args.sprintId, args.status)`.
  - `listBacklog` — params `{}` → `store.listBacklog(userId)`.
  - `createTask` — `{ title, sprintId?, status? }` required `["title"]`.
  - `moveTask` — `{ id, sprintId?, status, position }` required `["id","status","position"]`; pass `sprintId` through only when present in args.
  - `updateTask`/`deleteTask`/`getTask` — unchanged.
  Each `execute` returns `{ output: JSON.stringify(result) }`; not-found → `{ output: JSON.stringify({error:"not_found"}), isError:true }`.

- [ ] **Step 2: Sprint tools.** Create `sprint-tools.ts` — `buildSprintToolDefs(store, userId)`:
  - `listSprints` `{}` → `store.list(userId)`.
  - `activeSprint` `{}` → `store.active(userId)` (returns the sprint or `null`).
  - `createSprint` `{ name, goal?, startDate?, endDate? }` required `["name"]`.
  - `updateSprint` `{ id, name?, goal?, startDate?, endDate? }` required `["id"]`.
  - `startSprint` `{ id }` required `["id"]` → if `await store.active(userId)` exists and != id → `{ output: JSON.stringify({error:"already_active"}), isError:true }`; else `store.setStatus(userId, id, "active")`.
  - `completeSprint` `{ id }` → `store.setStatus(userId, id, "completed")`.
  - `deleteSprint` `{ id }` → `store.remove(userId, id)`.
  Same factory-per-tool structure; `execute` returns JSON output.

- [ ] **Step 3: Services wiring.** Add `sprint: SprintStore` to `packages/api/src/services.ts` `stores`. In `apps/server/src/services.ts` construct `const sprintStore = createSprintStore(db);` (import from `@better-agent/db/repositories/sprint-store`) and thread it to `stores.sprint` (mirror how `task` was threaded).

- [ ] **Step 4: Router wiring.** In `packages/api/src/routers/user-sessions.ts`: import `buildSprintToolDefs`. In `streamUserTurn`, `const taskDefs = buildTaskToolDefs(stores.task, userId); const sprintDefs = buildSprintToolDefs(stores.sprint, userId); allDefs = [...remoteDefs, ...toolDefs, ...taskDefs, ...sprintDefs]`. In `streamToolCalls`, build `[...buildTaskToolDefs(...), ...buildSprintToolDefs(...)]` and index by name.

- [ ] **Step 5: Tests.** `task-tools.test.ts` (updated: listBacklog, listSprintColumn, createTask with sprintId), `sprint-tools.test.ts` (startSprint rejects when another active; createSprint/list). Use in-memory fakes.

- [ ] **Step 6: Run + commit.**
```bash
pnpm -F @better-agent/agent test src/tool/task-tools.test.ts src/tool/sprint-tools.test.ts
pnpm -F @better-agent/api test
pnpm dlx ultracite fix
git add packages/agent/src/tool packages/api/src/services.ts apps/server/src/services.ts packages/api/src/routers/user-sessions.ts
git commit -m "feat(board): task tools v2 + sprint tools, wired into both stream paths"
```

---

## Task 5: SDK + board-client reads (verify no SDK change)

**Files:** modify `apps/web/src/board/board-client.ts`, `board-store.ts`; test.

**Interfaces — Produces:** `BoardTask` with `seq`, `sprintId`; `parseColumn`/`parseTask` map them; `loadSprintColumns(client, sessionId, sprintId, onColumn)` and `loadBacklog(client, sessionId, onBacklog)`.

- [ ] **Step 1: Confirm** `runTools`/`runTool` need NO change (they pass `name`+`args` generically). Note in the report.

- [ ] **Step 2: board-store types.** Add `seq: number` and `sprintId: string | null` to `BoardTask`. `parseColumn`/`parseTask` map `seq` (Number) and `sprintId` (string|null). Keep helpers.

- [ ] **Step 3: board-client.** `loadSprintColumns(client, sessionId, sprintId, onColumn)` fans out three `listSprintColumn` calls (`{sprintId,status}`) keyed by status (callId=status). `loadBacklog(client, sessionId, onBacklog)` calls `listBacklog` once.

- [ ] **Step 4: Tests** — extend `board-client.test.ts`: parseColumn maps seq/sprintId; loadSprintColumns fires 3 calls with the sprintId; loadBacklog fires 1.

- [ ] **Step 5: Run + commit.**
```bash
pnpm -F web test src/board/board-client.test.ts
pnpm dlx ultracite fix
git add apps/web/src/board/board-client.ts apps/web/src/board/board-store.ts apps/web/src/board/board-client.test.ts
git commit -m "feat(board): client reads for sprint columns + backlog"
```

---

## Task 6: Persistent session (#6)

**Files:** new `apps/web/src/board/board-session.ts`; modify `apps/web/src/board/board-page.tsx`.

- [ ] **Step 1: Session helper.** Create `board-session.ts` — SSR-guarded localStorage (key `board_session_id`): `loadBoardSessionId(): string | null`, `saveBoardSessionId(id: string): void` (mirror `todo-store.ts` guards).

- [ ] **Step 2: Reuse in board-page.** In `useBoardClient`, replace the always-`createSession()` effect: on mount, if `loadBoardSessionId()` returns an id, use it; else `createSession()` once → `saveBoardSessionId(id)`. (If a stored session later 404s server-side, the stream just errors and the user can refresh — acceptable for v2; note it.) The page no longer mints a fresh session per refresh.

- [ ] **Step 3: Verify + commit.**
```bash
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/board-session.ts apps/web/src/board/board-page.tsx
git commit -m "fix(board): reuse one persistent board session across refreshes"
```

---

## Task 7: Rich aligned card (#3 #5 #7)

**Files:** new `apps/web/src/board/use-current-user.ts`; rewrite `apps/web/src/board/task-card.tsx`.

- [ ] **Step 1: current user hook.** `use-current-user.ts`: `useCurrentUser()` → `useQuery(orpc.auth.me.queryOptions())`, returns `{ email: string, initial: string }` (`initial = email ? email[0].toUpperCase() : "?"`).

- [ ] **Step 2: Card rewrite.** `task-card.tsx` — strict grid (shadcn `Card`, `Avatar`/`AvatarFallback`, `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`):
  - Top row: `TASK-{task.seq}` (mono, `text-xs text-muted-foreground`) left; a `DropdownMenu` (⋯) right with Open + Delete (delete in a FIXED aligned slot, not hover-floating). The `⋯` trigger stops drag propagation.
  - Title: `font-medium text-sm`, `line-clamp-2`.
  - Description preview: `text-xs text-muted-foreground line-clamp-2` (omit if empty).
  - Footer row: `Avatar size="sm"` with `AvatarFallback`{initial} left; relative time (`createdAt`) right (`text-xs text-muted-foreground`). Use a tiny `relativeTime(iso)` helper (or reuse the one in `account.tsx` — copy the minimal version; extract named constants for the second/minute/hour/day thresholds to satisfy no-magic-numbers).
  - Keep `useSortable` (drag), `isDragging` lifted style. Card ≤50-line component — extract `CardFooter`/`CardMenu` subcomponents if needed.

- [ ] **Step 3: Verify + commit.**
```bash
pnpm -F web check-types
cd apps/web && npx eslint src/board/task-card.tsx src/board/use-current-user.ts && cd /Users/john/better-agent
pnpm dlx ultracite fix
git add apps/web/src/board/task-card.tsx apps/web/src/board/use-current-user.ts
git commit -m "feat(board): rich aligned card — TASK-N, title, desc, owner avatar, time, menu"
```

---

## Task 8: Inline create (#1)

**Files:** modify `apps/web/src/board/task-column.tsx`, `use-board-handlers.ts`.

- [ ] **Step 1: Inline composer.** In `task-column.tsx`, replace the "+ Add" auto-create with a toggle: clicking "+ Add" reveals a shadcn `Input` (autoFocus); Enter calls `onCreate(status, title)` and clears; Esc/blur cancels. No auto "New task".

- [ ] **Step 2: Handler.** Update `onCreate(status, title)` in `use-board-handlers.ts`: ignore empty/whitespace title; optimistic temp card (`seq: 0` placeholder, `sprintId` = the board's active sprint id, `status`, title); `runTool("createTask", { title, sprintId, status })` → `replaceLocal(tempId, parseTask(result))`; on failure `removeLocal` + toast. The active sprint id is threaded from the board (Task 10).

- [ ] **Step 3: Verify + commit.**
```bash
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/task-column.tsx apps/web/src/board/use-board-handlers.ts
git commit -m "feat(board): inline create with real title (no auto New task)"
```

---

## Task 9: Multi-container drag (#2)

**Files:** rewrite `apps/web/src/board/use-board-handlers.ts` (drag), modify `task-board.tsx`; test `use-board-handlers` resolver.

**Interfaces — Produces:** `onDragOver(event)` moves the active card's column/backlog live in the store; `onDragEnd(event)` persists via `moveTask({ id, sprintId, status, position })`. A pure `resolveDrop(snapshot, activeId, overId, columns)` returning `{ sprintId, status, position }` is unit-tested.

- [ ] **Step 1: Containers.** Define container ids: the three statuses (`"todo"/"in_progress"/"done"`) for the active sprint board, and `"backlog"`. A card's container = its status when `sprintId != null`, else `"backlog"`. `useDroppable` on each column AND the backlog list.

- [ ] **Step 2: onDragOver (live move).** When the active card hovers a different container, update the store: if over a board column → `applyMove(id, { sprintId: activeSprintId, status: col, position })`; if over backlog → `applyMove(id, { sprintId: null, status: "todo", position })`. Compute position via `midpoint` against the hovered container's items (excluding active). Use a throttle-free guard (only update when container actually changes) to avoid thrash.

- [ ] **Step 3: onDragEnd (persist).** Read the active card's now-current container/position from the store and call `runTool("moveTask", { id, sprintId, status, position })`; on failure reload the affected columns/backlog + toast.

- [ ] **Step 4: store.** `applyMove` in `board-store.ts` must accept `{ sprintId, status, position }` (extend its signature). Add a pure `resolveDrop(snapshot, activeId, overId, activeSprintId)` helper (exported for tests) returning the target `{ sprintId, status, position }`.

- [ ] **Step 5: task-board.** Add `onDragOver` to `DndContext`; render board columns (active sprint) — backlog is a separate droppable in Task 11.

- [ ] **Step 6: Tests.** `use-board-handlers.test.ts` (or board-store): `resolveDrop` cases — drop on empty column, drop on a card (insert above), drop into backlog (sprintId null), no-op when same container+position.

- [ ] **Step 7: Run + commit.**
```bash
pnpm -F web test src/board
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/use-board-handlers.ts apps/web/src/board/task-board.tsx apps/web/src/board/board-store.ts apps/web/src/board/use-board-handlers.test.ts
git commit -m "fix(board): multi-container drag (onDragOver + onDragEnd) across columns + backlog"
```

---

## Task 10: SprintBar + sprint management (#4 part 1)

**Files:** new `apps/web/src/board/sprint-bar.tsx`, `use-sprints.ts`; modify `task-board.tsx`/`board-page.tsx`.

- [ ] **Step 1: sprint data hook.** `use-sprints.ts`: `useSprints(agentClient, sessionId)` → loads `activeSprint` + `listSprints` via `runTool`; exposes `{ active, sprints, refresh, createSprint, startSprint, completeSprint }` (each calls `runTool` then refresh). Manage with local state + a `refresh()` that re-reads.

- [ ] **Step 2: SprintBar.** `sprint-bar.tsx`: if `active` → show name + date range + a "Complete sprint" button (shadcn `Button`); if no active → show "No active sprint" + a "Start sprint" / "Create sprint" affordance. A small `Dialog` to create a sprint (name + optional goal/dates) and a menu to start a `future` sprint. shadcn only; aligned.

- [ ] **Step 3: Thread active sprint.** `task-board` receives the active sprint id (from `useSprints`) and passes it to column loads (`loadSprintColumns(..., active.id, ...)`) and to `onCreate`/drag handlers. When there's no active sprint, the board area shows an empty "Start a sprint to begin" state.

- [ ] **Step 4: Verify + commit.**
```bash
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/sprint-bar.tsx apps/web/src/board/use-sprints.ts apps/web/src/board/task-board.tsx apps/web/src/board/board-page.tsx
git commit -m "feat(board): sprint bar + create/start/complete sprint"
```

---

## Task 11: Backlog panel + drag backlog→sprint (#4 part 2)

**Files:** new `apps/web/src/board/backlog-panel.tsx`; modify `task-board.tsx`, `use-board-handlers.ts`.

- [ ] **Step 1: Backlog panel.** `backlog-panel.tsx`: a collapsible side panel (shadcn) listing backlog tasks (reuse `TaskCard`), an inline create (sprintId null), and a `useDroppable({ id: "backlog" })` region so cards can be dragged INTO the backlog. Loads via `loadBacklog`.

- [ ] **Step 2: Cross drag.** The drag handlers (Task 9) already resolve `backlog` ↔ sprint columns; ensure the backlog list is inside the same `DndContext` and its `SortableContext` items are the backlog ids. Dragging a backlog card onto a column sets `sprintId = active.id`; dragging a board card onto backlog sets `sprintId = null`.

- [ ] **Step 3: Verify + commit.**
```bash
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/backlog-panel.tsx apps/web/src/board/task-board.tsx apps/web/src/board/use-board-handlers.ts
git commit -m "feat(board): backlog panel + drag backlog<->sprint"
```

---

## Task 12: Modal v2 (status + sprint)

**Files:** modify `apps/web/src/board/task-modal.tsx`.

- [ ] **Step 1:** Add to the modal: show `TASK-{seq}` in the title; a `Select` (shadcn) for status; a `Select` for sprint (active sprint / backlog / other sprints from `useSprints`). Saving title/description via `updateTask`; status/sprint change via `moveTask`. Keep load skeleton + toasts. Reuse `useSprints` for the sprint options.

- [ ] **Step 2: Verify + commit.**
```bash
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/task-modal.tsx
git commit -m "feat(board): modal shows issue key, status + sprint controls"
```

---

## Task 13: Polish + responsive + deploy

- [ ] **Step 1:** Empty states (no active sprint; empty backlog; empty column), consistent spacing scale, motion-reduce-safe transitions, responsive (board columns `overflow-x-auto`, backlog panel collapses on mobile), strict alignment pass on the card + sprint bar.
- [ ] **Step 2: Full sweep.**
```bash
pnpm -F @better-agent/db test && pnpm -F @better-agent/agent test && pnpm -F @better-agent/api test && pnpm -F web test
pnpm -F web check-types && pnpm dlx ultracite check
```
- [ ] **Step 3: Commit + push.**
```bash
pnpm dlx ultracite fix
git add -A && git commit -m "feat(board): v2 polish, empty states, responsive"
git push origin dev
```
Verify local HEAD == `origin/dev`. The GitHub Action deploys to the Workers test env.

---

## Self-Review

- #1 inline create → Task 8. #2 multi-container drag → Task 9. #3 `TASK-N` → Tasks 1/2/7. #4 sprints+backlog → Tasks 1/3/4/10/11. #5 aligned card → Task 7. #6 persistent session → Task 6. #7 rich cards → Task 7. ✅ all 7 covered.
- Type consistency: `Task`/`Sprint` (agent) vs `BoardTask` (web) bridged by `parseColumn`/`parseTask` (Task 5). `move`/`moveTask` carry `sprintId|null` consistently across store → tool → SDK → handlers.
- Owner avatar uses `email` initial (no name in `auth.me`) — documented limitation.
- Open items implementers confirm from code: exact `auth.me` query options import; the shadcn `Select`/`DropdownMenu` import paths; whether a stored session id can 404 (handle by letting the stream error + a refresh).
