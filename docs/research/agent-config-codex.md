# codex (`codex app-server`) — Configuration Surface

> Researched from `openai/codex` primary source: `codex-rs/protocol/src/protocol.rs`
> (fetched from `raw.githubusercontent.com/openai/codex/main/...`). Wire names
> below are verified against the Rust enum serde renames, not guessed.

codex is driven over its `app-server` JSON-RPC. The two safety knobs —
**`approval_policy`** and **`sandbox_policy`** — are NOT launch-only flags: they
ride on `thread/start` and `turn/start` requests (see `protocol.rs` ~3244/3879:
`pub approval_policy: AskForApproval`, `pub sandbox_policy: SandboxPolicy`,
`pub model: String`), so they can be set per-session/per-turn from the bridge.

## approval_policy (`AskForApproval`, `protocol.rs:901`)

`#[serde(rename_all = "kebab-case")]` + per-variant `#[strum(serialize = ...)]`.

| Wire value | Rust variant | Meaning |
|---|---|---|
| `untrusted` | `UnlessTrusted` | Only "known safe" read-only commands auto-approve; everything else asks. |
| `on-request` | `OnRequest` (default; alias `on-failure`) | The model decides when to ask. |
| `never` | `Never` | Never ask; failures returned to the model, never escalated. |
| `granular` | `Granular(GranularApprovalConfig)` | Per-category allow/reject (advanced). |

For a Settings UI, surface the three simple values: **untrusted / on-request / never**.

## sandbox_policy (`SandboxPolicy`, `protocol.rs:988`)

Tagged union: `#[serde(tag = "type", rename_all = "kebab-case")]` — so the wire
form is `{ "type": "<variant>", ... }`.

| Wire `type` | Rust variant | Meaning / extra fields |
|---|---|---|
| `danger-full-access` | `DangerFullAccess` | No restrictions. Use with caution. |
| `read-only` | `ReadOnly` | Read-only disk; extra `network_access: bool` (default false). |
| `workspace-write` | `WorkspaceWrite` | Read-only + write to cwd ("workspace"); extras `writable_roots: string[]`, `network_access: bool`. |
| `external-sandbox` | `ExternalSandbox` | Process already sandboxed externally; `network_access`. |

For a Settings UI, surface the three modes the codex CLI itself offers:
**read-only / workspace-write / danger-full-access** (matching the plan's §2).

## model

`model: String` on `thread/start` / `turn/start` — the model id (e.g.
`gpt-5-codex`). Settable per request (not only `config.toml`).

## Where else config lives

- `~/.codex/config.toml` / project `config.toml`: persisted defaults for `model`,
  `approval_policy`, `sandbox_policy`, MCP servers, etc. (the bridge does NOT
  write these — it sends values per request.)
- `docs/config.md` only points at the external config reference
  (developers.openai.com/codex/config-*).

## Notes for the bridge adapter

Our codex adapter (`apps/bridge-cli/src/adapters/codex.ts`) currently sends
`thread/start { cwd }` and `turn/start { threadId, input }` with no
`approval_policy`/`sandbox_policy`/`model` — so codex uses its config.toml
defaults. To apply a persisted config, thread those fields into the
`thread/start` (or `turn/start`) request body. (Verified against the protocol
types; the exact request that wins for a mid-session change still needs a
real-machine check, but the fields are accepted on `thread/start`.)
