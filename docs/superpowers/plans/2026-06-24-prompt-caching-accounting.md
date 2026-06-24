# Prompt Caching + Token Accounting (T3 + 3.4) Implementation Plan

> **Plan C of 3** for the tool system (Plans A + B merged). This is the cost layer: per-provider prompt caching so multi-step tool turns reuse the stable prefix, plus cache/reasoning token accounting + per-message cost so the savings are measurable.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-step turns cheaper and measurable: apply provider-appropriate prompt-cache hints before each `streamText`, and record cache-read / cache-write / reasoning tokens plus a computed per-message cost.

**Architecture:** A pure `resolveCachePolicy(providerNpm)` maps a provider to a strategy: Anthropic → tag the system message's content with `cacheControl: ephemeral`; OpenAI/compatible/xAI → set `providerOptions.<key>.promptCacheKey = sessionId`; Gemini → rely on implicit prefix caching (no-op); others → set `promptCacheKey` as a harmless fallback. The runtime resolves the policy (it gains `providerCatalogStore` for the `npm`) and applies it to the messages + `providerOptions` it already passes to `streamText`. Accounting: `mapUsage` reads the AI-SDK unified `cachedInputTokens`/`reasoningTokens` into an extended `MessageUsage`; a pure `computeCost(usage, modelEntry)` (default cache multipliers) is written into the message at finalize via the existing `modelCacheStore`. All `MessageUsage` additions are jsonb — **no migration**.

**Tech Stack:** TypeScript, Vercel AI SDK v6 (`providerOptions` cache hints, `usage.cachedInputTokens`/`reasoningTokens`), Vitest. The exact AI-SDK usage field names + the per-provider `providerOptions` shapes are version-specific — the relevant tasks verify them against the installed `ai`/`@ai-sdk/*` types before writing.

