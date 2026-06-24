# Tool-System Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Three follow-up refinements to the agent session runtime surfaced during the tool-system reviews: (1) collapse the param-heavy streaming helpers into options objects (also clears the `max-params` lint in `runtime.ts`), (2) extend Anthropic prompt caching from the single system breakpoint to the full opencode-`auto` set (tool-defs + system + last-user), and (3) add a Redis-backed `SessionLock` so concurrent-prompt rejection works across instances.

**Architecture:** All three live in `@better-agent/agent` plus the `apps/server` composition root. The cache and lock work follows the established ports pattern: the agent package owns the interface, `apps/server` provides the in-memory and Redis implementations and selects by `env.REDIS_URL` (mirrors `redis-pending-store.ts`). Task 1 is a pure mechanical refactor that Task 2 builds on (Task 2 threads a `cacheToolDefs` flag through the same helpers into `buildTools`).

**Tech Stack:** TypeScript, AI SDK v6 (`ai@6.0.205`, `@ai-sdk/anthropic@3.0.84`), ioredis (`catalog:` → `^5.11.1`), ioredis-mock v8 + vitest.

## Global Constraints

- Functions ≤ 50 lines; files ≤ 300 lines; kebab-case filenames; conventional-commits; commit footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `ioredis` must NOT be imported into `packages/agent` — Redis implementations live in `apps/server` behind the agent-package interface (same as `redis-pending-store.ts`).
- No behavior change in Task 1 (refactor only). Existing runtime tests must stay green unchanged except for call-site argument shape if any test calls these private helpers directly (none do; they drive `runTurn`).
- Anthropic cache breakpoints must stay ≤ 4 total (provider hard limit). After this plan: tool-defs + system + last-user = 3.
- The lock interface becomes async; `runTurn` must `await` both `acquire` and `release`.
- Run `pnpm dlx ultracite check` (or `pnpm lint` scoped) before each commit; lint must be clean for the touched files.

---

### Task 1: Bundle streaming-helper params into options objects

**Files:**
- Modify: `packages/agent/src/session/runtime.ts` (`runAttempt`, `streamAssistant`, `finalizeAssistant`, and their call sites in `streamAssistant`/`executeTurn`)
- Test: `packages/agent/src/session/runtime-retry.test.ts`, `runtime-tools.test.ts`, `runtime-cache.test.ts`, `runtime-overflow.test.ts` (these drive `runTurn` — they should pass UNCHANGED; running them is the verification)

**Why:** `runAttempt` (8 params), `streamAssistant` (7), and `finalizeAssistant` (6) each trip the `max-params` lint. Bundling also makes Task 2's new `cacheToolDefs` field a one-line addition rather than yet another positional param.

**Interfaces:**
- Produces (module-private, consumed by Task 2):
  ```ts
  interface AttemptArgs {
    model: AiModel;
    messages: ModelMessage[];
    providerOptions: SharedV3ProviderOptions;
    params: AgentParams | null;
    ctx: DrainCtx;
    abortSignal?: AbortSignal;
  }
  ```

- [ ] **Step 1: Introduce `AttemptArgs` and refactor `runAttempt`**

Add the interface near the top of the helper section. New signature (3 params, was 8):

```ts
async function* runAttempt(
  args: AttemptArgs,
  bufs: {
    text: ReturnType<typeof createPartBuffer>;
    reasoning: ReturnType<typeof createPartBuffer>;
  },
  state: StreamOutcome
): AsyncGenerator<RunEvent, void> {
  const { model, messages, providerOptions, params, ctx, abortSignal } = args;
  try {
    const tools = buildTools(ctx.toolDefs, {
      sessionId: ctx.sessionId,
      messageId: ctx.assistantId,
      agentId: ctx.agentId,
      abortSignal: abortSignal ?? new AbortController().signal,
    });
    const result = streamText({
      model,
      messages,
      providerOptions,
      stopWhen: stepCountIs(DEFAULT_MAX_STEPS),
      tools,
      experimental_repairToolCall: () => Promise.resolve(null),
      abortSignal,
      maxRetries: 0,
      ...buildSettings(params),
    });
    yield* drainStream(result, bufs, state, ctx);
  } catch (error) {
    if (abortSignal?.aborted) {
      state.status = "aborted";
    } else {
      state.status = "error";
      state.finishReason = "error";
      state.errorMessage = error instanceof Error ? error.message : String(error);
      state.errorCategory = classifyError(error);
    }
  }
}
```

