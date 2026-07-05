# Claude Code Online — Implementation Plan

> Goal: mirror the FULL local Claude Code experience into the web Local Agent view — reasoning, sessions, slash commands, skills, status/usage — driven through `@anthropic-ai/claude-agent-sdk`.

**Research basis:** the SDK exposes everything needed (verified against sdk.d.ts + docs):
`listSessions`/`getSessionMessages`/`forkSession` + `resume` option; thinking via `stream_event` `thinking_delta` under `includePartialMessages`; `query.supportedCommands()` / init `slash_commands`; `query.getUsage()` / `getContextUsage()`; `setPermissionMode`/`setModel`/`interrupt`/`mcpServerStatus`.

**Already shipped (0918ede):** noise hidden (hooks/thinking_tokens/stream bookkeeping), empty reasoning dropped, init → curated `session_ready` (model/session/tools/slash/skills/mcp), result → `turn_usage` (cost/tokens), thinking enabled.

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
