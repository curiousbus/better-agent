# Research: pi (badlogic / Mario Zechner) Configuration Surface — Settings UI Reference

> Scope: every configuration knob exposed by `pi --mode rpc` (the JSON-over-stdio protocol) plus the persisted
> `settings.json` surface, skills/packages, and project trust. Goal: a complete, build-ready inventory for a
> Settings UI. All facts are sourced to pi-mono's own docs (`packages/coding-agent/docs/*`).
>
> Primary sources (fetched from `raw.githubusercontent.com`):
> - `rpc.md` — RPC protocol & commands: <https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md>
> - `settings.md` — `settings.json` / trust / persistence: <https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md>
> - `skills.md` — skills/packages: <https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md>
> - `json.md` — JSON event-stream mode (`--mode json`): <https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/json.md>

---

## Summary

pi exposes configuration through **three layers** that a Settings UI must distinguish:

1. **Live RPC setters** — commands sent to a running `pi --mode rpc` process (`set_model`, `set_thinking_level`, `set_steering_mode`, `set_follow_up_mode`, `set_auto_compaction`, `set_auto_retry`, `set_session_name`, plus `cycle_*` variants). These change the *current session* immediately and return `success: true`; the change is reflected by the next `get_state`. [rpc.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)
2. **Persisted `settings.json` defaults** — read at process start. Global at `~/.pi/agent/settings.json`; project at `.pi/settings.json` (project overrides global; nested objects are deep-merged). [settings.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)
3. **Startup-only flags / env** — CLI flags (`--provider`, `--model`, `--approve`, …) and env vars (`PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_CODING_AGENT_SESSION_DIR`, `PI_EXPERIMENTAL`). [rpc.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md) · [settings.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)

**Crucially: pi has NO built-in tool-permission / approval concept** (no Claude-Code-style allow/deny list, no YOLO/auto-approve toggle, no per-tool-call gating). The only approval-adjacent mechanisms are *project trust* (gates loading project resources), *extension UI dialogs* (`ctx.ui.confirm`/`select`, which extensions use to build their own flows), and the experimental skill-scoped `allowed-tools` frontmatter. Confirmed below in §6.

Many knobs have **both** a startup default (in `settings.json`) and a live RPC setter: the setting seeds the value at launch; the RPC setter overrides it for the live session. (See the "Startup default ↔ Live setter" column.)

---

## 1. Live RPC configuration commands