- [ ] **Step 2: Refactor `streamAssistant` to take `(deps, args)`**

New signature (2 params, was 7). It builds `bufs`/`state` internally as today and forwards `args` to `runAttempt`:

```ts
async function* streamAssistant(
  deps: SessionRuntimeDeps,
  args: AttemptArgs
): AsyncGenerator<RunEvent, StreamOutcome> {
  const { ctx, abortSignal } = args;
  const bufs = {
    text: createPartBuffer(deps.messageStore, ctx.assistantId, "text"),
    reasoning: createPartBuffer(deps.messageStore, ctx.assistantId, "reasoning"),
  };
  const sleep = deps.sleep ?? defaultSleep;
  const state: StreamOutcome = {
    usage: null,
    finishReason: "stop",
    status: "complete",
    errorMessage: null,
    errorCategory: null,
    emittedOutput: false,
  };
  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
    resetOutcome(state);
    yield* runAttempt(args, bufs, state);
    if (shouldRetryAttempt(state, attempt, abortSignal?.aborted ?? false)) {
      await sleep(backoffMs(attempt));
      continue;
    }
    break;
  }
  const partStatus: PartStatus = state.status === "error" ? "error" : "complete";
  await bufs.reasoning.flush(partStatus);
  await bufs.text.flush(partStatus);
  return state;
}
```

- [ ] **Step 3: Bundle `finalizeAssistant` params**

Add `FinalizeArgs` and refactor to `(deps, args)` (2 params, was 6):

```ts
interface FinalizeArgs {
  agent: AgentIdentity;
  assistantId: string;
  fallback: Message;
  sessionId: string;
  outcome: StreamOutcome;
}

async function* finalizeAssistant(
  deps: Pick<SessionRuntimeDeps, "messageStore" | "modelCacheStore" | "sessionStore">,
  args: FinalizeArgs
): AsyncGenerator<RunEvent, Message> {
  const { agent, assistantId, fallback, sessionId, outcome } = args;
  const usage = await withCost(deps, agent, outcome.usage);
  const final = await deps.messageStore.updateMessage(assistantId, {
    status: outcome.status,
    usage,
    finishReason: outcome.finishReason,
    error: outcome.errorMessage
      ? { message: outcome.errorMessage, category: outcome.errorCategory ?? "fatal" }
      : null,
  });
  if (outcome.status === "error") {
    await deps.sessionStore.setStatus(sessionId, "error");
    yield { type: "error", message: outcome.errorMessage ?? "stream error" };
  } else {
    yield { type: "done", usage, finishReason: outcome.finishReason };
  }
  return final ?? fallback;
}
```

- [ ] **Step 4: Update `executeTurn` call sites**

Build `AttemptArgs` once and pass the bundled args:

```ts
  const ctx: DrainCtx = {
    agentId: agent.id,
    assistantId: assistant.id,
    messageStore: deps.messageStore,
    sessionId,
    toolDefs: tools ?? [],
  };
  const outcome = yield* streamAssistant(deps, {
    model,
    messages: cached.messages,
    providerOptions: cached.providerOptions,
    params: agent.params,
    ctx,
    abortSignal,
  });
  return yield* finalizeAssistant(deps, {
    agent,
    assistantId: assistant.id,
    fallback: assistant,
    sessionId,
    outcome,
  });
```

- [ ] **Step 5: Verify — typecheck, lint, runtime tests unchanged**

