# Local Agent Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute task-by-task.

**Goal:** A local CLI drives a local coding agent (Claude Code / opencode / Codex) and bridges it to better-agent: the agent's output streams up to the server, the web terminal sends commands down. Transport = native SSE push + real Redis pub/sub (server runs on Docker/Node with ioredis; updated 2026-07-04 after the server left Workers).

**Spec:** `docs/superpowers/specs/2026-07-03-local-agent-bridge-design.md` (all decisions locked there; §3.1 transport updated for the Docker deployment).

**Architecture:** `local agent proc ↔ bridge CLI (adapters) ↔ server relay (Redis pub/sub push + rolling-window replay buffer) ↔ web terminal`. Two Redis channels+windows per session: `events↑` (agent→web), `commands↓` (web→agent). Live delivery = PUBLISH→SSE; the capped, TTL'd, id-ordered window exists for reconnect replay (`lastEventId`) and as the poll fallback.

## Global Constraints
- No `any`; magic numbers only -1/0/1 (named consts); files ≤299 lines; functions ≤50 lines; deps pinned exact; drizzle migrations; conventional commits; work on dev.
- Relay runs on the Node server with **ioredis** (`new Redis(env.REDIS_URL)`, same wiring as redis-pending-store / redis-session-lock). Live path = Redis pub/sub feeding server-sent SSE (heartbeat `:ping` comments to keep proxies happy); windows are the replay/fallback path. In-memory impl for dev/test, Redis impl when REDIS_URL is set, selected the same way pending-store is. No Durable Objects, no Upstash REST.
- bridge tokens are a NEW independent mechanism (prefix `bt_`), NOT agent tokens. Phase 1 is single-user (session.userId === caller). Events are Redis-only (no DB persistence of the stream). pi-agent adapter is OUT (phase 2).

---

## Task 1: DB — bridge tokens + sessions

**Files:**
- Create `packages/db/src/schema/bridge.ts`, migration (drizzle generate)
- Create `packages/db/src/repositories/bridge-token-store.ts`, `bridge-session-store.ts` (+ integration tests)
- Modify `packages/agent/src/ports.ts` (interfaces), `packages/db/src/schema/index.ts`

**Schema:**
- `bridge_tokens`: id uuid pk, user_id uuid notNull, name text, token_hash text notNull unique, last4 text, created_at, revoked_at timestamptz null. index (user_id).
- `bridge_sessions`: id uuid pk, user_id uuid notNull, token_id uuid notNull, agent_kind text ('claude-code'|'opencode'|'codex'), label text, status text ('active'|'ended') default 'active', created_at, last_seen_at. index (user_id).

**Stores (interfaces in ports):**
- `BridgeTokenStore`: create({userId,name,tokenHash,last4}) / listByUser / findByHash (returns {id,userId,revokedAt}) / revoke(id,userId).
- `BridgeSessionStore`: create({userId,tokenId,agentKind,label}) / listByUser / get(id) / touch(id) (lastSeenAt) / end(id,userId).

**Test:** PGlite integration — token create/find/revoke, session create/list/end, owner scoping. Reuse `bt_` token via `createTokenService`-style hashing (sha256), or a small dedicated hasher.

**Interfaces produced:** `BridgeTokenStore`, `BridgeSessionStore`, the two row types.

## Task 2: Relay — Redis pub/sub push + rolling-window replay store

**Files:**
- Create `packages/agent/src/bridge/relay-store.ts` (interface + in-memory impl), `apps/server/src/redis-relay-store.ts` (ioredis impl)
- Modify `packages/api/src/services.ts` (type), `apps/server/src/services.ts` (wire, pick Redis when REDIS_URL set else in-memory — same switch as pending-store), `packages/agent/src/ports.ts`

**Interface `RelayStore`:**
```ts
type RelayDir = "events" | "commands";
interface RelayEvent { id: number; data: unknown }
interface RelayStore {
  append(sessionId, dir, data): Promise<number>;          // returns new id; also notifies subscribers
  read(sessionId, dir, afterId): Promise<RelayEvent[]>;    // ids > afterId, in order (replay/fallback)
  subscribe(sessionId, dir, onEvent: (e: RelayEvent) => void): () => void; // live push; returns unsubscribe
}
```
- Rolling window (replay buffer): cap `MAX_WINDOW = 500` events per (session,dir); TTL `WINDOW_TTL_SEC = 900`. id = monotonic per (session,dir) (Redis INCR of a counter key).
- ioredis impl: counter key `bridge:{sid}:{dir}:seq` (INCR); list key `bridge:{sid}:{dir}` storing `{id,data}` JSON (RPUSH + LTRIM -MAX..-1); both EXPIREd. append then `PUBLISH bridge:{sid}:{dir}` with the event JSON. subscribe = a dedicated subscriber connection (ioredis requires a separate connection for SUBSCRIBE — create one lazily, share it, route by channel). read = LRANGE, filter id>afterId.
- In-memory impl: per-(session,dir) array + counter + listener set (append notifies synchronously).

**Test:** append→read increments; afterId filtering; window cap keeps only last MAX_WINDOW; both dirs isolated; subscribe receives appended events live and unsubscribe stops them.