Every command is a single JSON line on stdin; response is `{"type":"response","command":<cmd>,"success":true|false,...}`. Commands support an optional `id` for correlation. [rpc.md §Protocol Overview](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

### Table A — RPC config commands

| RPC command | Params | Allowed values | Purpose | Live (running session) or Startup-only | Persisted? | Startup-default counterpart in `settings.json` |
|---|---|---|---|---|---|---|
| `get_state` | none | — | Snapshot of current session config (model, thinking, queue modes, compaction, name…). **Read for UI initialization.** | Live read | — | — |
| `get_available_models` | none | — | Array of full `Model` objects the user can switch to. Drives the model picker. | Live read | — | `enabledModels` (cycling set) |
| `set_model` | `provider` (string), `modelId` (string) | any id returned by `get_available_models` | Switch the active model immediately. | **Live** | Not explicitly documented (treat as session-scoped; see Gaps) | `defaultProvider`, `defaultModel` |
| `cycle_model` | none | — | Advance to next model in `enabledModels`. Returns `{model, thinkingLevel, isScoped}`. | **Live** | as above | `enabledModels` |
| `set_thinking_level` | `level` (string) | `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` | Set reasoning depth. (`xhigh` only on OpenAI codex-max.) | **Live** | Not explicitly documented | `defaultThinkingLevel` |
| `cycle_thinking_level` | none | — | Cycle levels; `data.level` or `null` if model can't think. | **Live** | as above | `defaultThinkingLevel` |
| `get_commands` | none | — | All slash commands: extensions, prompt templates, skills (`skill:`-prefixed). Drives the commands/skills browser. | Live read | — | `enableSkillCommands`, `skills`, `prompts`, `packages`, `extensions` |
| `set_steering_mode` | `mode` (string) | `"all"`, `"one-at-a-time"` | How queued steering messages are delivered. | **Live** | session-scoped | `steeringMode` |
| `set_follow_up_mode` | `mode` (string) | `"all"`, `"one-at-a-time"` | How queued follow-up messages are delivered. | **Live** | session-scoped | `followUpMode` |
| `set_auto_compaction` | `enabled` (boolean) | `true`/`false` | Toggle automatic compaction when context nears full. | **Live** | session-scoped | `compaction.enabled` |
| `set_auto_retry` | `enabled` (boolean) | `true`/`false` | Toggle auto-retry on transient errors (overload/rate-limit/5xx). | **Live** | session-scoped | `retry.enabled` |
| `set_session_name` | `name` (string) | any display name | Set/clear session display name (shown in `get_state.sessionName`). | **Live** | session-scoped | startup flag `--name`/`-n` |
| `compact` | optional `customInstructions` (string) | — | Manually compact context now. Returns summary + token estimates. | Live action | — | `compaction.*` |
| `get_session_stats` | none | — | Token usage, cost, context-window %. | Live read | — | — |
| `abort` / `abort_retry` / `abort_bash` | none | — | Cancel current op / retry / bash. (Operational, not config.) | Live action | — | — |

> "Live" = a `success: true` response mutates the *running* session and is observable via `get_state` on the next call. [rpc.md §Model / §Thinking / §Queue Modes / §Compaction / §Retry](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

> **Persist?** The docs confirm the live setters change current-session state and that `get_state` reflects them, but they do **not** state that these writes are flushed back to `settings.json`. For a Settings UI, model/thinking/queue/compaction/retry chosen via RPC should be treated as **per-session overrides**; if persistence across restarts is required, write to `settings.json` and restart. Flagged in §Gaps.

### Table B — `get_state` response fields (the UI's config snapshot)

[rpc.md §get_state](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

| Field | Type | Meaning |
|---|---|---|
| `model` | `Model` \| `null` | Active model (full object, see Table F) |
| `thinkingLevel` | string | Current level (`off`…`xhigh`) |
| `isStreaming` | boolean | Agent actively generating |
| `isCompacting` | boolean | Compaction in progress |
| `steeringMode` | `"all"` \| `"one-at-a-time"` | Current steering delivery mode |
| `followUpMode` | `"all"` \| `"one-at-a-time"` | Current follow-up delivery mode |
| `sessionFile` | string | Path to `.jsonl` session log |
| `sessionId` | string | Session id |
| `sessionName` | string \| omitted | Display name (if set) |
| `autoCompactionEnabled` | boolean | Live auto-compaction toggle |
| `messageCount` | number | Messages in active branch |
| `pendingMessageCount` | number | Queued steering+follow-up |

### Table C — Other config-adjacent RPC reads/writes (not user "settings" but UI-relevant)

| Command | Purpose |
|---|---|
| `get_messages` | full conversation (`AgentMessage[]`) |
| `get_entries` / `get_tree` / `get_fork_messages` / `get_last_assistant_text` | session history / forking / tree browsing |
| `switch_session` / `new_session` / `fork` / `clone` | session lifecycle (cancellable via extension `session_before_switch`/`session_before_fork`) |
| `export_html` | export session |
| `set_session_name` | (listed in Table A) |

[rpc.md §Session](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

---

## 2. Persisted `settings.json` knobs

Persistence locations: **Global** `~/.pi/agent/settings.json`; **Project** `.pi/settings.json` (project overrides global; **nested objects deep-merged**, scalar/arrays replaced). Edit file directly or via interactive `/settings`. [settings.md §Settings / §Project Overrides](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)

### Table D — All `settings.json` fields by group

| Group | Setting | Type | Default | Purpose | Live-settable via RPC? |
|---|---|---|---|---|---|
| **Model & Thinking** | `defaultProvider` | string | — | Default provider (`anthropic`,`openai`,…) | `set_model` (provider) |
| | `defaultModel` | string | — | Default model id | `set_model` (modelId) |
| | `defaultThinkingLevel` | string | — | `off`,`minimal`,`low`,`medium`,`high`,`xhigh` | `set_thinking_level` |
| | `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in output | no |
| | `thinkingBudgets` | object | — | Token budgets per level, e.g. `{minimal:1024,low:4096,medium:10240,high:32768}` | no |
| **Model Cycling** | `enabledModels` | string[] | — | Ctrl+P cycling patterns (same as `--models`), e.g. `["claude-*","gpt-4o","gemini-2*"]` | `cycle_model` uses it |
| **UI & Display** | `theme` | string | `"dark"` | `dark`,`light`, or custom | no |
| | `externalEditor` | string | `$VISUAL`→`$EDITOR`→`nano`/Notepad | Ctrl+G editor; add `--wait` for VS Code | no |
| | `quietStartup` | boolean | `false` | Hide startup header | no |
| | `defaultProjectTrust` | string | `"ask"` | `ask`,`always`,`never`. **Global-only**, fallback trust in non-interactive modes | no |
| | `collapseChangelog` | boolean | `false` | Condensed changelog after updates | no |
| | `enableInstallTelemetry` | boolean | `true` | Anonymous install/update ping to pi.dev | no |
| | `enableAnalytics` | boolean | `false` | Opt-in analytics (`PI_EXPERIMENTAL` first-run) | no |
| | `trackingId` | string | — | Analytics id (auto-generated) | no |
| | `doubleEscapeAction` | string | `"tree"` | `tree`,`fork`,`none` | no |
| | `treeFilterMode` | string | `"default"` | `default`,`no-tools`,`user-only`,`labeled-only`,`all` | no |
| | `editorPaddingX` | number | `0` | 0–3 | no |
| | `outputPad` | number | `1` | 0 or 1 | no |
| | `autocompleteMaxVisible` | number | `5` | 3–20 | no |
| | `showHardwareCursor` | boolean | `false` | terminal cursor for IME | no |
| **Network** | `httpProxy` | string | — | applied as `HTTP_PROXY`/`HTTPS_PROXY`. **Global-only** | no |
| **Warnings** | `warnings.anthropicExtraUsage` | boolean | `true` | Warn on possible paid extra usage | no |
| **Compaction** | `compaction.enabled` | boolean | `true` | Auto-compaction | `set_auto_compaction` |
| | `compaction.reserveTokens` | number | `16384` | Tokens reserved for LLM response | no |
| | `compaction.keepRecentTokens` | number | `20000` | Recent tokens kept (not summarized) | no |
| **Branch Summary** | `branchSummary.reserveTokens` | number | `16384` | tokens reserved for branch summarization | no |
| | `branchSummary.skipPrompt` | boolean | `false` | skip "Summarize branch?" prompt | no |
| **Retry** | `retry.enabled` | boolean | `true` | agent-level auto-retry | `set_auto_retry` |
| | `retry.maxRetries` | number | `3` | agent-level attempts | no |
| | `retry.baseDelayMs` | number | `2000` | exp backoff base (2s,4s,8s) | no |
| | `retry.provider.timeoutMs` | number | SDK default | provider request timeout (ms) | no |
| | `retry.provider.maxRetries` | number | `0` | provider/SDK retries (keep 0) | no |
| | `retry.provider.maxRetryDelayMs` | number | `60000` | cap on server-requested delay; `0`=disable | no |
| **Message Delivery** | `steeringMode` | string | `"one-at-a-time"` | `all`,`one-at-a-time` | `set_steering_mode` |
| | `followUpMode` | string | `"one-at-a-time"` | `all`,`one-at-a-time` | `set_follow_up_mode` |
| | `transport` | string | `"auto"` | `sse`,`websocket`,`websocket-cached`,`auto` | no |
| | `httpIdleTimeoutMs` | number | `300000` | HTTP idle timeout; `0`=disable | no |
| | `websocketConnectTimeoutMs` | number | `15000` | WS connect timeout; `0`=disable | no |
| **Terminal & Images** | `terminal.showImages` | boolean | `true` | show inline images | no |
| | `terminal.imageWidthCells` | number | `60` | inline image width in cells | no |
| | `terminal.clearOnShrink` | boolean | `false` | clear empty rows on shrink (may flicker) | no |
| | `images.autoResize` | boolean | `true` | resize to ≤2000×2000 | no |
| | `images.blockImages` | boolean | `false` | block all images to LLM | no |
| **Shell** | `shellPath` | string | — | custom shell path | no |
| | `shellCommandPrefix` | string | — | prefix for every bash command | no |
| | `npmCommand` | string[] | — | argv for npm ops, e.g. `["mise","exec","node@20","--","npm"]` | no |
| **Sessions** | `sessionDir` | string | — | session storage dir (abs/relative/`~`) | no (startup flag `--session-dir` / env `PI_CODING_AGENT_SESSION_DIR`) |
| **Markdown** | `markdown.codeBlockIndent` | string | `"  "` | code-block indentation | no |
| **Resources** | `packages` | array | `[]` | npm/git packages (string or `{source,skills,extensions}` filter) | no |
| | `extensions` | string[] | `[]` | local extension paths/dirs (glob, `!`/`+`/`-`) | no |
| | `skills` | string[] | `[]` | local skill paths/dirs | no |
| | `prompts` | string[] | `[]` | local prompt-template paths/dirs | no |
| | `themes` | string[] | `[]` | local theme paths/dirs | no |
| | `enableSkillCommands` | boolean | `true` | register skills as `/skill:name` | no |

[settings.md §All Settings](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)

> Precedence for session dir: `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > `sessionDir`. [settings.md §Sessions](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)
> Global-only fields (cannot be set per-project): `defaultProjectTrust`, `httpProxy`. [settings.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)

### Table E — Startup flags & env vars (process launch only)

| Flag / Env | Purpose |
|---|---|
| `--mode rpc` | start JSON-over-stdio protocol |
| `--mode json "<prompt>"` | one-shot JSON event stream to stdout |
| `--provider <name>` | LLM provider at startup |
| `--model <pattern>` | model pattern/id; supports `provider/id` and optional `:<thinking>` |
| `--name <name>` / `-n <name>` | session display name at startup |
| `--no-session` | disable session persistence |
| `--session-dir <path>` | session storage dir |
| `--models <patterns>` | cycling set (cf. `enabledModels`) |
| `--skill <path>` (repeatable) | add a skill; additive even with `--no-skills` |
| `--no-skills` | disable skill discovery (explicit `--skill` still loads) |
| `--approve` / `-a` · `--no-approve` / `-na` | override project trust for one run |
| `--offline` / `PI_OFFLINE=1` | disable all startup network ops |
| `PI_SKIP_VERSION_CHECK=1` | disable pi version check |
| `PI_CODING_AGENT_SESSION_DIR` | session dir env |
| `PI_EXPERIMENTAL=1` | experimental first-time setup (asks for analytics) |

[rpc.md §Starting RPC Mode](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md) · [settings.md §Telemetry / §Sessions / §Project Trust](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)

---

## 3. Skills / packages

A skill is a directory with `SKILL.md` (frontmatter + instructions); loaded on-demand (progressive disclosure). Implements the [Agent Skills standard](https://agentskills.io/specification). [skills.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md)

### Table F1 — Skill discovery locations

| Location | Scope | Note |
|---|---|---|
| `~/.pi/agent/skills/` | global | root `.md` files = individual skills; dirs with `SKILL.md` recursive |
| `~/.agents/skills/` | global (cross-harness) | root `.md` ignored; dirs only |
| `.pi/skills/` | project (**only after trust**) | as above |
| `.agents/skills/` (cwd + ancestors to git root) | project (**only after trust**) | root `.md` ignored |
| package `skills/` dir or `pi.skills` in `package.json` | package | via `packages` setting |
| `skills` array in settings | explicit | files/dirs (glob, `!`/`+`/`-`) |
| `--skill <path>` CLI | explicit | repeatable, additive with `--no-skills` |

### Table F2 — SKILL.md frontmatter

| Field | Required | Rules |
|---|---|---|
| `name` | yes | ≤64 chars; `[a-z0-9-]`; no leading/trailing/consecutive hyphens. **Pi does NOT require name==dir** (deviation from standard, for shared dirs). |
| `description` | yes | ≤1024 chars; determines when the model loads it. **Missing ⇒ skill not loaded.** |
| `license` | no | license name/file |
| `compatibility` | no | ≤500 chars, env requirements |
| `metadata` | no | key-value map |
| `allowed-tools` | no | **experimental** space-delimited pre-approved tools |
| `disable-model-invocation` | no | `true` ⇒ hide from system prompt (force `/skill:name`) |

### Skill commands

- Register as `/skill:name` (toggle via `enableSkillCommands` in settings or `/settings`). [skills.md §Skill Commands](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md)
- Invoked through the `prompt` RPC command: `{"type":"prompt","message":"/skill:brave-search extract"}`. Args after the command are appended as `User: <args>`. [rpc.md §prompt](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)
- Enumerate all (extensions + prompts + skills) via `get_commands` → each `{name, description, source, location, path}` where `source` ∈ `extension|prompt|skill` and `location` ∈ `user|project|path`. [rpc.md §get_commands](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

### Packages

- `packages` setting: string form loads all resources; object form filters `{source, skills[], extensions[]}`. User-scoped npm → `~/.pi/agent/npm/`; project-scoped → `.pi/npm/`. `npmCommand` setting controls the package manager argv. [settings.md §Resources / §Shell](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md) · See `packages.md` (not staged) for package-management details.

---

## 4. Project trust

Trust gates whether pi loads **project-local settings, `.pi` resources, project packages, and project extensions/skills**. Saved decisions live in `~/.pi/agent/trust.json` (records the folder or a parent). [settings.md §Project Trust](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)

| Mode | Behavior |
|---|---|
| Interactive startup | Prompts before trusting a project that has local settings/resources/`.agents/skills` and has no saved decision. `/trust` saves a decision (writes trust.json; **restart required**). |
| Non-interactive (`-p`, `--mode json`, **`--mode rpc`**) | **No prompt.** Uses `defaultProjectTrust` (`ask`=treat as untrusted, `never`=ignore, `always`=trust) when no saved decision. |
| Per-run override | `--approve`/`-a` (trust) or `--no-approve`/`-na` (ignore) project settings for one run. `pi config`/package commands use same flow; `pi update` never prompts. |

> **Implication for an RPC-driven UI:** there is no "approve project" RPC command. To trust a project from a non-interactive client you must either set `defaultProjectTrust: "always"` in `~/.pi/agent/settings.json`, write `~/.pi/agent/trust.json` directly, or launch pi with `--approve`. Flagged in §Gaps.

---

## 5. `Model` object (drives the model picker)

[rpc.md §Types/Model](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

```json
{
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "api": "anthropic-messages",
  "provider": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 200000,
  "maxTokens": 16384,
  "cost": { "input": 3.0, "output": 15.0, "cacheRead": 0.3, "cacheWrite": 3.75 }
}
```

`get_available_models` returns an array of these; `set_model` accepts `{provider, modelId}`; `get_state.model` is one of these or `null`.

---

## 6. Permission / approval — CONFIRMED: pi has NO built-in concept

Evidence from the four docs:

1. **No permission config exists in `settings.json`.** Every field in Table D was enumerated from [settings.md §All Settings](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md). There is **no** `permissionMode`, `allowedTools`, `blockedTools`, `autoApprove`/`yolo`, or tool-allowlist setting.
2. **The `bash` RPC command executes immediately with no approval step** — "Execute a shell command and add output to conversation context … executes immediately and returns a `BashResult`." [rpc.md §bash](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)
3. **Built-in TUI commands (`/settings`, `/hotkeys`, …) are explicitly excluded from `get_commands`** and "would not execute if sent via `prompt`." [rpc.md §get_commands Note](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

The three approval-**adjacent** (but distinct) mechanisms:

| Mechanism | What it actually does | Is it a tool-permission system? |
|---|---|---|
| **Project trust** (`defaultProjectTrust`, trust.json, `--approve`) | Gates *loading* of project settings/resources/packages/extensions — i.e., **trust-on-project**, decided once. | No. Not per-tool-call. |
| **Extension UI dialogs** (`ctx.ui.select`/`confirm`/`input`) | Lets an *extension* build its own ask-the-user flow over the `extension_ui_request`/`extension_ui_response` sub-protocol. | No. Optional, extension-driven, not built-in gating. |
| **Skill `allowed-tools` frontmatter** (experimental) | Pre-approves a set of tools *for that skill* only. | Closest analog, but **experimental and skill-scoped**, not a global permission gate. |

**Conclusion:** A Settings UI built for pi should NOT include a Claude-Code-style permission/allow-list panel — there is nothing to bind it to. If approval UX is required, it must be implemented as a pi **extension** using `ctx.ui.confirm()`/`ctx.ui.select()` over the extension UI sub-protocol, and/or via the experimental skill `allowed-tools`.

---

## Findings (key takeaways)

1. **Three config layers, clearly separable.** Live RPC setters mutate the running session; `settings.json` holds startup defaults; CLI/env are launch-time. A good UI shows the live value (via `get_state`) and offers to "make default" by writing `settings.json`. [rpc.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md) · [settings.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)
2. **Eight live setters** a UI can call directly: `set_model`, `cycle_model`, `set_thinking_level`, `cycle_thinking_level`, `set_steering_mode`, `set_follow_up_mode`, `set_auto_compaction`, `set_auto_retry`, `set_session_name`. [rpc.md §Model/§Thinking/§Queue Modes/§Compaction/§Retry/§Session](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)
3. **Thinking levels are fixed**: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` (`xhigh` = OpenAI codex-max only). `thinkingBudgets` lets you override token budgets per level. [rpc.md §set_thinking_level](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md) · [settings.md §thinkingBudgets](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)
4. **Model picker data** comes from `get_available_models` (full `Model` objects) + `get_state.model`. The cycling set is `enabledModels` (settings) / `--models`. [rpc.md §get_available_models](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)
5. **Skills/slash commands** are enumerated by `get_commands` (sources `extension|prompt|skill`, locations `user|project|path`); toggle registration with `enableSkillCommands`. [rpc.md §get_commands](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md) · [skills.md](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md)
6. **Project trust has no RPC command** — non-interactive clients must use `defaultProjectTrust: "always"`, trust.json, or `--approve`. [settings.md §Project Trust](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md)
7. **No permission/approval system exists** (see §6). Do not model one.

---

## Sources

**Kept (primary, all from pi-mono `packages/coding-agent/docs/`):**
- `rpc.md` (<https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md>) — authoritative RPC protocol: all commands, `get_state`, thinking levels, `get_commands`, extension UI sub-protocol. Source for Tables A–C.
- `settings.md` (<https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/settings.md>) — authoritative `settings.json` schema, persistence/merge rules, project trust. Source for Tables D–E and §4.
- `skills.md` (<https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md>) — skill discovery, frontmatter, `/skill:` commands. Source for Table F.
- `json.md` (<https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/json.md>) — `--mode json` event stream + `AgentSessionEvent`/`AgentEvent` type refs. Confirms event surface (useful for live UI binding).

**Cross-referenced (type definitions, not fetched):** `packages/ai/src/types.ts` (`Model`), `packages/agent/src/types.ts` (`AgentEvent`), `src/modes/rpc/rpc-types.ts` (RPC command types), `src/core/agent-session.ts` (`AgentSession` programmatic API). [rpc.md §Types](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md)

**Dropped:** none — all four retrieved docs are primary and used.

---

## Gaps / Next steps

1. **Do live RPC setters persist?** Docs confirm they change the live session + `get_state`, but do not state whether `set_model`/`set_thinking_level`/queue-mode setters flush to `settings.json`. **Action:** confirm against `src/modes/rpc/rpc-handler.ts` (or ask pi to set a model, restart, and read `get_state`/settings.json). Until confirmed, treat as session-scoped; persist via `settings.json` + restart.
2. **`packages.md` not staged** (referenced by settings.md for package management). Raw URL: <https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/packages.md>. Needed only if the UI manages package install/uninstall.
3. **No "trust project" RPC command** exists in rpc.md. If the UI must trust/untrust projects, it writes `~/.pi/agent/trust.json` (schema undocumented here) or sets `defaultProjectTrust`. **Action:** inspect trust.json schema in `src` if a trust panel is wanted.
4. **Exact line numbers** were not captured (read was full-file). Section anchors above are durable; line refs available on request from `src/modes/rpc/rpc-types.ts`.
5. **`xhigh` eligibility & provider/model availability** depend on provider config; `get_available_models` is the runtime source of truth for what `set_model`/`cycle_model` can actually select.

## Supervisor coordination
No further coordination needed — supervisor staged all required primary docs locally; analysis complete.
