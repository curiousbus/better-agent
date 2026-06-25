# Composio Server Tools (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an agent call server-executed composio tools during a web (user-session) chat turn, gated by `COMPOSIO_API_KEY` and per-user scoped via composio's `userId` = our account user id. Design: `docs/superpowers/specs/2026-06-25-composio-tools-sp1-design.md`.

**Architecture:** A composio tool is just a `ToolDef` (the runtime already executes `ToolDef.execute` server-side via `buildTools`). We add a nullable `ComposioService` (port + `apps/server` impl, mirroring `GoogleOAuth`), a `buildComposioToolDefs` mapper, and inject the resulting defs in the user-sessions router — gated and graceful (composio failure → no tools, never breaks the turn).

**Tech Stack:** TypeScript, `@composio/core` (v0.x, current SDK — NOT the deprecated `composio-core`), oRPC, Drizzle, AI SDK.

## Global Constraints

- Mirror the `GoogleOAuth` pattern exactly: port type in the agent package, impl in `apps/server`, a `build*()` returning `null` when unconfigured, `… | null` in `AgentServices`, a fake in tests.
- Composio failures (bad key, network, rate limit) must DEGRADE to "no composio tools" for that turn — never throw out of the turn. A tool that fails returns `{ isError: true }` (the runtime already surfaces that to the model).
- `userId` passed to composio = our account user id (the user session's `userId`). Plain string.
- No `any` (use `unknown` + narrowing; sanctioned `as unknown` casts in tests only); prefer `??` over `||`; functions ≤50 lines; files ≤300 lines.
- conventional-commits; footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (never pipe `git commit` through grep/head — SIGPIPE aborts it).
- Run `pnpm exec biome lint <files>` from the repo ROOT. `pnpm check-types` is the cross-package gate.
- SP1 is web (user-session) only; no admin UI, no per-agent config, no per-user OAuth (those are SP2/SP3). Toolkit list is env-level.

---

### Task 1: Composio port + `buildComposioToolDefs` (agent package)

**Files:**
- Create: `packages/agent/src/tool/composio-tools.ts`
- Test: `packages/agent/src/tool/composio-tools.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2 + 3):
```ts
import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export interface ComposioToolMeta {
	name: string;
	description: string;
	parameters: JsonSchema;
}
export interface ComposioService {
	listTools(userId: string): Promise<ComposioToolMeta[]>;
	execute(input: { userId: string; toolName: string; args: unknown }): Promise<ExecuteResult>;
}
export function buildComposioToolDefs(
	service: ComposioService,
	userId: string,
): Promise<ToolDef[]>;
```

- [ ] **Step 1: Write the failing test**

`packages/agent/src/tool/composio-tools.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildComposioToolDefs, type ComposioService } from "./composio-tools";

function fakeService(over: Partial<ComposioService> = {}): ComposioService {
	return {
		listTools: () =>
			Promise.resolve([
				{ name: "HACKERNEWS_SEARCH_POSTS", description: "search HN", parameters: { type: "object" } },
			]),
		execute: ({ toolName, userId, args }) =>
			Promise.resolve({ output: `ran ${toolName} for ${userId} with ${JSON.stringify(args)}` }),
		...over,
	};
}

