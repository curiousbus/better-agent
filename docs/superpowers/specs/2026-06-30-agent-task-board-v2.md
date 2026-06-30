# Agent Task Board v2 Design

**Status:** Design / spec (supersedes the v1 board)
**Date:** 2026-06-30
**Authors:** jackson + Claude

## Why v2

The v1 board shipped as a bare MVP and missed real-board expectations. This v2
fixes the defects and turns it into a real Jira-style board with sprints. Same
hard architecture as v1 (ONE interface — the `userSessions.prompt` SSE stream;
tools are the only backend; minimal tools, stream-as-resolved). The v1 architecture
doc (`2026-06-30-agent-task-board.md`) still governs the stream/tool mechanics;
this doc changes the data model and the UI.

## The 7 problems v2 must solve

1. **Real create flow.** "+ Add" must NOT auto-generate a `"New task"`. Typing a
   title inline (Enter to create) creates it; the modal edits title + description.
2. **Drag works to every column.** v1 can't drop into In Progress / Done — the
   multi-container drag is broken (single `onDragEnd`, no `onDragOver`). Rewrite
   as a proper dnd-kit multi-container board.
3. **Issue IDs.** Every task shows a human key `TASK-<n>` (per-user monotonic).
4. **Sprints.** A board without sprints isn't a board. Full sprint model: create
   → start (active) → complete; a backlog; the board shows only the active
   sprint's tasks; drag backlog → sprint.
5. **Alignment.** Cards are laid out on a strict grid — ID row, title, footer
   (owner avatar + time) — controls in fixed aligned positions, not floating.
6. **One persistent session.** v1 creates a NEW session every page load (breaks
   chat context). Reuse a single board session id (persisted), so refreshes keep
   context.
7. **Rich cards.** Each card shows: `TASK-<n>`, title, owner avatar, description
   preview, relative time — not a bare title.

## Decisions (locked)

- **Sprint scope:** FULL (sprints table + dates + backlog + active sprint).
- **Owner:** personal board — owner is the logged-in user. Identity comes from
  `orpc.auth.me` which returns `{ id, email }` only (NO name), so the avatar is
  the email's first initial (same as `user-menu.tsx`). One owner; no member system.
- **Issue key:** per-user monotonic integer `seq`, displayed `TASK-<seq>`.
- **Backlog:** a flat ordered list (not status columns). Tasks with
  `sprintId = null` are backlog.
- **Active sprint:** at most one `active` sprint per user. `startSprint` rejects
  if another is already active ("Complete the current sprint first").
- **Create defaults:** "+ Add" in a board column creates in the active sprint
  with that status; "+ Add" in the backlog creates in the backlog (sprintId null,
  status `todo`).

## Data model

### `tasks` (modify `packages/db/src/schema/task-board.ts`)

Add two columns to the existing table:
- `seq` integer notNull — per-user monotonic issue number (display `TASK-<seq>`).
- `sprintId` uuid (nullable) — null = backlog; otherwise the owning sprint. Plain
  uuid + index (no FK, per repo convention).

New index `tasks_user_sprint_status_position` on `(userId, sprintId, status, position)`.

Migration note (hand-edit the generated SQL): backfill `seq` for existing rows so
they don't all collide on 0:
```sql
UPDATE tasks t SET seq = sub.rn FROM (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS rn FROM tasks
) sub WHERE t.id = sub.id;
```

### `sprints` (new table in the same schema file)

| column     | type        | notes                                  |
|------------|-------------|----------------------------------------|
| id         | uuid pk     |                                        |
| userId     | uuid notNull| indexed; scopes every query            |
| name       | text notNull|                                        |
| goal       | text notNull default "" | optional one-liner         |
| startDate  | timestamptz (nullable) | planned start               |
| endDate    | timestamptz (nullable) | planned end                 |
| status     | text `$type<SprintStatus>()` notNull default "future" | `future`\|`active`\|`completed` |
| createdAt  | timestamptz notNull defaultNow |                     |
| updatedAt  | timestamptz notNull defaultNow |                     |

Indexes: `sprints_user_id` on `userId`; `sprints_user_status` on `(userId, status)`.

### Domain types (`packages/agent/src/task/types.ts`)

```ts
export type TaskStatus = "todo" | "in_progress" | "done";
export type SprintStatus = "future" | "active" | "completed";

export interface Task {
  id: string; userId: string; seq: number;
  sprintId: string | null;
  title: string; description: string;
  status: TaskStatus; position: number;
  createdAt: string; updatedAt: string;
}

export interface Sprint {
  id: string; userId: string;
  name: string; goal: string;
  startDate: string | null; endDate: string | null;
  status: SprintStatus;
  createdAt: string; updatedAt: string;
}
```

## Stores (ports + repos)

`TaskStore` (extend):
- `create(userId, { title, sprintId?, status? })` → assigns `seq = max(seq)+1`
  for the user, sets `sprintId`/`status`.
- `listColumn(userId, sprintId, status)` → tasks of one sprint+status, by position.
- `listBacklog(userId)` → tasks with `sprintId IS NULL`, by position.
- `move(userId, id, { sprintId, status, position })` → column move, sprint move,
  reorder (sprintId may become null for "move to backlog").
- `update(userId, id, { title?, description? })`, `remove`, `get` (returns seq,
  sprintId) — as before.

`SprintStore` (new, `packages/db/src/repositories/sprint-store.ts`):
- `list(userId)`, `get(userId, id)`, `active(userId)` (status=active or null),
  `create(userId, { name, goal?, startDate?, endDate? })`,
  `update(userId, id, patch)`, `setStatus(userId, id, status)`, `remove(userId, id)`.

