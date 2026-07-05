# Bridge follow-ups + Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** (a) agent approval interactions end-to-end (CLI ↔ web), (b) "Local Agent" IA in the web app (sidebar entry, add flow, detail page), (c) all mobile defects from the audit fixed, then Phase 2: (d) remote stop on endSession, (e) pi-agent adapter (research-gated), (f) adapter-side output truncation.

**Context:** the Local Agent Bridge (tokens, relay, API, `apps/bridge-cli`, `/bridge` page) is merged. Approval requests from agents are currently treated as notifications → the turn stalls. The web entry is a `/bridge` page; the owner wants a first-class "Local Agent" section.

## Global Constraints
- No `any`; magic numbers ≠ -1/0/1 named; files ≤299 lines; functions ≤50 lines; eslint gates (consistent-return/complexity/max-lines-per-function) + tailwind checker (no template-literal className interpolation); `pnpm dlx ultracite fix` before commit; conventional commits; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; branch dev.
- The web copy of the normalized event union (`apps/web/src/components/bridge/bridge-events.ts`) MUST stay field-for-field identical to `apps/bridge-cli/src/normalize/types.ts` (both carry sync comments).
- Protocol shapes for real agent binaries may be assumptions — flag inline with the existing convention.
- NO page-header title/description boilerplate on web pages. UI kit components only.

---

### Task 1: CLI approval plumbing

**Files:**
- Modify `apps/bridge-cli/src/normalize/types.ts` (add approval event kind), `apps/bridge-cli/src/adapters/types.ts` (AgentHandle.answerApproval), `apps/bridge-cli/src/adapters/jsonrpc-io.ts` (server-initiated request handling), `apps/bridge-cli/src/adapters/{claude-code,codex,opencode}.ts`, `apps/bridge-cli/src/relay-client.ts` (route approval commands)
- Tests: extend the per-adapter tests + relay-client tests.

**Design:**
- New normalized event: `{ kind: "approval"; requestId: string; title: string; detail?: string; options: { id: string; label: string }[] }`.
- `AgentHandle` gains `answerApproval(requestId: string, optionId: string): void`.
- All three protocols are "server-initiated request with id → client must reply":
  - **codex (app-server JSON-RPC)**: requests like `execCommandApproval`/`applyPatchApproval` carry an id; reply `{decision: "approved"|"denied"}` → options `[{id:"approved",label:"Allow"},{id:"denied",label:"Deny"}]`. Flag exact method/param names inline as assumptions.
  - **claude-code (stream-json)**: `control_request` frames (`can_use_tool`) with `request_id`; reply is a `control_response` frame on stdin with `behavior: "allow"|"deny"`. Flag shapes inline.
  - **opencode (ACP)**: `session/request_permission` request with options; reply selects an optionId. Flag shapes inline.
- `jsonrpc-io.ts` currently only handles responses/notifications: add an `onRequest(handler)` hook that surfaces server→client requests (id-bearing inbound messages) and a `respond(id, result)` to answer them. Keep pending-map exit-rejection behavior intact.
- Adapters keep a pending-approval map requestId→protocol reply fn; emit the approval event; `answerApproval` looks up and replies (unknown/duplicate requestId → no-op + status event warning). On process exit, clear the map.
- `relay-client.ts` `parseCommandText`: in addition to bare string / `{text}`, accept `{type:"approval", requestId, optionId}` → `handle.answerApproval(...)`. Anything else stays a text send.

**Tests:** per adapter — fake process emits an approval request frame → normalized approval event emitted → answerApproval writes the correct protocol reply frame to stdin (assert exact JSON). relay-client — an approval command from pollCommands routes to answerApproval, not send.

### Task 2: Web approval UI

**Files:**
- Modify `apps/web/src/components/bridge/bridge-events.ts` (sync the approval kind), `event-line.tsx` (approval card), `use-bridge-terminal.ts` or the terminal component (send approval decisions), tests.

**Design:**
- Approval event renders as a visually distinct card: title + optional detail + option buttons (Allow-style primary, Deny-style outline).
- Clicking sends `sendInput({sessionId, data: JSON.stringify({type:"approval", requestId, optionId})})` and locally marks that requestId answered (buttons disable, show chosen label) — keep answered-state in the feed store keyed by requestId.
- Timeline: an already-answered approval arriving via replay must render disabled (dedupe by requestId in the answered set is client-session-local; acceptable).

**Tests:** jsdom — approval event renders options; click → sendInput called with the exact JSON payload + buttons disable; replayed approval after answering stays disabled.

