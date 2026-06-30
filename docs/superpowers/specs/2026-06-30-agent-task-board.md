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

One tool layer, ONE interface (the agent's SSE stream), two modes. The agent
truly knows who you are (the authenticated user-session identity), and every task
is scoped to that user.

## Architecture principle (the hard rule)

There is exactly **one interface for the whole project: the user-session SSE
stream** (`userSessions.prompt`). There is NO separate endpoint — not even a
generic `callTool`. The stream accepts two kinds of input and runs the SAME
server-side tools:

```
              ┌─────────────────────────────────────────┐
              │     task tools (server-side data layer)  │
              │  listTasks / createTask / moveTask /     │
              │  updateTask / deleteTask / getTask       │
              │  — all scoped to session.authedUser.id   │
              └───────────────▲───────────────▲──────────┘
                              │               │
              ┌───────────────┴───────────────┴──────────┐
              │   THE ONE INTERFACE: userSessions stream  │
              │                                           │
              │  { toolCall: { name, args } }   { text }  │
              │   → run the tool DIRECTLY,       → model  │
              │     NO model, stream result        turn   │
              └───────────────▲───────────────▲──────────┘
   EXPLICIT ops (no model)    │               │   CONVERSATIONAL ops (model)
                <TaskBoard> widget            floating chat (Conversation)
```

- **No `tasks.create` / `tasks.move` REST procedures, and no `callTool` endpoint.**
  The stream input becomes a union: `{ text, … }` (a model turn) OR
  `{ toolCall: { name, args } }` (execute that named server tool directly, no
  model, and stream the result back). Both paths run the same user-scoped tools.
- The board's explicit ops send a `toolCall` frame; the chat sends `text`. One
  endpoint, one tool layer.

## Non-goals

- No public/third-party API. Tools are internal to the agent.
- No realtime multi-user sync (single user's board; optimistic local updates +
  tool persistence are enough).
- Drag-drop does NOT invoke the model (that was explicitly rejected — too slow).

## Frontend constraint (hard rule)

Every UI element is built from `@better-agent/ui` (shadcn) components — Card,
Button, Input, Textarea, Dialog, Badge, Separator, DropdownMenu, etc. No
ad-hoc `<div>`-with-classes widgets where a ui component exists. The only
exceptions are layout containers (flex/grid wrappers) and the dnd-kit drag
primitives, which wrap ui components.

## Streaming rendering (hard rule)

SSE arrives frame-by-frame, not as one finished JSON blob — so the chat must
**render progressively as it streams, never wait for the turn to finish**:
- Generative-UI replies render via the already-built `structured-delta` partial
  stream: each delta best-effort-parses the growing tool-input into a deep-
  partial tree; completed nodes render immediately, the trailing incomplete node
  shows a skeleton, and the validated tree from `done` reconciles at the end.
  (No "wait for the full object" anywhere.)
- Text replies stream token-by-token (existing `text-delta`).
- The board's direct `toolCall` results are small, single payloads — rendered
  immediately on the `tool-result` event (no progressive needed there).

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
invokable via the stream `toolCall` mode (so the board can call them directly).

## Direct tool execution over the one stream (no separate endpoint)

`userSessions.prompt`'s input becomes a union — keep the existing model-turn
shape, and add a direct-tool shape:

```ts
// existing: { sessionId, text, tools?, outputSchema?, attachmentIds? }
// added:    { sessionId, toolCall: { name: string, args: Record<string, unknown> } }
```

In `streamUserTurn`, when `input.toolCall` is present, DO NOT run the model:
build the task tools bound to `context.authedUser.id`, find the named one,
execute it with `input.toolCall.args`, and stream back a single result —
`yield { type: "tool-result", callId, result, isError }` then `done`. Unknown
tool name → an `error` event. This reuses the existing RunEvent stream; no new
endpoint, no new transport.

SDK: `@curiousbus/agent-client`'s user-plane client gains
`runTool(sessionId, name, args): Promise<unknown>` — it opens the stream with a
`toolCall` input, reads the `tool-result` event, and resolves its `result` (or
rejects on the `error` event). The board uses `runTool` for every explicit op.

There are NO `tasks.*` REST procedures and NO `callTool` procedure — the only
network interface the board touches is the user-session stream.

## apps/web — the board

### Sidebar + route

apps/web currently has no persistent sidebar (it's a step-based home). Add a
minimal left **sidebar** (`app-shell` style) with entries **Chat** (the existing
home) and **Board**, and a `/board` route (behind the normal web auth).

### `<TaskBoard>` widget

`apps/web/src/board/task-board.tsx` — a real Jira-style board:
- On mount: `agentClient.runTool("listTasks", {})` → render three columns
  (To Do / In Progress / Done), tasks sorted by `position`.
- **Drag-drop** between/within columns (use `@dnd-kit/core` + `@dnd-kit/sortable`,
  pinned): on drop, **optimistically** move the card, then
  `runTool("moveTask", { id, status, position })`; on failure, revert + toast.
- **Create**: an "Add" affordance per column → `runTool("createTask", { title, status })` → optimistic append.
- **Delete**: per-card → `runTool("deleteTask", { id })` → optimistic remove.
- **Open detail**: clicking a card opens `<TaskModal>`.
- A local store mirrors the data so optimistic updates are instant; `runTool`
  results reconcile it. (Same external-store pattern as the existing TodoList.)

### `<TaskModal>`

`apps/web/src/board/task-modal.tsx` — a Dialog showing a task's title, status,
and an editable description (save → `runTool("updateTask", { id, description })`).
Opened by: clicking a card, OR a chat action (below).

### Floating chat

A fixed bottom-right **chat icon**; clicking it opens a chat panel (reuse
`<Conversation>` from `@better-agent/ui`) bound to the board's agent, wired with
the task tools + the generative-UI config. Conversational commands:
- "write a completion description for task #5" → the model calls `getTask` +
  `updateTask`, then emits a **client action** `{ intent: "openTask", target: "client", payload: { id } }`.
- The board's `onAction` handles `openTask` → opens `<TaskModal>` for that task,
  showing the freshly written description. The board also refreshes (re-`runTool`
  listTasks) so the card reflects changes.

So the chat can both mutate data (via the model→tools) AND drive the page (open a
modal, refresh the board) — "user asks → agent updates the page".

## Identity / auth

Everything is user-scoped via the user-session's `context.authedUser.id`:
The `toolCall` path builds the task tools bound to that id; the model-path turn likewise
builds task tools bound to the session's user. A user only ever sees/edits their
own tasks. No task id is trusted from the client without the userId filter.

## Error handling

- an unknown `toolCall` name → an `error` event; the board surfaces a toast.
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
- stream `toolCall` mode: dispatches to the named tool with the authed user; unknown
  name → NOT_FOUND; a foreign task id is not found.
- board pure logic: column grouping + sort by position; optimistic move/insert
  helpers; reconciliation against a `runTool` result.
- SDK `runTool` sends a toolCall frame and resolves the result name/args to the user-plane procedure (stub test).

## File structure

- `packages/db/src/schema/tasks.ts` (new) + migration
- `packages/db/src/repositories/task-store.ts` (new) + test
- `packages/agent/src/tool/task-tools.ts` (new) + test
- `packages/agent/src/ports.ts` — `TaskStore` port (if the agent needs the type)
- `packages/api/src/routers/user-sessions.ts` — add the `toolCall` stream-input mode + direct-exec branch
- `packages/api/src/services.ts` + `apps/server/src/services.ts` — wire `taskStore`
- `packages/client/src/types.ts` + `internal.ts` — `runTool` on the user-plane client
- `apps/web/src/routes/board.tsx` (new route)
- `apps/web/src/components/app-shell-nav.tsx` or a new sidebar (Chat / Board)
- `apps/web/src/board/task-board.tsx`, `task-card.tsx`, `task-modal.tsx`, `board-chat.tsx`, `board-store.ts` (+ tests for pure logic)
- `apps/web/package.json` — add `@dnd-kit/core` + `@dnd-kit/sortable` (pinned)

## Phasing (one plan, sequenced tasks)

1. `tasks` table + migration + `TaskStore` (+ tests).
2. `buildTaskToolDefs` task tools (+ tests).
3. `toolCall` stream mode (direct tool exec, no model) + wire `taskStore` into services (+ test).
4. SDK `runTool` (toolCall over the stream) on the user-plane client (+ test).
5. Board pure logic (`board-store`: group/sort/optimistic) (+ tests).
6. `/board` route + sidebar (Chat / Board) scaffold.
7. `<TaskBoard>` + `<TaskCard>` — render columns from `runTool("listTasks")`.
8. Drag-drop (`@dnd-kit`) → optimistic + `runTool("moveTask")`; create/delete.
9. `<TaskModal>` (open from card; edit description → `runTool("updateTask")`).
10. Floating chat (`<BoardChat>`) — Conversation + task tools + genui; `openTask` action opens the modal + refreshes.
11. Bind the task tools into the user-session model turn so the chat can call them.
12. Polish + responsive + deploy.

## Resolved decisions

- **No per-resource REST API and no callTool endpoint.** One stream with a `toolCall` mode + the model turn; both run
  the same user-scoped task tools.
- **Explicit ops (render/drag/create/delete) call tools directly** (no model);
  **conversational ops go through the model**.
- **Board on entry renders directly** (page renders `<TaskBoard>`, which calls
  `listTasks` directly) — fast; the agent is the data layer + chat brain, not the
  per-visit renderer.
- **Drag-drop:** `@dnd-kit`, optimistic + tool-persisted.
- **Chat:** floating bottom-right, reuses `<Conversation>` + generative UI; can
  open the task modal via an `openTask` client action.