**Interfaces produced:** `RelayStore`, `RelayEvent`, `RelayDir`.

## Task 3: API — bridge router + bridge-token auth

**Files:**
- Create `packages/api/src/routers/bridge.ts`, register in `packages/api/src/routers/index.ts` as `bridge:`
- Create a `bridgeProcedure` (validates `Authorization: Bearer bt_...` → {userId, tokenId, sessionId?}) alongside the existing procedures in `packages/api/src/context.ts` / procedures file
- Modify context to expose relay + bridge stores (via services)

**Endpoints:**
- `createToken` (userProcedure): {name} → {token: "bt_…", last4}. Store hash. Return raw once.
- `listTokens` / `revokeToken` (userProcedure).
- `startSession` (bridgeProcedure): {agentKind, label} → {sessionId}. Creates bridge_session bound to token's user.
- `pushEvents` (bridgeProcedure): {sessionId, events: unknown[]} → append each to `events↑`; touch session. Reject if session not owned by token's user.
- `pollCommands` (bridgeProcedure): {sessionId, afterId} → RelayEvent[] from `commands↓`. (CLI may stay on polling — local Node process, zero cost; SSE swap-in later is a client-only change.)
- `observeStream` (userProcedure, **SSE**): {sessionId, lastEventId?} → long-lived event stream from `events↑`: replay `read(afterId)` first, then live via `relay.subscribe`; heartbeat `:ping` comment every ~15s so proxies don't kill the idle stream (assert session.userId === caller). Hono streaming response on the Node server.
- `observe` (userProcedure, poll fallback): {sessionId, afterId} → RelayEvent[] from `events↑` (assert owner). Same data path as the SSE replay.
- `sendInput` (userProcedure): {sessionId, data} → append to `commands↓` (assert owner).
- `listSessions` (userProcedure) / `endSession` (userProcedure).

**Test:** api tests — token create/revoke; a bridge-token session pushes events, an owner observes them; a non-owner observe → NOT_FOUND; sendInput lands in commands poll; revoked token rejected.

**Interfaces produced:** the `bridge` router contract (consumed by CLI + web via orpc types).

## Task 4: Bridge CLI — `apps/bridge-cli` (adapters + relay client)

**Files:** new workspace pkg `apps/bridge-cli` (bin `better-agent-bridge`), `src/index.ts` (arg parse), `src/relay-client.ts` (push + poll loop, reconnect), `src/adapters/{types,claude-code,opencode,codex}.ts`, `src/normalize.ts` (NDJSON event → normalized), tests for the pure parts (normalize, relay-client with a fake transport).

**Normalized event model:** `{ kind: "message"|"tool"|"file"|"output"|"status"|"error", …payload }`. Each adapter maps its agent's NDJSON to this.

**Adapter interface:**
```ts
interface Adapter { start(dir: string): Promise<AgentHandle> }
interface AgentHandle { events: AsyncIterable<NormalizedEvent>; send(text: string): void; stop(): void }
```
- **claude-code**: spawn `claude -p --output-format stream-json --input-format stream-json --verbose` in `dir`; read stdout NDJSON → normalize; write user commands as stream-json input to stdin. (Confirm exact input frame shape against the installed claude version at implement time.)
- **opencode**: prefer ACP (spawn opencode in ACP mode, stdin/stdout nd-JSON) OR `opencode serve` + REST/SSE. Pick whichever the installed opencode exposes; normalize.
- **codex**: `codex exec` JSONL or app-server JSON-RPC; normalize.

**Relay client:** `startSession` → loop: (a) drain adapter.events → batch `pushEvents`; (b) poll `pollCommands(afterId)` → adapter.send. Adaptive interval (fast when active). Reconnect on transient failure; resume afterId from last seen.

**Test:** normalize mapping (fixtures per agent), relay-client loop against a fake relay (pushes recorded, polled commands dispatched), reconnect resumes afterId. Do NOT spawn real agents in CI.

## Task 5: Web — terminal view + token management

**Files:** `apps/web/src/routes/bridge.index.tsx` (+ sidebar nav item), `apps/web/src/components/bridge/{terminal,session-list,token-manager,event-line}.tsx`, api-types additions.

- **Token manager**: list tokens, create (show `bt_…` once with copy + the `better-agent-bridge --token …` command), revoke.
- **Session list**: the user's active bridge sessions (poll `listSessions`).
- **Terminal**: for a selected session — monospaced output area rendering normalized events (message/tool/file/output/status/error each styled), auto-scroll, connection status; bottom input box → `sendInput`. Live feed = `observeStream` SSE (instant push; reconnect with `lastEventId` replays the window); falls back to polling `observe(afterId)` if the stream errors repeatedly. Mobile-friendly (fits narrow, scrolls).

**Test:** web jsdom — terminal renders a sequence of normalized events and never drops/duplicates; input posts and clears. (Mirror the chat regression-harness style.)

---

## Execution order & notes
1→2→3 are the backend spine (each independently testable). 4 (CLI) depends on 3's contract. 5 (web) depends on 3's contract; can proceed in parallel with 4. pi-agent adapter and multi-observer are explicitly phase 2. The whole thing ships behind the new `/bridge` route; nothing existing changes behavior.
