# Claude Code Online — Implementation Plan

> Goal: mirror the FULL local Claude Code experience into the web Local Agent view — reasoning, sessions, slash commands, skills, status/usage — driven through `@anthropic-ai/claude-agent-sdk`.

**Research basis:** the SDK exposes everything needed (verified against sdk.d.ts + docs):
`listSessions`/`getSessionMessages`/`forkSession` + `resume` option; thinking via `stream_event` `thinking_delta` under `includePartialMessages`; `query.supportedCommands()` / init `slash_commands`; `query.getUsage()` / `getContextUsage()`; `setPermissionMode`/`setModel`/`interrupt`/`mcpServerStatus`.

**Already shipped (0918ede):** noise hidden (hooks/thinking_tokens/stream bookkeeping), empty reasoning dropped, init → curated `session_ready` (model/session/tools/slash/skills/mcp), result → `turn_usage` (cost/tokens), thinking enabled.

## Phase 0 — Persist Local Agent conversation history (why there's no history today)
Bridge events are Redis-window-only (ephemeral; the session's feed vanishes on reload / when the window TTLs). Persist them so a Local Agent conversation survives reload and can be reopened, exactly like the normal chat.
- DB: new `bridge_messages` table — id, session_id (fk bridge_sessions), seq (monotonic per session), event jsonb, created_at; index (session_id, seq). Store the SERVER-assigned relay id as seq so history + live feed share one ordering.
- Store: `BridgeMessageStore` — `append(sessionId, event) → seq`, `list(sessionId, afterSeq?, limit) → {seq, event}[]`. Wire into services (Postgres impl; fake for tests).
- API `pushEvents`: after `relayStore.append`, also persist to `bridgeMessages` (best-effort; a persist failure must not break the live relay). `history` endpoint (userProcedure, owner-asserted): `{sessionId, afterSeq?, limit}` → persisted events.
- Web: the detail terminal loads `history` on mount (seed the feed), THEN live via SSE/observe — dedupe by id so replayed live events don't double. Mirrors the chat's listMessages-then-stream seeding.
- Skip persisting the noisy/curated status internals if desired; persist message/output/tool/file/approval + the curated session_ready/turn_usage.

## Phase 0.5 — Common agent-capability abstraction (across claude / pi / opencode / codex)
Don't special-case claude. Define a capability model each adapter reports, and the web surfaces each feature ONLY for agents that support it (see the capability matrix from the pi/opencode research).
- `AgentCapabilities` on the adapter/handle: `{ reasoning, sessionList, sessionResume, slashCommands, skills, usage, contextUsage, toolApproval, modelSwitch, permissionMode, interrupt }` (booleans / optional method presence). claude = full; pi/opencode = per research; codex = per research.
- Surface capabilities to the web (via the `session_ready` event's detail or a dedicated capability event), so the composer/status/session UIs render conditionally.
- The normalized event model already unifies message/output/tool/file/status/error/approval — keep every agent mapping onto it; capability flags gate the OPTIONAL surfaces (slash picker, session list, usage panel, model/permission controls).

## Phase 1 — Reasoning display (the #1 complaint)
- Adapter: turn on `includePartialMessages: true`.
- Normalize `stream_event`: `text_delta` → `output`; `thinking_delta` → a reasoning-flagged output (`OutputEvent.reasoning?: boolean`).
- Dedup: with partial messages on, the final assistant `message` text duplicates the streamed deltas — SKIP text blocks on the final assistant message (keep tool_use blocks); the streamed deltas are the source of truth.
- Web fold (`bridge-turns.ts`): accumulate reasoning-output into a separate collapsible "Thinking" block on the assistant turn (like the chat's reasoning rendering), text-output into the reply block.

## Phase 2 — Status & usage panels
- Web: render `session_ready` as a compact header (model, permission mode, cwd, #tools, #mcp servers with status) — NOT an inline chat line.
- Render `turn_usage` as a subtle per-turn footer (cost, in/out/cache tokens, turns).
- Live context %: call `query.getContextUsage()` on demand (a small "context: N%" chip); `query.getUsage()` for session cost + rate-limit/subscription info. Expose via a bridge RPC the web polls, or fold into the status header.

## Phase 3 — Session mapping + list/resume
- Persist claude's `session_id` (from init) onto the bridge_session row (add a `agentSessionId` column) so the web can show "claude session: <id>".
- New CLI/adapter capability: `listSessions({dir})` → the user's local claude conversations (id, title, lastModified, gitBranch). Surface via a bridge RPC → web "Resume a past conversation" picker.
- `resume: sessionId` option on `query()` (adapter takes an optional resume id at start) so a Local Agent can reopen a prior claude session with full context. `forkSession` for branching.

## Phase 4 — Slash commands & skills
- Surface `slash_commands` + `skills` from init (already in `session_ready`) and refresh via `query.supportedCommands()` / the `commands_changed` system event.
- Composer: typing `/` opens a command/skill picker (fed by the session's slash_commands + skills). Selecting sends `/command …` as a normal user turn.
- Show skills as a labeled subset; invoked either by `/skill` or autonomously (Skill tool). Handle `compact_boundary` (show a "compacted N→M tokens" divider) and `/clear`.

## Phase 5 — Controls
- Expose `setPermissionMode` (a mode dropdown), `setModel` (model picker from `supportedModels()`), and `interrupt` (a Stop button) in the detail page — wired through new bridge input command shapes (`{type:"control", action:"setModel"|"setPermissionMode"|"interrupt", …}`) the CLI routes to the query object.

## Constraints
No `any`; magic numbers named; files ≤299/functions ≤50; eslint + tailwind gates; conventional commits; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; branch dev. Each phase ships independently and is testable (fake SDK query in unit tests; real-claude smoke by the user). Approvals already route via `canUseTool` (done).
