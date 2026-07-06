# Claude Agent SDK — Full Configuration Surface for `claude-code`

> **Authoritative source:** installed type definitions for
> `@anthropic-ai/claude-agent-sdk@0.3.201`
> (`…/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, 6764 lines).
> All line numbers below are 1-indexed offsets into that file and were read directly.
> SDK version: **0.3.201**. Cross-check against
> `https://docs.claude.com/en/api/agent-sdk/query` was attempted but the
> `web_search` tool was unavailable in this run; the SDK types are the
> authoritative source the task named and were read in full.

## Summary

The SDK exposes one `query({ prompt, options })` entry point
(`sdk.d.ts:~2533`) whose `options` argument is the `Options` type
(`sdk.d.ts:~1282`). `Options` carries **63 fields** that together control
model, permissions, system prompt, tools, MCP servers, thinking/effort,
budget, hooks, skills, settings cascade, and process/transport behavior.
The returned `Query` async-generator additionally exposes **runtime
control methods** (`setModel`, `setPermissionMode`, `setMaxThinkingTokens`,
`applyFlagSettings`, `setMcpServers`, …) that mutate a **subset** of
config mid-session. Everything not reachable through a `Query` method is
**startup-only** (set once at `query()` time).

> ⚠️ **Naming note:** There is **no type named `AgentOptions`** in this SDK
> version. The task referenced "AgentOptions (~line 40-100)" — that range
> actually contains `AgentDefinition` (the per-subagent config type,
> `sdk.d.ts:56–127`) and `AgentInfo`. `AgentDefinition` is documented below
> in full as the closest analog. If your UI needs a literal `AgentOptions`,
> map it onto `AgentDefinition`.

---

## 1. The `Options` type — every field (query-time options)

`export declare type Options = { … }` — declared at **`sdk.d.ts:~1282`**,
field list runs through **`sdk.d.ts:~2013`**.

`startup_vs_live` legend:
- **STARTUP** — only settable at `query()` time. Changing it requires a new `query()` call (new subprocess).
- **LIVE** — mutable mid-session via a `Query` method (or, for some, via `applyFlagSettings`).
- **STARTUP (+flag)** — startup-set on `Options`, but the *equivalent* `Settings` key can be flipped live via `Query.applyFlagSettings()` (flag-settings tier).

### 1a. Conversation / model / reasoning

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `model` | `string` | model ID/alias e.g. `'claude-sonnet-5'`, `'opus'`, `'claude-fable-5'` | Claude model to use (defaults to CLI default). | STARTUP → **LIVE** via `Query.setModel()` |
| `fallbackModel` | `string` | comma-separated list; primary re-tried each turn | Fallback model(s) tried in order when primary overloaded/unavailable. | STARTUP |
| `thinking` | `ThinkingConfig` | `{ type:'adaptive', display? } \| { type:'enabled', budgetTokens?, display? } \| { type:'disabled' }` | Controls thinking/reasoning; overrides deprecated `maxThinkingTokens`. | STARTUP |
| `effort` | `EffortLevel` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | Reasoning effort depth (default `'high'`). | STARTUP (+flag; `Settings.effortLevel`) |
| `maxThinkingTokens` | `number` | integer | Max tokens for thinking. **@deprecated** — use `thinking`. On Opus 4.6 treated as on/off. | STARTUP → **LIVE** via `Query.setMaxThinkingTokens()` |
| `maxTurns` | `number` | integer | Max conversation turns before query stops (`error_max_turns`). | STARTUP |
| `maxBudgetUsd` | `number` | USD float | Max spend; stops with `error_max_budget_usd` if exceeded. | STARTUP |
| `taskBudget` | `{ total: number }` | token count | API-side task budget (beta header `task-budgets-2026-03-13`). **@alpha** | STARTUP |
| `outputFormat` | `OutputFormat` | `{ type:'json_schema', schema: Record<string,unknown> }` | Structured-output schema for agent responses. | STARTUP |

### 1b. Permissions / safety

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `permissionMode` | `PermissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk' \| 'auto'` (6 values) | How tool executions are handled. | STARTUP → **LIVE** via `Query.setPermissionMode()` |
| `allowDangerouslySkipPermissions` | `boolean` | `true` required when `permissionMode:'bypassPermissions'` | Safety ack to bypass permission checks. | STARTUP |
| `canUseTool` | `CanUseTool` | `(toolName, input, options) => Promise<PermissionResult \| null>` | Custom per-tool permission callback (before each tool exec). | STARTUP (callback) |
| `permissionPromptToolName` | `string` | MCP tool name | Route permission requests through this MCP tool. | STARTUP |
| `planModeInstructions` | `string` | free text | Replaces default plan-mode workflow body (only when `permissionMode:'plan'`). | STARTUP |
| `sandbox` | `SandboxSettings` | see §5 | Command-execution sandbox (fs/network/credentials isolation). | STARTUP (+flag) |
| `additionalDirectories` | `string[]` | absolute paths | Extra dirs Claude can access beyond cwd. | STARTUP (+flag via `permissions.additionalDirectories`) |

### 1c. Tools

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `tools` | `string[] \| { type:'preset'; preset:'claude_code' }` | tool-name list, `[]` (all off), or preset | Base set of **available** built-in tools. | STARTUP |
| `allowedTools` | `string[]` | tool names | Tools **auto-allowed** without prompting (does not restrict availability — use `tools` for that). Passing `'Skill'` is deprecated → use `skills`. | STARTUP (+flag via `permissions.allow`) |
| `disallowedTools` | `string[]` | tool names (`mcp__server`, `mcp__server__*`, `mcp__*` patterns supported) | Tools removed from model context entirely. | STARTUP (+flag via `permissions.deny`) |
| `toolAliases` | `Record<string,string>` | `{ Bash: 'mcp__workspace__bash' }` | Redirect model-emitted tool names before resolution (single-hop). | STARTUP |
| `toolConfig` | `ToolConfig` | `{ askUserQuestion?: { previewFormat?: 'markdown' \| 'html' } }` | Per-tool config for built-in tools. | STARTUP |

### 1d. System prompt & skills

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `systemPrompt` | `string \| string[] \| { type:'preset'; preset:'claude_code'; append?: string; excludeDynamicSections?: boolean }` | custom string; array with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker for cache split; preset (+append); preset (+`excludeDynamicSections` to strip per-user dynamic sections) | System prompt config. | STARTUP |
| `skills` | `string[] \| 'all'` | skill names, `plugin:skill`, or `'all'`; omit for CLI defaults | Context filter of skills to enable (single place to turn skills on). | STARTUP (rescan via `Query.reloadSkills()`) |
| `settingSources` | `SettingSource[]` | subset of `['user','project','local']`; `[]` = SDK isolation | Which filesystem settings to load. Must include `'project'` to load CLAUDE.md. | STARTUP |
| `plugins` | `SdkPluginConfig[]` | `[{ type:'local', path:string, skipMcpDiscovery?: boolean }]` | Load local plugins. | STARTUP (reload via `Query.reloadPlugins()`) |

### 1e. MCP servers

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `mcpServers` | `Record<string, McpServerConfig>` | keys=server names; values = stdio/sse/http/sdk config (incl. `createSdkMcpServer()` results) | MCP server configurations. **SDK MCP servers** (in-process, built via `createSdkMcpServer()` / `tool()`) are passed here, NOT via a separate `sdkMcpServers` Options field. | STARTUP → **LIVE** via `Query.setMcpServers()`, `toggleMcpServer()`, `reconnectMcpServer()` |
| `strictMcpConfig` | `boolean` | `true`/`false` | Ignore all non-option MCP sources (`.mcp.json`, settings, plugins, agent frontmatter). Maps to `--strict-mcp-config`. | STARTUP |

> Note on `sdkMcpServers`: it appears only on the internal
> `SDKControlInitializeRequest` (`sdk.d.ts:~3230`) as `sdkMcpServers?: string[]`
> (server names). SDK consumers create in-process servers with
> `createSdkMcpServer({ name, version?, tools?, alwaysLoad? })`
> (`sdk.d.ts:~460`) and pass the result through `Options.mcpServers`.

### 1f. Hooks & event streaming

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | keys = 30 hook events; `{ matcher?, hooks: HookCallback[], timeout? }` | JS hook callbacks (vs shell-command hooks in `Settings.hooks`). | STARTUP (also LIVE via `Settings.hooks` in `applyFlagSettings`) |
| `includeHookEvents` | `boolean` | default `false` | Emit `hook_started`/`hook_progress`/`hook_response` system messages. SessionStart & Setup always emitted. | STARTUP |
| `includePartialMessages` | `boolean` | default off | Emit `SDKPartialAssistantMessage` streaming events. | STARTUP |
| `forwardSubagentText` | `boolean` | default off | Forward subagent text/thinking blocks (full nested transcript) with `parent_tool_use_id`. | STARTUP |
| `onElicitation` | `OnElicitation` | `(request, {signal}) => Promise<ElicitationResult>` | Handle MCP elicitation (form/URL) requests; auto-declined if absent. | STARTUP (callback) |
| `onUserDialog` | `OnUserDialog` | `(request, {signal}) => Promise<UserDialogResult>` | Render blocking `request_user_dialog` dialogs. | STARTUP (callback) |
| `supportedDialogKinds` | `string[]` | dialog_kind values e.g. `'refusal_fallback_prompt'` | Which dialog kinds your `onUserDialog` can render (requires `onUserDialog`). | STARTUP |
| `stderr` | `(data: string) => void` | callback | Capture Claude Code process stderr. | STARTUP (callback) |
| `debug` | `boolean` | `true`/`false` | Verbose debug logging (`--debug`). | STARTUP |
| `debugFile` | `string` | file path | Write debug logs to file (implies `debug`). | STARTUP |
| `promptSuggestions` | `boolean` | `true`/`false` | Emit a predicted next-prompt `prompt_suggestion` after each turn. | STARTUP |
| `agentProgressSummaries` | `boolean` | default off | Periodic AI progress summaries for subagents (`task_progress.summary`). | STARTUP |

### 1g. Session lifecycle / resume

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `resume` | `string` | session UUID | Session to resume (loads history). Mutually exclusive with `continue`. | STARTUP |
| `continue` | `boolean` | `true`/`false` | Resume most recent conversation in cwd. Mutually exclusive with `resume`. | STARTUP |
| `sessionId` | `string` | valid UUID | Use a specific session ID; needs `forkSession` to combine with `resume`/`continue`. | STARTUP |
| `forkSession` | `boolean` | `true`/`false` | Resumed session forks to a new ID instead of continuing. | STARTUP |
| `resumeSessionAt` | `string` | message UUID (`SDKAssistantMessage.uuid`) | Resume only up to & including this message. | STARTUP |
| `title` | `string` | free text | Custom new-session title (ignored on resume; use `renameSession()`). | STARTUP |
| `persistSession` | `boolean` | default `true` | Persist session to disk (disable for ephemeral). | STARTUP |
| `cwd` | `string` | path | Working directory (default `process.cwd()`). | STARTUP |
| `enableFileCheckpointing` | `boolean` | `true`/`false` | Track file changes for `Query.rewindFiles()`. | STARTUP |
| `betas` | `SdkBeta[]` | `['context-1m-2025-08-07']` | Enable beta features. | STARTUP |

### 1h. Settings cascade

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `settings` | `string \| Settings` | settings object or path to settings JSON | Flag-tier settings (highest user-controlled priority). Equivalent to `--settings`. | STARTUP → **LIVE** via `Query.applyFlagSettings()` |
| `managedSettings` | `Settings` | settings object (restrictive-only filtered) | Policy-tier settings from spawning parent (below managed policy tier on disk). | STARTUP |
| `settingSources` | `SettingSource[]` | `'user' \| 'project' \| 'local'`; `[]` = isolation | (also in §1d) Which filesystem settings to load. | STARTUP |

### 1i. Process / transport / agents

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `agent` | `string` | agent name (must be in `agents` or settings) | Agent for the main thread (≡ `--agent`). Applies its prompt/tools/model. | STARTUP |
| `agents` | `Record<string, AgentDefinition>` | name → definition | Define custom subagents (see §2). | STARTUP |
| `env` | `{ [envVar: string]: string \| undefined }` | env map (**replaces** `process.env`; spread it yourself) | Subprocess env. Set `CLAUDE_AGENT_SDK_CLIENT_APP` for UA. | STARTUP |
| `executable` | `'bun' \| 'deno' \| 'node'` | runtime | JS runtime (auto-detected if omitted). | STARTUP |
| `executableArgs` | `string[]` | args | Extra args to the JS runtime. | STARTUP |
| `extraArgs` | `Record<string, string \| null>` | arg name → value (`null` for boolean flags) | Extra CLI args to Claude Code. | STARTUP |
| `pathToClaudeCodeExecutable` | `string` | path | Path to Claude Code executable (built-in if omitted). | STARTUP |
| `spawnClaudeCodeProcess` | `(options: SpawnOptions) => SpawnedProcess` | callback | Custom process spawn (VMs/containers/remote). | STARTUP (callback) |
| `abortController` | `AbortController` | controller | Cancel the query; on abort it stops & cleans up. | LIVE (abort mid-run) |

### 1j. Session store (transcript mirroring) — `@alpha`

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `sessionStore` | `SessionStore` | adapter (`append`, `load`, `listSessions?`, …) | Mirror transcripts to external store (dual-write). Cannot combine with `persistSession:false`. | STARTUP |
| `sessionStoreFlush` | `SessionStoreFlush` | `'batched' \| 'eager'` | Flush cadence for the store. | STARTUP |
| `loadTimeoutMs` | `number` | ms (default `60000`) | Timeout for store `load()`/`listSubkeys()` during resume. | STARTUP |

**Total `Options` fields: 63** (including `taskBudget` @alpha).

---

## 2. `AgentDefinition` — per-subagent config (the "AgentOptions" analog)

`export declare type AgentDefinition = { … }` at **`sdk.d.ts:56–127`**.
Passed via `Options.agents: Record<string, AgentDefinition>`.

| Field | TS type | Allowed values / shape | Purpose | startup-vs-live |
|---|---|---|---|---|
| `description` (req) | `string` | natural language | When to use this subagent. | STARTUP |
| `prompt` (req) | `string` | system prompt text | The agent's system prompt. | STARTUP |
| `tools` | `string[]` | tool names; omit = inherit all | Allowed tool names. (`'Skill'` deprecated → use `skills`.) | STARTUP |
| `disallowedTools` | `string[]` | tool names incl. `mcp__server` / `mcp__*` | Explicitly disallowed tools. | STARTUP |
| `model` | `string` | alias (`'opus'`,`'sonnet'`,…) or full ID; omit/`'inherit'` = main model | Model for this agent. | STARTUP |
| `mcpServers` | `AgentMcpServerSpec[]` | `string \| Record<string, McpServerConfigForProcessTransport>` | MCP servers scoped to this agent. | STARTUP |
| `skills` | `string[]` | skill names | Skills preloaded into agent context. | STARTUP |
| `initialPrompt` | `string` | text (slash commands processed) | Auto-submitted first user turn when agent is main-thread; prepended to user prompt. | STARTUP |
| `maxTurns` | `number` | integer | Max agentic turns (API round-trips). | STARTUP |
| `background` | `boolean` | `true`/`false` | Run as non-blocking fire-and-forget background task. | STARTUP |
| `memory` | `'user' \| 'project' \| 'local'` | scope | Auto-load agent memory files scope. | STARTUP |
| `effort` | `('low'\|'medium'\|'high'\|'xhigh'\|'max') \| number` | named level or integer | Reasoning effort for this agent. | STARTUP |
| `permissionMode` | `PermissionMode` | same 6 values | Permission mode for this agent. | STARTUP |
| `observer` | `string` | agent type name | Auto-spawned read-only background observer receiving activity digests. | STARTUP |
| `observerMessage` | `string` | free text | Supplemental postamble appended to each observer digest. | STARTUP |
| `criticalSystemReminder_EXPERIMENTAL` | `string` | free text | Experimental critical reminder added to system prompt. | STARTUP |

`AgentInfo` (`sdk.d.ts:129–140`) is the read-only companion returned by
`Query.supportedAgents()`: `{ name, description, model? }`.

---

## 3. `Query` interface — runtime (LIVE) control methods

`export declare interface Query extends AsyncGenerator<SDKMessage, void>` at
**`sdk.d.ts:~2238`**. Only in **streaming input mode**. These are what make a
config field "live-switchable."

### 3a. Live configuration mutation

| Method | Signature | What it changes live |
|---|---|---|
| `setModel` | `(model?: string) => Promise<void>` | Switch model for subsequent turns (`SDKControlSetModelRequest`). |
| `setPermissionMode` | `(mode: PermissionMode) => Promise<void>` | Switch permission mode — all 6 values. |
| `setMcpPermissionModeOverride` | `(serverName, mode: 'default'\|'auto'\|null) => Promise<{warning?}>` | Tighten-only per-MCP-server mode override (can never widen privilege). |
| `setMaxThinkingTokens` | `(maxThinkingTokens: number\|null, thinkingDisplay?: 'summarized'\|'omitted'\|null) => Promise<void>` | Set/clear thinking-token budget (deprecated; use `thinking` at query time). |
| `applyFlagSettings` | `(settings: Partial<Settings, null>) => Promise<void>` | **Powerful:** shallow-merge any `Settings` key into the flag tier mid-session. Pass `null` to clear a key. |
| `setMcpServers` | `(servers: Record<string, McpServerConfig>) => Promise<McpSetServersResult>` | Replace the set of dynamically-added MCP servers (add/remove). |
| `toggleMcpServer` | `(serverName, enabled) => Promise<void>` | Enable/disable an MCP server. |
| `reconnectMcpServer` | `(serverName) => Promise<void>` | Reconnect a failed/disconnected server. |
| `reloadPlugins` | `() => Promise<SDKControlReloadPluginsResponse>` | Reload plugins from disk → refreshed commands/agents/MCP. |
| `reloadSkills` | `() => Promise<SDKControlReloadSkillsResponse>` | Reload skills from disk. |
| `interrupt` | `() => Promise<void>` | Stop the current query execution. |

> **`applyFlagSettings` is the broadest live lever.** Any top-level
> `Settings` key (model, permissions, hooks, skillOverrides, effortLevel,
> alwaysThinkingEnabled, etc.) can be flipped mid-session through it. UIs that
> want a "settings panel" mapped to live mutation should target
> `applyFlagSettings` for most `Settings` keys, and the dedicated methods
> (`setModel`, `setPermissionMode`, …) where they exist.

### 3b. Runtime read-only / introspection methods (not config mutation)

`initializationResult`, `reinitialize`, `supportedCommands`,
`supportedModels`, `supportedAgents`, `mcpServerStatus`, `getContextUsage`,
`usage_EXPERIMENTAL…`, `readFile`, `accountInfo`, `rewindFiles`,
`seedReadState`, `streamInput`, `stopTask`, `backgroundTasks`, `close`.
These read state or drive the conversation; they don't change startup config.

---

## 4. Startup-vs-live determination rule (for building a Settings UI)

A field is **LIVE-switchable** iff one of these holds:
1. There is a dedicated `Query` method (`setModel`, `setPermissionMode`,
   `setMaxThinkingTokens`, `setMcpServers`, `toggleMcpServer`,
   `reconnectMcpServer`, `setMcpPermissionModeOverride`, `reloadPlugins`,
   `reloadSkills`).
2. It is a `Settings` key reachable via `applyFlagSettings()`.
   - Note: `applyFlagSettings` operates on the **flag tier**; it does not
     rewrite the on-disk `user/project/local` files. For persistence, write
     the corresponding settings JSON file directly (and reload sources, which
     requires a new `query()`).

Everything else on `Options` (env, executable, cwd, resume/continue,
abortController, callbacks like `canUseTool`/`onElicitation`/`spawnClaudeCodeProcess`,
`betas`, `settingSources`, `maxTurns`, `maxBudgetUsd`, `tools`/`allowedTools`
arrays as such, `systemPrompt`, `agents`, `agent`) is **STARTUP-only**.

---

## 5. Key supporting types

### `PermissionMode` (`sdk.d.ts:~2080`)
```ts
'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'
```
- `default` — standard; prompts for dangerous ops.
- `acceptEdits` — auto-accept file edits.
- `bypassPermissions` — bypass all (requires `allowDangerouslySkipPermissions`).
- `plan` — planning mode; no tool execution.
- `dontAsk` — deny if not pre-approved (no prompts).
- `auto` — model classifier approves/denies prompts.

In `Settings.permissions.defaultMode`, `'manual'` is accepted as an alias for
`'default'`, and `disableBypassPermissionsMode: 'disable'` /
`disableAutoMode: 'disable'` can forbid two of these modes.

### `EffortLevel` (`sdk.d.ts:~445`)
```ts
'low' | 'medium' | 'high' | 'xhigh' | 'max'
```
`'high'` is the default. `'xhigh'`/`'max'` are model-gated (Fable 5, Opus 4.6/4.7+, Sonnet 4.6/5).

### `ThinkingConfig` (`sdk.d.ts:~6560`)
```ts
{ type:'adaptive', display?: 'summarized'|'omitted' }   // Opus 4.6+, default when supported
| { type:'enabled', budgetTokens?: number, display?: 'summarized'|'omitted' }  // fixed budget
| { type:'disabled' }                                    // off
```

### `systemPrompt` shapes (`sdk.d.ts:~1925`)
- `string` — custom prompt.
- `string[]` — blocks; include `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
  (`'__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'`, `sdk.d.ts:~6650`) to split
  static-cacheable prefix from dynamic suffix.
- `{ type:'preset', preset:'claude_code' }` — default prompt.
- `{ type:'preset', preset:'claude_code', append: string }` — default + appended instructions.
- `{ type:'preset', preset:'claude_code', excludeDynamicSections: true }` —
  strip per-user dynamic sections (cwd/memory/git) for cross-user prompt
  caching; re-injected as first user message.

### `SettingSource` (`sdk.d.ts:~6425`)
```ts
'user' | 'project' | 'local'
```
Resolution precedence (low→high): user → project → local → **flag**
(`Options.settings`/`--settings`) → **managed/policy** (admin tiers:
managed-settings.json, remote cache, MDM plist/registry, `managedSettings`).
`ResolvedSettingSource` adds `'managed' | 'flag'` (`sdk.d.ts:~2400`).

### `McpServerConfig` union (`sdk.d.ts:~1017`)
```ts
McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance
```
- `stdio`: `{ type?:'stdio', command, args?, env?, timeout?, alwaysLoad? }`
- `sse`: `{ type:'sse', url, headers?, tools?, timeout?, alwaysLoad? }`
- `http`: `{ type:'http', url, headers?, tools?, timeout?, alwaysLoad? }`
- SDK (in-process): produced by `createSdkMcpServer({ name, version?, instructions?, tools?, alwaysLoad? })` (`sdk.d.ts:~460`).

### `SandboxSettings` (`sdk.d.ts:~2580`, Zod-inferred)
Top-level: `enabled?`, `failIfUnavailable?`, `autoAllowBashIfSandboxed?`,
`allowUnsandboxedCommands?`, `network?`, `filesystem?`, `credentials?`,
`ignoreViolations?`, `enableWeakerNestedSandbox?`, `enableWeakerNetworkIsolation?`,
`allowAppleEvents?`, `excludedCommands?`, `ripgrep?`, `bwrapPath?`, `socatPath?`.
(`network` includes `allowedDomains`, `deniedDomains`, `allowManagedDomainsOnly`,
`allowUnixSockets`, `allowAllUnixSockets`, `allowLocalBinding`, `allowMachLookup`,
`httpProxyPort`, `socksProxyPort`, `tlsTerminate`. `filesystem` includes
`allowWrite`, `denyWrite`, `denyRead`, `allowRead`, `allowManagedReadPathsOnly`.)

### `HookEvent` (`sdk.d.ts:~637`) — 30 events
`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`,
`Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`,
`SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`,
`PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`,
`Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`,
`ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`,
`InstructionsLoaded`, `CwdChanged`, `FileChanged`, `MessageDisplay`.

---

## 6. `Settings` — the on-disk / flag configuration object (auto-generated)

`export declare interface Settings` at **`sdk.d.ts:~4649`** (auto-generated
from the settings JSON schema; mark "AUTO-GENERATED - DO NOT EDIT").
This is the full user/admin configuration surface that also feeds
`Options.settings` / `Options.managedSettings` and `applyFlagSettings`.

### 6a. SDK-relevant `Settings` keys (most useful for a Settings UI)

| Key | Type (short) | Purpose | Live via applyFlagSettings? |
|---|---|---|---|
| `model` | `string` | Override default model. | Yes (prefer `setModel`) |
| `fallbackModel` | `string[]` | Ordered fallback list. | Yes |
| `permissions` | `{ allow?, deny?, ask?, defaultMode?, disableBypassPermissionsMode?, additionalDirectories? }` | Tool permission rules + default mode. | Yes (defaultMode prefer `setPermissionMode`) |
| `env` | `{ [k:string]: string }` | Session env vars. | Yes |
| `hooks` | `{ [event]: { matcher?, hooks: HookDef[] }[] }` | Shell/command/prompt/agent/http/mcp_tool hooks per event. | Yes |
| `sandbox` | `SandboxSettings` | Sandbox config. | Yes |
| `includeGitInstructions` | `boolean` | Commit/PR workflow instructions in system prompt (default true). | Yes |
| `outputStyle` | `string` | Assistant response output style. | Yes |
| `alwaysThinkingEnabled` | `boolean` | Thinking on/off for supported models. | Yes |
| `effortLevel` | `'low'\|'medium'\|'high'\|'xhigh'` | Persisted effort. | Yes (prefer `thinking`/`effort`) |
| `ultracode` | `boolean` | xhigh + standing orchestration. Session-scoped. | Yes |
| `autoCompactEnabled` | `boolean` | Auto-compact on context fill. | Yes |
| `autoCompactWindow` | `number` | Auto-compact window size. | Yes |
| `fastMode` | `boolean` | Enable fast mode. | Yes |
| `promptSuggestionEnabled` | `boolean` | Prompt suggestions toggle. | Yes |
| `skillOverrides` | `{ [skill]: 'on'\|'name-only'\|'user-invocable-only'\|'off' }` | Per-skill listing visibility. | Yes |
| `disableBundledSkills` | `boolean` | Remove bundled skills/workflows. | Yes |
| `enabledPlugins` | `{ [plugin@marketplace]: bool\|string[]\|object }` | Enable plugins (precedence user<project<local<flag<policy). | Yes |
| `cleanupPeriodDays` | `number` | Transcript retention days (default 30). | Yes |
| `apiKeyHelper` / `awsCredentialExport` / `gcpAuthRefresh` / `otelHeadersHelper` | `string` | Auth helper scripts. | Yes |
| `additionalDirectories` (via `permissions`) | — | Extra accessible dirs. | Yes |

### 6b. Enterprise / managed-only `Settings` keys (read from managed/policy tier)
`availableModels`, `enforceAvailableModels`, `modelOverrides`,
`allowedMcpServers`, `deniedMcpServers`, `allowManagedHooksOnly`,
`allowManagedPermissionRulesOnly`, `allowManagedMcpServersOnly`,
`allowAllClaudeAiMcps`, `strictPluginOnlyCustomization`,
`strictKnownMarketplaces`, `blockedMarketplaces`, `disableSideloadFlags`,
`parentSettingsBehavior`, `forceLoginMethod`, `forceLoginOrgUUID`,
`forceRemoteSettingsRefresh`, `disableClaudeAiConnectors`,
`requiredMinimumVersion`, `requiredMaximumVersion`,
`policyHelper`, `claudeMd`, `pluginSuggestionMarketplaces`,
`pluginTrustMessage`. These are typically **not** user-editable in a UI;
surface as read-only/locked where present.

### 6c. UI/display-only `Settings` keys (terminal/visual, lower priority for an SDK Settings UI)
`theme`, `editorMode` (`'normal'\|'vim'`), `verbose`, `viewMode`, `defaultView`,
`language`, `tui` (`'default'\|'fullscreen'`), `voice`, `spinnerVerbs`,
`spinnerTipsOverride`, `preferredNotifChannel`, `showThinkingSummaries`,
`terminalProgressBarEnabled`, `todoFeatureEnabled`, `teammateMode`,
`autoScrollEnabled`, `prefersReducedMotion`, `statusLine`, `subagentStatusLine`,
`footerLinksRegexes`, `prUrlTemplate`, `attribution`, `includeCoAuthoredBy`,
`respectGitignore`, `syntaxHighlightingDisabled`, `terminalTitleFromRename`,
`companyAnnouncements`, `autoUpdatesChannel`, `minimumVersion`.

---

## 7. How it all wires together (for the Settings UI)

1. **Startup knobs** → `Options` (§1). Build the `Options` object once and
   pass to `query({ prompt, options })`. Fields like `model`,
   `permissionMode`, `systemPrompt`, `tools`/`allowedTools`,
   `disallowedTools`, `mcpServers`, `thinking`/`effort`/`maxThinkingTokens`,
   `maxTurns`, `maxBudgetUsd`, `skills`, `settingSources`, `hooks`,
   `includePartialMessages`, `resume`/`continue`, `cwd`, `agents`/`agent`
   are the primary user-facing ones.
2. **On-disk config** → `Settings` (§6), layered across `user/project/local`
   + `flag` + `managed`. `Options.settings` injects a flag-tier object;
   `Options.settingSources` selects which on-disk tiers load.
3. **Live changes** during a session → `Query` methods (§3a): dedicated
   setters for model/permission/thinking/MCP, and `applyFlagSettings()`
   for everything else that lives in `Settings`.
4. **Introspection for UI population** → `Query.supportedModels()`,
   `supportedAgents()`, `supportedCommands()`, `mcpServerStatus()`,
   `getContextUsage()`, `initializationResult()`.

---

## Sources

- **Kept:** `node_modules/.../@anthropic-ai/claude-agent-sdk/sdk.d.ts` (v0.3.201) —
  the authoritative type definitions, read in full (6764 lines). Cited ranges:
  `AgentDefinition` 56–127; `AgentInfo` 129–140; `EffortLevel` ~445;
  `Options` ~1282–2013; `PermissionMode` ~2080; `Query` interface ~2238–2540;
  `query()` function ~2533; `SDKControlInitializeRequest` (sdkMcpServers)
  ~3230; `Settings` interface ~4649–6423; `SettingSource` ~6425;
  `ThinkingConfig` variants ~6560; `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` ~6650.
- **Not fetched:** `https://docs.claude.com/en/api/agent-sdk/query` —
  `web_search` tool was unavailable in this run. SDK types are the
  authoritative source named by the task and were read in full.

## Gaps

- **No live web cross-check** against the docs URL (no `web_search` tool).
  Recommend a follow-up fetch of `https://docs.claude.com/en/api/agent-sdk/query`
  to confirm any fields the docs document that are *not* in the installed
  type defs (e.g., newer preview fields).
- **`AgentOptions` does not exist** in this SDK version. If an upstream
  spec expects it, confirm whether it means `AgentDefinition` or a renamed
  type in a newer SDK. Flagged to supervisor-worthy attention only if the
  UI codegen assumes the name `AgentOptions`.
- **`applyFlagSettings` coverage is "any `Settings` key"** but the docs
  don't enumerate exactly which `Settings` keys take effect mid-turn vs.
  require a fresh session (e.g., `env`, `settingSources`,
  `cleanupPeriodDays` are unlikely to hot-swap meaningfully). Treat
  dedicated `Query` setters as authoritative for live mutation and use
  `applyFlagSettings` for the documented-flag-tier keys (model,
  permissions, hooks, skillOverrides, effort, thinking toggles).
- The `taskBudget` field is **@alpha** and may change.

## Supervisor coordination
No decision needed. `AgentOptions` naming discrepancy flagged in Gaps; returning the completed research brief normally.