**Source design (validated + decided):** `docs/research/agent-gap-analysis.md` §3.2.1 (T3, all-provider per decision #2), §3.4 (accounting), decision #5 (cache pricing uses default multipliers; per-provider exact cache prices deferred — no new pricing columns this plan).

## Global Constraints

- **Decisions (binding):**
  - **Caching is `auto` for every turn** (no agent field, no migration — like `DEFAULT_MAX_STEPS`). Applied in the runtime before `streamText` based on the provider's `npm`.
  - **Anthropic strategy:** put ONE `cacheControl: { type: "ephemeral" }` breakpoint on the system message's content (the largest stable prefix: system prompt + summary + tool defs all precede it). Converting the system message's string content into a single text part carrying `providerOptions.anthropic.cacheControl` is the mechanism. (Per gap-doc §3.2.1 the "ideal" is breakpoints at last-tool-def + last-system + last-user; this plan ships the single system breakpoint — the highest-value, lowest-risk one — and notes the others as a follow-up.)
  - **OpenAI/compatible/xAI strategy:** `providerOptions[providerKey].promptCacheKey = sessionId` where `providerKey` is the AI-SDK provider options key (`openai`, `xai`, etc.). Unknown providers also get a `promptCacheKey` fallback (AI SDK ignores unknown `providerOptions`).
  - **Gemini strategy:** no-op (implicit prefix caching). 
  - **Accounting fields** added to `MessageUsage` (jsonb, zero migration): `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costCents` — all `number | null`.
  - **Cost multipliers (decision #5):** `CACHE_READ_MULTIPLIER = 0.1`, `CACHE_WRITE_MULTIPLIER = 1.25` applied to the model's `inputPricePerM`; reasoning tokens billed at `outputPricePerM`. No new per-provider cache-price columns this plan.
  - **`computeCost` returns cents** (a number) or null when pricing/usage is unavailable.
- **AI-SDK shape verification:** each task that depends on AI-SDK internals (usage field names, `providerOptions` shapes, message `content`-part `providerOptions`) includes a step to confirm against the installed types in `node_modules/.pnpm/ai@*` / `@ai-sdk/*` before writing. Do not guess.
- **Code rules (Ultracite/Biome + project):** no `any` (use `unknown`); `interface` over `type` for object shapes; `import type`; `for...of`; files ≤300 lines, functions ≤50 lines, complexity ≤10; no magic numbers (named constants/multipliers); kebab-case; specific imports. `pnpm dlx ultracite fix <paths>` before each commit; lefthook blocks non-compliant commits.
- **Tests:** `pnpm -F @better-agent/<pkg> exec vitest run src/<path>.test.ts`. Typecheck per package.
- **Commits:** conventional-commits; every message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/agent/src/session/types.ts` (modify) — extend `MessageUsage`.
- `packages/agent/src/session/stream-mapping.ts` (modify) — `mapUsage` reads cached/reasoning tokens.
- `packages/agent/src/provider/cost.ts` (new) — `computeCost(usage, modelEntry)` + multipliers.
- `packages/agent/src/provider/cache-policy.ts` (new) — `resolveCachePolicy(npm)` + `applyCachePolicy({messages, providerOptions}, {policy, sessionId})`.
- `packages/agent/src/session/runtime.ts` (modify) — resolve + apply the policy before `streamText`; compute + persist cost at finalize; gains `providerCatalogStore`.
- Deps sites for `providerCatalogStore`: `runtime.test.ts`, `packages/api/src/routers/sessions.test.ts`, `apps/server/src/index.ts`.
- Tests alongside.

---

### Task 1: Accounting token fields + mapUsage

**Files:**
- Modify: `packages/agent/src/session/types.ts`
- Modify: `packages/agent/src/session/stream-mapping.ts`
- Modify: `packages/agent/src/session/stream-mapping.test.ts`

**Interfaces:**
- Produces: `MessageUsage` gains `reasoningTokens: number | null`, `cacheReadTokens: number | null`, `cacheWriteTokens: number | null`, `costCents: number | null`. `mapUsage` populates `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` from the AI-SDK usage; `costCents` defaults to null (set later, Task 2).

- [ ] **Step 1: Verify the AI-SDK usage fields**

Read the installed `ai` `LanguageModelUsage` type (`node_modules/.pnpm/ai@*/node_modules/ai/dist/index.d.ts`, grep `LanguageModelUsage`): confirm the unified fields for cached input tokens (likely `cachedInputTokens`) and reasoning tokens (likely `reasoningTokens`), and whether a cache-WRITE count exists at the unified level (it may only be in `providerMetadata`/`inputTokenDetails`). Record the exact names. If cache-write isn't on the unified usage, map it to null this task (the unified `cachedInputTokens` covers cache READ, which is the dominant savings signal).

- [ ] **Step 2: Extend `MessageUsage` + write the failing mapUsage test**

In `types.ts`, extend `MessageUsage`:
```ts
export interface MessageUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	reasoningTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	costCents: number | null;
}
```
In `stream-mapping.test.ts`, extend the existing `mapUsage` test to assert the new fields map from a usage object carrying `cachedInputTokens`/`reasoningTokens` (use the verified field names), and that absent fields → null, and `costCents` is null.

- [ ] **Step 3: Run to verify it fails** — `pnpm -F @better-agent/agent exec vitest run src/session/stream-mapping.test.ts` → FAIL.

- [ ] **Step 4: Extend `mapUsage`**

In `stream-mapping.ts`, widen the `UsageInput` `Pick` to include the cached/reasoning fields and map them (verified names):
```ts
export function mapUsage(usage: UsageInput): MessageUsage {
	return {
		inputTokens: usage.inputTokens ?? null,
		outputTokens: usage.outputTokens ?? null,
		totalTokens: usage.totalTokens ?? null,
		reasoningTokens: usage.reasoningTokens ?? null,
		cacheReadTokens: usage.cachedInputTokens ?? null,
		cacheWriteTokens: null,
		costCents: null,
	};
}
```
(Adjust field names to Step 1's findings. `costCents`/`cacheWriteTokens` are set/refined later.)

- [ ] **Step 5: Run + full agent typecheck**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/stream-mapping.test.ts` → PASS. Run `pnpm -F @better-agent/agent exec tsc --noEmit` → expect errors anywhere a `MessageUsage` is constructed literally (fakes/tests that build a usage object). Fix each by adding the four new fields (`: null`). The `mapUsage` path is the only producer in the runtime; literals appear in tests/fakes — update them.

- [ ] **Step 6: Run the full agent suite + commit**

Run: `pnpm -F @better-agent/agent test` → green. `pnpm -F @better-agent/api exec tsc -b` → clean (the api re-exports `MessageUsage` via events; additive fields are fine).
```bash
pnpm dlx ultracite fix packages/agent/src/session
git add packages/agent/src/session/types.ts packages/agent/src/session/stream-mapping.ts packages/agent/src/session/stream-mapping.test.ts
git commit -m "feat(agent): account for cache and reasoning tokens in usage"
```

---

### Task 2: Cost computation + persistence

**Files:**
- Create: `packages/agent/src/provider/cost.ts`
- Create: `packages/agent/src/provider/cost.test.ts`
- Modify: `packages/agent/src/session/runtime.ts` (compute + store cost at finalize)

**Interfaces:**
- Consumes: `MessageUsage` (Task 1); `ModelEntry` (`provider/types.ts`, has `inputPricePerM`/`outputPricePerM`).
- Produces: `computeCost(usage: MessageUsage, modelEntry: { inputPricePerM: number | null; outputPricePerM: number | null }): number | null` (cents); exported `CACHE_READ_MULTIPLIER = 0.1`, `CACHE_WRITE_MULTIPLIER = 1.25`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/provider/cost.test.ts`:
```ts
import { expect, it } from "vitest";
import type { MessageUsage } from "../session/types";
import { computeCost } from "./cost";

const baseUsage: MessageUsage = {
	inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: null,
	reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costCents: null,
};

it("computes input + output cost in cents", () => {
	// $3/M in, $15/M out → 300c + 1500c = 1800c
	expect(computeCost(baseUsage, { inputPricePerM: 3, outputPricePerM: 15 })).toBe(1800);
});

it("bills cache-read at 0.1x input and cache-write at 1.25x input", () => {
	const usage = { ...baseUsage, inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
	// 1M*3*0.1 = 30c (read) + 1M*3*1.25 = 375c (write) = 405c
	expect(computeCost(usage, { inputPricePerM: 3, outputPricePerM: 15 })).toBe(405);
});

it("bills reasoning tokens at the output rate", () => {
	const usage = { ...baseUsage, inputTokens: 0, outputTokens: 0, reasoningTokens: 1_000_000 };
	expect(computeCost(usage, { inputPricePerM: 3, outputPricePerM: 15 })).toBe(1500);
});

it("returns null when pricing is missing", () => {
	expect(computeCost(baseUsage, { inputPricePerM: null, outputPricePerM: null })).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

`packages/agent/src/provider/cost.ts`:
```ts
import type { MessageUsage } from "../session/types";

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;
const CENTS_PER_DOLLAR = 100;
const TOKENS_PER_MILLION = 1_000_000;

interface Pricing {
	inputPricePerM: number | null;
	outputPricePerM: number | null;
}

export function computeCost(
	usage: MessageUsage,
	pricing: Pricing
): number | null {
	if (pricing.inputPricePerM === null || pricing.outputPricePerM === null) {
		return null;
	}
	const inPrice = pricing.inputPricePerM;
	const outPrice = pricing.outputPricePerM;
	const dollars =
		((usage.inputTokens ?? 0) * inPrice +
			(usage.outputTokens ?? 0) * outPrice +
			(usage.cacheReadTokens ?? 0) * inPrice * CACHE_READ_MULTIPLIER +
			(usage.cacheWriteTokens ?? 0) * inPrice * CACHE_WRITE_MULTIPLIER +
			(usage.reasoningTokens ?? 0) * outPrice) /
		TOKENS_PER_MILLION;
	return dollars * CENTS_PER_DOLLAR;
}
```

- [ ] **Step 4: Run to verify it passes** (4 tests).

- [ ] **Step 5: Persist cost at finalize**

In `runtime.ts` `finalizeAssistant` (which already has `deps` + the outcome's `usage`): after the stream completes, look up the model pricing and set `costCents` on the usage before `updateMessage`. The runtime already has `deps.modelCacheStore`. Add a helper:
```ts
async function withCost(
	deps: SessionRuntimeDeps,
	agent: { providerId: string; modelId: string },
	usage: MessageUsage | null
): Promise<MessageUsage | null> {
	if (usage === null) {
		return null;
	}
	const entry = await deps.modelCacheStore.get(agent.providerId, agent.modelId);
	return { ...usage, costCents: entry ? computeCost(usage, entry) : null };
}
```
Thread the `agent` (providerId/modelId) into `finalizeAssistant` and call `const usage = await withCost(deps, agent, outcome.usage);` then write that `usage` into `updateMessage` and the `done` event. (Import `computeCost` from `../provider/cost`.)

- [ ] **Step 6: Run agent suite + typecheck + commit**

Run: `pnpm -F @better-agent/agent test` → green (existing runtime tests now see a `costCents` on usage — if any assert the exact usage object, update them to include `costCents`). `pnpm -F @better-agent/agent exec tsc --noEmit` → clean.
```bash
pnpm dlx ultracite fix packages/agent/src/provider/cost.ts packages/agent/src/provider/cost.test.ts packages/agent/src/session/runtime.ts
git add packages/agent/src/provider/cost.ts packages/agent/src/provider/cost.test.ts packages/agent/src/session/runtime.ts
git commit -m "feat(agent): compute and persist per-message cost"
```

---

### Task 3: Cache policy resolution

**Files:**
- Create: `packages/agent/src/provider/cache-policy.ts`
- Create: `packages/agent/src/provider/cache-policy.test.ts`

**Interfaces:**
- Produces:
  - `type CacheStrategy = "anthropic-breakpoint" | "prompt-cache-key" | "none"`
  - `resolveCachePolicy(providerNpm: string | null): { strategy: CacheStrategy; providerKey: string }` — maps npm → strategy + the AI-SDK `providerOptions` key.
  - `applyCachePolicy(input: { messages: ModelMessage[]; sessionId: string }, policy: { strategy: CacheStrategy; providerKey: string }): { messages: ModelMessage[]; providerOptions: Record<string, Record<string, unknown>> }` — returns the (possibly transformed) messages + the `providerOptions` to pass to `streamText`.

- [ ] **Step 1: Verify the provider npm values + AI-SDK provider-options shapes**

Confirm the provider `npm` strings used in this repo (read `packages/agent/src/provider/adapter-loader.ts` `NATIVE_ADAPTERS` — e.g. `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`, `@ai-sdk/openai-compatible`). Confirm the AI-SDK `providerOptions` key per provider (e.g. `anthropic`, `openai`, `google`, `xai`) and that `providerOptions.anthropic.cacheControl: { type: "ephemeral" }` is valid on a message text part, and `providerOptions.openai.promptCacheKey` is a string. Record the npm→key→strategy mapping.

- [ ] **Step 2: Write the failing test**

`cache-policy.test.ts` (use the verified mappings):
```ts
import type { ModelMessage } from "ai";
import { expect, it } from "vitest";
import { applyCachePolicy, resolveCachePolicy } from "./cache-policy";

it("maps anthropic npm to the breakpoint strategy", () => {
	expect(resolveCachePolicy("@ai-sdk/anthropic").strategy).toBe("anthropic-breakpoint");
});
it("maps openai npm to the prompt-cache-key strategy", () => {
	const p = resolveCachePolicy("@ai-sdk/openai");
	expect(p.strategy).toBe("prompt-cache-key");
	expect(p.providerKey).toBe("openai");
});
it("maps google npm to none", () => {
	expect(resolveCachePolicy("@ai-sdk/google").strategy).toBe("none");
});
it("unknown/null npm falls back to a prompt-cache-key strategy", () => {
	expect(resolveCachePolicy(null).strategy).toBe("prompt-cache-key");
});

it("anthropic policy tags the system message with cacheControl", () => {
	const messages: ModelMessage[] = [{ role: "system", content: "SYS" }, { role: "user", content: "hi" }];
	const out = applyCachePolicy({ messages, sessionId: "s1" }, { strategy: "anthropic-breakpoint", providerKey: "anthropic" });
	const sys = out.messages[0];
	// system content becomes an array with a text part carrying anthropic.cacheControl
	expect(Array.isArray(sys?.content)).toBe(true);
});

it("prompt-cache-key policy sets promptCacheKey=sessionId in providerOptions", () => {
	const out = applyCachePolicy({ messages: [], sessionId: "s1" }, { strategy: "prompt-cache-key", providerKey: "openai" });
	expect(out.providerOptions.openai?.promptCacheKey).toBe("s1");
});
```

- [ ] **Step 3: Run to verify it fails** — FAIL.

- [ ] **Step 4: Implement** (using verified mappings/shapes from Step 1)

`packages/agent/src/provider/cache-policy.ts`: `resolveCachePolicy` switches on the npm; `applyCachePolicy`:
- `anthropic-breakpoint`: find the first `system` message; if its `content` is a string, replace it with `[{ type: "text", text: <string>, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }]`; return the new messages array + empty `providerOptions`.
- `prompt-cache-key`: return messages unchanged + `providerOptions: { [providerKey]: { promptCacheKey: sessionId } }`.
- `none`: return messages unchanged + empty `providerOptions`.
Keep functions ≤50 lines (extract `tagSystemMessage`).

- [ ] **Step 5: Run to verify it passes** + `tsc --noEmit` clean.

- [ ] **Step 6: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/provider/cache-policy.ts packages/agent/src/provider/cache-policy.test.ts
git add packages/agent/src/provider/cache-policy.ts packages/agent/src/provider/cache-policy.test.ts
git commit -m "feat(agent): per-provider prompt cache policy"
```

---

### Task 4: Apply the cache policy in the runtime

**Files:**
- Modify: `packages/agent/src/session/runtime.ts`
- Modify: `packages/agent/src/session/runtime.test.ts` (deps + a test)
- Modify: `packages/api/src/routers/sessions.test.ts` (deps)
- Modify: `apps/server/src/index.ts` (deps)

**Interfaces:**
- Consumes: `resolveCachePolicy`/`applyCachePolicy` (Task 3); `ProviderCatalogStore` (ports).
- Produces: `SessionRuntimeDeps` gains `providerCatalogStore: ProviderCatalogStore`. The runtime resolves the provider's `npm`, applies the cache policy to the messages + `providerOptions`, and passes both to `streamText`.

- [ ] **Step 1: Add the dep + wire the policy**

In `runtime.ts`:
- Add `providerCatalogStore: ProviderCatalogStore;` to `SessionRuntimeDeps` (import `ProviderCatalogStore` from `../ports`).
- Where the runtime builds the per-turn messages + calls `streamText` (in `runTurn`/`runAttempt`): resolve the policy once per turn:
```ts
const provider = await deps.providerCatalogStore.get(agent.providerId);
const policy = resolveCachePolicy(provider?.npm ?? null);
const cached = applyCachePolicy({ messages, sessionId }, policy);
// pass cached.messages as `messages` and merge cached.providerOptions into streamText `providerOptions`
```
- In the `streamText({...})` call, use `messages: cached.messages` and add `providerOptions: cached.providerOptions`. (Thread `cached.messages`/`cached.providerOptions` into `streamAssistant`/`runAttempt`, which currently receive `messages`; add a `providerOptions` param, or resolve the policy inside and pass through.)
- Import `resolveCachePolicy`, `applyCachePolicy` from `../provider/cache-policy`.

- [ ] **Step 2: Write a test that the policy is applied**

In `runtime.test.ts` (reuse the seed helper; the fake `providerCatalogStore` is `createFakeCatalogStore` from `../testing/fakes` — seed a provider entry with `npm: "@ai-sdk/openai"`). Add a test that a turn with that provider results in `providerOptions.openai.promptCacheKey === sessionId` reaching the model. The simplest observable: use a `MockLanguageModelV3` whose `doStream` captures its `options`/`providerOptions` (the mock receives the call args) and assert the key is present. (If capturing providerOptions from the mock is awkward, instead unit-assert via `applyCachePolicy` already covered in Task 3 and make this test assert that `providerCatalogStore.get` was consulted + the turn still completes — but prefer capturing the providerOptions if the mock exposes them.)

- [ ] **Step 3: Update the other deps sites**

`providerCatalogStore` is now required on `SessionRuntimeDeps`. Add `providerCatalogStore: createFakeCatalogStore()` to:
- `runtime.test.ts` deps (or the shared seed helper),
- `packages/api/src/routers/sessions.test.ts` deps,
- `apps/server/src/index.ts` `buildServices` → use the existing `providerCatalog` store local.

- [ ] **Step 4: Run tests + typecheck (agent + api + server)**

Run: `pnpm -F @better-agent/agent exec vitest run src/session/runtime.test.ts` → PASS (existing turns unaffected: a provider with no npm or a non-anthropic provider just adds a harmless `promptCacheKey`; the empty-tools/text tests still pass). `pnpm -F @better-agent/api test` → PASS. `pnpm -F @better-agent/agent exec tsc --noEmit && pnpm -F @better-agent/api exec tsc -b && pnpm -F server check-types` → clean.

- [ ] **Step 5: Commit**
```bash
pnpm dlx ultracite fix packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts packages/api/src/routers/sessions.test.ts apps/server/src/index.ts
git add packages/agent/src/session/runtime.ts packages/agent/src/session/runtime.test.ts packages/api/src/routers/sessions.test.ts apps/server/src/index.ts
git commit -m "feat(agent): apply per-provider prompt caching per turn"
```

---

## Final verification

- [ ] **Agent suite:** `pnpm -F @better-agent/agent test` — green (new: mapUsage cache/reasoning, computeCost, cache-policy, runtime cache application).
- [ ] **Typecheck:** agent / api / server — clean.
- [ ] **Lint:** `pnpm dlx ultracite check packages/agent/src apps/server/src` — clean.
- [ ] **Coverage:** T3 → Tasks 3,4 (per-provider cache hints applied per turn); 3.4 → Tasks 1,2 (cache/reasoning tokens mapped, per-message cost computed + persisted). No migration (jsonb usage; no new pricing columns — default multipliers per decision #5).
- [ ] **End-to-end (user-run, manual):** with a real Anthropic key, run a multi-step turn twice in a session; confirm the second turn's persisted `usage.cacheReadTokens` is non-zero and `costCents` reflects the cache discount. With OpenAI, confirm `promptCacheKey` improves the cached-token count on repeated prefixes.
- [ ] **Scope guard / follow-ups (by design):** single Anthropic breakpoint on the system message (last-user / last-tool-def breakpoints are a follow-up); no per-provider exact cache-price columns (default multipliers); `cacheWriteTokens` may be null if the unified usage doesn't expose it (cache-read is the dominant signal); caching is always-on `auto` (no agent `cachePolicy` field). This completes the tool-system milestone (Plans A+B+C).
