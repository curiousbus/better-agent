# Composio Per-Agent Tool Config (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Each agent stores its own composio toolkit list; a chat turn resolves composio tools from the turn's agent's toolkits (env default as fallback). Admins set the list in the agent wizard. Design: `docs/superpowers/specs/2026-06-25-composio-per-agent-sp2-design.md`.

**Architecture:** Add `agents.composio_toolkits` (jsonb `string[]`). Thread it through `AgentConfig`/`AgentInput`/zod/stores. Change the SP1 `ComposioService.listTools(userId)` → `listTools(userId, toolkits)` and `buildComposioToolDefs(service, userId, toolkits)`; the user-sessions turn loads its agent and passes that agent's toolkits. Add a "Tools" wizard step.

**Tech Stack:** Drizzle, oRPC, TanStack Router/Query, `@composio/core`.

## Global Constraints

- Migration via `pnpm db:generate` then `pnpm db:migrate` (shared local DB — NEVER `db:push`). Commit the generated migration.
- Agent toolkits authoritative; empty → fall back to env `COMPOSIO_TOOLKITS` default (preserves SP1 smoke path).
- No `any`; prefer `??` over `||`; functions ≤50 lines; files ≤300 lines; flat UI (no nested cards). conventional-commits + footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit BARE (no grep/head pipe). `pnpm exec biome lint <files>` from repo ROOT.

---

### Task 1: Data model — `composioToolkits` on agents

**Files:**
- Modify: `packages/db/src/schema/agents.ts` (+ generate/apply migration)
- Modify: `packages/agent/src/agent/types.ts` (`AgentConfig`, `AgentInput`)
- Modify: `packages/db/src/repositories/agent-store.ts` (`toAgentConfig`)
- Modify: `packages/agent/src/testing/fake-agent-store.ts`
- Modify: `packages/api/src/routers/agents.ts` (`agentInput` zod)
- Test: `packages/api/src/routers/agents.test.ts`

**Interfaces:**
- Produces: `AgentConfig.composioToolkits: string[]` + `AgentInput.composioToolkits: string[]` (consumed by Tasks 2 + 3).

- [ ] **Step 1: Schema + migration**

`packages/db/src/schema/agents.ts` — add to the `agents` table (after `params`):
```ts
	composioToolkits: jsonb("composio_toolkits")
		.$type<string[]>()
		.notNull()
		.default([]),
```
Then:
```bash
pnpm db:generate
pnpm db:migrate
```
Verify the generated SQL adds `composio_toolkits jsonb NOT NULL DEFAULT '[]'::jsonb` (or equivalent). If drizzle emits a non-defaulted column, adjust so existing rows get `[]`.

- [ ] **Step 2: Types**

`packages/agent/src/agent/types.ts` — add `composioToolkits: string[];` to BOTH `AgentConfig` and `AgentInput`.

- [ ] **Step 3: Store mapping + fake**

`packages/db/src/repositories/agent-store.ts` `toAgentConfig` — add `composioToolkits: row.composioToolkits ?? [],`. (`create`/`update` already spread input, so writes flow once the column + types exist.)
`packages/agent/src/testing/fake-agent-store.ts` — read it; wherever it builds an `AgentConfig` (create/update), include `composioToolkits: input.composioToolkits ?? []` so the fake matches the real shape.

- [ ] **Step 4: Router input**

`packages/api/src/routers/agents.ts` `agentInput` zod — add:
```ts
	composioToolkits: z.array(z.string()).default([]),
```
(This covers create AND update — both derive from `agentInput`.)

- [ ] **Step 5: Write the failing test**

In `packages/api/src/routers/agents.test.ts` (read its existing harness first — it builds a router client with a fake agent store + admin context), add:
```ts
it("round-trips composioToolkits on create and update", async () => {
	const { client } = await buildClient(); // mirror existing harness setup
	const { agent } = await client.agents.create({
		name: "T", description: "d", systemPrompt: "s",
		providerId: "openai", modelId: "gpt-x",
		params: null, composioToolkits: ["hackernews"],
	});
	expect(agent.composioToolkits).toEqual(["hackernews"]);
	const updated = await client.agents.update({
		id: agent.id,
		name: "T", description: "d", systemPrompt: "s",
		providerId: "openai", modelId: "gpt-x",
		params: null, composioToolkits: ["github", "gmail"],
	});
	expect(updated.composioToolkits).toEqual(["github", "gmail"]);
});
```
Adapt the field set / provider/model to whatever the existing create tests use (so `assertValidAgent` passes with the fake validator). If the existing tests omit `composioToolkits`, the zod `.default([])` keeps them valid.

