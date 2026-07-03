# Tool Search + Deferred Binding(按需装配)— design spec

**Goal:** An agent with many tools (composio + MCP) stops paying prompt tokens for tools it doesn't use. Above a threshold, bulky tool schemas are NOT sent to the model; the model gets a `search_tools` meta-tool, finds what it needs, and the hits become active for the rest of the turn. Secondary: users can curate a per-agent tool allowlist in the wizard (coarse waste cut at the source).

## Verified mechanics
- Assembly: `packages/api/src/routers/agent-tool-defs.ts` `assembleAgentToolDefs` → full `ToolDef[]` per turn → `runtime.runTurn({tools})` → `streamText`.
- AI SDK v6: `streamText({ tools, prepareStep })` — `prepareStep` may return `{ activeTools }` per step; **inactive tools' schemas are not sent to the provider** but remain executable/registered. This gives per-step dynamic exposure with zero custom-loop surgery.
- Prompt caching note: the tool block is the topmost cache prefix — growing the active set mid-turn invalidates that turn's later-step cache. Acceptable: still ≪ always sending N schemas; across turns the active set resets to core → stable prefix → good caching.

## Design

### 1. Deferral marking (packages/agent + api)
- `ToolDef` gains optional `defer?: boolean`.
- `agent-tool-defs.ts` marks **composio + MCP** defs `defer: true`. Builtin, board, remote(client), StructuredOutput stay always-active (small and/or protocol-critical).

### 2. Runtime deferred mode (packages/agent/src/tool/tool-search.ts + session/runtime.ts)
- `DEFER_THRESHOLD = 12`: if `defs.filter(d => d.defer).length > 12`, runtime enters deferred mode; otherwise behavior is byte-identical to today.
- Deferred mode:
  - active set = non-defer defs + `search_tools`.
  - `search_tools(query: string)` (server tool): keyword-scores the DEFERRED defs — tokenized match on name (weight 3) + description (weight 1) — returns top `SEARCH_TOP_K = 8` as `name — first sentence of description`, and **adds them to the active set**. Response text tells the model "these tools are now available; call them directly."
  - `prepareStep` returns `{ activeTools: [...active] }` (recomputed each step; set only grows within a turn).
  - `search_tools` description instructs the model when to reach for it ("more tools exist than you can see; search before claiming a capability is missing").
- Tests: scoring unit tests; runtime loop test (Mock model calls `search_tools` → hit becomes callable next step → executes).

### 3. Per-agent tool allowlist (db + api + web)
- `agents.tool_allowlist` jsonb `string[] | null` (null = all tools of linked sources). Migration.
- Assembly filters composio/MCP defs by the allowlist (when non-null) BEFORE deferral logic. Builtin picking already exists separately.
- Zod: `toolAllowlist: z.array(z.string()).nullable().default(null)` on agents create/update; round-trips through AgentConfig/AgentInput/store/fakes.
- Wizard Tools step: after picking composio account / MCP servers, an optional "Limit tools" picker — fetches live tool lists (`composio.tools({accountId})`, `mcp.tools({serverId})`), grouped checkboxes, "All tools" default (null). Stored flat as tool names.

### 4. Out of scope
Embedding-based retrieval (keyword is enough for SCREAMING_SNAKE tool names; upgrade later), per-toolkit gateway tools, tool-result memoization.

## Tasks
1. agent: ToolDef.defer + tool-search.ts (scoring + search tool + active-set manager) + runtime prepareStep wiring + tests.
2. api: mark defer on composio/MCP defs; allowlist filter in assembly; agents router allowlist input; migration `agents.tool_allowlist` + store/fakes.
3. web: wizard "Limit tools" picker + form model. (UI subagent)

## Global constraints
No `any`; magic numbers only -1/0/1; files ≤300; functions ≤50; deps pinned; drizzle migrations. Work on dev.