## Tools (the data layer)

`buildTaskToolDefs(taskStore, userId)` — updated:
- `listSprintColumn({ sprintId, status })` → tasks in a sprint column.
- `listBacklog()` → backlog tasks.
- `createTask({ title, sprintId?, status? })` → returns the created task (with seq).
- `moveTask({ id, sprintId?, status, position })`.
- `updateTask({ id, title?, description? })`, `deleteTask({ id })`, `getTask({ id })`.

`buildSprintToolDefs(sprintStore, userId)` — new:
- `listSprints()`, `activeSprint()`, `createSprint({ name, goal?, startDate?, endDate? })`,
  `updateSprint({ id, name?, goal?, startDate?, endDate? })`,
  `startSprint({ id })` (rejects if another active), `completeSprint({ id })`,
  `deleteSprint({ id })`.

Both tool sets are wired into BOTH the `toolCalls` direct path and the model turn
(same as v1). The router builds `[...taskDefs, ...sprintDefs]`.

## Frontend (apps/web — all shadcn)

### Session reuse (#6)
`board-page` persists ONE session id in `localStorage` (`board_session_id`,
SSR-guarded like `todo-store.ts`/`auth.ts`). On mount: if a stored id exists, reuse
it; else `createSession()` once and persist. Refresh keeps the same session → chat
context survives.

### Layout
- **SprintBar** (top): active sprint name + date range + "Complete sprint"; if no
  active sprint, a "No active sprint — Start one" state with a Start/Create action.
- **Board** (main): 3 columns (To Do / In Progress / Done) of the ACTIVE sprint.
- **Backlog** (collapsible side panel or a toggle): flat list of backlog tasks +
  inline create; drag a backlog card onto a board column to add it to the sprint.
- **Sprint management:** a small menu/dialog to create a sprint and start it.

### Multi-container drag (#2)
One `DndContext` with `onDragOver` (move the active card between columns/backlog
live in the store) AND `onDragEnd` (persist via `moveTask` with the resolved
`sprintId` + `status` + `position`). Card = `useSortable`; each column/backlog =
`useDroppable`. Crossing backlog↔board sets/clears `sprintId`.

### Card (#3 #5 #7) — strict grid
```
┌─────────────────────────────┐
│ TASK-12            ⋯ (menu)  │   ← id (mono, muted) left, actions right (aligned)
│ Title text, up to 2 lines    │
│ Description preview (muted)   │
│ ─────────────────────────── │
│ (avatar)            2h ago   │   ← owner avatar left, relative time right
└─────────────────────────────┘
```
Use shadcn `Card`, `Avatar`/`AvatarFallback` (email initial), `DropdownMenu` for
per-card actions (Open / Delete) so the delete control is in a fixed aligned slot,
not a hover-floating button.

### Create flow (#1)
"+ Add" reveals an inline `Input` (title) in the column/backlog; Enter creates via
`createTask`, Esc cancels. No auto "New task". The modal edits title + description +
status + sprint.

### Owner avatar (#7)
Fetch the current user via `orpc.auth.me`; render `AvatarFallback` with
`email[0].toUpperCase()`. One shared query (TanStack Query dedups).

## Identity / auth
Everything stays user-scoped via `context.authedUser.id`. Sprints + tasks both
filter by userId; a user never sees another's sprint or task.

## Testing
- `task-store` (db, integration): seq monotonic per user; sprint/backlog scoping;
  cross-user isolation; move across sprint + status.
- `sprint-store` (db, integration): one-active enforcement via setStatus; user
  scoping.
- `task-tools` / `sprint-tools`: each tool calls the store with the bound userId;
  startSprint rejects when another is active.
- board pure logic: group by column within a sprint; backlog ordering; the
  multi-container move resolver (dest sprintId+status+position from over id).
- existing api stream tests stay green.

## Phasing (one plan, sequenced) — early tasks land the fixes, later tasks add sprint
1. Schema: add `seq`+`sprintId` to tasks, new `sprints` table, migration (+ backfill), domain types.
2. `TaskStore` v2 (seq, sprint/backlog scoping, move-with-sprint) + tests.
3. `SprintStore` + one-active enforcement + tests.
4. `buildTaskToolDefs` v2 + `buildSprintToolDefs` (+ tests); wire both into the router (toolCalls + model turn) + services.
5. SDK: board reads (listBacklog + per-sprint columns) — reuse `runTools`/`runTool` (may need no SDK change; verify).
6. Session reuse (#6): persist one board session id.
7. Card v2 (#3 #5 #7): id row, title, description, owner avatar, time, actions menu — strict grid, aligned.
8. Inline create (#1): title input + Enter in columns and backlog.
9. Multi-container drag (#2): `onDragOver` + `onDragEnd`, status+sprint+position; tests for the resolver.
10. SprintBar + sprint management (create/start/complete) UI.
11. Backlog panel + drag backlog→sprint.
12. Modal v2 (title/description/status/sprint) + board chat unchanged.
13. Polish: empty states (no sprint, empty backlog), transitions, responsive, alignment pass; full sweep + deploy.

## Global constraints (unchanged from v1)
- ONE interface (the stream); no REST, no callTool.
- Frontend = `@better-agent/ui` (shadcn) only; strict alignment/spacing scale,
  loading + transitions, error toasts, intentional empty states.
- Minimal tools, stream-as-resolved.
- Lint: no `any`; no magic numbers (except -1/0/1); files ≤300 lines; functions
  ≤50 lines; deps pinned; `db:migrate` (not push).
- Work on `dev`; deploy via the GitHub Action; rotate any pasted secrets.
