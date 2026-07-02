# Web UI Batch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 UI issues across apps/web and packages/ui — avatars, dashboard route, eager-session chat flow, "Thinking…" centering, rounded user bubble, copy icon alignment, and activity timeline.

**Architecture:** Items 1–7 are surgical edits to existing files; item 8 adds a new Timeline component used only in the dashboard route. The DiceBear avatar helper lives in `apps/web/src/utils/avatar.ts`; it stays out of packages/ui. The message-avatar threading (item 1, chat-row) is deferred — `packages/ui` must not import from `apps/web`, and the invasive prop-drilling was ruled non-blocking by the spec.

**Tech Stack:** React 19, TanStack Router v5, oRPC + TanStack Query, shadcn/base-ui via `@better-agent/ui`, Sonner toasts, Lucide icons, Biome/Ultracite linting.

## Global Constraints

- No `any` types anywhere.
- Magic numbers: only -1/0/1 are bare literals; all others must be named constants.
- Every file ≤ 300 lines; every function/component/callback ≤ 50 lines (split if needed).
- `pnpm dlx ultracite fix` must pass on all changed files.
- `pnpm -F web check-types` and root `pnpm check-types` must pass.
- `npx eslint <changed files>` must be 0 errors.
- `pnpm -F web test` must still pass.
- Do NOT git commit — the controller commits.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `apps/web/src/utils/avatar.ts` | **Create** | DiceBear URL helpers (`agentAvatar`, `userAvatar`) |
| `apps/web/src/components/chat/agent-grid.tsx` | **Modify** | Add Avatar to AgentCard |
| `apps/web/src/components/agents/agents-card.tsx` | **Modify** | Add Avatar to name cell in AgentRows |
| `apps/web/src/components/user-menu.tsx` | **Modify** | Replace letter-span with Avatar |
| `apps/web/src/routes/dashboard.tsx` | **Create** | Move DashboardPage here + add Timeline section |
| `apps/web/src/routes/index.tsx` | **Modify** | Replace with redirect to /dashboard |
| `apps/web/src/components/sidebar.tsx` | **Modify** | Dashboard nav item → `/dashboard` |
| `apps/web/src/routes/chat.tsx` | **Modify** | Skip STEP_COMPOSER — eager session creation on agent-select |
| `apps/web/src/components/chat/web-composer.tsx` | **Delete** | No longer needed |
| `packages/ui/src/components/chat/chat-row.tsx` | **Modify** | Center "Thinking…"; tidy CopyAction alignment |
| `packages/ui/src/components/bubble.tsx` | **Modify** | Default variant → `rounded-2xl` |
| `apps/web/src/components/dashboard/activity-timeline.tsx` | **Create** | Timeline component (item 8) |

---

### Task 1: Avatar Helper

**Files:**
- Create: `apps/web/src/utils/avatar.ts`

**Interfaces:**
- Produces:
  - `agentAvatar(seed: string): string` — returns DiceBear bottts-neutral SVG URL
  - `userAvatar(seed: string): string` — returns DiceBear thumbs SVG URL

- [ ] **Step 1: Create the file**

```typescript
// apps/web/src/utils/avatar.ts
const DICEBEAR_BASE = "https://api.dicebear.com/9.x";

export const agentAvatar = (seed: string): string =>
  `${DICEBEAR_BASE}/bottts-neutral/svg?seed=${encodeURIComponent(seed)}`;

export const userAvatar = (seed: string): string =>
  `${DICEBEAR_BASE}/thumbs/svg?seed=${encodeURIComponent(seed)}`;
```

- [ ] **Step 2: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/utils/avatar.ts
```

Expected: no issues (or auto-fixed cleanly).

---

### Task 2: Agent Avatar on AgentCard (chat grid)

**Files:**
- Modify: `apps/web/src/components/chat/agent-grid.tsx`

**Interfaces:**
- Consumes: `agentAvatar` from `@/utils/avatar`, `Avatar`/`AvatarImage`/`AvatarFallback` from `@better-agent/ui/components/avatar`

- [ ] **Step 1: Rewrite agent-grid.tsx**

The file is 49 lines. Add the avatar to `AgentCard`, keeping the card under 50 lines. The final file:

```typescript
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@better-agent/ui/components/avatar";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";

