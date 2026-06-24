# Turn 上下文补全设计（动态上下文 R11 + 标题生成 R8）

> 日期：2026-06-24
> 范围：两个独立的运行时体验补全。R11：给 agent 的 system prompt 注入当前日期，让它知道"今天"。R8：会话首条消息后自动生成简短标题（`setTitle` 接口与 `session.title` 列已就位，但从未被调用）。
> 关联：[`agent-gap-analysis.md`](../../research/agent-gap-analysis.md) R8/R11；运行时 [`2026-06-16-agent-runtime-design.md`](./2026-06-16-agent-runtime-design.md)。

---

## 1. 目标 / 非目标

**目标**
- R11：每个 turn 在 system prompt 后注入「当前日期」（精确到天），agent 能回答与时间相关的问题。
- R8：会话第一次 `runTurn` 后，基于首条用户消息生成一个 ≤6 词的标题并 `setTitle`；同时向客户端发一个 `title` 事件供 UI 更新。

**非目标（YAGNI）**
- 不注入 OS/cwd/host 等 environment（对"通用对外 agent"语义不明确；只做日期）。
- 标题不做重命名/再生成；只在 `session.title == null` 时生成一次。
- 不引入新 DB 迁移（`session.title` 列已存在）。

---

## 2. R11 动态上下文

**机制**：纯函数 `buildDynamicContext(now: Date): string` 返回 `"Current date: YYYY-MM-DD"`（UTC，`toISOString().slice(0,10)`）。`buildTurnMessages` 把它追加到 `agent.systemPrompt` 后，再传给 `toModelMessages`：
```ts
systemPrompt: `${agent.systemPrompt}\n\n${buildDynamicContext(now)}`
```

**缓存友好**：日期精确到天 → 同一天内所有 turn 的 system message 相同 → Anthropic/OpenAI 前缀缓存照常命中（intra-turn 多步必然命中，inter-turn 同天也命中）。只有跨天才失效一次，可接受。

**时钟注入**：`SessionRuntimeDeps.clock?: () => Date`，默认 `() => new Date()`。`buildTurnMessages` 的 deps 接口加 `clock`。测试注入固定时钟。

**落点**
- 新增 `packages/agent/src/session/dynamic-context.ts`：`buildDynamicContext(now)`。
- 改 `packages/agent/src/session/turn-messages.ts`：`BuildTurnMessagesDeps` 加 `clock?: () => Date`；`buildTurnMessages` 在两处 `toModelMessages(...)` 调用前算出注入后的 `systemPrompt`（base 里替换 `systemPrompt`）。
- 改 `packages/agent/src/session/runtime.ts`：`SessionRuntimeDeps.clock?: () => Date`，透传给 `buildTurnMessages`（`loadContext`/`buildTurnMessages` 已收 deps）。

**测试**
- `dynamic-context.test.ts`：`buildDynamicContext(new Date("2026-06-24T10:00:00Z")) === "Current date: 2026-06-24"`。
- `turn-messages` 或 runtime 测试：注入固定 clock，断言 system message 含 `Current date: 2026-06-24`。
- ⚠️ 现有断言 system message 内容的测试需更新（注入改变了 system 文本）。实现时用固定 clock 或在断言里接受日期后缀。

---

## 3. R8 标题生成

**接口**（仿 `Summarizer`，新文件 `session/titler.ts`）：
```ts
export interface Titler {
  title(input: { providerId: string; modelId: string; userText: string }): Promise<string>;
}
```

**实现**（新文件 `session/model-titler.ts`，仿 `model-summarizer.ts`）：
```ts
const TITLE_SYSTEM =
  "Generate a concise chat title (max 6 words) for a conversation that starts with the user's message. Output only the title, no quotes, no punctuation at the end.";
export function createModelTitler(modelFactory: ModelFactory): Titler {
  return {
    async title({ providerId, modelId, userText }) {
      const model = await modelFactory.create(providerId, modelId);
      const result = await generateText({ model, system: TITLE_SYSTEM, prompt: userText });
      return result.text.trim();
    },
  };
}
```

