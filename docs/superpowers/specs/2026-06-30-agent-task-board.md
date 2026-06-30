# Agent Task Board Design

**Status:** Design / spec (pre-implementation)
**Date:** 2026-06-30
**Authors:** jackson + Claude

## Goal

A real, usable Jira-style Kanban task board (`/board`) where **the agent's tools
are the only backend** — there is NO bespoke per-resource REST API. The board
renders and mutates real, user-scoped data (a `tasks` table) entirely through
the agent's tool layer:

- **Explicit operations** (render-on-enter, drag between columns, create, delete)
  call named agent tools **directly** — no model in the loop, instant.
- **Conversational operations** (a floating chat: "write a completion description
  for task #5") go through the **model** over the existing SSE stream, which
  calls the *same* tools and can update the page (e.g. open a task modal).

One tool layer, two invocation modes. The agent truly knows who you are (the
authenticated user-session identity), and every task is scoped to that user.

## Architecture principle (the hard rule)

```
                ┌─────────────────────────────────────────┐
                │     task tools (server-side data layer)  │
                │  listTasks / createTask / moveTask /     │
                │  updateTask / deleteTask / getTask       │
                │  — all scoped to session.authedUser.id   │
                └───────────────▲───────────────▲──────────┘
   direct call (no model)       │               │   model call (SSE stream)
   for EXPLICIT ops             │               │   for CONVERSATIONAL ops
                ┌───────────────┴──┐         ┌──┴──────────────────┐
                │  callTool() proc │         │  prompt/stream turn │
                │  (one generic    │         │  (existing agent    │
                │   tool endpoint) │         │   SSE interface)    │
                └───────────────▲──┘         └──┬──────────────────┘
                  <TaskBoard> widget            floating chat (Conversation)
```

- **No `tasks.create` / `tasks.move` REST procedures.** The only data entry points
  are: (1) `callTool({ name, args })` — a single generic "invoke a named agent
  tool" procedure, and (2) the existing model stream. Both run the same tool
  functions with the same identity.

## Non-goals

- No public/third-party API. Tools are internal to the agent.
- No realtime multi-user sync (single user's board; optimistic local updates +
  tool persistence are enough).
- Drag-drop does NOT invoke the model (that was explicitly rejected — too slow).

## Data model

New table `tasks` (`packages/db/src/schema/tasks.ts`):

| column       | type      | notes                                            |
|--------------|-----------|--------------------------------------------------|
| id           | uuid pk   |                                                  |
| userId       | text      | the owning user (indexed); scopes every query    |
| title        | text      |                                                  |
| description  | text      | default ""                                       |
| status       | enum      | `todo` \| `in_progress` \| `done`                |
| position     | integer   | order within a column (fractional or reindexed)  |
| createdAt    | timestamp |                                                  |
| updatedAt    | timestamp |                                                  |

Indexes on `userId` and `(userId, status, position)`. A `TaskStore` repository
(`packages/db/src/repositories/task-store.ts`) provides user-scoped CRUD:
`list(userId)`, `create(userId, {title})`, `update(userId, id, patch)`,
`move(userId, id, status, position)`, `remove(userId, id)`, `get(userId, id)`.
Every method takes `userId` and filters by it — a user can never touch another's
tasks.

## The task tools (the data layer)

`packages/agent/src/tool/task-tools.ts` — `buildTaskToolDefs(store, userId)`
returns `ToolDef[]` bound to one user. Each tool's `execute(args)` calls the
TaskStore with `userId`:

- `listTasks()` → JSON array of the user's tasks (id, title, description, status, position).
- `createTask({ title, status? })` → the created task.
- `moveTask({ id, status, position? })` → the updated task (column move + reorder).
- `updateTask({ id, title?, description? })` → the updated task.
- `deleteTask({ id })` → `{ ok: true }`.
- `getTask({ id })` → one task (or not-found).

These are SERVER-side tools (DB access). They are added to the agent's tool set
for user-session turns (so the model can call them), AND are individually
invokable via `callTool` (so the board can call them directly).

## The generic tool endpoint (no per-resource API)

`packages/api/src/routers/user-sessions.ts` gains ONE procedure:

```ts
callTool: authorizedUserProcedure
  .input(z.object({ agentId: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()).default({}) }))
  .handler(async ({ context, input }) => {
    const defs = buildTaskToolDefs(context.services.taskStore, context.authedUser.id);
    const tool = defs.find((d) => d.name === input.name);
    if (!tool) { throw new ORPCError("NOT_FOUND", { message: `Unknown tool ${input.name}` }); }
    return await tool.execute(input.args, { sessionId: "", callId: "", abortSignal: undefined });
  })
```

This is the single generic data interface for the board. It runs the same task
tools the model uses, with the same identity. No `tasks.*` REST procedures exist.

SDK: `@curiousbus/agent-client` gains `callTool(name, args)` on the user-plane
client, forwarding to this procedure.

## apps/web — the board

### Sidebar + route

apps/web currently has no persistent sidebar (it's a step-based home). Add a
minimal left **sidebar** (`app-shell` style) with entries **Chat** (the existing
home) and **Board**, and a `/board` route (behind the normal web auth).

### `<TaskBoard>` widget

`apps/web/src/board/task-board.tsx` — a real Jira-style board:
- On mount: `agentClient.callTool("listTasks", {})` → render three columns
  (To Do / In Progress / Done), tasks sorted by `position`.
- **Drag-drop** between/within columns (use `@dnd-kit/core` + `@dnd-kit/sortable`,
  pinned): on drop, **optimistically** move the card, then
  `callTool("moveTask", { id, status, position })`; on failure, revert + toast.
- **Create**: an "Add" affordance per column → `callTool("createTask", { title, status })` → optimistic append.
- **Delete**: per-card → `callTool("deleteTask", { id })` → optimistic remove.
- **Open detail**: clicking a card opens `<TaskModal>`.
- A local store mirrors the data so optimistic updates are instant; `callTool`
  results reconcile it. (Same external-store pattern as the existing TodoList.)

### `<TaskModal>`

`apps/web/src/board/task-modal.tsx` — a Dialog showing a task's title, status,
and an editable description (save → `callTool("updateTask", { id, description })`).
Opened by: clicking a card, OR a chat action (below).

### Floating chat

A fixed bottom-right **chat icon**; clicking it opens a chat panel (reuse
`<Conversation>` from `@better-agent/ui`) bound to the board's agent, wired with
the task tools + the generative-UI config. Conversational commands:
- "write a completion description for task #5" → the model calls `getTask` +
  `updateTask`, then emits a **client action** `{ intent: "openTask", target: "client", payload: { id } }`.
- The board's `onAction` handles `openTask` → opens `<TaskModal>` for that task,
  showing the freshly written description. The board also refreshes (re-`callTool`
  listTasks) so the card reflects changes.

So the chat can both mutate data (via the model→tools) AND drive the page (open a
modal, refresh the board) — "user asks → agent updates the page".

## Identity / auth

Everything is user-scoped via the user-session's `context.authedUser.id`:
`callTool` builds the task tools bound to that id; the model-path turn likewise
builds task tools bound to the session's user. A user only ever sees/edits their
own tasks. No task id is trusted from the client without the userId filter.

## Error handling

- `callTool` unknown name → `NOT_FOUND`; the board surfaces a toast.
- Optimistic mutations that fail → revert local state + toast.
- `getTask`/`updateTask` on a missing/foreign id → not-found (the store filters by
  userId, so a foreign id simply isn't found).
- The board renders an empty state per column with an "Add" affordance.

## Generative-UI tie-in

The floating chat uses the existing generative-UI config so the agent can render
rich task UI inline (e.g. a task card) when useful, and the `openTask` action
reuses the A2 action-routing already built. The board itself is a fixed
interactive widget (not generated each load) — fast, and the agent's role is the
data layer + the conversational brain.

## Testing

- `task-store` (db): user-scoped CRUD; a user cannot read/update/delete another
  user's task (integration test).
- `task-tools`: each tool calls the store with the bound userId; `moveTask`
  updates status+position; `deleteTask` returns ok.
- `callTool` router: dispatches to the named tool with the authed user; unknown
  name → NOT_FOUND; a foreign task id is not found.
- board pure logic: column grouping + sort by position; optimistic move/insert
  helpers; reconciliation against a `callTool` result.
- SDK `callTool` forwards name/args to the user-plane procedure (stub test).

## File structure

- `packages/db/src/schema/tasks.ts` (new) + migration
- `packages/db/src/repositories/task-store.ts` (new) + test
- `packages/agent/src/tool/task-tools.ts` (new) + test
- `packages/agent/src/ports.ts` — `TaskStore` port (if the agent needs the type)
- `packages/api/src/routers/user-sessions.ts` — `callTool` procedure
- `packages/api/src/services.ts` + `apps/server/src/services.ts` — wire `taskStore`
- `packages/client/src/types.ts` + `internal.ts` — `callTool` on the user-plane client
- `apps/web/src/routes/board.tsx` (new route)
- `apps/web/src/components/app-shell-nav.tsx` or a new sidebar (Chat / Board)
- `apps/web/src/board/task-board.tsx`, `task-card.tsx`, `task-modal.tsx`, `board-chat.tsx`, `board-store.ts` (+ tests for pure logic)
- `apps/web/package.json` — add `@dnd-kit/core` + `@dnd-kit/sortable` (pinned)

## Phasing (one plan, sequenced tasks)

1. `tasks` table + migration + `TaskStore` (+ tests).
2. `buildTaskToolDefs` task tools (+ tests).
3. `callTool` generic procedure + wire `taskStore` into services (+ test).
4. SDK `callTool` on the user-plane client (+ test).
5. Board pure logic (`board-store`: group/sort/optimistic) (+ tests).
6. `/board` route + sidebar (Chat / Board) scaffold.
7. `<TaskBoard>` + `<TaskCard>` — render columns from `callTool("listTasks")`.
8. Drag-drop (`@dnd-kit`) → optimistic + `callTool("moveTask")`; create/delete.
9. `<TaskModal>` (open from card; edit description → `callTool("updateTask")`).
10. Floating chat (`<BoardChat>`) — Conversation + task tools + genui; `openTask` action opens the modal + refreshes.
11. Bind the task tools into the user-session model turn so the chat can call them.
12. Polish + responsive + deploy.

## Resolved decisions

- **No per-resource REST API.** One generic `callTool` + the model stream; both run
  the same user-scoped task tools.
- **Explicit ops (render/drag/create/delete) call tools directly** (no model);
  **conversational ops go through the model**.
- **Board on entry renders directly** (page renders `<TaskBoard>`, which calls
  `listTasks` directly) — fast; the agent is the data layer + chat brain, not the
  per-visit renderer.
- **Drag-drop:** `@dnd-kit`, optimistic + tool-persisted.
- **Chat:** floating bottom-right, reuses `<Conversation>` + generative UI; can
  open the task modal via an `openTask` client action.
