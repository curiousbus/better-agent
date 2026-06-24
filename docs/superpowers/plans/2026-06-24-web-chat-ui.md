# Web Chat UI Implementation Plan

> **Auth sub-project 3 of 3** (sub-project 1 = web auth, 2 = user-scoped sessions, both shipped). This ports the admin chat into apps/web: pick an agent → centered input → chat over a user-owned session, reusing the admin chat components.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An authenticated web user lands on a grid of agents (created in admin), clicks one to get a centered composer, sends a message to start a user-owned session, chats in the reused chat view, and can close back to the composer or switch among their own sessions.

**Architecture:** The admin chat components (`use-chat`/`Conversation`/`SessionPicker`) are already parameterized by the `@better-agent/client` `AgentClient` interface. We add a **user-plane `AgentClient`** that talks to `userSessions.*` (sub-project 2) over the web's user-JWT oRPC client, move the chat components into a shared package so both apps use them, and build the web pages (agent grid → composer → chat shell). The web cannot create agents (no UI for it).

**Tech Stack:** TanStack Start (web), `@better-agent/client`, `@better-agent/ui`, `@tanstack/react-query`, oRPC (user JWT). Per the user's standing rule, this plan runs **static checks only** (typecheck/lint) — the browser end-to-end test is the user's.