**时机与并发**：`titler` 为**可选** dep（`SessionRuntimeDeps.titler?: Titler`），减少现有测试改动——未注入时不生成。在 `executeTurn` 中：
1. `loadContext` 后、`session.title == null` 且 `deps.titler` 存在时，**fire 但不 await** 一个 title promise（与 LLM 流并行，基于 `input.text`）：
   ```ts
   const titlePromise = maybeTitle(deps, session, agent, input.text);
   ```
   `maybeTitle` 内部 `.catch(() => null)`，标题失败绝不影响 turn。
2. LLM 流照常跑（`streamAssistant` + `finalizeAssistant`），先拿到 `const message = yield* finalizeAssistant(...)`。
3. `return message` 之前：`const title = await titlePromise; if (title) { await deps.sessionStore.setTitle(sessionId, title); yield { type: "title", title }; }`。

这样 title 生成与回复流并行，`done` 事件不被它阻塞；generator 结束前 await 一个通常已完成的 promise，并在 `done` 之后补发 `title` 事件。

**`maybeTitle` 纯逻辑**（放 `titler.ts`，便于测试）：
```ts
export function maybeTitle(
  deps: { titler?: Titler },
  session: { title: string | null },
  agent: { providerId: string; modelId: string },
  userText: string
): Promise<string | null> {
  if (session.title != null || !deps.titler) return Promise.resolve(null);
  return deps.titler.title({ providerId: agent.providerId, modelId: agent.modelId, userText }).catch(() => null);
}
```

**事件**：`events.ts` 的 `RunEvent` 增加 `{ type: "title"; title: string }`。客户端/UI 可选消费（不消费也无害）。

**落点**
- 新增 `session/titler.ts`（`Titler` 接口 + `maybeTitle`）、`session/model-titler.ts`（`createModelTitler`）。
- 改 `session/runtime.ts`：`SessionRuntimeDeps.titler?`；`executeTurn` 接入 fire-then-await-before-return + emit `title`。
- 改 `session/events.ts`：`title` 事件。
- 改 `apps/server/src/index.ts`：装配 `titler: createModelTitler(deps.modelFactory)` 与 `clock`（默认省略，用内置默认）。
- 改 `packages/agent/src/testing/fakes.ts`：`createFakeTitler(canned = "A Title"): Titler`。

**测试**（`runtime-title.test.ts`）
- 首 turn + fake titler → `session.title` 被 set 为 canned；事件流含 `{ type:"title", title }`。
- 已有 title 的 session → titler 不被调、无 title 事件。
- 无 titler dep → 不生成、不报错（现有测试路径）。

---

## 4. 错误处理

- 标题生成失败（模型错误）→ `maybeTitle` catch 成 null → 不 setTitle、不发事件、turn 正常完成。
- 动态上下文是纯字符串拼接，无失败路径。
- 两者都不改变既有错误/abort/SessionBusy 路径。

---

## 5. 决策记录

1. **只注入日期，不注入 environment**（YAGNI；通用 agent 无明确 environment）。
2. **日期精确到天**（缓存友好）。
3. **`titler` 与 `clock` 均为可选 dep**，最小化现有测试改动；server 装配真实实现。
4. **标题与 LLM 流并行、`done` 后补发 `title` 事件**，不阻塞回复。
5. **标题只生成一次**（`session.title == null` 守卫）；不做重命名。
6. **零 DB 迁移**（`session.title` 列已存在）。

---

## 6. 任务拆分（writing-plans 输入）

- **Task 1（R11 动态上下文）**：`dynamic-context.ts` + `turn-messages.ts` clock 注入 + `runtime.ts` clock 透传 + 测试（含更新受影响的 system 断言）。
- **Task 2（R8 标题）**：`titler.ts` + `model-titler.ts` + `events.ts` title 事件 + `runtime.ts` executeTurn 接入 + server 装配 + fakes + 测试。
