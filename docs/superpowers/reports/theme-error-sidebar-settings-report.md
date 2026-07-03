# Theme / Error Page / Sidebar / Settings — Implementation Report

Status: **DONE**

No commits were made (per instructions) — all changes are in the working tree on branch `dev`.

## 1. Rocket loader backdrop

- `apps/web/src/components/rocket-loader.tsx` — the scene container now has
  `rounded-3xl bg-muted/40` alongside the existing `relative size-44 overflow-hidden`.
  Nothing else in the file changed.

## 2. Generic error page

- **New** `apps/web/src/components/error-page.tsx` — full-height centered state with
  a muted `CloudAlert` icon, "Something went wrong" title, one line of copy ("The
  error has been logged to the console."), and two buttons: "Reload"
  (`window.location.reload()`, outline variant) and "Back to home"
  (`window.location.href = "/dashboard"`, default variant). No raw error text is
  rendered.
- **Modified** `apps/web/src/router.tsx` — added `defaultErrorComponent:
  RouterErrorComponent` to `createTanStackRouter`. `RouterErrorComponent` calls a
  small `logRouterError(error)` helper that does the actual `console.error`, marked
  with `// biome-ignore lint/suspicious/noConsole: error boundary is the legitimate
  exception to the console ban` (verified the exact rule name via `biome.json` →
  `linter.rules.suspicious.noConsole`; there was no prior `noConsole` biome-ignore
  precedent in the repo to copy, so the comment text was written fresh but the rule
  id was confirmed against the config). Note: the repo's own eslint `no-console` rule
  is only `"warn"`, so it doesn't need suppression to hit "0 errors."

## 3. Light/dark toggle

- **New** `apps/web/src/utils/theme.ts` — `getStoredTheme()`, `applyTheme(theme)`,
  `initTheme()`, `toggleTheme()`, all keyed off `localStorage["theme"]` and the
  `dark` class on `document.documentElement`, matching the `@custom-variant dark`
  class-based setup in `packages/ui/src/styles/globals.css`.
- **FOUC handling**: confirmed via `@tanstack/router-core`'s `route.d.ts` that
  `head()` supports a `scripts` field typed as `AnyRouteMatch['headScripts']` →
  `RouterManagedScriptTag` (`{ attrs?, children?: string }`), so no fallback to a
  client-only `initTheme()` call was needed. `apps/web/src/routes/__root.tsx` now
  defines a top-level `THEME_INIT_SCRIPT` string (reads `localStorage.theme`, falls
  back to `matchMedia("(prefers-color-scheme: dark)")`, toggles the `dark` class) and
  passes it as `head: () => ({ ..., scripts: [{ children: THEME_INIT_SCRIPT }] })`.
  This renders as a blocking inline `<script>` in `<head>` before `<body>` paints, so
  a stored dark preference never flashes light first. `theme.ts`'s own `initTheme()`
  is still exported for completeness/testability but isn't required for FOUC
  avoidance since the inline script (duplicated, intentionally small logic) already
  covers it.
- **New** `apps/web/src/components/theme-toggle.tsx` — ghost icon button (`size="icon-sm"`),
  shows `Sun` when dark / `Moon` when light, `aria-label` reflects the action,
  calls `toggleTheme()` and updates local `isDark` state from its return value.
- **Modified** `apps/web/src/components/sidebar.tsx` — footer is now
  `<div className="flex items-center gap-1"><UserMenu /><ThemeToggle /></div>`.
- **Modified** `apps/web/src/components/user-menu.tsx` — its root trigger `<button>`
  className changed from `w-full` to `min-w-0 flex-1` so it shares the footer row
  with `ThemeToggle` instead of overflowing it (its email `<span>` already had
  `truncate`; `min-w-0` on the flex item is what makes that truncation work again
  inside the new row).

## 4. Sidebar active-state: extra matches + stronger visuals

- `packages/ui/src/components/app-shell-nav.tsx`:
  - `NavChild` gained `match?: readonly string[]`.
  - `isActivePath(pathname, to, match?)` now also returns `true` if `match` has any
    prefix the pathname starts with. All four call sites (`CollapsedNavGroup`,
    `PopoverNavLink`, `ExpandedNavGroup`, `SubNavLink`'s caller, `CollapsibleNavItem`)
    were updated to pass `item.match` / `child.match` through.
  - `apps/web/src/components/sidebar.tsx`: the Agents item now has
    `match: ["/chat"]`.
- `packages/ui/src/components/sidebar.tsx` — `sidebarMenuButtonVariants` (CVA, was
  line ~462) active treatment changed from `data-active:bg-sidebar-accent
  data-active:font-medium data-active:text-sidebar-accent-foreground` to
  `data-active:bg-primary/10 data-active:font-semibold data-active:text-primary`,
  plus a `relative` base class and a left accent bar via `data-active:before:*`
  utilities (`absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary
  content-['']`). The bar is hidden when collapsed
  (`group-data-[collapsible=icon]:before:hidden`) since there's no room for it
  next to the icon-only rail.
- **Judgment call beyond the literal instructions**: `app-shell-sidebar.tsx` /
  `app-shell-nav.tsx` render nav buttons with a shared `ACTIVE_BUTTON_CLASS` that
  previously *overrode* the CVA's `data-active:bg-*` / `text-*` / `font-*` with its
  own `data-active:bg-transparent data-active:font-medium
  data-active:text-sidebar-accent-foreground` (tailwind-merge keeps the
  last-applied class per utility group, and `ACTIVE_BUTTON_CLASS` is merged in after
  the CVA output). Left as-is, the new CVA styling would have been completely
  invisible in both apps/web and apps/admin (only the new left bar would show,
  still with the old gray "active" text/background). I updated `ACTIVE_BUTTON_CLASS`
  to drop those three active-state overrides, keeping only the inactive-hover
  treatment (`not-data-active:hover:*`) and the `relative z-10` stacking needed for
  the existing `ActiveHighlight` motion slider. The slider (`bg-sidebar-accent
  ring-1 ring-sidebar-border`) still renders behind the button and still animates
  between items on navigation — the button's own `bg-primary/10` sits on top of it
  (semi-transparent, so both layers are visible), giving a tinted, clearly "active"
  pill with primary-colored bold text and the left accent bar. This wasn't named in
  the task's file list but was necessary for the "clearly visible" requirement to
  actually manifest; it's shared by web and admin as intended.
  - Verified: `pnpm check-types` (includes `@better-agent/admin`) and
    `pnpm -F web test` both pass, so this didn't break either app's sidebar.

## 5. Integrations page → settings layout

- `apps/web/src/routes/integrations.index.tsx` rewritten as a two-pane settings
  layout:
  - `validateSearch` adds an optional `tab?: "composio" | "mcp"` search param
    (kept optional so existing `<Link to="/integrations">` callers elsewhere in the
    app — `composio-accounts-field.tsx`, `mcp-servers-field.tsx`,
    `integrations.$accountId.tsx` — don't need a `search` prop; the component
    defaults to `"composio"` when absent). This means the selected tab survives a
    refresh via the URL, as requested.
  - Left rail: `<nav className="flex shrink-0 flex-row gap-1 sm:w-48
    sm:flex-col">` with two `<Link>`-based tab items ("Composio", "MCP Servers"),
    active tab styled `bg-primary/10 font-medium text-primary rounded-md` (same
    treatment as the sidebar).
  - Right: `{tab === "composio" ? <AccountsList /> : <McpServersSection />}` — both
    components unchanged.
  - Responsive: outer container is `flex-col sm:flex-row` (stacked, rail-above-content
    on mobile) with the rail itself `flex-row sm:flex-col` (horizontal tabs on
    mobile, vertical column at `sm:` and up), per the spec.
  - `integrations.$accountId.tsx` (composio account detail route) was not touched.

## Files created

- `apps/web/src/components/error-page.tsx`
- `apps/web/src/utils/theme.ts`
- `apps/web/src/components/theme-toggle.tsx`

## Files modified

- `apps/web/src/components/rocket-loader.tsx`
- `apps/web/src/router.tsx`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/components/sidebar.tsx`
- `apps/web/src/components/user-menu.tsx`
- `packages/ui/src/components/app-shell-nav.tsx`
- `packages/ui/src/components/app-shell-sidebar.tsx`
- `packages/ui/src/components/sidebar.tsx`
- `apps/web/src/routes/integrations.index.tsx`

## Check outputs

- `pnpm dlx ultracite fix <all changed/new files>` → `Checked 12 files. No fixes
  applied.`
- `pnpm check-types` → **7/7 packages passed** (web, admin, ui, agent, server,
  agent-client, authz).
- `npx eslint <all changed/new files>` → **4 errors, 8 warnings**, all in
  `packages/ui/src/components/sidebar.tsx` (`SidebarProvider`/`Sidebar` line-count
  and complexity, plus pre-existing magic-number warnings) — confirmed via `git
  stash` + re-run that every one of these errors/warnings is byte-for-byte
  pre-existing on `dev` before this change (the CVA string edit added 0 new lines
  to any function body). **0 new errors or warnings introduced.**
- `node scripts/check-tailwind.js <changed .tsx files>` → `✅ Tailwind CSS 检查通过`
  (pass). Verified the `content-['']` arbitrary-value bracket and the
  `BODY_CLASS[body.kind]`-style lookups don't trip the checker: `content-['']`
  lives inside the CVA string on its own line (never on the same line as `cva(`,
  which is what the checker's regex requires to flag it), and all existing
  object/array lookups (`BODY_CLASS[body.kind]`, `BODY_OPACITY[body.kind]`) were
  already hoisted to local consts before being used in `className={...}` — no new
  bracket-indexing was introduced inside a className line.
- `pnpm -F web test` → **32/32 tests passed** (8 test files).

## Notes / things a reviewer may want to sanity-check visually

- The stronger sidebar active state (task 4) changes both `apps/web` and
  `apps/admin` since `packages/ui`'s `SidebarMenuButton`/`app-shell-nav` are
  shared — this is the intended, desired blast radius per the task.
- No manual browser verification was performed (per house rule: finish UI work and
  hand off for the user to test rather than driving a browser).