Run:
```bash
pnpm -F @better-agent/agent check-types
pnpm exec biome lint packages/agent/src/session/runtime.ts
pnpm -F @better-agent/agent test -- runtime
```
Expected: tsc clean; biome reports NO `max-params` for `runtime.ts`; all `runtime*` tests PASS unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/session/runtime.ts
git commit -m "refactor(agent): bundle streaming-helper params into options objects"
```

---

### Task 2: Anthropic cache breakpoints — tool-defs + last-user

**Files:**
- Modify: `packages/agent/src/provider/cache-policy.ts` (add last-user tagging + `cacheToolDefs` output flag; extract a shared cacheControl helper)
- Modify: `packages/agent/src/tool/registry.ts` (`buildTools` gains an options arg to tag the last tool def)
- Modify: `packages/agent/src/session/runtime.ts` (thread `cacheToolDefs` from policy → `AttemptArgs` → `buildTools`)
- Test: `packages/agent/src/provider/cache-policy.test.ts`, `packages/agent/src/tool/registry.test.ts` (create if absent)

**Background:** `@ai-sdk/anthropic@3.0.84` reads `cacheControl` for: a tool from `tool.providerOptions.anthropic.cacheControl` (dist index.mjs:1497/1516); a user message from `message.providerOptions.anthropic.cacheControl` applied to its last content part (dist:2323) — identical to the existing system tagging. Anthropic caches the prefix up to each breakpoint; ordering is tools → system → messages. Today only the system breakpoint exists; this task adds the tool-def and last-user breakpoints to reach the opencode `auto` set (3 total, ≤ 4 limit).

**Interfaces:**
- Consumes: `AttemptArgs` from Task 1.
- Produces:
  ```ts
  // cache-policy.ts — ApplyCachePolicyOutput gains:
  cacheToolDefs: boolean;            // true only for the anthropic-breakpoint strategy
  // registry.ts:
  export function buildTools(
    defs: ToolDef[],
    ctxBase: CtxBase,
    opts?: { cacheLastToolDef?: boolean }
  ): ToolSet;
  ```

- [ ] **Step 1: Write failing tests for last-user tagging + `cacheToolDefs`**

Add to `packages/agent/src/provider/cache-policy.test.ts`:

```ts
it("tags the last user message with anthropic cacheControl", () => {
  const messages: ModelMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "latest" },
  ];
  const out = applyCachePolicy({ messages, sessionId: "s1" }, {
    strategy: "anthropic-breakpoint",
    providerKey: "anthropic",
  });
  const lastUser = out.messages.at(-1);
  expect(lastUser?.providerOptions?.anthropic).toMatchObject({
    cacheControl: { type: "ephemeral" },
  });
  // the earlier user message is NOT tagged
  expect(out.messages[1].providerOptions?.anthropic).toBeUndefined();
});

it("signals cacheToolDefs only for the anthropic strategy", () => {
  const base = { messages: [], sessionId: "s1" };
  expect(applyCachePolicy(base, { strategy: "anthropic-breakpoint", providerKey: "anthropic" }).cacheToolDefs).toBe(true);
  expect(applyCachePolicy(base, { strategy: "prompt-cache-key", providerKey: "openai" }).cacheToolDefs).toBe(false);
  expect(applyCachePolicy(base, { strategy: "none", providerKey: "google" }).cacheToolDefs).toBe(false);
});
```

Run `pnpm -F @better-agent/agent test -- cache-policy` → FAIL (`cacheToolDefs` undefined; last user untagged).

- [ ] **Step 2: Implement in `cache-policy.ts`**

Extract the inline cacheControl spread into a shared helper, add `tagLastUserMessage`, add `cacheToolDefs` to the output type, and tag both system + last-user in the anthropic branch:

```ts
interface ApplyCachePolicyOutput {
  messages: ModelMessage[];
  providerOptions: SharedV3ProviderOptions;
  cacheToolDefs: boolean;
}

function withAnthropicCacheControl(msg: ModelMessage): ModelMessage {
  return {
    ...msg,
    providerOptions: {
      ...msg.providerOptions,
      anthropic: {
        ...(msg.providerOptions?.anthropic as Record<string, unknown> | undefined),
        cacheControl: { type: "ephemeral" },
      },
    },
  };
}

// tagSystemMessage: replace its inline spread with `withAnthropicCacheControl(msg)`.

/** Tags the last `user` message so the cached prefix covers system + history through the prompt. */
function tagLastUserMessage(messages: ModelMessage[]): ModelMessage[] {
  let targetIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) {
    return messages;
  }
  return messages.map((msg, i) => (i === targetIdx ? withAnthropicCacheControl(msg) : msg));
}
```

Update `applyCachePolicy`'s switch — every branch returns `cacheToolDefs`:

```ts
  switch (strategy) {
    case "anthropic-breakpoint":
      return {
        messages: tagLastUserMessage(tagSystemMessage(messages)),
        providerOptions: {},
        cacheToolDefs: true,
      };
    case "prompt-cache-key":
      return {
        messages,
        providerOptions: { [providerKey]: { promptCacheKey: sessionId } },
        cacheToolDefs: false,
      };
    case "none":
      return { messages, providerOptions: {}, cacheToolDefs: false };
    default:
      return { messages, providerOptions: {}, cacheToolDefs: false };
  }
