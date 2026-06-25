# Composio Server Tools (SP1) — Design Spec

> Date: 2026-06-25. Sub-project SP1 of the tool-config feature (see `docs/research/agent-gap-analysis.md` and the `tool-config-direction` memory). SP2 = per-agent tool config in admin; SP3 = per-user connect-account OAuth. This spec covers SP1 only.

## Goal

Let an agent call **server-executed composio tools** during a web (user-session) chat turn. The composio integration is gated by `COMPOSIO_API_KEY` (absent → feature simply off, no tools), and per-user scoped via composio's `userId` = our account user id. One real tool must work end-to-end in chat (proven via fakes in tests; real SDK impl in `apps/server`).

## Key finding (why this is small)

The tool runtime already executes server-side tools. `ToolDef.execute(args, ctx): Promise<ExecuteResult>` is a generic server-side interface; `buildTools` (`packages/agent/src/tool/registry.ts`) already awaits `def.execute`, truncates output, applies the doom-loop guard, and prompt-caches the last tool def. Remote (client) tools are just `ToolDef`s whose `execute` parks on the pending store. **A composio tool is therefore just a `ToolDef` whose `execute` calls composio.** No change to `runTurn`, `buildTools`, or the streaming/drain code.

## Architecture

Mirror the existing `GoogleOAuth` port pattern exactly:

1. **Port** (`packages/agent/src/tool/composio-tools.ts`):
   ```ts
   export interface ComposioToolMeta {
     name: string;
     description: string;
     parameters: JsonSchema;   // from tool/types
   }
   export interface ComposioService {
     /** List the composio tools available to this user (scoped to configured toolkits). */
     listTools(userId: string): Promise<ComposioToolMeta[]>;
     /** Execute one tool server-side for this user. */
     execute(input: { userId: string; toolName: string; args: unknown }): Promise<ExecuteResult>;
   }
   /** Turn composio tool metas into runtime ToolDefs (execute → service.execute). */
   export async function buildComposioToolDefs(
     service: ComposioService,
     userId: string,
   ): Promise<ToolDef[]>;
   ```
   `buildComposioToolDefs` calls `service.listTools(userId)` and maps each meta to a `ToolDef` whose `execute(args)` returns `service.execute({ userId, toolName, args })`. Pure and unit-testable with a fake service.

2. **`apps/server` impl** (`apps/server/src/composio.ts`): `createComposioService({ apiKey, toolkits }): ComposioService` using the composio TS SDK. `listTools` → composio "get tools for user, scoped to `toolkits`" mapped to `ComposioToolMeta[]` (name + description + JSON-schema params). `execute` → composio "execute action" with `userId` + arguments, mapped to `ExecuteResult` (`{ output, isError }`): success → stringified result as `output`; failure → `{ output: <error message>, isError: true }`. (Exact SDK signatures pinned in the implementation plan from current composio docs.)

3. **Services + env**:
   - `packages/api/src/services.ts`: `AgentServices.composio: ComposioService | null` (import the type from `@better-agent/agent/tool/composio-tools`, mirroring how `PendingToolCallStore` is imported from `tool/pending-store`).
   - `packages/env/src/server.ts`: `COMPOSIO_API_KEY: z.string().optional()` and `COMPOSIO_TOOLKITS: z.string().default("<smoke-test toolkit>").transform(split-trim-filter)` (comma-separated toolkit slugs; SP1 uses a service-level default, SP2 makes it per-agent).
   - `apps/server/src/index.ts`: `buildComposio()` returns `null` when `!env.COMPOSIO_API_KEY`, else `createComposioService({ apiKey: env.COMPOSIO_API_KEY, toolkits: env.COMPOSIO_TOOLKITS })`. Add `composio: buildComposio()` to the services object.

4. **Injection point** (`packages/api/src/routers/user-sessions.ts` `streamUserTurn`): it already has `userId` and builds remote tool defs. Build composio defs too and concatenate:
   ```ts
   await requireUserSession(context, userId, input.sessionId);
   const remoteDefs = input.tools ? buildRemoteToolDefs(input.tools, store) : [];
   const composioDefs = await safeComposioDefs(context.services.composio, userId);
   const all = [...remoteDefs, ...composioDefs];
   yield* runtime.runTurn({ ..., tools: all.length > 0 ? all : undefined });
   ```
   `safeComposioDefs(service, userId)` returns `[]` when `service` is null, and **catches any error** from `buildComposioToolDefs` (composio outage / bad key) returning `[]` so a composio failure degrades to "no tools" rather than breaking the chat turn (log the error). This robustness is required.

## Scope / boundaries (SP1)

- **In:** server execution of composio tools in user (web) sessions; nullable gating; per-user `userId` scoping; service-level toolkit config via env; a no-auth smoke-test tool proving the loop; fakes + tests for the wiring and the `buildComposioToolDefs` mapper; graceful degradation on composio failure.
- **Out (later SPs):** admin per-agent tool selection (SP2); per-user connect-account OAuth UI + tools that need user auth (SP3); agent-plane (`sessions.ts`) composio tools (web user-sessions only for SP1); caching composio's per-turn `listTools` call.

## Error handling & robustness

- No `COMPOSIO_API_KEY` → `composio: null` → zero composio tools, no errors, existing behavior unchanged.
- `listTools`/`execute` throwing (network, invalid key, rate limit) → `safeComposioDefs` swallows + logs → turn proceeds with whatever other tools exist. A tool `execute` that fails returns `{ isError: true }`, which `buildTools` already surfaces to the model as a tool error (the model can react), not a crash.
- A tool returning a large result is already truncated by `buildTools`/`truncateOutput`.

## Testing

- `composio-tools.test.ts` (agent pkg): with a fake `ComposioService` (canned `listTools` + `execute`), `buildComposioToolDefs` returns `ToolDef`s whose `execute(args, ctx)` forwards `{ userId, toolName, args }` to `service.execute` and returns its `ExecuteResult`; an `execute` returning `isError: true` is preserved.
- `user-sessions` router test: with a fake `composio` in services returning one tool whose `execute` returns a known output, a prompt turn that triggers the tool (mock model emits a tool-call for it) drives the tool and the result flows back. Reuse the existing sessions test harness (mock LanguageModel). At minimum: when `composio` is null, behavior is unchanged; when present, the composio tool def is included in the turn's tools.
- The real `apps/server/src/composio.ts` is verified by typecheck + a focused unit test of the meta/result mapping with `global.fetch`/SDK stubbed if practical; otherwise the mapping logic is covered by the fake-service router test and the apps/server impl is kept thin. (It needs a live key/network to run for real — the user tests that.)

## Self-review notes

- Coverage: server-tool execution (already present) + composio service (port + impl) + env/services wiring + router injection + graceful disable + per-user scoping + tests.
- Type consistency: `ComposioService`/`ComposioToolMeta` defined once in `tool/composio-tools.ts`, consumed by `services.ts`, `apps/server`, and the router; `buildComposioToolDefs` returns `ToolDef[]` (the same type `runTurn` already accepts).
- YAGNI: no admin UI, no per-agent config, no per-user OAuth, no caching in SP1 — those are SP2/SP3. Toolkit list is env-level for now.
- Risk: composio per-turn `listTools` adds latency + an API call per turn; acceptable for SP1, cache later. The smoke-test toolkit must be one that needs no per-user OAuth (pinned from research) so the loop is provable with only the app key.