- [ ] **Step 6: Run tests + verify**

```bash
pnpm db:generate  # ensure no pending diff
pnpm check-types
pnpm -F @better-agent/api test -- agents
pnpm exec biome lint packages/db/src/schema/agents.ts packages/agent/src/agent/types.ts packages/db/src/repositories/agent-store.ts packages/agent/src/testing/fake-agent-store.ts packages/api/src/routers/agents.ts packages/api/src/routers/agents.test.ts
```
Expected: tsc clean; agents tests pass; lint clean.

- [ ] **Step 7: Commit** (include the migration file)

```bash
git add packages/db packages/agent/src/agent/types.ts packages/agent/src/testing/fake-agent-store.ts packages/api/src/routers/agents.ts packages/api/src/routers/agents.test.ts
git commit -m "$(printf 'feat(agent): per-agent composio toolkits field\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Resolve a turn's composio tools from the agent's toolkits

**Files:**
- Modify: `packages/agent/src/tool/composio-tools.ts` (`ComposioService.listTools` + `buildComposioToolDefs` signatures)
- Modify: `packages/agent/src/tool/composio-tools.test.ts`
- Modify: `apps/server/src/composio.ts` (`listTools(userId, toolkits)` + `defaultToolkits` fallback)
- Modify: `packages/api/src/routers/user-sessions.ts` (`safeComposioDefs` + load agent toolkits)
- Modify: `packages/api/src/routers/user-sessions.test.ts` (or the SP1 `*-composio.test.ts` file if that's where `safeComposioDefs` tests live)

**Interfaces:**
- Consumes: `AgentConfig.composioToolkits` (Task 1).
- Changes: `ComposioService.listTools(userId: string, toolkits: string[])`; `buildComposioToolDefs(service, userId, toolkits)`; `safeComposioDefs(service, userId, toolkits)`.

- [ ] **Step 1: Update the agent-package signatures + test**

`composio-tools.ts`:
- `ComposioService.listTools(userId: string, toolkits: string[]): Promise<ComposioToolMeta[]>;`
- `buildComposioToolDefs(service, userId, toolkits: string[])` → calls `service.listTools(userId, toolkits)`.

Update `composio-tools.test.ts`: the fake `listTools` now takes `(userId, toolkits)`; add an assertion that `buildComposioToolDefs(service, "u1", ["hackernews"])` calls the fake with `["hackernews"]` (capture the args). Keep the existing execute-forwarding + isError + empty-list cases.

- [ ] **Step 2: Run agent test (fail → implement → pass)**

Run: `pnpm -F @better-agent/agent test composio-tools` (fails on arity), implement, re-run → PASS.

- [ ] **Step 3: apps/server impl — toolkits param + fallback**

`apps/server/src/composio.ts`:
- `createComposioService` keeps `config.toolkits` but rename its role to a default. In `listTools(userId, toolkits)`:
```ts
async listTools(userId, toolkits) {
	const resolved = toolkits.length > 0 ? toolkits : config.toolkits;
	if (resolved.length === 0) {
		return [];
	}
	const tools = await composio.tools.get(userId, { toolkits: resolved });
	return (tools as OpenAiTool[]).map(mapOpenAiTool);
},
```
(The env `COMPOSIO_TOOLKITS` default is still passed as `config.toolkits` in `optional-services.ts` → it becomes the fallback. No change needed in `optional-services.ts`.)

- [ ] **Step 4: Router — load the agent's toolkits + forward**

`packages/api/src/routers/user-sessions.ts`:
- `safeComposioDefs(service, userId, toolkits: string[])` → forwards `toolkits` to `buildComposioToolDefs(service, userId, toolkits)`. (null/throw → [] unchanged.)
- In `streamUserTurn`, capture the session and load its agent:
```ts
const session = await requireUserSession(context, userId, input.sessionId);
const remoteDefs = input.tools
	? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
	: [];