```

Run `pnpm -F @better-agent/agent test -- cache-policy` → PASS.

- [ ] **Step 3: Write failing test for `buildTools` tool-def tagging**

In `packages/agent/src/tool/registry.test.ts` (create if needed; import `buildTools`, a minimal `ToolDef[]`, and a stub `CtxBase`):

```ts
const ctxBase = {
  sessionId: "s1",
  messageId: "m1",
  agentId: "a1",
  abortSignal: new AbortController().signal,
};
const defs: ToolDef[] = [
  { name: "alpha", description: "a", parameters: { type: "object", properties: {} }, execute: async () => ({ output: "" }) },
  { name: "omega", description: "o", parameters: { type: "object", properties: {} }, execute: async () => ({ output: "" }) },
];

it("tags only the last tool def with anthropic cacheControl when opted in", () => {
  const tools = buildTools(defs, ctxBase, { cacheLastToolDef: true });
  expect((tools.omega as { providerOptions?: Record<string, unknown> }).providerOptions).toMatchObject({
    anthropic: { cacheControl: { type: "ephemeral" } },
  });
  expect((tools.alpha as { providerOptions?: unknown }).providerOptions).toBeUndefined();
});

it("does not tag tool defs by default", () => {
  const tools = buildTools(defs, ctxBase);
  expect((tools.omega as { providerOptions?: unknown }).providerOptions).toBeUndefined();
});
```

Run `pnpm -F @better-agent/agent test -- registry` → FAIL.

- [ ] **Step 4: Implement `buildTools` opts**

Add the third arg and, after the loop, tag the last def's tool. Build the `tool()` config with an optional `providerOptions`:

```ts
export function buildTools(
  defs: ToolDef[],
  ctxBase: CtxBase,
  opts?: { cacheLastToolDef?: boolean }
): ToolSet {
  const tools: ToolSet = {};
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (tools[def.name]) {
      throw new Error(`Duplicate tool name: ${def.name}`);
    }
    const isLast = i === defs.length - 1;
    const cacheLast = opts?.cacheLastToolDef === true && isLast;
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters),
      ...(cacheLast
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : {}),
      execute: async (
        args: unknown,
        options: { toolCallId: string; abortSignal?: AbortSignal }
      ) => {
        const result = await def.execute(args, {
          ...ctxBase,
          abortSignal: options.abortSignal ?? ctxBase.abortSignal,
          callId: options.toolCallId,
        });
        const output = truncateOutput(result.output).output;
        if (result.isError) {
          throw new Error(output);
        }
        return output;
      },
    });
  }
  return tools;
}
```

Run `pnpm -F @better-agent/agent test -- registry` → PASS.

- [ ] **Step 5: Thread `cacheToolDefs` through `runtime.ts`**

Add `cacheToolDefs?: boolean` to `AttemptArgs`. In `runAttempt`, pass it to `buildTools`:

```ts
    const tools = buildTools(
      ctx.toolDefs,
      {
        sessionId: ctx.sessionId,
        messageId: ctx.assistantId,
        agentId: ctx.agentId,
        abortSignal: abortSignal ?? new AbortController().signal,
      },
      { cacheLastToolDef: args.cacheToolDefs === true }
    );
```

(`args` is already destructured in `runAttempt`; reference `args.cacheToolDefs` directly or add it to the destructure.) In `executeTurn`, pass `cacheToolDefs: cached.cacheToolDefs` into the `streamAssistant` args object.

- [ ] **Step 6: Verify**

```bash
pnpm -F @better-agent/agent check-types
pnpm -F @better-agent/agent test -- "cache-policy|registry|runtime"
pnpm exec biome lint packages/agent/src/provider/cache-policy.ts packages/agent/src/tool/registry.ts packages/agent/src/session/runtime.ts
```
Expected: tsc clean, all tests PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/provider/cache-policy.ts packages/agent/src/provider/cache-policy.test.ts packages/agent/src/tool/registry.ts packages/agent/src/tool/registry.test.ts packages/agent/src/session/runtime.ts
git commit -m "feat(agent): cache anthropic tool defs and last user message"
```

---

### Task 3: Redis-backed session lock