### Task 3: Local Agent IA — sidebar entry, add flow, detail page

**Files:**
- Modify sidebar nav (where the current Bridge item lives) → rename to "Local Agent" with a fitting lucide icon (e.g. TerminalSquare).
- Create `apps/web/src/routes/local-agents.index.tsx` (list) + `apps/web/src/routes/local-agents.$sessionId.tsx` (detail); move/reuse the existing `apps/web/src/components/bridge/*` components; delete or redirect `apps/web/src/routes/bridge.index.tsx` to `/local-agents`.

**Design:**
- **List page**: cards/rows of the user's bridge sessions (agentKind icon, label, status live/idle/ended derived from status+lastSeenAt: live if lastSeenAt < 30s ago — named const; idle otherwise; ended if status=ended), click → detail. Primary "新增 / Add local agent" button → the token flow dialog: name it → create token → show the raw token ONCE + the full ready-to-run CLI command (`better-agent-bridge --agent claude-code --dir . --token bt_… --server <origin>`) with copy buttons — the communication is token-secured, exactly the existing createToken flow, reshaped as "add a local agent". Existing tokens management (list/revoke) stays reachable as a secondary tab/section on the list page.
- **Detail page** (`/local-agents/$sessionId`): status header (agent kind, label, connection state, started at, last seen) + the live terminal (existing component) + End session button. Mobile-first: terminal fits 375px, header wraps.
- Session list auto-refresh stays (existing poll).

**Tests:** reuse/adjust existing bridge page tests for the new routes; add: status derivation (live/idle/ended) unit test; list→detail navigation renders terminal for the right sessionId.

### Task 4: Mobile responsiveness fixes

**Files:** exactly the files named in the audit findings.

**Requirements:** fix ALL findings in `/Users/john/better-agent/.superpowers/sdd/mobile-audit.md` (10 items: 2 Broken, 5 Cramped, 3 Polish), each per its prescribed fix. Highlights: genui Stack flex-wrap; markdown table overflow wrapper in response.tsx; wizard stepper narrow-screen layout; wizard min-h; mcp-tools-preview popover viewport clamp; the rest per the file.

**Tests:** where a fix changes component structure covered by existing tests, keep them green. No new browser tests required (owner tests on a real phone).

### Task 5 (Phase 2): remote stop on endSession

**Files:**
- Modify `packages/api/src/routers/bridge.ts` (endSession also appends a control command), `apps/bridge-cli/src/relay-client.ts` (recognize it), tests both sides.

**Design:** endSession, after flipping DB status, appends `{type:"control", action:"stop"}` to that session's `commands↓`. The CLI's parseCommandText recognizes it → stops polling loops and calls `handle.stop()` (graceful process kill), then exits 0 with a status line. Web detail page: after endSession, show ended state. The CLI should also mark ANY natural agent exit by pushing a final `{kind:"status"}` event ("agent exited") before terminating — if not already.

**Tests:** api — endSession appends the control command; CLI — a control:stop command triggers handle.stop and loop termination (fake transport).

### Task 6 (Phase 2): pi-agent adapter (research-gated)

**Files:** create `apps/bridge-cli/src/adapters/pi.ts` + `apps/bridge-cli/src/normalize/pi.ts` + tests; register in the CLI's agent choices.

**Design:** FIRST research pi-agent's headless/streaming interface (`pi` CLI: check for a print/exec mode with JSON output, e.g. `pi --mode json`/RPC mode — search the web or npm for pi-agent / @mariozechner/pi docs). If a viable stdin/stdout JSON interface exists: implement adapter + normalizer like the other three (spawn, NDJSON→normalized, send, approval if the protocol has it). If NO viable headless interface is found: write the research conclusion to the report, add a stub that errors clearly ("pi-agent has no supported headless mode"), do NOT fake it — and say so in the final summary.

**Tests:** fixtures like other adapters (no real binary).

### Task 7 (Phase 2): adapter-side output truncation

**Files:** modify `apps/bridge-cli/src/normalize.ts` (or a shared helper) + tests.

**Design:** cap any normalized event's text-bearing fields at MAX_EVENT_TEXT_CHARS = 16_000 (named const, safely under the server's 32KB byte cap): truncate with a `… [+N chars truncated]` suffix. Applied uniformly in the normalize pipeline (one helper, all adapters). Long single lines from chatty agents must never trigger the server's BAD_REQUEST rejection.

**Tests:** an over-long output event is truncated with the marker; total serialized size stays under the server cap; short events untouched.