const agent = await context.services.stores.agent.get(session.agentId);
const composioDefs = await safeComposioDefs(
	context.services.composio,
	userId,
	agent?.composioToolkits ?? [],
);
const allDefs = [...remoteDefs, ...composioDefs];
```
(`requireUserSession` already returns the `Session`; it was previously discarded.)

- [ ] **Step 5: Update the router test**

In the file holding the SP1 `safeComposioDefs` tests, update calls to the new arity: `safeComposioDefs(service, "u1", ["hackernews"])`. Add an assertion the toolkits reach the fake `listTools`. Keep null → [] and throw → [].

- [ ] **Step 6: Verify + commit**

```bash
pnpm check-types
pnpm -F @better-agent/agent test composio-tools
pnpm -F @better-agent/api test -- user-sessions
pnpm -F server build
pnpm exec biome lint packages/agent/src/tool/composio-tools.ts packages/agent/src/tool/composio-tools.test.ts apps/server/src/composio.ts packages/api/src/routers/user-sessions.ts <the router test file>
git add packages/agent/src/tool apps/server/src/composio.ts packages/api/src/routers/user-sessions.ts <router test file>
git commit -m "$(printf 'feat(api): resolve composio tools from the turn agent toolkits\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: tsc clean; agent + api tests pass; server build clean; lint clean.

---

### Task 3: Admin wizard — "Tools" step

**Files:**
- Modify: `apps/admin/src/components/agents/agent-form.ts`
- Modify: `apps/admin/src/components/agents/agent-wizard-steps.tsx`
- Modify: `apps/admin/src/components/agents/agent-wizard.tsx` (render the new step)

- [ ] **Step 1: Form model**

`agent-form.ts`:
- `AgentForm` += `composioToolkits: string[];`
- `EMPTY_AGENT_FORM` += `composioToolkits: [],`
- `WIZARD_STEPS = ["Identity", "Model", "Params", "Tools"] as const;`
- `toAgentInput` return += `composioToolkits: form.composioToolkits,`
- `agentRowToForm` return += `composioToolkits: row.composioToolkits ?? [],`
- `isStepValid`: the new Tools step is optional → the existing `return true` fallthrough already covers it (Tools isn't IDENTITY_STEP or MODEL_STEP). Confirm no step-index assumptions break (LAST_STEP is derived from `WIZARD_STEPS.length`, so it stays correct).

- [ ] **Step 2: `ToolsStep` + `ToolkitsInput`**

In `agent-wizard-steps.tsx`, add a `ToolsStep({ form, set })` rendering a `ToolkitsInput` for `form.composioToolkits`. `ToolkitsInput`: an `Input` where Enter adds the trimmed lowercased slug as a chip (dedup), chips are removable (a small × button), plus a row of common-suggestion chips that quick-add. Keep each function ≤50 lines (extract `ToolkitChip`). Flat styling, reuse the existing `Field`/`Label` pattern. Suggestions constant:
```ts
const SUGGESTED_TOOLKITS = ["hackernews", "github", "gmail", "slack", "googledocs"] as const;
```
Helper text: "Toolkit slugs from composio (e.g. hackernews). The agent can call any tool in these toolkits." Set updates via `set({ composioToolkits: next })`.

- [ ] **Step 3: Render the step**

`agent-wizard.tsx` — read it; it switches on the step index to render `IdentityStep`/`ModelStep`/`ParamsStep`. Add the `ToolsStep` branch for the new index (3). Import `ToolsStep`.

- [ ] **Step 4: Verify + commit**

```bash
pnpm -F admin build
cd apps/admin && pnpm exec tsc --noEmit && cd ../..
pnpm exec biome lint apps/admin/src/components/agents/agent-form.ts apps/admin/src/components/agents/agent-wizard-steps.tsx apps/admin/src/components/agents/agent-wizard.tsx
git add apps/admin/src/components/agents/agent-form.ts apps/admin/src/components/agents/agent-wizard-steps.tsx apps/admin/src/components/agents/agent-wizard.tsx
git commit -m "$(printf 'feat(admin): agent wizard tools step for composio toolkits\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
Expected: admin build + tsc clean; lint clean.

---

## Self-Review Notes
- Coverage: column + migration + types + store + zod (T1); service/runtime resolution from agent toolkits + fallback (T2); admin wizard Tools step (T3).
- Type consistency: `composioToolkits: string[]` uniform across schema/`AgentConfig`/`AgentInput`/zod/`AgentForm`; `listTools`/`buildComposioToolDefs`/`safeComposioDefs` all gain `toolkits`.
- Backward-compat: empty agent toolkits → env `COMPOSIO_TOOLKITS` fallback (SP1 smoke preserved); migration additive + defaulted.
- YAGNI: toolkit-level only, static suggestion chips (no catalog fetch), no per-user OAuth (SP3).
- Smoke (human): set an agent's toolkits to `hackernews` in the admin wizard (or rely on the env fallback), set `COMPOSIO_API_KEY`, chat with that agent → it can call `HACKERNEWS_SEARCH_POSTS`.