**Files:**
- Modify: `packages/agent/src/session/session-lock.ts` (interface → async; in-memory impl returns Promises)
- Modify: `packages/agent/src/session/session-lock.test.ts` (await the calls)
- Modify: `packages/agent/src/session/runtime.ts` (`runTurn` awaits acquire/release)
- Create: `apps/server/src/redis-session-lock.ts`
- Create: `apps/server/src/redis-session-lock.test.ts`
- Modify: `apps/server/src/index.ts` (`buildSessionLock()` gated by `env.REDIS_URL`; wire into `buildRuntime`)

**Background:** `createInMemorySessionLock` is single-process; decision #1 of the gap analysis requires session-dimension state to use a shareable backend so `prompt` can land on any instance. Redis acquire is `SET key val PX <ttl> NX` (atomic); release is a token-guarded Lua compare-and-del so a turn that outlives the TTL never deletes another instance's lock. ioredis-mock v8 supports both `SET … PX … NX` and `eval` (verified).

**Interfaces:**
- Produces:
  ```ts
  export interface SessionLock {
    acquire(sessionId: string): Promise<boolean>;
    release(sessionId: string): Promise<void>;
  }
  export function createRedisSessionLock(redis: Redis): SessionLock;
  ```

- [ ] **Step 1: Make the interface async (`session-lock.ts`)**

```ts
export interface SessionLock {
  /** Try to take the lock for a session. Resolves false if already held. */
  acquire(sessionId: string): Promise<boolean>;
  release(sessionId: string): Promise<void>;
}
```

`SessionBusyError` unchanged. In-memory impl returns Promises:

```ts
export function createInMemorySessionLock(): SessionLock {
  const held = new Set<string>();
  return {
    acquire(sessionId) {
      if (held.has(sessionId)) {
        return Promise.resolve(false);
      }
      held.add(sessionId);
      return Promise.resolve(true);
    },
    release(sessionId) {
      held.delete(sessionId);
      return Promise.resolve();
    },
  };
}
```

Update the doc comment's "Single-process lock" line to note the Redis impl lives in `apps/server/redis-session-lock.ts`.

- [ ] **Step 2: Update `session-lock.test.ts` to await**

```ts
it("grants the lock once and rejects a second holder", async () => {
  const lock = createInMemorySessionLock();
  expect(await lock.acquire("s1")).toBe(true);
  expect(await lock.acquire("s1")).toBe(false);
});

it("does not block a different session", async () => {
  const lock = createInMemorySessionLock();
  expect(await lock.acquire("s1")).toBe(true);
  expect(await lock.acquire("s2")).toBe(true);
});

it("allows re-acquire after release", async () => {
  const lock = createInMemorySessionLock();
  await lock.acquire("s1");
  await lock.release("s1");
  expect(await lock.acquire("s1")).toBe(true);
});
```

Run `pnpm -F @better-agent/agent test -- session-lock` → PASS.

- [ ] **Step 3: Await the lock in `runTurn` (`runtime.ts`)**

```ts
export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
  return {
    async *runTurn(input) {
      if (!(await deps.sessionLock.acquire(input.sessionId))) {
        throw new SessionBusyError(input.sessionId);
      }
      try {
        return yield* executeTurn(deps, input);
      } finally {
        await deps.sessionLock.release(input.sessionId);
      }
    },
  };
}
```

