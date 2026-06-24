# User-Scoped Chat Sessions Implementation Plan

> **Auth sub-project 2 of 3** (sub-project 1 = web auth, shipped). This adds a user-owned chat plane so the web app (authenticated by user JWT) can create and drive its own sessions. Sub-project 3 (web chat UI) builds on the `userSessions` router this delivers.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated web user create chat sessions bound to an agent and drive turns over them, seeing only their own sessions — without an agent token.

**Architecture:** Sessions gain a nullable `userId`. A new `userSessions` oRPC router mirrors the existing agent-token `sessions` router but is `userProcedure`-gated with ownership by `session.userId === authedUser.id`. It reuses the runtime/stores **unchanged** — the runtime already loads the agent config per turn from `session.agentId`, so a user-JWT caller can drive a turn once ownership is verified. The existing `sessions` router (agent token, for admin) is untouched.

**Tech Stack:** TypeScript, Drizzle (additive migration), oRPC (`userProcedure` from the auth work), Vitest.

**Source design (validated):** the original brainstorming (sub-project 2: "user-scoped chat sessions — add `sessions.userId`, scope the chat plane to the user"), confirmed by survey: the runtime is agent-config-agnostic per turn; the only gate change needed is `agentProcedure` → `userProcedure` + ownership by `userId`.

## Global Constraints