function AgentCard({
  agent,
  onSelect,
}: {
  agent: AgentRow;
  onSelect: (agent: AgentRow) => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onSelect(agent)}
      type="button"
    >
      <Avatar size="default">
        <AvatarImage alt={agent.name} src={agentAvatar(agent.id)} />
        <AvatarFallback>{agent.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-medium text-sm">{agent.name}</span>
        <span className="truncate font-mono text-muted-foreground text-xs">
          {agent.providerId}/{agent.modelId}
        </span>
      </div>
    </button>
  );
}

export function AgentGrid({
  agents,
  onSelect,
}: {
  agents: AgentRow[];
  onSelect: (agent: AgentRow) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        No agents available.
      </div>
    );
  }
  return (
    <section
      aria-label="Agents"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {agents.map((agent) => (
        <AgentCard agent={agent} key={agent.id} onSelect={onSelect} />
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/components/chat/agent-grid.tsx
```

---

### Task 3: Agent Avatar on Agents Table (name cell)

**Files:**
- Modify: `apps/web/src/components/agents/agents-card.tsx`

**Interfaces:**
- Consumes: `agentAvatar` from `@/utils/avatar`, `Avatar`/`AvatarImage`/`AvatarFallback` from `@better-agent/ui/components/avatar`

The `AgentRows` function (lines 51–83) renders `<TableCell className="font-medium">{row.name}</TableCell>`. Replace the name cell content with an avatar + name flex row. Total function stays ≤ 50 lines.

- [ ] **Step 1: Add imports to agents-card.tsx**

Add to the existing imports at the top (after the existing `import { CopyAction }...` line):

```typescript
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@better-agent/ui/components/avatar";
import { agentAvatar } from "@/utils/avatar";
```

- [ ] **Step 2: Update name cell in AgentRows**

Replace:
```typescript
<TableCell className="font-medium">{row.name}</TableCell>
```

With:
```typescript
<TableCell>
  <div className="flex items-center gap-2">
    <Avatar size="sm">
      <AvatarImage alt={row.name} src={agentAvatar(row.id)} />
      <AvatarFallback>{row.name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
    <span className="font-medium">{row.name}</span>
  </div>
</TableCell>
```

- [ ] **Step 3: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/components/agents/agents-card.tsx
```

---

### Task 4: User Menu Avatar

**Files:**
- Modify: `apps/web/src/components/user-menu.tsx`

**Interfaces:**
- Consumes: `userAvatar` from `@/utils/avatar`, `Avatar`/`AvatarImage`/`AvatarFallback` from `@better-agent/ui/components/avatar`

Currently lines 39–41 render a `<span>` circle with just the initial. Replace with `<Avatar size="sm">`.

- [ ] **Step 1: Add imports**

Add to top of `apps/web/src/components/user-menu.tsx`:

```typescript
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@better-agent/ui/components/avatar";
import { userAvatar } from "@/utils/avatar";
```

- [ ] **Step 2: Replace letter-span with Avatar**

Replace the `<span className="flex size-7 shrink-0 ...">` block (lines 39–41) with:

```tsx
<Avatar size="sm">
  <AvatarImage alt={email} src={userAvatar(email)} />
  <AvatarFallback>{initial}</AvatarFallback>
</Avatar>
```

The containing `<DropdownMenuTrigger render={<button .../>}>` block stays identical.

- [ ] **Step 3: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/components/user-menu.tsx
```

---

### Task 5: Dashboard Route + Sidebar Update

**Files:**
- Create: `apps/web/src/routes/dashboard.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/components/sidebar.tsx`

**Interfaces:**
- `dashboard.tsx` exports `Route = createFileRoute("/dashboard")` — router picks it up automatically via TSR file-based routing.

- [ ] **Step 1: Create apps/web/src/routes/dashboard.tsx**

Move all dashboard logic from `index.tsx`. The new file will also contain the `ActivityTimeline` import (added in Task 8, but leave a placeholder comment for now). File ≤ 300 lines.

```typescript
// apps/web/src/routes/dashboard.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_WINDOW,
  type WindowDays,
} from "@/components/dashboard/dashboard-constants";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { TokenChart } from "@/components/dashboard/token-chart";
import { useUsageData } from "@/components/dashboard/use-usage-data";
import { WindowToggle } from "@/components/dashboard/window-toggle";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardHeader({
  windowDays,
  onWindowChange,
}: {
  windowDays: WindowDays;
  onWindowChange: (w: WindowDays) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="font-semibold text-lg">Usage</h1>
      <WindowToggle onChange={onWindowChange} value={windowDays} />
    </div>
  );
}

function DashboardBody({
  daily,
  isEmpty,
  isPending,
  totals,
}: {
  daily: ReturnType<typeof useUsageData>["daily"];
  isEmpty: boolean;
  isPending: boolean;
  totals: ReturnType<typeof useUsageData>["totals"];
}) {
  if (isEmpty) {
    return <EmptyState />;
  }
  return (
    <>
      <SummaryCards isPending={isPending} totals={totals} />
      <TokenChart daily={daily} isPending={isPending} />
    </>
  );
}

function DashboardPage() {
  const [windowDays, setWindowDays] = useState<WindowDays>(DEFAULT_WINDOW);
  const { isPending, isError, error, daily, totals, isEmpty } =
    useUsageData(windowDays);

  useEffect(() => {
    if (isError) {
      const message =
        error instanceof Error ? error.message : "Failed to load usage";
      toast.error(message);
    }
  }, [isError, error]);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <DashboardHeader onWindowChange={setWindowDays} windowDays={windowDays} />
      <DashboardBody
        daily={daily}
        isEmpty={isEmpty}
        isPending={isPending}
        totals={totals}
      />
    </div>
  );
}
```

(ActivityTimeline is added in Task 8 by inserting it below `<DashboardBody …/>`.)

- [ ] **Step 2: Replace apps/web/src/routes/index.tsx with redirect**

```typescript
// apps/web/src/routes/index.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
```

- [ ] **Step 3: Update sidebar Dashboard nav item**

In `apps/web/src/components/sidebar.tsx`, change:
```typescript
item: { to: "/", label: "Dashboard", icon: Gauge },
```
to:
```typescript
item: { to: "/dashboard", label: "Dashboard", icon: Gauge },
```

- [ ] **Step 4: Regenerate route tree**

```bash
cd /Users/john/better-agent && pnpm -F web exec tsr generate
```

Expected: `routeTree.gen.ts` updated with `/dashboard` route and `/` redirect.

- [ ] **Step 5: Type-check**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors.

- [ ] **Step 6: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/routes/dashboard.tsx apps/web/src/routes/index.tsx apps/web/src/components/sidebar.tsx
```

---

### Task 6: Eager Session + Skip WebComposer

**Files:**
- Modify: `apps/web/src/routes/chat.tsx`
- Delete: `apps/web/src/components/chat/web-composer.tsx`

**Goal:** When user selects an agent, immediately call `client.userSessions.create`, set `sessionId`, and jump straight to `STEP_CHAT`. Remove `STEP_COMPOSER` and the `WebComposer` landing screen entirely.

**Key changes to chat.tsx:**

1. Remove `STEP_COMPOSER` constant and `WebComposer` import.
2. Change `selectAgent` in `useHomeActions` to be async: call `sendFirstMessage` variant that creates a session but sends no text, then go straight to chat.
3. The `sendFirstMessage` function currently takes `text` and sets `initialText`. For eager creation we need a version that just creates the session (no initial text). Rename and adjust.
4. `HomeContent`: remove the `sessionId === ""` → `WebComposer` branch. After agent is selected, either show a "creating session" spinner (while `sending === true`) or go straight to `ChatPanel` once `sessionId` is set.

**Concrete diff for chat.tsx:**

- [ ] **Step 1: Revise the session-creation logic**

Replace the `sendFirstMessage` function and `SendOpts` interface with a simpler `createSession`:

```typescript
interface CreateSessionOpts {
  agentId: string;
  invalidate: () => Promise<void>;
  setSending: (v: boolean) => void;
  setSessionId: (id: string) => void;
}

async function createSession({
  agentId,
  invalidate,
  setSending,
  setSessionId,
}: CreateSessionOpts): Promise<void> {
  setSending(true);
  try {
    const session = await client.userSessions.create({ agentId });
    await invalidate();
    setSessionId(session.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session";
    toast.error(message);
  } finally {
    setSending(false);
  }
}
```

- [ ] **Step 2: Update HomeActions and useHomeActions**

Remove `send` from `HomeActions` interface. Remove `closeComposer` (it was the "back from WebComposer" action — no longer needed).

Update `selectAgent` in the returned object to trigger `createSession`:

```typescript
selectAgent: (agent: AgentRow) => {
  setSelectedAgent(agent);
  setSessionId("");
  void createSession({
    agentId: agent.id,
    invalidate,
    setSending,
    setSessionId,
  });
},
```

Also remove `send` from useHomeActions's return, and remove `closeComposer`.

- [ ] **Step 3: Update useHomeState**

Remove `initialText` state and its setter (it was only used for the WebComposer → ChatPanel handoff). `ChatView` uses its own internal state for the composer.

The return object no longer exposes `send`, `closeComposer`, or `initialText`.

- [ ] **Step 4: Update ChatPanel and ChatPanelProps**

Remove `initialText` and `onClearInitialText` props — `ChatView` manages its own text:

```typescript
interface ChatPanelProps {
  agent: AgentRow;
  agentClient: AgentClient | null;
  initialGenui: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onSessionChange: (id: string) => void;
  sessionId: string;
  sessions: UserSessionRow[];
}
```

Update the `ChatPanel` component and the `ChatView` usage inside it to drop `initialText` / `onClearInitialText`.

- [ ] **Step 5: Update HomeContent**

Replace the 3-branch logic with 2 branches. When agent is selected but session is being created (`sending === true`), show a spinner. Once `sessionId` is set, show `ChatPanel`. Remove all `WebComposer` usage:

```typescript
function HomeContent({ home }: { home: ReturnType<typeof useHomeState> }) {
  const { selectedAgent, sessionId, sending } = home;
  if (!selectedAgent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AgentGridView onSelect={home.selectAgent} />
      </div>
    );
  }
  if (sending || sessionId === "") {
    return <AgentGridSkeleton />;
  }
  return (
    <ChatPanel
      agent={selectedAgent}
      agentClient={home.agentClient}
      initialGenui={home.genuiOn}
      onClose={home.closeChat}
      onNewSession={home.newSession}
      onSessionChange={home.selectSession}
      sessionId={sessionId}
      sessions={home.sessions}
    />
  );
}
```

- [ ] **Step 6: Update HomePage**

Remove `STEP_COMPOSER` and `StepTransition` step calculation (now only 2 meaningful states). Simplify:

```typescript
const STEP_GRID = 0;
const STEP_CHAT = 1;

function HomePage() {
  const home = useHomeState();
  const step = home.selectedAgent && home.sessionId !== "" ? STEP_CHAT : STEP_GRID;
  return (
    <StepTransition step={step}>
      <HomeContent home={home} />
    </StepTransition>
  );
}
```

- [ ] **Step 7: Remove WebComposer import**

Remove: `import { WebComposer } from "@/components/chat/web-composer";`

- [ ] **Step 8: Delete web-composer.tsx**

```bash
rm /Users/john/better-agent/apps/web/src/components/chat/web-composer.tsx
```

- [ ] **Step 9: Check ChatView for initialText/onClearInitialText**

Read `apps/web/src/components/chat/chat-view.tsx` to confirm `initialText` and `onClearInitialText` props are optional or need to be removed. If they are required, make them optional with defaults.

- [ ] **Step 10: Lint and type-check**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/routes/chat.tsx
pnpm -F web check-types
```

Expected: 0 errors.

---

### Task 7: "Thinking…" Centered + CopyAction Alignment

**Files:**
- Modify: `packages/ui/src/components/chat/chat-row.tsx`

Two sub-items in one file:

**a) "Thinking…" centered:** The `showThinking` span is inside `<div className="flex flex-col gap-2">` in `AssistantBody`. To center it, wrap it in a `flex justify-center w-full`:

Replace:
```tsx
{showThinking ? (
  <span className="shimmer font-medium text-sm">Thinking…</span>
) : null}
```
With:
```tsx
{showThinking ? (
  <div className="flex w-full justify-center">
    <span className="shimmer font-medium text-sm">Thinking…</span>
  </div>
) : null}
```

**b) CopyAction alignment:** The `CopyAction` is rendered bare in the `flex flex-col gap-2` div. Wrap it in an `Actions` wrapper from the same `actions.tsx` (already used elsewhere in the codebase — check if it's already imported, otherwise use a plain div). The goal: left-align with the content (no change needed, it already naturally aligns left), but ensure it sits in a proper row:

Replace:
```tsx
{message.status === "complete" && fullText !== "" ? (
  <CopyAction text={fullText} />
) : null}
```
With:
```tsx
{message.status === "complete" && fullText !== "" ? (
  <div className="flex items-center">
    <CopyAction text={fullText} />
  </div>
) : null}
```

This is a minimal tidy-up — the button is already `size="icon-xs"` with `text-muted-foreground`. The `flex items-center` wrapper ensures vertical centering if additional actions are added later.

- [ ] **Step 1: Edit chat-row.tsx for Thinking… centering**

In `AssistantBody` (lines 87–125), wrap the `showThinking` span as described above.

- [ ] **Step 2: Edit chat-row.tsx for CopyAction**

Wrap the `CopyAction` render in `<div className="flex items-center">` as described above.

- [ ] **Step 3: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix packages/ui/src/components/chat/chat-row.tsx
```

---

### Task 8: Rounded User Bubble

**Files:**
- Modify: `packages/ui/src/components/bubble.tsx`

The `BubbleContent` base class (line 72) contains `rounded-none`. The `ghost` variant explicitly sets `*:data-[slot=bubble-content]:rounded-none` via the `bubbleVariants` cva. So the ghost override will continue to zero-out rounding for assistant messages.

Changing `rounded-none` → `rounded-2xl` in the base class of `BubbleContent` will apply to the default (user) bubble. The ghost variant's explicit `*:data-[slot=bubble-content]:rounded-none` overrides it for assistant messages. Result: user bubbles are rounded, assistant ghost bubbles stay flat.

- [ ] **Step 1: Edit BubbleContent base className**

In `packages/ui/src/components/bubble.tsx`, line 72, change:

```
"wrap-break-word w-fit min-w-0 max-w-full overflow-hidden rounded-none border border-transparent px-2.5 py-2 text-xs leading-relaxed ...
```

To:

```
"wrap-break-word w-fit min-w-0 max-w-full overflow-hidden rounded-2xl border border-transparent px-2.5 py-2 text-xs leading-relaxed ...
```

(Only change `rounded-none` → `rounded-2xl`; leave everything else untouched.)

- [ ] **Step 2: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix packages/ui/src/components/bubble.tsx
```

---

### Task 9: Activity Timeline Component + Dashboard Integration

**Files:**
- Create: `apps/web/src/components/dashboard/activity-timeline.tsx`
- Modify: `apps/web/src/routes/dashboard.tsx` (add `ActivityTimeline` section)

**Interfaces:**
- Consumes: `orpc.activity.list.queryOptions()` — returns `Array<{ id: string; userId: string; type: string; summary: string; metadata: Record<string, unknown> | null; createdAt: string }>` (newest first)
- `relativeTime(iso: string): string` from `@/board/relative-time`

Activity types and their icons:
- `"login"` → `LogInIcon`
- `"agent_created"` → `BotIcon`
- `"agent_deleted"` → `Trash2Icon`
- anything else → `ActivityIcon`

- [ ] **Step 1: Create activity-timeline.tsx**

Keep each sub-component ≤ 50 lines. Split into: `TimelineIcon`, `TimelineItem`, `TimelineSkeleton`, `TimelineEmpty`, `ActivityTimeline`.

```typescript
// apps/web/src/components/dashboard/activity-timeline.tsx
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, BotIcon, LogInIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { relativeTime } from "@/board/relative-time";
import { orpc } from "@/utils/orpc";

type ActivityType = "login" | "agent_created" | "agent_deleted";

type ActivityEvent = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
};

const ICON_MAP: Record<ActivityType, ReactNode> = {
  login: <LogInIcon className="size-4" />,
  agent_created: <BotIcon className="size-4" />,
  agent_deleted: <Trash2Icon className="size-4" />,
};

function isActivityType(type: string): type is ActivityType {
  return type === "login" || type === "agent_created" || type === "agent_deleted";
}

function TimelineIcon({ type }: { type: string }) {
  const icon = isActivityType(type)
    ? ICON_MAP[type]
    : <ActivityIcon className="size-4" />;
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      {icon}
    </div>
  );
}

function TimelineItem({ event }: { event: ActivityEvent }) {
  return (
    <div className="flex items-start gap-3">
      <TimelineIcon type={event.type} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">{event.summary}</span>
        <span className="text-muted-foreground text-xs">
          {relativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

const SKELETON_COUNT = 3;
const SKELETON_KEYS = Array.from({ length: SKELETON_COUNT }, (_, i) => `sk-${i}`);

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {SKELETON_KEYS.map((k) => (
        <div className="flex items-start gap-3" key={k}>
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineEmpty() {
  return (
    <p className="text-muted-foreground text-sm">No activity yet.</p>
  );
}

export function ActivityTimeline() {
  const query = useQuery(orpc.activity.list.queryOptions());
  const events = query.data ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-semibold text-base">Recent Activity</h2>
      {query.isPending ? (
        <TimelineSkeleton />
      ) : events.length === 0 ? (
        <TimelineEmpty />
      ) : (
        <div className="flex flex-col gap-4">
          {events.map((event) => (
            <TimelineItem event={event} key={event.id} />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add ActivityTimeline to dashboard.tsx**

In `apps/web/src/routes/dashboard.tsx`, add the import and render it below `<DashboardBody …/>` in `DashboardPage`:

Add import:
```typescript
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
```

In `DashboardPage`, change the return to:
```tsx
return (
  <div className="flex flex-col gap-6 p-4 sm:p-6">
    <DashboardHeader onWindowChange={setWindowDays} windowDays={windowDays} />
    <DashboardBody
      daily={daily}
      isEmpty={isEmpty}
      isPending={isPending}
      totals={totals}
    />
    <ActivityTimeline />
  </div>
);
```

- [ ] **Step 3: Lint**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/components/dashboard/activity-timeline.tsx apps/web/src/routes/dashboard.tsx
```

---

### Task 10: Final Checks

- [ ] **Step 1: Run ultracite fix on all changed files**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix \
  apps/web/src/utils/avatar.ts \
  apps/web/src/components/chat/agent-grid.tsx \
  apps/web/src/components/agents/agents-card.tsx \
  apps/web/src/components/user-menu.tsx \
  apps/web/src/routes/dashboard.tsx \
  apps/web/src/routes/index.tsx \
  apps/web/src/components/sidebar.tsx \
  apps/web/src/routes/chat.tsx \
  packages/ui/src/components/chat/chat-row.tsx \
  packages/ui/src/components/bubble.tsx \
  apps/web/src/components/dashboard/activity-timeline.tsx
```

- [ ] **Step 2: Type check web**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors.

- [ ] **Step 3: Type check all packages**

```bash
cd /Users/john/better-agent && pnpm check-types
```

Expected: 0 errors across all 7 workspaces.

- [ ] **Step 4: ESLint web files**

```bash
cd /Users/john/better-agent/apps/web && npx eslint \
  src/utils/avatar.ts \
  src/components/chat/agent-grid.tsx \
  src/components/agents/agents-card.tsx \
  src/components/user-menu.tsx \
  src/routes/dashboard.tsx \
  src/routes/index.tsx \
  src/components/sidebar.tsx \
  src/routes/chat.tsx \
  src/components/dashboard/activity-timeline.tsx
```

Expected: 0 errors.

- [ ] **Step 5: ESLint ui files**

```bash
cd /Users/john/better-agent && npx eslint \
  packages/ui/src/components/chat/chat-row.tsx \
  packages/ui/src/components/bubble.tsx
```

Expected: 0 errors.

- [ ] **Step 6: Run tests**

```bash
cd /Users/john/better-agent && pnpm -F web test
```

Expected: all tests pass.

- [ ] **Step 7: Write report**

Write a report to `/Users/john/better-agent/docs/superpowers/reports/ui-batch-report.md` covering:
- Every file created/modified/deleted
- Per-item status (1–8)
- DiceBear styles chosen (bottts-neutral for agents, thumbs for users)
- Whether message-avatar threading was done or deferred
- Check command outputs (pass/fail)
- Any 300/50 line splits
- Anything unfinished or uncertain
- Final verdict: DONE / DONE_WITH_CONCERNS / BLOCKED

---

## Self-Review

**Spec coverage check:**

1. ✅ `agentAvatar`/`userAvatar` helper in `utils/avatar.ts`
2. ✅ AgentCard gets Avatar (Task 2)
3. ✅ Agents table name cell gets Avatar (Task 3)
4. ✅ UserMenu gets Avatar (Task 4)
5. ✅ Message-avatar (chat-row.tsx) — **DEFERRED** per spec guidance: "if threading is too invasive, do user-menu + agent cards and note the message-avatar as deferred". `packages/ui` cannot import from `apps/web`, and threading `userAvatarUrl` down through `ChatRow → ChatView → Conversation` is invasive. Icon fallback is kept.
6. ✅ Dashboard at `/dashboard` created (Task 5)
7. ✅ `index.tsx` redirect (Task 5)
8. ✅ Sidebar `/dashboard` (Task 5)
9. ✅ Eager session + skip WebComposer (Task 6)
10. ✅ web-composer.tsx deleted (Task 6)
11. ✅ "Thinking…" centered (Task 7)
12. ✅ Rounded user bubble (Task 8)
13. ✅ CopyAction tidy alignment (Task 7)
14. ✅ Activity Timeline (Task 9)
15. ✅ All checks run in Task 10

**Placeholder scan:** No TBD/TODO left in plan — all steps contain actual code.

**Type consistency:** `ActivityEvent` type in `activity-timeline.tsx` uses `createdAt: string` (not `Date`) to match the oRPC output. `relativeTime` accepts `string`. `orpc.activity.list.queryOptions()` is called the same way as other list queries in the codebase (e.g. `orpc.agents.list.queryOptions()`).

**Potential concern — ChatView props:** Task 6 Step 9 calls for checking `ChatView`'s `initialText`/`onClearInitialText` props before removing them. If those props are required in the `ChatView` type, they need to be made optional there too. The implementer must read `apps/web/src/components/chat/chat-view.tsx` before completing Task 6.
