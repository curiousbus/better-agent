# Integrations merge + tool-config cascading picker — report

Status: **DONE**

## Part 1 — Integrations account detail page: one merged toolkit table

### Files deleted
- `apps/web/src/components/integrations/agent-tools-section.tsx` — removed. Confirmed via grep it was only imported by `account-detail.tsx`.
- `apps/web/src/components/integrations/connections-section.tsx` — removed. Its logic (list active connections, disconnect mutation + confirm) was folded into `toolkits-section.tsx`. Confirmed via grep it was only imported by `account-detail.tsx` (and mentioned in a comment in `toolkits-section.tsx`).

### Files modified
- `apps/web/src/components/integrations/toolkits-section.tsx` (288 lines) — full rework. Joins `orpc.composio.toolkits({accountId})` (catalog) with `orpc.composio.connections({accountId})` (active connections, matched by `toolkitSlug` case-insensitively) into one `MergedRow[]`. Table columns: Toolkit (name), Slug (mono muted), Status (green `CheckCircle2Icon` + `text-green-600 dark:text-green-500` + sr-only "Connected", or muted `—`), Actions (connected → `DeleteConfirm` icon button calling `orpc.composio.disconnect({accountId, connectionId})` then invalidating `orpc.composio.connections.key()`; unconnected → existing Connect button, still routed through `keySchemeFor` / `useOauthPopup` / `ConnectKeyDialog` unchanged). Search box filters by name/slug (unchanged behavior). Sort: connected rows first, then alphabetical by toolkit name. Loading/empty/error states reuse `queryPlaceholder`.
- `apps/web/src/components/integrations/account-detail.tsx` (30 lines) — now renders just the heading + `<ToolkitsSection accountId={accountId} />`; removed the `AgentToolsSection` and `ConnectionsSection` imports/usages.
- `apps/web/src/components/integrations/integrations-skeleton.tsx` (64 lines) — `AccountDetailSkeleton` now renders a single `SectionSkeleton` (was two, mirroring the now-removed split sections).

No other files imported the deleted components (verified with repo-wide grep before and after).

## Part 2 — Agent wizard Tools step: cascading tool picker

Kept the exact same form contract: `form.toolAllowlist: string[] | null`, `set({ toolAllowlist })`; the "All tools" / "Selected tools" `ModeToggle` is unchanged (switching to Selected still seeds all currently-known tool names via `allToolNames(groups)`; switching to All still sets `null`).

Split into three files to stay under the 300-line cap (the single-file version came out to 340 lines):

- `apps/web/src/components/agents/tool-allowlist-groups.ts` (125 lines, new) — data layer, no JSX. `ToolRow`/`ToolGroup`/`Mode` types, `modeOf`, `allToolNames`, `prefixOf` (splits a composio tool name on the first `_`), `buildComposioGroups` (flattens tools across **all** linked composio accounts and groups by name prefix, e.g. `GMAIL_SEND_EMAIL` → group `GMAIL`, regardless of which account it came from), `buildMcpGroups` (one group per linked MCP server, as before), `useToolSources` (same queries as before — `orpc.composio.tools` per accountId, `orpc.mcp.tools` per serverId, via `useQueries`; exposes aggregate `isPending`/`errors`; groups are only built once nothing is pending), and `useToolToggles` (the single-tool and whole-group toggle handlers, extracted out of the field component to keep it under the 50-line function cap).
- `apps/web/src/components/agents/tool-picker.tsx` (156 lines, new) — the cascading `DropdownMenu` UI, patterned directly on `packages/ui/src/components/chat/session-picker.tsx`: `DropdownMenuSub`/`SubTrigger`/`SubContent` for level-1 groups (label + "checked/total" count), `DropdownMenuCheckboxItem` rows for level-2 tools (mono, truncated, `closeOnClick={false}`), a `GroupBulkActions` "Select all / Clear" pair (`DropdownMenuItem`, `closeOnClick={false}`) at the top of each `SubContent` (`max-h-72 w-72 overflow-y-auto`). Trigger button shows "Configure tools — N selected" and is disabled with "Loading tools…" while any source query is pending; errors render as destructive text under the trigger.
- `apps/web/src/components/agents/tool-allowlist-field.tsx` (88 lines, rewritten) — now just wires `ModeToggle` + `ToolPicker` together via `useToolSources`/`useToolToggles`; the old flat checkbox list (`ToolCheckboxRow`, `SourceGroupSection`, `SourceGroupSkeleton`, per-account grouping) is gone.

Data fetching is unchanged from before (same queries, same hooks pattern — `useQueries` over `orpc.composio.tools` per accountId and `orpc.mcp.tools` per serverId), just regrouped: composio tools are pooled across accounts and grouped by name prefix instead of one group per account; MCP stays one group per server.

`apps/web/src/components/agents/agent-wizard-steps.tsx` (unmodified) still imports `ToolAllowlistField` from `./tool-allowlist-field` with the same `form`/`set` props — contract preserved, verified via grep.

## Checks run

- `pnpm dlx ultracite fix <changed files>` — "Checked 6 files … No fixes applied" (clean both before and after the eslint fix for the 51-line function).
- `pnpm check-types` — **7/7** tasks successful.
- `npx eslint <changed files>` — **0 errors** (initially 1 error: `ToolAllowlistField` was 51 lines, 1 over the 50-line cap; fixed by extracting `useToolToggles` into `tool-allowlist-groups.ts`; re-ran clean).
- `pnpm -F web test` — **32/32** tests passed (8 test files).

## Line counts (constraint: ≤299 lines)

| File | Lines |
|---|---|
| `integrations/account-detail.tsx` | 30 |
| `integrations/toolkits-section.tsx` | 288 |
| `integrations/integrations-skeleton.tsx` | 64 |
| `agents/tool-allowlist-field.tsx` | 88 |
| `agents/tool-allowlist-groups.ts` | 125 |
| `agents/tool-picker.tsx` | 156 |

All well within budget (`toolkits-section.tsx` is the tightest at 288/299 since it absorbed the deleted `connections-section.tsx`).

## Notes / anything unfinished

- No new dependencies added; no regex literals introduced; no `any`; no magic numbers besides -1/0/1 (`prefixOf` compares `indexOf` to `-1`, empty-array/length checks use `0`).
- Not manually verified in a running browser (per house rule, browser testing is left to the user) — recommend clicking through: (1) an integrations account detail page with a mix of connected/unconnected toolkits to confirm sort order, delete-confirm flow, and search filtering; (2) the agent wizard Tools step in "Selected tools" mode with at least one composio account and one MCP server linked, to confirm the cascading menu groups, per-group counts, "Select all"/"Clear", and that the safe-triangle hover behavior feels right.
- No commits were made, per instructions.
