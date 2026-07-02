# Phase 3 — Admin Customer Back-office (design spec)

**Goal:** apps/admin stops managing agents/composio and instead manages CUSTOMERS: a customer list, a customer detail (basic info / activity timeline / AI usage / block), and the ability to block a customer (which immediately cuts them off). All admin tables lose their borders (moved from Phase 5 since we're touching admin tables anyway).

**Depends on:** Phase 1 (per-user agents), Phase 2 (usage aggregation), and the activity_events log (already built). Reuses `usage.dailySummary` and `activity` for per-customer views.

## Current state (verified earlier)
- Users: one `users` table, `kind` = "customer" | "staff"; NO `blocked` field. `admin.listStaff` exists; no customer list.
- `authorizedUserProcedure` gates web data routes (invite gate; staff bypass). This is where a block check belongs.
- Admin nav (`apps/admin/src/components/sidebar.tsx`): Providers / Agents / Composio / Users(staff). Uses AppShellSidebar.
- Tables use the shared `packages/ui/.../table.tsx` (TableRow/TableHeader `border-b`).
- `refresh_tokens` table exists (for killing sessions on block).
- Decisions locked: block = **gate + immediately revoke refresh tokens** (force sign-out). Usage/activity are already strictly per-user.

## Design decisions
1. **`users.blocked`** boolean (+ `blockedAt` timestamp), default false. Migration. Enforce in `authorizedUserProcedure`: a blocked user → `FORBIDDEN "Your account has been suspended"`. Also block token refresh (the `refresh` endpoint) so access can't be renewed.
2. **Block action = revoke all refresh tokens.** `admin.blockUser(userId)` sets blocked=true + `refreshToken.deleteByUser(userId)` (new store method) so existing sessions can't refresh → forced out within the access-token TTL (15 min) and immediately for any refresh. `admin.unblockUser` clears the flag.
3. **Admin customer endpoints** (`admin` router, adminProcedure):
   - `listCustomers({ search?, page? })` → paginated customers (kind="customer") with email, joined, blocked.
   - `getCustomer(id)` → basic info (email, kind, createdAt, emailVerifiedAt, blocked) + agent count.
   - `blockUser(id)` / `unblockUser(id)`.
   - For a customer's usage + activity, add admin variants that take a userId: `usage.summaryFor({ userId, windowDays })` and `activity.listFor({ userId })` (adminProcedure) — OR extend admin router. Reuse the existing `usage.dailySummary(userId, since)` and `activity.listByUser(userId)` stores.
4. **Admin nav**: remove Agents + Composio items; add **Customers**. Keep Providers + Users(staff). (Agent/composio routes+components can stay in the codebase but are unlinked; deleting them is optional cleanup.)
5. **Admin customer UI**:
   - `/customers` list: table (Avatar+email, joined, status badge, blocked?) with search + pagination, row → detail.
   - `/customers/$userId` detail: Basic info card; **Activity timeline** (reuse a timeline component; login / created agent … newest first); **AI Usage** (the same input/output double-line chart from web, windowed 3/7/12D); a **Block/Unblock** button (confirm) with the "immediately signs them out" note.
6. **Borderless tables**: change `packages/ui/.../table.tsx` — drop `border-b` from `TableRow`/`TableHeader`/`TableFooter` (and the `rounded-lg border` wrappers at call sites). Affects web + admin (both wanted borderless).

## Data model
```
ALTER TABLE users ADD COLUMN blocked boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN blocked_at timestamptz;
```
Stores: `UserStore.setBlocked(id, blocked)`, `UserStore.listCustomers({search, limit, offset})`, `RefreshTokenStore.deleteByUser(userId)`.

## Tasks (SDD)
1. DB: `users.blocked/blockedAt` + migration; UserStore.setBlocked/listCustomers; RefreshTokenStore.deleteByUser. Tests.
2. API: enforce blocked in authorizedUserProcedure + refresh; admin.listCustomers/getCustomer/blockUser/unblockUser; admin usage/activity-for-user. Tests (blocked → FORBIDDEN; block revokes tokens; isolation).
3. Admin UI: nav (remove agents/composio, add Customers); `/customers` list; `/customers/$userId` detail (basic/timeline/usage/block). Borderless via ui Table change.

## Global constraints
No `any`; magic numbers only -1/0/1; files ≤300 lines; functions ≤50; deps pinned. Migrations via drizzle-kit generate (deploy applies). Work on dev.