**Source design (validated):** the original sub-project-3 brief (centered input → chat → close, session select, web can't create agents, "reuse the admin chat, write little code") + the user's decision this session: **agent cards → centered input → chat**.

## Global Constraints

- **Decisions (binding):**
  - **Reuse, don't rewrite:** move `use-chat.ts`/`conversation.tsx`/`session-picker.tsx` (+ the tiny `reveal-text.tsx`) into a shared home `packages/ui/src/components/chat/`, consuming `@better-agent/client` types (`Message`, `MessageHistory`, the per-row message type) instead of admin-local `@/utils/api-types`. Rewire admin to import from the shared home. The components stay `AgentClient`-driven (zero behavioral change).
  - **User-plane client:** add `createUserSessionClientFrom(orpcClient)` to `@better-agent/client` — an `AgentClient` whose `createSession`/`listMessages`/`run`/`stream` call `client.userSessions.*` instead of `client.sessions.*`. The web builds it from its existing user-JWT oRPC client.
  - **`create` takes an agentId on the user plane:** `userSessions.create({ agentId })`. The web's user-plane `createSession` needs the chosen agentId — so the web-side flow passes the selected agent into session creation (the shared `AgentClient.createSession()` is parameterless; the web creates the session by calling `orpc.userSessions.create({agentId})` directly at the page level, then hands the resulting `AgentClient` + sessionId to the reused `Conversation`).
  - **Web flow:** `/` shows a grid of agent cards (`orpc.agents.list` — already public). Click an agent → a MuleRun-style centered composer bound to that agent. On first send: `userSessions.create({agentId})` → switch to the chat view (`Conversation` with the user-plane client + new sessionId). Top-right **close** → back to the composer (same agent) / a way back to the grid. A session `<select>` (the user's own sessions for that agent, `userSessions.list` filtered to the agent) switches sessions; picking none / "new" returns to the composer.
  - **No create-agent UI** in the web. Agents are read-only.
  - Follow the existing MuleRun styling already established in admin (light theme, the `@better-agent/ui` chat primitives) — reuse, don't restyle.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers; kebab-case; specific imports; React: function components, hooks at top level, keys on lists, semantic HTML + a11y (labels/alt/keyboard), no array-index keys. `pnpm dlx ultracite fix <paths>` before each commit; lefthook blocks non-compliant commits.
- **Tests/checks:** typecheck each touched package (`pnpm -F <pkg> exec tsc --noEmit` / `check-types`); `pnpm -F @better-agent/admin check-types` MUST stay clean after the component move; client unit test for the user-plane adapter. Route-tree regeneration: `apps/web/src/routeTree.gen.ts` is gitignored + vite-plugin-generated — regenerate it (background `vite dev` until it emits, then stop) before the web typecheck, and do NOT commit it.
- **Commits:** conventional-commits; every message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/client/src/index.ts` (modify) — `createUserSessionClientFrom`.
- `packages/ui/src/components/chat/` (new) — moved `use-chat.ts`, `conversation.tsx`, `session-picker.tsx`, `reveal-text.tsx`; `packages/ui/package.json` gains `@better-agent/client` + react-query (peer).
- `apps/admin/src/components/sessions/*` (modify) — re-export / import from the shared home; delete the moved originals; fix admin call sites.
- `apps/web/src/routes/index.tsx` (rewrite) — agent grid + composer + chat shell.
- `apps/web/src/utils/orpc.ts` or a small `apps/web/src/utils/chat-client.ts` (new) — build the user-plane `AgentClient`.
- Tests alongside.

---

### Task 1: User-plane `AgentClient` adapter

**Files:**
- Modify: `packages/client/src/index.ts`
- Modify/Create: `packages/client/src/index.test.ts`

**Interfaces:**
- Produces: `createUserSessionClientFrom(client: RouterClient<AppRouter>): AgentClient` — same `AgentClient` shape (`createSession`/`listMessages`/`run`/`stream`) but calling `client.userSessions.create({ agentId })`/`.listMessages`/`.run`/`.prompt`. Because `userSessions.create` requires an `agentId`, this factory takes the `agentId` it should bind: `createUserSessionClientFrom(client, agentId)`.

- [ ] **Step 1: Write the failing test**

Extend `packages/client/src/index.test.ts` with a fake oRPC client exposing `userSessions.{create,prompt,run,listMessages}` and assert the adapter calls them:
```ts
it("user-plane client creates sessions via userSessions.create with the bound agentId", async () => {
	const calls: { create?: unknown } = {};
	const fake = {
		userSessions: {
			create: (input: { agentId: string }) => { calls.create = input; return Promise.resolve({ id: "s1" }); },
			listMessages: () => Promise.resolve([]),
			run: () => Promise.resolve({}),
			prompt: () => (async function* () {})(),
		},
	} as never;
	const client = createUserSessionClientFrom(fake, "agent-1");
	const s = await client.createSession();
	expect(s.sessionId).toBe("s1");
	expect(calls.create).toEqual({ agentId: "agent-1" });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

In `packages/client/src/index.ts`, add (mirroring `createAgentClientFrom` but over `userSessions`, binding an `agentId` for `createSession`):
```ts
export function createUserSessionClientFrom(
	client: Client,
	agentId: string
): AgentClient {
	const ensureSession = async (sessionId?: string): Promise<string> =>
		sessionId ?? (await client.userSessions.create({ agentId })).id;
	return {
		async createSession() {
			const session = await client.userSessions.create({ agentId });
			return { sessionId: session.id };
		},
		async run(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			return client.userSessions.run({ sessionId, text }, { signal: options?.signal });
		},
		async *stream(text, options) {
			const sessionId = await ensureSession(options?.sessionId);
			const events = await client.userSessions.prompt({ sessionId, text }, { signal: options?.signal });
			for await (const event of events) {
				yield event;
			}
		},
		listMessages(sessionId) {
			return client.userSessions.listMessages({ sessionId });
		},
	};
}
```
(If `Client` doesn't yet include `userSessions` in its `AppRouter` type, it will after sub-project 2 — confirm `client.userSessions` typechecks. Reuse the file's `Client`/`AgentClient` types. If `run`/`stream` also need `tools`, mirror what `createAgentClientFrom` does — but the web isn't shipping client tools this plan, so the basic shape is enough.)

- [ ] **Step 4: Run to verify it passes** + `pnpm -F @better-agent/client exec tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
pnpm dlx ultracite fix packages/client/src
git add packages/client/src
git commit -m "feat(client): user-plane AgentClient over userSessions"
```

---

### Task 2: Share the chat components

**Files:**
- Create: `packages/ui/src/components/chat/use-chat.ts`, `conversation.tsx`, `session-picker.tsx`, `reveal-text.tsx` (moved + de-app-coupled)
- Modify: `packages/ui/package.json` (add `@better-agent/client` dep + `@tanstack/react-query` peer if not present)
- Modify: `apps/admin/src/components/sessions/*` + `apps/admin/src/routes/agents.$agentId.tsx` (import from the shared home; delete moved originals)

**Interfaces:**
- Produces: `@better-agent/ui/components/chat` exports `Conversation`, `SessionPicker`, `useChat`, `ChatMessage`, `RevealText` — identical APIs, consuming `@better-agent/client` types.

- [ ] **Step 1: Move + de-couple the components**

- Copy `use-chat.ts`, `conversation.tsx`, `session-picker.tsx` from `apps/admin/src/components/sessions/`, and `reveal-text.tsx` from `apps/admin/src/components/`, into `packages/ui/src/components/chat/`.
- Replace the admin-local type imports:
  - `import type { SessionMessageRow } from "@/utils/api-types"` → use `@better-agent/client`'s `MessageHistory` element type. `MessageHistory = Awaited<ReturnType<Client["sessions"]["listMessages"]>>`; the per-row type is `MessageHistory[number]`. Define a local `type SessionMessageRow = MessageHistory[number];` from the client import, or import the underlying type.
  - `import type { SessionRow } from "@/utils/api-types"` (in session-picker) → the session shape; derive from the client types similarly, or accept a minimal `{ id: string; title: string | null }[]`.
  - `import { RevealText } from "@/components/reveal-text"` (in conversation) → `./reveal-text` (now colocated).
- The `messagesKey` query key, `createStreamReveal` (`@better-agent/ui/lib/stream-reveal`, already shared), `AgentClient` import — unchanged.
- `packages/ui/package.json`: add `"@better-agent/client": "workspace:*"` to deps and `@tanstack/react-query` as a peerDependency (the app provides the QueryClient).

- [ ] **Step 2: Re-point admin imports + delete originals**

- In `apps/admin/src/routes/agents.$agentId.tsx` (and anywhere importing the chat components), change imports to `@better-agent/ui/components/chat` (e.g. `import { Conversation } from "@better-agent/ui/components/chat";`, `import { SessionPicker } from "@better-agent/ui/components/chat";`).
- Delete `apps/admin/src/components/sessions/use-chat.ts`, `conversation.tsx`, `session-picker.tsx`, and `apps/admin/src/components/reveal-text.tsx` (now in ui). Update any other admin importer of `reveal-text` (e.g. the agents empty-state) to `@better-agent/ui/components/chat`.

- [ ] **Step 3: Typecheck both apps + admin tests**

Run: `pnpm -F @better-agent/ui exec tsc --noEmit` (or its check-types) — clean.
Run: `pnpm -F @better-agent/admin check-types` — clean (the move must not break admin).
Run: `pnpm -F @better-agent/admin test` if it has tests — green.
(Resolve any `@/utils/api-types` vs `@better-agent/client` type mismatch by aligning the shared components to the client SDK's exported shapes.)

- [ ] **Step 4: Commit**
```bash
pnpm dlx ultracite fix packages/ui/src/components/chat apps/admin/src
git add packages/ui/src/components/chat packages/ui/package.json apps/admin/src pnpm-lock.yaml
git commit -m "refactor(ui): share chat components across admin and web"
```

---

### Task 3: Web chat pages

**Files:**
- Create: `apps/web/src/utils/chat-client.ts` (build the user-plane `AgentClient`)
- Rewrite: `apps/web/src/routes/index.tsx` (agent grid → composer → chat shell)
- Possibly: small components under `apps/web/src/components/chat/` (agent grid, composer) — keep each ≤300 lines

**Interfaces:**
- Consumes: `createUserSessionClientFrom` (Task 1); `Conversation`/`SessionPicker` (Task 2); `orpc`/`client` (web user-JWT oRPC) ; `orpc.agents.list`/`orpc.userSessions.{list,create}`.

- [ ] **Step 1: Build the user-plane client helper**

`apps/web/src/utils/chat-client.ts`:
```ts
import { createUserSessionClientFrom } from "@better-agent/client";
import { client } from "@/utils/orpc";

export function userAgentClient(agentId: string) {
	return createUserSessionClientFrom(client, agentId);
}
```
(`client` is the web's user-JWT `RouterClient<AppRouter>` from `apps/web/src/utils/orpc.ts`.)

- [ ] **Step 2: Rewrite `/` — agent grid → composer → chat**

Rewrite `apps/web/src/routes/index.tsx` (extract subcomponents/files to stay ≤300 lines/≤50-line functions). The page is a small state machine:
- **State:** `selectedAgent: AgentRow | null`, `sessionId: string` ("" = composer).
- **Agent grid** (when `selectedAgent === null`): `useQuery(orpc.agents.list.queryOptions())` → a grid of clickable cards (name + `providerId/modelId`); click sets `selectedAgent`. No create button.
- **Composer** (agent selected, `sessionId === ""`): a centered MuleRun-style `PromptInput` (reuse the `@better-agent/ui` prompt-input primitives, matching the admin `ChatComposer`); a top-right **close** button → `setSelectedAgent(null)` (back to grid); a session `<select>` (the user's sessions for this agent — `useQuery(orpc.userSessions.list.queryOptions())` filtered to `s.agentId === selectedAgent.id`) → picking one sets `sessionId`. On send: `const s = await client.userSessions.create({ agentId: selectedAgent.id })` (or via the helper), then `setSessionId(s.id)` AND pass the first message into the chat (or send it after the Conversation mounts — simplest: create the session, set sessionId, and let the user re-send; cleaner: create on first send and immediately stream — implement create-then-render-Conversation with the initial text handed to it).
- **Chat view** (`sessionId !== ""`): render `<Conversation sessionId={sessionId} agentClient={userAgentClient(selectedAgent.id)} />` (memoize the client by agentId). A top-right **close** → `setSessionId("")` (back to composer); the session `<select>` switches sessions; a "new session" option resets `sessionId` to "".
- The web shell (`AuthBoundary`/sidebar from sub-project 1) wraps this; ensure the page fills the height (the admin chat uses `flex min-h-0 flex-1`).

(Implementer: prefer the simplest correct flow — selecting an agent shows the composer; sending creates the session then mounts `Conversation`, which loads history + streams. Reuse the admin `agents.$agentId.tsx` structure as the reference for wiring `Conversation` + `SessionPicker` + the new-session action.)

- [ ] **Step 3: Regenerate the route tree + typecheck**

Regenerate `apps/web/src/routeTree.gen.ts` (background `pnpm -F web dev` until it re-emits, then stop — do NOT commit it; it's gitignored).
Run: `pnpm -F web exec tsc --noEmit` — clean. `pnpm dlx ultracite check apps/web/src` — clean.
DO NOT start a browser / drive chrome — the user tests the flow manually.

- [ ] **Step 4: Commit**
```bash
pnpm dlx ultracite fix apps/web/src
git add apps/web/src/utils/chat-client.ts apps/web/src/routes/index.tsx apps/web/src/components
git commit -m "feat(web): agent grid, composer, and chat over user sessions"
```

---

## Final verification

- [ ] **Typecheck:** client / ui / admin / web — clean. `pnpm -F @better-agent/admin check-types` proves the component move didn't break admin.
- [ ] **Client test:** the user-plane adapter unit test passes.
- [ ] **Lint:** `pnpm dlx ultracite check packages/client/src packages/ui/src/components/chat apps/admin/src apps/web/src` — clean.
- [ ] **Manual end-to-end (user-run, per the no-auto-browser rule):** sign in → see the agent grid → click an agent → centered composer → send → a user session is created and the chat streams → close returns to the composer → the session `<select>` shows only your sessions and switches among them → "new session" resets → admin chat still works unchanged.
- [ ] **Coverage:** sub-project 3 → user-plane `AgentClient` (Task 1) + shared chat components (Task 2) + web pages (Task 3). The web reuses the admin chat verbatim (driven by the user-plane client); only the page-level shell (agent grid, composer, close, session select) is new. Web cannot create agents.
- [ ] **Scope guard / follow-ups:** client-side remote tools in the web are out of scope (the SDK supports them; the web UI doesn't expose tool definitions yet). The pre-existing public `sessions.list` (management-plane auth deferred) is unrelated. This completes the auth set (sub-projects 1+2+3).
