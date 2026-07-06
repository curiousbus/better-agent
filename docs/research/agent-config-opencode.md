# opencode Agent/Session Configuration Surface — Reference for Settings UI

> Purpose: enumerate every user-facing configuration knob in [sst/opencode](https://github.com/sst/opencode) so we can design a Settings UI for better-agent's agent platform.
> For each knob: **exact wire name**, **allowed values**, **purpose**, **startup vs live** (set only at config/creation time, or mutable during a session).
> Compiled: 2026-07-06.

---

## How this was compiled (READ FIRST — verification status)

This brief was built from two existing, primary-sourced project research documents (both researched directly from the sst/opencode source tree at the time):

- `docs/research/opencode-research.md` (2026-06-16 deep dive)
- `docs/research/2026-07-02-opencode-gap-refresh.md` (2026-07-02 refresh)

**Critical limitation:** I could not fetch `raw.githubusercontent.com` myself (no web tool available in this run), and the supervisor confirmed that `packages/opencode/src/...` paths currently **404** and the GitHub tree API is **rate-limited**, so live paths could not be enumerated. opencode is a fast-moving repo; several wire names below are therefore **assumptions in our codebase that MUST be verified against current `main` before the Settings UI hard-codes them.**

Every wire name is tagged with a confidence level:

- **[OK]** — corroborated in both project briefs (high confidence).
- **[VERIFY]** — single-source in our briefs, or a codebase assumption. Needs confirmation against current `main` before UI hard-coding.
- **[GUESS]** — inferred from general opencode/ACP knowledge, not present in either brief. Treat as a hypothesis.

The three knobs the supervisor explicitly flagged as codebase assumptions are marked 🔶.

---

## 0. Configuration tiers at a glance

opencode config lives in **three layers**, each with a startup/live split:

| Layer | Where | When set | Example knobs |
|---|---|---|---|
| **File config** | `opencode.json` (project), `opencode.json` (global `~/.config/opencode`), `agents/*.md`, `AGENTS.md` | Startup | model, provider keys, MCP servers, agents, mode permission defaults |
| **ACP session creation** | `session/new` request params | Session startup | cwd, mcpServers, initial model/mode/agent |
| **ACP live methods** | `session/setMode`, `unstable_setSessionModel`, runtime permission responses | Live (mid-session) | mode switch, model switch, allow/deny a tool |

**Settings-UI mapping:** most knobs belong to layer 1 (file config) or layer 2 (session creation). Layer 3 is runtime interaction, surfaced in the better-agent "approval/ask" UI, not the Settings page.

---

## 1. Model selection (`model`, `small_model`, `provider`)

### `model` [OK]
- **Wire name:** `model`
- **Allowed values:** `"<provider>/<model-id>"` string, e.g. `"anthropic/claude-sonnet-4.5"`, `"openai/gpt-4o"`. Also accepts a custom provider id you defined under `provider`.
- **Purpose:** The primary reasoning model for the default/primary agent.
- **Startup vs live:** **Startup** in `opencode.json`; **live** via `unstable_setSessionModel` ACP method (see §6) for a specific session.

### `small_model` [OK]
- **Wire name:** `small_model`
- **Allowed values:** same `"<provider>/<model-id>"` format.
- **Purpose:** Lightweight model used for non-reasoning background work — generating session titles, compaction/summarization. Cheaper/faster than the primary model.
- **Startup vs live:** **Startup only** (no per-session override). better-agent gap doc notes we currently route titler/summarizer through the primary model — this is the knob that would change that.

### `provider` [OK]
- **Wire name:** `provider` (a record keyed by provider id)
- **Allowed values shape:**
  ```jsonc
  "provider": {
    "<id>": {
      "name": "string",          // display name
      "npm": "@ai-sdk/<pkg>",    // Vercel AI SDK provider package, e.g. "@ai-sdk/anthropic"
      "options": { "apiKey": "…" },   // passed to the provider constructor (env-expanded)
      "models": {                // optional: register custom/extra models + limits
        "<model-id>": { "name": "…", "limit": { "context": 200000, "output": 8192 } }
      }
    }
  }
  ```
- **Purpose:** Declares LLM providers + API keys + any custom model metadata. This is where API keys live (env-expanded via `$VAR` syntax). [OK]
- **Startup vs live:** **Startup only.**

### How models are chosen — `models.dev` metadata [OK]
- **Wire name:** (not a config knob — a runtime data source)
- **Mechanism:** opencode does **not** hard-code provider/model lists. It pulls provider metadata (catalog of providers, models, context windows, pricing, capabilities) from **[models.dev](https://models.dev)**. This is why "one provider abstraction" supports 75+ models. [OK] corroborated in deep-dive brief.
- **Likely fetch endpoints** [GUESS, needs confirmation]: `https://models.dev/providers.json` and per-provider `https://models.dev/providers/<id>.json`. opencode caches these locally.
- **Settings-UI implication:** A model picker should be **provider-first, then model** (matches the confirmed better-agent decision: "先选 provider，选完才能选 model"). Context-window/price columns come from models.dev data, not our DB.

---

## 2. Agents (`agent` config + `agents/*.md`)

opencode treats an agent as **pure configuration** (system prompt + model + tool whitelist + permission rules). [OK]

### `agent` [OK]
- **Wire name:** `agent` (record keyed by agent name) and/or `agents/<name>.md` markdown files.
- **Allowed values shape:**
  ```jsonc
  "agent": {
    "<name>": {
      "description": "string",          // shown in agent picker
      "mode": "primary" | "subagent",  // [VERIFY exact enum] primary = top-level, subagent = spawned via `task` tool
      "model": "<provider>/<model>",    // override per agent (optional)
      "tools": { "read": true, "edit": false } | ["read","edit"],  // tool whitelist
      "permission": { … },              // per-tool allow/ask/deny (see §4)
      "prompt": "string"                // system prompt; .md files use frontmatter + body
    }
  }
  ```
- **Purpose:** Define named agents (e.g. a coding agent, a research subagent). `agents/*.md` files carry `description`/`mode`/`tools`/`model` in YAML frontmatter and the prompt in the body. [OK]
- **Startup vs live:** **Startup only.** Which agent a session runs is chosen at `session/new`/`session/prompt` time via the `agent` param. [VERIFY param name]

### Primary vs subagent [OK]
- **`mode: "primary"`** — can be selected as the main session agent.
- **`mode: "subagent"`** — only invocable by the `task` tool; runs an isolated child session and returns only final text to the parent. (See §7 `task` tool.)

---

## 3. Modes: `build` vs `plan`

### `mode` (named mode set) [OK]
- **Wire name:** `mode` (record) + the active mode is a per-session state.
- **Built-in modes:**
  - **`build`** — read+write. Tools like `edit`, `bash` permitted (per the mode's permission rules).
  - **`plan`** — **read-only**. Mutating tools (`edit`, `bash`) denied; agent plans/researches without changing files. [OK]
- **Allowed values shape (custom modes):**
  ```jsonc
  "mode": {
    "build": { "permission": { "edit": "allow", "bash": "allow" } },
    "plan":  { "permission": { "edit": "deny",  "bash": "deny"  } }
    // you can add custom named modes the same way
  }
  ```
- **Purpose:** Toggle between acting (build) and analysis-only (plan). The mode's `permission` block overrides the global permission rules while that mode is active.
- **Startup vs live:** Mode **definitions** are startup; the **active mode** is **live** — switched mid-session. Switching injects a "build-switch" system message into context so the model knows it is now allowed/blocked from writing. [OK]

### 🔶 ACP method to switch the active mode [VERIFY — supervisor-flagged]
- **Wire name:** `session/setMode` **OR** `session/set_mode` — **casing unconfirmed.** ACP (Agent Client Protocol) conventionally uses camelCase JSON-RPC method names (`session/setMode`), but opencode's server handler and our adapter currently assume `session/set_mode`. **Must verify against current `main`.**
- **Likely params:** `{ "sessionId": "…", "mode": "build" | "plan" | "<custom>" }` [GUESS]
- **Purpose:** Live mode switch for a running session.
- **Settings-UI implication:** The Settings page defines *which modes exist and their permission profiles*; the *active mode* is a chat-surface control (a tab/toggle in the session UI, mirroring opencode TUI's mode tab).

---

## 4. Permission system (per-tool `allow` / `ask` / `deny`)

This is the core governance surface and the most valuable to expose in a Settings UI. [OK — design corroborated in both briefs]

### `permission` [OK]
- **Wire name:** `permission` (record keyed by tool/permission key)
- **Allowed values per key:** `"allow"` | `"ask"` | `"deny"`
  - `allow` — tool runs without prompting.
  - `ask` — before each execution, `Permission.ask()` intercepts and the user must approve; refusal stops that tool call. This is the "approval/ask" interaction.
  - `deny` — tool is blocked entirely (filtered out of the agent's toolset / errors if invoked).
- **Resolution order** [VERIFY]: mode-specific `permission` overrides agent-level `permission` overrides global `permission`. MCP-tool permission uses the same syntax (keyed by server/tool name or glob).
- **Startup vs live:** The **rules** are startup. The **ask→allow/deny responses** are live (the better-agent "approval" UI / remote-tool protocol carries the ask interaction).

### 🔶 The exact set of permission keys (tool list) [VERIFY — supervisor-flagged]
There is **ambiguity in our own briefs** about the exact tool/permission key list. Two readings:

**Reading A — broad (from `opencode-research.md`):** every built-in tool has a permission key:
`read`, `edit`, `bash`, `glob`, `grep`, `list`, `task`, `lsp`, `skill`, `external_directory`

**Reading B — narrow (standard opencode behavior):** only **side-effecting** tools are gated by permission; read-only tools (`read`, `glob`, `grep`, `list`) are not gated by default:
`bash`, `edit`, `webfetch`, plus **per-MCP-tool** keys (e.g. `"mcp/<server>.<tool>"` or a glob pattern) and possibly `external_directory`.

**Reconciliation:** The deep-dive brief lists the broad set as the *permission-key universe*, while in practice opencode's default config only sets rules for mutating tools. The full built-in **tool names** available are (union across both briefs) [OK for names, VERIFY which are permission-gated]:

| Tool name | Side effect? | Default permission gating | Notes |
|---|---|---|---|
| `read` | no | usually ungated | file read |
| `edit` | **yes** | gated (`allow`/`ask`/`deny`) | in-place file edit |
| `write` | **yes** | gated | full file write (may be merged with `edit`) |
| `bash` | **yes** | gated | shell execution (see §5) |
| `glob` | no | ungated | file globbing |
| `grep` | no | ungated | content search |
| `list` | no | ungated / [VERIFY] | directory listing |
| `webfetch` | **yes** (network) | gated (`ask` typical) | HTTP fetch |
| `task` | yes (spawns child) | gated / [VERIFY] | subagent spawn |
| `todoread` / `todowrite` | mixed | [VERIFY] | todo list |
| `lsp` | no (query) | ungated / [VERIFY] | LSP diagnostics feedback |
| `skill` | varies | [VERIFY] | custom command/skill |
| `external_directory` | n/a | [VERIFY] | gates access outside cwd |

**For the Settings UI:** implement the permission editor as a **generic `tool-key → allow|ask|deny` map** (not a hardcoded list). That way it covers built-in tools, custom modes, and MCP tools uniformly — which is exactly how opencode models it. [OK — this generic-map approach is the safe, verified design.]

---

## 5. Bash / execution mode

### Bash tool + `bash` permission [OK]
- **Wire name:** tool `bash`; permission key `bash`.
- **Allowed values:** permission `"allow"` | `"ask"` | `"deny"` (see §4).
- **Purpose:** Execute shell commands. `ask` is the common default so destructive commands prompt the user.
- **Startup vs live:** rules startup; per-command approvals live.

### "bash execution mode" / sandbox [GUESS — needs confirmation]
- The phrase "bash execution mode" is **not a single documented knob** in our briefs. It most likely refers to one of:
  1. The `bash` **permission value** (`allow`/`ask`/`deny`) — most probable.
  2. A sandbox/isolation option for command execution [GUESS, not found in briefs].
  3. The `--auto` / autonomous-approve behavior (see §8) which effectively forces `allow`.
- **Action:** Treat the Settings knob as **`bash` permission = allow|ask|deny** (verified mechanism) and note that any "sandbox mode" is unverified and out of MVP scope.

---

## 6. 🔶 ACP method to switch the session model (`unstable_setSessionModel`) [VERIFY — supervisor-flagged]

- **Wire name:** `unstable_setSessionModel` — **assumed by our adapter, not yet confirmed against current `main`.** The `unstable_` prefix is opencode's convention for not-yet-stable ACP methods, which makes the name plausible, but it must be verified before the UI/adapter depends on it.
- **Likely params:** `{ "sessionId": "…", "model": "<provider>/<model-id>" }` [GUESS]
- **Purpose:** Change the model for an **already-running** session (live), without recreating it.
- **Startup vs live:** **Live.** (Startup model is set via `model` in config / `session/new`.)
- **Fallback if the name differs:** If `unstable_setSessionModel` is wrong, the alternative is to set the model at `session/new` time only (no live switch), or a differently-named method. Verify before implementing a live model-switcher.

---

## 7. Tools available to agents

### Built-in tools [OK]
`Tool.define(name, { description, parameters: zodSchema, execute(params, ctx) })`. `ctx` carries `sessionID`/`messageID`/`agent`/`abort`. Built-in set (union of both briefs):

`read`, `write`, `edit`, `bash`, `glob`, `grep`, `list`, `webfetch`, `todoread`, `todowrite`, `task`, `lsp`, `skill`

### `task` tool (subagents) [OK]
- **Wire name:** tool `task`
- **Behavior:** Spawns a **new child session** (`parentID`), injects the chosen subagent's prompt, runs to completion, returns **only final text** to the parent (intermediate steps hidden). Supports concurrent spawns. Optional `background: true` for fire-and-forget tasks that re-inject on completion. [OK]
- **Purpose:** Agent orchestration / delegation.
- **Startup vs live:** The tool definition + the subagents it can spawn are **startup**; invocation is **live** (model-driven).

### Tool whitelist per agent [OK]
- **Wire name:** `agent.<name>.tools`
- **Allowed values:** `{ "toolName": true|false }` **or** `["toolName", …]` (both forms supported). [VERIFY both forms still accepted]
- **Purpose:** Restrict which built-in/MCP tools an agent can see. `ToolRegistry` filters by this whitelist **and** by permission rules.

---

## 8. Autonomous / `--auto` behavior

### `--auto` flag [GUESS → VERIFY]
- **Wire name:** CLI flag `--auto` (and/or an equivalent in `session/new` params / a permission mode).
- **Likely behavior:** Auto-approve all permission prompts (effectively `allow` for every gated tool) so the agent runs fully autonomously without user approval — i.e. a "YOLO"/hands-off mode. The gap doc references an autonomous-approve concept.
- **Allowed values:** boolean flag (on/off).
- **Startup vs live:** **Startup** (session-creation flag). Internally it likely overrides permission rules to `allow`.
- **Verification needed:** exact flag name (`--auto` vs `--auto-approve` vs a permission-mode value) is **unconfirmed**. Do not hard-code `--auto` without checking current `main`.
- **Settings-UI implication:** Expose as a per-session "Autonomous mode / auto-approve tools" toggle, clearly warning it disables the safety prompts.

---

## 9. MCP server configuration

### `mcp` [OK]
- **Wire name:** `mcp` (record keyed by server name)
- **Allowed values shape:**
  ```jsonc
  "mcp": {
    "<server-name>": {
      "type": "local" | "remote",      // [VERIFY enum values] local = stdio subprocess, remote = HTTP/SSE
      "enabled": true,                 // startup enable/disable
      // local:
      "command": ["npx", "-y", "@some/mcp-server"],
      "args": ["…"],                   // [VERIFY] may be folded into command array
      "environment": { "API_KEY": "$ENV_VAR" },   // env-expanded
      "cwd": "/path",                  // [VERIFY]
      // remote:
      "url": "https://…/mcp",
      "headers": { "Authorization": "Bearer $TOKEN" }   // env-expanded
    }
  }
  ```
- **Purpose:** Register Model Context Protocol servers whose tools get merged into the agent's toolset (filtered by the same permission system). [OK]
- **Startup vs live:** **Startup** for config; per-session servers can also be passed in `session/new`'s `mcpServers` param (see §10). `enabled` toggles availability. [VERIFY whether servers can be hot-added live without a restart.]
- **Settings-UI implication:** An MCP-server manager (add/remove/enable/disable + edit command/env or URL/headers). Tools from MCP servers then appear in the permission editor (§4) under their `mcp/<server>.<tool>` keys.

---

## 10. ACP (Agent Client Protocol) wire surface — summary

opencode exposes an ACP server (JSON-RPC over stdio) that editors/clients call. The relevant session-lifecycle methods [mixture of OK and VERIFY — see per-method]:

| Method | Wire name | Phase | Purpose | Confidence |
|---|---|---|---|---|
| Initialize | `initialize` | startup | handshake, capabilities | [GUESS] |
| Create session | `session/new` | session startup | create session; params include `cwd`, `mcpServers`, and (opencode extension) initial model/mode/agent | [VERIFY exact param shape] |
| Send prompt | `session/prompt` | live | send a prompt; params include session id + prompt parts (+ optional `agent`/`mode`/`model` overrides) | [VERIFY param names] |
| 🔶 Switch mode | `session/setMode` **or** `session/set_mode` | live | change active mode (build/plan/custom) | **[VERIFY]** |
| 🔶 Switch model | `unstable_setSessionModel` | live | change session model without recreating | **[VERIFY]** |
| Cancel | `session/cancel` | live | abort current run | [GUESS] |
| Load/resume | `session/load` | session startup | resume an existing session | [GUESS] |

### `session/new` request shape [VERIFY]
- **Likely params:**
  ```jsonc
  {
    "cwd": "/path/to/project",                  // working directory [OK concept]
    "mcpServers": { "<name>": { "transport": {…} } },  // per-session MCP servers [OK concept]
    "agentSession": {                           // [VERIFY field name + contents] opencode extension
      "model": "<provider>/<model>",            // initial model
      "mode": "build",                         // initial mode
      "agent": "general",                      // which named agent
      "permission": { … }                      // per-tool rules for this session
    }
  }
  ```
- **Confidence:** the *concepts* (cwd, mcpServers, initial model/mode) are [OK]; the **exact field names** (e.g. `agentSession` vs a flat `model`/`mode`) are **[VERIFY]**.

### Runtime permission interaction (the "ask" flow) [OK]
- Mechanism: `Permission.ask()` fires before a gated tool runs; the client must respond with allow/deny. This is carried over whatever transport (opencode's SSE/event bus; better-agent's remote-tool protocol).
- **Settings-UI implication:** This is a *chat-surface* concern (approval prompts), not the Settings page — but the Settings page defines *which* tools are `ask` vs `allow` vs `deny`.

---

## 11. Consolidated Settings-UI control list (recommended)

Mapping opencode's surface to UI controls, with the verified/assumed split made explicit:

| UI control | Backed by opencode knob | Wire name | Values | Startup/Live | Verify? |
|---|---|---|---|---|---|
| Default model | config | `model` | `provider/model` | startup | [OK] |
| Utility (small) model | config | `small_model` | `provider/model` | startup | [OK] |
| Providers + API keys | config | `provider.<id>` | record | startup | [OK] |
| Model catalog/metadata | runtime | models.dev | — | startup | [OK] |
| Agents (name/desc/prompt/model/tools) | config + `agents/*.md` | `agent.<name>` | record | startup | [OK] |
| Primary vs subagent | config | `agent.<name>.mode` | `primary`\|`subagent` | startup | [VERIFY enum] |
| Tool whitelist | config | `agent.<name>.tools` | map\|array | startup | [VERIFY forms] |
| Modes (build/plan/custom) | config | `mode.<name>` | record | startup (def) | [OK] |
| Per-tool permission | config / mode / agent | `permission.<key>` | `allow`\|`ask`\|`deny` | startup (rules) | [OK]; **exact key list VERIFY** |
| Bash execution | config | `permission.bash` | `allow`\|`ask`\|`deny` | startup | [OK] |
| MCP servers | config | `mcp.<name>` | record | startup (+session) | [OK]; enums VERIFY |
| Autonomous/auto-approve | CLI / session | `--auto` (?) | bool | startup | **[VERIFY]** |
| Live mode switch | ACP | `session/setMode` (?) | mode id | live | **[VERIFY casing]** |
| Live model switch | ACP | `unstable_setSessionModel` (?) | provider/model | live | **[VERIFY]** |
| Tool approval prompts | runtime | `Permission.ask()` | allow/deny | live | [OK] |

---

## 12. What still needs verification (and suggested next steps)

The supervisor offered to curl+stage specific files if given exact URLs. **However, `packages/opencode/src/...` paths currently 404 and the tree API is rate-limited**, so exact file paths are unknown right now. Suggested approach to close the gaps:

1. **Get a live file listing first.** Have the supervisor (or a run with `gh`/shell access) run `gh api repos/sst/opencode/git/trees/main?recursive=1` (when rate limit clears) to find the real source layout, then map the files below.
2. **Then verify these specific wire names against the real source:**
   - 🔶 ACP method casing: search the server/ACP handler for `setMode` vs `set_mode`.
   - 🔶 `unstable_setSessionModel` exact name (grep the session/server module).
   - 🔶 Exact permission keys + which tools are gated (the `Config.Permission` / `Permission` type).
   - `session/new` exact param field names.
   - `--auto` exact flag name.
   - `mcp` config: `type` enum values (`local`/`remote`), `command` vs `command`+`args`, `enabled`.
3. **ACP spec cross-check:** the method names likely also appear in the **Agent Client Protocol** spec repo (Zed) — e.g. its `schema.json` / protocol document — which is a more stable source for `session/new`, `session/setMode`, `session/prompt` shapes than opencode's moving source.

Candidate URLs to request (once layout is known): `https://raw.githubusercontent.com/sst/opencode/main/<real path>/config/index.ts`, `.../session/index.ts`, `.../server/index.ts` (or wherever the ACP handler lives), plus the ACP spec schema.

---

## Sources

### Kept (proximate, primary-sourced within this project)
- **`docs/research/opencode-research.md`** (2026-06-16) — the authoritative deep dive in-repo. Source for: server-held-state architecture, the agent loop, the permission system with per-tool keys, build vs plan mode + build-switch message, models.dev, MCP, the `task` subagent tool, compaction. (Researched from sst/opencode source + DeepWiki.)
- **`docs/research/2026-07-02-opencode-gap-refresh.md`** (2026-07-02) — the refresh. Source for: tool/permission key list reconciliation, `small_model` routing, MCP presets, `task` tool background mode, `experimental_repairToolCall`.
- **opencode docs site** — [opencode.ai/docs](https://opencode.ai/docs/), [Agents](https://opencode.ai/docs/agents/), [Config](https://opencode.ai/docs/config/), [LSP](https://opencode.ai/docs/lsp/) — referenced via the two briefs.
- **models.dev** — [models.dev](https://models.dev) — provider/model metadata source. [OK]
- **DeepWiki pages** (sst/opencode) — Agent System, Tool System, Provider/Model Config, Context Mgmt — referenced via the deep-dive brief.

### Dropped
- (none actively fetched this run — all external fetching was blocked; see "How this was compiled.")

## Gaps

- **Cannot cite exact source-file URLs with line accuracy** — no web access in this run, and `packages/opencode/src/` paths 404 / tree API rate-limited. Every [VERIFY]/[GUESS] item above is a gap.
- **ACP `session/new` and `session/setMode` exact request shapes** are inferred, not confirmed.
- **`unstable_setSessionModel`** existence + exact name unconfirmed.
- **Exact permission key list** (broad vs narrow reading) unresolved — recommend treating as a generic map in the UI regardless.
- **`--auto` flag exact name/semantics** unconfirmed.
- **MCP `type` enum + `command`/`args` shape** unconfirmed.

**Next steps:** see §12 — obtain a live repo tree listing, then curl the real `config`/`session`/`server` source files and the ACP spec schema to verify the five supervisor-flagged wire names before the Settings UI hard-codes them.