describe("buildComposioToolDefs", () => {
	it("maps listed tools to ToolDefs that forward execute to the service", async () => {
		const defs = await buildComposioToolDefs(fakeService(), "user-1");
		expect(defs).toHaveLength(1);
		expect(defs[0]?.name).toBe("HACKERNEWS_SEARCH_POSTS");
		const ctx = {
			abortSignal: new AbortController().signal,
			agentId: "a", callId: "c", messageId: "m", sessionId: "s",
		};
		const result = await defs[0]?.execute({ query: "ts" }, ctx);
		expect(result?.output).toContain("HACKERNEWS_SEARCH_POSTS");
		expect(result?.output).toContain("user-1");
	});

	it("preserves an isError result from the service", async () => {
		const defs = await buildComposioToolDefs(
			fakeService({ execute: () => Promise.resolve({ output: "boom", isError: true }) }),
			"user-1",
		);
		const ctx = {
			abortSignal: new AbortController().signal,
			agentId: "a", callId: "c", messageId: "m", sessionId: "s",
		};
		const result = await defs[0]?.execute({}, ctx);
		expect(result).toEqual({ output: "boom", isError: true });
	});

	it("returns an empty list when the service lists no tools", async () => {
		const defs = await buildComposioToolDefs(
			fakeService({ listTools: () => Promise.resolve([]) }),
			"user-1",
		);
		expect(defs).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @better-agent/agent test composio-tools`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent/src/tool/composio-tools.ts`:
```ts
import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export interface ComposioToolMeta {
	name: string;
	description: string;
	parameters: JsonSchema;
}

export interface ComposioService {
	/** List the composio tools available to this user (scoped to configured toolkits). */
	listTools(userId: string): Promise<ComposioToolMeta[]>;
	/** Execute one composio tool server-side for this user. */
	execute(input: {
		userId: string;
		toolName: string;
		args: unknown;
	}): Promise<ExecuteResult>;
}

/** Turn composio tool metas into runtime ToolDefs whose execute calls the service. */
export async function buildComposioToolDefs(
	service: ComposioService,
	userId: string,
): Promise<ToolDef[]> {
	const metas = await service.listTools(userId);
	return metas.map((meta) => ({
		name: meta.name,
		description: meta.description,
		parameters: meta.parameters,
		execute: (args) => service.execute({ userId, toolName: meta.name, args }),
	}));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @better-agent/agent test composio-tools`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

```bash
pnpm check-types
pnpm exec biome lint packages/agent/src/tool/composio-tools.ts packages/agent/src/tool/composio-tools.test.ts
git add packages/agent/src/tool/composio-tools.ts packages/agent/src/tool/composio-tools.test.ts
git commit -m "$(printf 'feat(agent): composio tool defs builder and service port\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; agent tests pass; lint clean.

---

### Task 2: Composio service impl + env + services wiring (apps/server)

**Files:**
- Modify: `packages/env/src/server.ts` (`COMPOSIO_API_KEY`, `COMPOSIO_TOOLKITS`)
- Modify: `packages/api/src/services.ts` (`AgentServices.composio`)
- Create: `apps/server/src/composio.ts` (`createComposioService` + pure mappers) + `apps/server/src/composio.test.ts`
- Modify: `apps/server/src/index.ts` (`buildComposio()` + add to services)
- Modify: `apps/server/package.json` (add `@composio/core`)

**Interfaces:**
- Consumes: `ComposioService`, `ComposioToolMeta` from Task 1.
- Produces: `AgentServices.composio: ComposioService | null` consumed by Task 3.

- [ ] **Step 1: Add the dependency**

```bash
pnpm -F server add @composio/core
```
(This is the CURRENT SDK. Do NOT use the deprecated `composio-core`.)

- [ ] **Step 2: env**

`packages/env/src/server.ts` — add inside `server: { … }` (next to `GOOGLE_CLIENT_ID`):
```ts
		COMPOSIO_API_KEY: z.string().optional(),
		/** 逗号分隔的 composio toolkit slugs（默认 hackernews：免授权，可只用 app key 冒烟）。 */
		COMPOSIO_TOOLKITS: z
			.string()
			.default("hackernews")
			.transform((value) =>
				value
					.split(",")
					.map((s) => s.trim().toLowerCase())
					.filter((s) => s !== "")
			),
```

- [ ] **Step 3: services type**

`packages/api/src/services.ts` — import the type and add the field:
```ts
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
```
Add to `AgentServices` (next to `googleOAuth`): `composio: ComposioService | null;`

- [ ] **Step 4: Write the failing test for the mappers**

`createComposioService` calls the SDK, but its mapping logic must be unit-tested without network. Extract two PURE exported helpers and test them. `apps/server/src/composio.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mapComposioResult, mapOpenAiTool } from "./composio";

describe("composio mappers", () => {
	it("maps an OpenAI-format tool to a ComposioToolMeta", () => {
		const meta = mapOpenAiTool({
			type: "function",
			function: { name: "HACKERNEWS_SEARCH_POSTS", description: "search", parameters: { type: "object" } },
		});
		expect(meta).toEqual({
			name: "HACKERNEWS_SEARCH_POSTS", description: "search", parameters: { type: "object" },
		});
	});

	it("defaults missing description/parameters", () => {
		const meta = mapOpenAiTool({ type: "function", function: { name: "X" } });
		expect(meta).toEqual({ name: "X", description: "", parameters: {} });
	});

	it("maps a successful composio result to output", () => {
		expect(mapComposioResult({ successful: true, data: { hits: 3 } })).toEqual({
			output: JSON.stringify({ hits: 3 }),
		});
	});

	it("passes through a string data result without double-encoding", () => {
		expect(mapComposioResult({ successful: true, data: "hello" })).toEqual({ output: "hello" });
	});

	it("maps a failed composio result to an isError output", () => {
		expect(mapComposioResult({ successful: false, error: "nope" })).toEqual({
			output: "nope", isError: true,
		});
	});
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm -F server test composio`
Expected: FAIL — module/exports not found.

- [ ] **Step 6: Implement `apps/server/src/composio.ts`**

```ts
import { Composio } from "@composio/core";
import type {
	ComposioService,
	ComposioToolMeta,
} from "@better-agent/agent/tool/composio-tools";
import type { ExecuteResult } from "@better-agent/agent/tool/types";

/** The subset of an OpenAI-format composio tool we read. */
interface OpenAiTool {
	function: { name: string; description?: string; parameters?: Record<string, unknown> };
}
/** The subset of a composio execute result we read. */
interface ComposioResult {
	successful: boolean;
	data?: unknown;
	error?: string;
}

export function mapOpenAiTool(tool: OpenAiTool): ComposioToolMeta {
	return {
		name: tool.function.name,
		description: tool.function.description ?? "",
		parameters: tool.function.parameters ?? {},
	};
}

export function mapComposioResult(result: ComposioResult): ExecuteResult {
	if (result.successful) {
		const { data } = result;
		return { output: typeof data === "string" ? data : JSON.stringify(data ?? null) };
	}
	return { output: result.error ?? "Tool execution failed", isError: true };
}

export function createComposioService(config: {
	apiKey: string;
	toolkits: string[];
}): ComposioService {
	const composio = new Composio({ apiKey: config.apiKey });
	return {
		async listTools(userId) {
			const tools = await composio.tools.get(userId, { toolkits: config.toolkits });
			return (tools as OpenAiTool[]).map(mapOpenAiTool);
		},
		async execute({ userId, toolName, args }) {
			const result = (await composio.tools.execute(toolName, {
				userId,
				arguments: (args ?? {}) as Record<string, unknown>,
			})) as ComposioResult;
			return mapComposioResult(result);
		},
	};
}
```
NOTE for the implementer: the exact TS types from `@composio/core` for `tools.get`'s return and `tools.execute`'s signature/return may differ slightly from the `OpenAiTool`/`ComposioResult` subsets above. Verify against the installed package's types (and context7 `/composiohq/composio` if needed). Keep the `OpenAiTool`/`ComposioResult` local interfaces as the read-subset and cast the SDK return to them (`as`) — do NOT introduce `any`. If `tools.get` without a provider does not return the `{ function: { … } }` shape in the installed version, adjust `mapOpenAiTool` + the cast accordingly, and update the Step 4 test to match the real shape. The mappers must stay pure and tested.

- [ ] **Step 7: Wire into the server**

`apps/server/src/index.ts`:
- Import: `import { createComposioService } from "./composio";`
- Add a builder near `buildGoogleOAuth`:
```ts
function buildComposio() {
	if (!env.COMPOSIO_API_KEY) {
		return null;
	}
	return createComposioService({
		apiKey: env.COMPOSIO_API_KEY,
		toolkits: env.COMPOSIO_TOOLKITS,
	});
}
```
- In the `buildServices()` return object, add (next to `googleOAuth: buildGoogleOAuth(),`): `composio: buildComposio(),`

- [ ] **Step 8: Run tests + verify**

```bash
pnpm -F server test composio
pnpm check-types
pnpm -F server build
pnpm exec biome lint apps/server/src/composio.ts apps/server/src/composio.test.ts apps/server/src/index.ts packages/api/src/services.ts packages/env/src/server.ts
```
Expected: mapper tests pass; tsc clean (the new `composio` field on `AgentServices` must be supplied everywhere services are constructed — `apps/server` now does; test fixtures that build full services may need `composio: null` — fix any that break in Task 3 or here); server build clean; lint clean.

- [ ] **Step 9: Commit**

```bash
git add packages/env/src/server.ts packages/api/src/services.ts apps/server/src/composio.ts apps/server/src/composio.test.ts apps/server/src/index.ts apps/server/package.json pnpm-lock.yaml
git commit -m "$(printf 'feat(server): composio service impl, env, and wiring\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Inject composio tools in the user-sessions router (api package)

**Files:**
- Modify: `packages/api/src/routers/user-sessions.ts`
- Test: `packages/api/src/routers/user-sessions.test.ts` (add cases; or a new `user-sessions-composio.test.ts` if the file nears 300 lines)

**Interfaces:**
- Consumes: `AgentServices.composio` (Task 2); `buildComposioToolDefs` (Task 1).
- Produces: `safeComposioDefs(service, userId)` — exported for testing.

- [ ] **Step 1: Write the failing test**

Add a test for `safeComposioDefs` (the new graceful-injection logic). `packages/api/src/routers/user-sessions.test.ts` (read the existing file first for its import/harness style; if adding pushes it over 300 lines, create `user-sessions-composio.test.ts` instead):
```ts
import { describe, expect, it } from "vitest";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import { safeComposioDefs } from "./user-sessions";

const okService: ComposioService = {
	listTools: () =>
		Promise.resolve([{ name: "HACKERNEWS_SEARCH_POSTS", description: "d", parameters: {} }]),
	execute: () => Promise.resolve({ output: "ok" }),
};

describe("safeComposioDefs", () => {
	it("returns [] when composio is null", async () => {
		expect(await safeComposioDefs(null, "u1")).toEqual([]);
	});

	it("returns built tool defs when composio is present", async () => {
		const defs = await safeComposioDefs(okService, "u1");
		expect(defs).toHaveLength(1);
		expect(defs[0]?.name).toBe("HACKERNEWS_SEARCH_POSTS");
	});

	it("swallows a composio failure and returns []", async () => {
		const boom: ComposioService = {
			listTools: () => Promise.reject(new Error("composio down")),
			execute: () => Promise.resolve({ output: "" }),
		};
		expect(await safeComposioDefs(boom, "u1")).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @better-agent/api test -- user-sessions`
Expected: FAIL — `safeComposioDefs` not exported.

- [ ] **Step 3: Implement**

In `packages/api/src/routers/user-sessions.ts`:
- Import: `import { buildComposioToolDefs, type ComposioService } from "@better-agent/agent/tool/composio-tools";`
- Add the exported helper (above `streamUserTurn`):
```ts
export async function safeComposioDefs(
	service: ComposioService | null,
	userId: string,
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		return await buildComposioToolDefs(service, userId);
	} catch (_error) {
		// Composio outage / bad key must not break the turn — degrade to no tools.
		return [];
	}
}
```
  (Import `ToolDef`: `import type { ToolDef } from "@better-agent/agent/tool/types";`)
- In `streamUserTurn`, replace the tool-building block:
```ts
await requireUserSession(context, userId, input.sessionId);
const remoteDefs = input.tools
	? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
	: [];
const composioDefs = await safeComposioDefs(context.services.composio, userId);
const allDefs = [...remoteDefs, ...composioDefs];
yield* context.services.runtime.runTurn({
	sessionId: input.sessionId,
	text: input.text,
	tools: allDefs.length > 0 ? allDefs : undefined,
	outputSchema: input.outputSchema,
	abortSignal: signal,
});
```
  (`buildRemoteToolDefs` already imported. Remove the old `const toolDefs = …` line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @better-agent/api test -- user-sessions`
Expected: PASS. If other api tests build a full `services` object and now fail to typecheck without `composio`, add `composio: null` to those fixtures.

- [ ] **Step 5: Full verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/api test
pnpm exec biome lint packages/api/src/routers/user-sessions.ts packages/api/src/routers/user-sessions.test.ts
git add packages/api/src/routers/user-sessions.ts packages/api/src/routers/user-sessions.test.ts
git commit -m "$(printf 'feat(api): inject composio tools into user-session turns\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; api tests pass; lint clean.

---

## Self-Review Notes
- Coverage: composio port + mapper (T1), service impl + env + wiring (T2), router injection + graceful degrade (T3). Server-side execution itself is the runtime's existing `buildTools`/`ToolDef.execute` path (already tested) — composio tools are ordinary `ToolDef`s, so end-to-end execution is covered by composition; the only network-dependent part (real composio calls) is left for the user's smoke test (default `hackernews` toolkit needs no OAuth, only the app key).
- Type consistency: `ComposioService`/`ComposioToolMeta` defined once in `tool/composio-tools.ts`; `buildComposioToolDefs` returns `ToolDef[]` (what `runTurn` accepts); `AgentServices.composio: ComposioService | null` consumed by the router via `safeComposioDefs`.
- Robustness: null key → no tools; composio throw → swallowed in `safeComposioDefs`; tool failure → `{isError:true}` surfaced by the runtime; large output truncated by `buildTools`.
- YAGNI: no provider adapter (we feed our own `ToolDef`→AI SDK), no per-agent config (SP2), no per-user OAuth (SP3), no listTools caching. Toolkit list is env-level.
- Smoke test (for the human): set `COMPOSIO_API_KEY` (and optionally `COMPOSIO_TOOLKITS`, default `hackernews`), restart the server, chat with any agent and ask it to "search Hacker News for TypeScript" — the model should call `HACKERNEWS_SEARCH_POSTS` and the result renders via the tool disclosure shipped earlier.
```