- **Decisions (binding):**
  - `sessions.userId` is **nullable** (`uuid`, no hard FK — consistent with the existing `agent_id` column). Agent-token-created sessions keep `userId = null`; user-created sessions set it. Additive migration.
  - The new plane is a **separate `userSessions` router**, all `userProcedure`-gated, ownership by `session.userId === authedUser.id` via a `requireUserSession` helper (mirrors `requireOwnedSession`'s NOT_FOUND-masking). The existing `sessions` (agentProcedure) router is NOT modified.
  - `userSessions.create({agentId})` validates the agent exists (`agentStore.get`) → NOT_FOUND otherwise → then `session.create({ agentId, userId: authedUser.id })`.
  - `userSessions` supports the same chat surface as the agent plane: `create`, `list` (the user's own), `get`, `listMessages`, `prompt` (streaming), `run`, `submitToolResult` — including remote tools (same `buildRemoteToolDefs`).
  - Shared helpers (`drain`, `errorMessage`, and the remote-tool/turn plumbing) are reused, not duplicated where reasonable; a small amount of streamTurn duplication is acceptable to avoid churning the working agent plane.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type`; `for...of`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers; kebab-case; specific imports; zod v4 (`z.uuid()`). `pnpm dlx ultracite fix <paths>` before each commit; lefthook blocks non-compliant commits.
- **DB:** use `db:generate` then `db:migrate` (NEVER `db:push` — the local DB is shared). Verify the generated migration only `ALTER TABLE sessions ADD COLUMN user_id` (no destructive ops on other tables).
- **Tests:** `pnpm -F @better-agent/<pkg> exec vitest run src/<path>.test.ts`. Typecheck per package.
- **Commits:** conventional-commits; every message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/db/src/schema/sessions.ts` (modify) — `userId` column.
- `packages/db/src/migrations/00NN_*.sql` (generated) — add column.
- `packages/agent/src/session/types.ts` (modify) — `Session.userId`, `SessionInput.userId`.
- `packages/agent/src/ports.ts` (modify) — `SessionStore.create` accepts `userId`; add `listByUser`.
- `packages/db/src/repositories/session-store.ts` (modify) — persist `userId`, implement `listByUser`.
- `packages/agent/src/testing/fakes.ts` (modify) — fake `create`/`listByUser`.
- `packages/api/src/routers/user-sessions.ts` (new) — the `userSessions` router.
- `packages/api/src/routers/index.ts` (modify) — register `userSessions`.
- `packages/api/src/routers/sessions.ts` (modify) — export `drain`/`errorMessage` for reuse (or move to a shared util).
- Tests alongside.

---

### Task 1: Session `userId` data layer

**Files:**
- Modify: `packages/db/src/schema/sessions.ts`
- Generated: `packages/db/src/migrations/00NN_*.sql`
- Modify: `packages/agent/src/session/types.ts`, `packages/agent/src/ports.ts`
- Modify: `packages/db/src/repositories/session-store.ts`, `packages/agent/src/testing/fakes.ts`
- Modify: `packages/db/src/repositories/session-store.integration.test.ts` (if present) — add a `listByUser` test

**Interfaces:**
- Produces: `Session.userId: string | null`; `SessionInput { agentId: string; userId?: string | null }`; `SessionStore.create(input: SessionInput)` persists `userId`; `SessionStore.listByUser(userId: string): Promise<Session[]>` (newest-first or unordered — match the existing `list`).

- [ ] **Step 1: Add the column + types**

In `packages/db/src/schema/sessions.ts`, add to the `sessions` table (after `agentId`):
```ts
	userId: uuid("user_id"),
```
In `packages/agent/src/session/types.ts`: add `userId: string | null;` to `Session` and `userId?: string | null;` to `SessionInput`.

- [ ] **Step 2: Generate + apply the migration**

Run: `pnpm -F @better-agent/db db:generate` → inspect the new `00NN_*.sql`: it must be exactly `ALTER TABLE "sessions" ADD COLUMN "user_id" uuid;` (nullable, no other table touched). If it contains anything destructive, STOP.
Run: `pnpm run db:migrate`.

- [ ] **Step 3: Extend the store interface + write a failing integration test**

In `packages/agent/src/ports.ts` `SessionStore`: `create(input: SessionInput): Promise<Session>` (signature unchanged — `SessionInput` now carries optional `userId`); add `listByUser(userId: string): Promise<Session[]>;`.

In the session-store integration test (`packages/db/src/repositories/session-store.integration.test.ts` — read it for the `createTestDb` pattern), add:
```ts
it("persists userId and lists by user", async () => {
	const store = createSessionStore(db);
	const mine = await store.create({ agentId: AGENT_ID, userId: "u1" });
	await store.create({ agentId: AGENT_ID, userId: "u2" });
	await store.create({ agentId: AGENT_ID }); // null user
	expect(mine.userId).toBe("u1");
	const u1 = await store.listByUser("u1");
	expect(u1.map((s) => s.id)).toEqual([mine.id]);
});
```
(Use the file's existing seeded `AGENT_ID`/`createTestDb`; if the file seeds an agent differently, match it.)

- [ ] **Step 4: Run to verify it fails** — `pnpm -F @better-agent/db exec vitest run src/repositories/session-store.integration.test.ts` → FAIL (no `listByUser` / userId not persisted).

- [ ] **Step 5: Implement the store**

In `packages/db/src/repositories/session-store.ts`:
- `create`: include `userId: input.userId ?? null` in the inserted values and map it back on the returned `Session`.
- Map `userId` in every `Session` row mapper in the file (get/list/listByUser).
- Add `listByUser(userId)`: `select().from(sessions).where(eq(sessions.userId, userId))` mapped to `Session[]`.

In `packages/agent/src/testing/fakes.ts` `createFakeSessionStore`: store `userId: input.userId ?? null` on create; map it on the `Session`; add `listByUser(userId)` filtering the map.

- [ ] **Step 6: Run to verify it passes + typecheck**

Run: `pnpm -F @better-agent/db exec vitest run src/repositories/session-store.integration.test.ts` → PASS.
Run: `pnpm -F @better-agent/db exec tsc --noEmit && pnpm -F @better-agent/agent exec tsc --noEmit` → clean (the `Session` type gained a required `userId`; fix any `Session` literal in fakes/tests by adding `userId: null`).
Run: `pnpm -F @better-agent/agent test` → green.

- [ ] **Step 7: Commit**
```bash
pnpm dlx ultracite fix packages/db/src packages/agent/src/session/types.ts packages/agent/src/ports.ts packages/agent/src/testing/fakes.ts
git add packages/db/src/schema packages/db/src/migrations packages/db/src/repositories/session-store.ts packages/db/src/repositories/session-store.integration.test.ts packages/agent/src/session/types.ts packages/agent/src/ports.ts packages/agent/src/testing/fakes.ts
git commit -m "feat(db): add user_id to sessions and listByUser"
```

---

### Task 2: `userSessions` oRPC router

**Files:**
- Create: `packages/api/src/routers/user-sessions.ts`
- Modify: `packages/api/src/routers/sessions.ts` (export `drain` + `errorMessage`)
- Modify: `packages/api/src/routers/index.ts` (register `userSessions`)
- Create: `packages/api/src/routers/user-sessions.test.ts`

**Interfaces:**
- Consumes: `userProcedure` (auth), `SessionStore.create({agentId,userId})`/`listByUser` (Task 1), `buildRemoteToolDefs`, the runtime; `drain`/`errorMessage` from `sessions.ts`.
- Produces: `userSessionsRouter` with `create({agentId})`, `list()`, `get({id})`, `listMessages({sessionId})`, `prompt({sessionId,text,tools?})` (stream), `run(...)`, `submitToolResult({sessionId,callId,result,isError})` — all `userProcedure`, ownership by `userId`.

- [ ] **Step 1: Export the shared helpers**

In `packages/api/src/routers/sessions.ts`, add `export` to `drain` and `errorMessage` (they're currently file-local). (Leave everything else unchanged.)

- [ ] **Step 2: Write the failing test**

`packages/api/src/routers/user-sessions.test.ts` (mirror `sessions.test.ts`'s `createRouterClient` setup, but build the context with `authedUser` and a seeded user + agent):
```ts
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";
// build services with fake stores (createFakeSessionStore, createFakeAgentStore, runtime, pendingToolCallStore, etc.)

it("create binds the session to the authed user and the chosen agent", async () => {
	// seed an agent in the fake agent store → agentId
	const client = createRouterClient(appRouter, {
		context: { services, authedAgent: null, authedUser: { id: "u1", email: "x@y.com", createdAt: new Date() } },
	});
	const session = await client.userSessions.create({ agentId });
	expect(session.userId).toBe("u1");
	const list = await client.userSessions.list();
	expect(list.map((s) => s.id)).toEqual([session.id]);
});

it("get/listMessages reject another user's session as NOT_FOUND", async () => {
	// seed a session with userId "other"
	const client = /* context authedUser u1 */;
	await expect(client.userSessions.get({ id: otherSessionId })).rejects.toThrow();
});

it("create rejects an unknown agent", async () => {
	const client = /* authedUser u1 */;
	await expect(client.userSessions.create({ agentId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow();
});
```
(Adapt the services/seed construction to the patterns in `sessions.test.ts` + `context.test.ts`.)

- [ ] **Step 3: Run to verify it fails** — FAIL (`userSessions` undefined).

- [ ] **Step 4: Implement the router**

`packages/api/src/routers/user-sessions.ts`:
```ts
import { buildRemoteToolDefs } from "@better-agent/agent/tool/remote-tools";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { userProcedure } from "../index";
import { drain, errorMessage } from "./sessions";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const remoteToolSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	parameters: z.record(z.string(), z.unknown()),
});
const promptInput = z.object({
	sessionId: z.uuid(),
	text: z.string().min(1),
	tools: z.array(remoteToolSchema).optional(),
});

async function requireUserSession(
	context: Context,
	userId: string,
	sessionId: string
): Promise<void> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session || session.userId !== userId) {
		throw new ORPCError("NOT_FOUND", {
			message: `Session ${sessionId} not found`,
		});
	}
}

async function* streamUserTurn(
	context: Context,
	userId: string,
	input: { sessionId: string; text: string; tools?: { name: string; description: string; parameters: Record<string, unknown> }[] },
	signal: AbortSignal | undefined
): AsyncGenerator<import("@better-agent/agent/session/events").RunEvent, void> {
	try {
		await requireUserSession(context, userId, input.sessionId);
		const toolDefs = input.tools
			? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
			: undefined;
		yield* context.services.runtime.runTurn({
			sessionId: input.sessionId,
			text: input.text,
			tools: toolDefs,
			abortSignal: signal,
		});
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

export const userSessionsRouter = {
	create: userProcedure
		.input(z.object({ agentId: z.uuid() }))
		.handler(async ({ input, context }) => {
			const agent = await context.services.stores.agent.get(input.agentId);
			if (!agent) {
				throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
			}
			return context.services.stores.session.create({
				agentId: input.agentId,
				userId: context.authedUser.id,
			});
		}),

	list: userProcedure.handler(({ context }) =>
		context.services.stores.session.listByUser(context.authedUser.id)
	),

	get: userProcedure.input(idInput).handler(async ({ input, context }) => {
		await requireUserSession(context, context.authedUser.id, input.id);
		return context.services.stores.session.get(input.id);
	}),

	listMessages: userProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			return context.services.stores.message.listWithParts(input.sessionId);
		}),

	run: userProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			const toolDefs = input.tools
				? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
				: undefined;
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					tools: toolDefs,
					abortSignal: signal,
				})
			);
		}),

	prompt: userProcedure
		.input(promptInput)
		.handler(({ input, context, signal }) =>
			streamUserTurn(context, context.authedUser.id, input, signal)
		),

	submitToolResult: userProcedure
		.input(
			z.object({
				sessionId: z.uuid(),
				callId: z.string().min(1),
				result: z.string(),
				isError: z.boolean().default(false),
			})
		)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			await context.services.pendingToolCallStore.resolve({
				sessionId: input.sessionId,
				callId: input.callId,
				result: { output: input.result, isError: input.isError },
			});
			return { ok: true };
		}),
};
```
(If `import("...").RunEvent` inline-type is awkward for Biome, add a top `import type { RunEvent } from "@better-agent/agent/session/events";`. If the file exceeds 300 lines, it won't — but split the prompt/run helpers if needed.)

- [ ] **Step 5: Register the router**

In `packages/api/src/routers/index.ts`, import `userSessionsRouter` and add `userSessions: userSessionsRouter` to `appRouter`.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -F @better-agent/api exec vitest run src/routers/user-sessions.test.ts` → PASS.
Run: `pnpm -F @better-agent/api test` → green (existing sessions tests unaffected — the agent plane is untouched).
Run: `pnpm -F @better-agent/api exec tsc -b` → clean.

- [ ] **Step 7: Commit**
```bash
pnpm dlx ultracite fix packages/api/src/routers
git add packages/api/src/routers/user-sessions.ts packages/api/src/routers/sessions.ts packages/api/src/routers/index.ts packages/api/src/routers/user-sessions.test.ts
git commit -m "feat(api): user-scoped chat sessions router"
```

---

## Final verification

- [ ] **Suites:** `pnpm -F @better-agent/db test`, `pnpm -F @better-agent/agent test`, `pnpm -F @better-agent/api test` — green.
- [ ] **Typecheck:** db / agent / api / server — clean (server's `buildServices` is unaffected; the runtime/stores are reused unchanged).
- [ ] **Lint:** `pnpm dlx ultracite check packages/api/src/routers packages/db/src packages/agent/src` — clean.
- [ ] **Coverage:** sub-project 2 → `userSessions` router (userProcedure, ownership by `userId`) over a `userId`-bearing session model. The runtime/agent/model layers are untouched (agent loaded from `session.agentId` per turn). `agents.list`/`agents.get` are already public → the web can read agents.
- [ ] **Scope guard / next:** this delivers the backend the web chat UI (sub-project 3) consumes — `userSessions.create/list/get/listMessages/prompt/run/submitToolResult`. The existing agent-token `sessions` router (admin) is unchanged. The pre-existing unscoped `sessions.list` (publicProcedure) is left as-is (out of scope; the web uses `userSessions.list`).