Run `pnpm -F @better-agent/agent test -- runtime` → PASS unchanged (in-memory lock is injected; tests don't assert lock timing).

- [ ] **Step 4: Write failing Redis-lock tests (`apps/server/src/redis-session-lock.test.ts`)**

```ts
import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisSessionLock } from "./redis-session-lock";

it("grants the lock once and rejects a second holder cross-connection", async () => {
  const a = new RedisMock();
  const b = new RedisMock();
  const lockA = createRedisSessionLock(a);
  const lockB = createRedisSessionLock(b);
  expect(await lockA.acquire("s1")).toBe(true);
  expect(await lockB.acquire("s1")).toBe(false);
});

it("allows re-acquire after release", async () => {
  const redis = new RedisMock();
  const lock = createRedisSessionLock(redis);
  expect(await lock.acquire("s1")).toBe(true);
  await lock.release("s1");
  expect(await lock.acquire("s1")).toBe(true);
});

it("does not block a different session", async () => {
  const redis = new RedisMock();
  const lock = createRedisSessionLock(redis);
  expect(await lock.acquire("s1")).toBe(true);
  expect(await lock.acquire("s2")).toBe(true);
});

it("release only frees a lock this instance still holds (token-guarded)", async () => {
  const a = new RedisMock();
  const b = new RedisMock();
  const lockA = createRedisSessionLock(a);
  const lockB = createRedisSessionLock(b);
  await lockA.acquire("s1");
  // Simulate A's TTL expiring and B taking over:
  await a.del("sessionlock:s1");
  expect(await lockB.acquire("s1")).toBe(true);
  // A's late release must NOT remove B's lock:
  await lockA.release("s1");
  expect(await lockB.acquire("s1")).toBe(false);
});
```

Run `pnpm -F server test -- redis-session-lock` → FAIL (module missing).

- [ ] **Step 5: Implement `apps/server/src/redis-session-lock.ts`**

```ts
import type { SessionLock } from "@better-agent/agent/session/session-lock";
import { log } from "evlog";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

// A turn (multi-step tool loops) can run for minutes; the TTL only exists so a
// crashed instance cannot deadlock a session forever. Release is token-guarded
// so a turn that outlives the TTL never deletes a successor instance's lock.
const LOCK_TTL_MS = 300_000;

// KEYS[1]=lock key, ARGV[1]=token. Delete only if we still own it.
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function keyFor(sessionId: string): string {
  return `sessionlock:${sessionId}`;
}

export function createRedisSessionLock(redis: Redis): SessionLock {
  const tokens = new Map<string, string>();

  redis.on("error", (err: Error) => {
    log.error({ action: "redis session-lock error", error: String(err) });
  });

  return {
    async acquire(sessionId) {
      const token = randomUUID();
      const res = await redis.set(keyFor(sessionId), token, "PX", LOCK_TTL_MS, "NX");
      if (res === "OK") {
        tokens.set(sessionId, token);
        return true;
      }
      return false;
    },
    async release(sessionId) {
      const token = tokens.get(sessionId);
      if (token === undefined) {
        return;
      }
      tokens.delete(sessionId);
      await redis.eval(RELEASE_SCRIPT, 1, keyFor(sessionId), token);
    },
  };
}
```

Run `pnpm -F server test -- redis-session-lock` → PASS.

- [ ] **Step 6: Wire selection in `apps/server/src/index.ts`**

Add the import and a builder mirroring `buildPendingToolCallStore`, then use it in `buildRuntime`:

```ts
import { createRedisSessionLock } from "./redis-session-lock";

function buildSessionLock() {
  return env.REDIS_URL
    ? createRedisSessionLock(new Redis(env.REDIS_URL))
    : createInMemorySessionLock();
}
```

In `buildRuntime`, replace `sessionLock: createInMemorySessionLock(),` with `sessionLock: buildSessionLock(),`.

- [ ] **Step 7: Verify the whole touched surface**

```bash
pnpm -F @better-agent/agent check-types && pnpm -F server check-types
pnpm -F @better-agent/agent test -- "session-lock|runtime"
pnpm -F server test -- redis-session-lock
pnpm exec biome lint packages/agent/src/session/session-lock.ts packages/agent/src/session/runtime.ts apps/server/src/redis-session-lock.ts
```
Expected: tsc clean both packages; all listed tests PASS; lint clean.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/session/session-lock.ts packages/agent/src/session/session-lock.test.ts packages/agent/src/session/runtime.ts apps/server/src/redis-session-lock.ts apps/server/src/redis-session-lock.test.ts apps/server/src/index.ts
git commit -m "feat(server): redis-backed session lock for cross-instance rejection"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 → param-bundling polish; Task 2 → §3.2.1-A tool-def + last-user breakpoints; Task 3 → decision #1 / R3 Redis lock. All three covered.
- **Type consistency:** `AttemptArgs` defined in Task 1, extended (`cacheToolDefs`) in Task 2. `buildTools` 3rd arg and `ApplyCachePolicyOutput.cacheToolDefs` are the only new public-ish shapes. `SessionLock` async change is the only breaking interface; its sole external impl/caller (`apps/server`, `runTurn`) are both updated.
- **Ordering:** Task 1 → Task 2 (Task 2 needs `AttemptArgs`). Task 3 is independent and could run anytime; placed last.
