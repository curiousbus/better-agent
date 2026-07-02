# Resumable Turns — decouple turn execution from the SSE connection (design spec)

**Goal:** An in-flight agent turn survives the client going away entirely (page refresh, tab close, laptop sleep). Re-opening the chat re-attaches: partial output is visible and keeps updating until the turn completes. Only the Stop button (or a server error) ends a turn early.

**Complements** the client-side fix already shipped (module-level chat store: in-SPA navigation no longer aborts). This spec covers the server side: today the turn is *pumped by the SSE response* — if the HTTP connection dies, the turn dies with it.

## Verified current state

- `userSessions.prompt` (`streamUserTurn`) does `yield* runtime.runTurn(...)`: the client's SSE consumption drives the model turn. Client disconnect → generator return → turn aborted mid-way.
- The runtime already persists progressively: the assistant message row exists from turn start (`status: "streaming"`); text/reasoning parts are appended/updated during the stream (`part-buffer.ts`), tool parts via `runtime-drain.ts`; `finalizeAssistant` stamps status/usage at the end. **The DB is already a live view of a running turn.**
- Cancellation is cross-isolate (Upstash registry) — Stop works regardless of which isolate runs the turn.
- No `ctx.waitUntil` use yet; the server is a Cloudflare Worker (Hono + oRPC).

## Design

### 1. Detached execution (server)
`streamUserTurn` stops letting the response drive the turn:

- A **pump** consumes `runtime.runTurn(...)` to completion, pushing every event into an in-memory **channel** (unbounded async queue). The pump promise is registered with `executionCtx.waitUntil(...)` so the Worker keeps it alive after the response ends.
- The SSE response becomes an **observer**: it drains the channel. If the client disconnects, the observer dies but the pump continues — parts keep landing in the DB, finalize still runs, usage/activity still recorded.
- Plumbing: expose `waitUntil` on the oRPC context (from Hono's `executionCtx`); no-op fallback for node/tests.
- Live streaming UX is unchanged (same isolate, same event flow, same smoothness).

### 2. Re-attach (client, DB-polling)
No new endpoint, no Redis event log — the progressively-persisted parts ARE the replay:

- `useChat` derives an **observing** state: the trailing history message is an assistant with `status === "streaming"` and there is no local live stream for the session (e.g. after a reload).
- While observing: poll `listMessages` every ~1.5s (refetchInterval on the existing history query). Parts grow chunk-by-chunk; render as normal history (chat-row already renders partial parts; only live drafts shimmer).
- Composer treats observing as streaming (disabled, Stop shown). Stop → existing `cancel` → registry aborts the pump → finalize flips status → polling stops.
- Stall guard: if a streaming row stops changing for > 2 minutes, stop polling and treat it as orphaned (render as-is, composer re-enabled) — protects against a crashed isolate that never finalized.

### 3. Out of scope (later, optional)
- Token-smooth re-attach via a Redis event log (batched RPUSH + poll-tail). DB-polling is chunky but correct; upgrade only if the UX demands it.
- Multi-tab live mirroring.

## Risks / 待定
- **Workers waitUntil budget**: wall-clock is fine for model streaming (mostly awaiting subrequests), but very long turns may hit platform limits. Verify on the test env; if turns die post-disconnect, revisit with Durable Objects or Queues (bigger infra, 待定).
- Duplicate-view edge: while a live draft streams we already pause the history query; observing mode only ever renders history (no draft), so no overlap.

## Tasks
1. **Server**: channel + pump in `user-sessions.ts`; `waitUntil` on context (Hono executionCtx → oRPC context; no-op default). Test: consumer stops after the first event → turn still completes (message finalized, tool executed).
2. **Client**: observing mode in `useChat` (trailing-streaming detection, refetchInterval, streaming derivation, stall guard). Composer/stop unchanged externally.

## Global constraints
No `any`; magic numbers only -1/0/1; files ≤300 lines; functions ≤50; deps pinned; migrations n/a (no schema change). Work on dev.
