# 结构化输出（Structured Output）设计

> 日期：2026-06-24
> 范围：为 `@better-agent/agent` 的 `run`/`prompt` 增加可选 `outputSchema`，让 agent 返回受 schema 约束的结构化 JSON。对应 gap-analysis §3.5（决策 #3：用「注入 `StructuredOutput` 工具 + `toolChoice:"required"`」，不用 AI SDK `experimental_output`）。
> 关联：[`agent-gap-analysis.md`](../../research/agent-gap-analysis.md) §3.5、[`2026-06-16-agent-runtime-design.md`](./2026-06-16-agent-runtime-design.md)。

---

## 1. 目标

SDK 用户调用 `run(text, { outputSchema })` 或 `prompt(text, { outputSchema })` 时，agent 可以先正常使用（远程）工具收集信息，最后返回一个**严格符合 `outputSchema` 的 JSON 对象**，而不是自由文本。

非目标（YAGNI，本期不做）：
- 服务端内置工具基础设施的泛化（`StructuredOutput` 是唯一的 server-side 工具，特例实现，不引入 `ToolSource.server` 框架）。
- 工具结果记忆化、doom-loop、子 agent（各自独立 backlog）。
- 给 `Message` 增加结构化字段 / 任何 DB migration。

---

## 2. 核心机制

LLM 只在**工具调用的参数**上保证严格符合给定 schema（AI SDK 会校验、不符则反馈模型重试）；自由文本不保证。因此：

提供 `outputSchema` 时，runtime 注入一个名为 `StructuredOutput` 的工具，其 `inputSchema = jsonSchema(outputSchema)`，`execute` 为 no-op（返回空串，不把结果喂回模型——它是「交卷」动作，不是真正的工具）。它与远程工具**并存**注入，并设：

```ts
toolChoice: "required",                                    // 每步必须调某个工具
stopWhen: [stepCountIs(DEFAULT_MAX_STEPS), hasToolCall("StructuredOutput")]
```

模型每一步都被迫调用某个工具：
- 需要更多信息 → 调远程工具（循环继续，结果照常喂回）。
- 准备好了 → 调 `StructuredOutput`（命中 `hasToolCall` → 循环停止）。

该 `StructuredOutput` 调用的 `args` 即结构化结果。

**统一覆盖两种场景**（无需 `prepareStep` 动态切换）：
- 无远程工具：模型第一步就调 `StructuredOutput` → 退化为「纯抽取」。
- 有远程工具：模型先用工具、再交卷 → 「工具循环后输出 JSON」。

**已验证的 AI SDK v6 事实**（`ai@6.0.205`）：
- `hasToolCall(toolName)` 是内置 `StopCondition`；`stopWhen` 接受 `StopCondition[]`。
- `toolChoice: "required"` 与 `activeTools` 均受支持。
- `drainStream` 在 `tool-call` chunk 已拿到 `chunk.input`（参数）并落库为 tool-call part。

---

## 3. 组件设计

### 3.1 `session/structured-output.ts`（新）
- `export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";`
- `buildStructuredOutputToolDef(outputSchema: JsonValue): ToolDef` —— 返回一个 `ToolDef`：
  - `name = STRUCTURED_OUTPUT_TOOL_NAME`
  - `description`：固定文案，提示模型「当你准备好最终答案时，调用此工具并把答案作为参数提交」。
  - `parameters = outputSchema`（registry 里会经 `jsonSchema(parameters)` 转换）。
  - `execute = () => Promise.resolve({ output: "" })` —— no-op；结果不喂回（循环已被 `hasToolCall` 停止）。

### 3.2 `RunTurnInput` + `AttemptArgs`（`session/runtime.ts`）
- `RunTurnInput` 增加 `outputSchema?: JsonValue`。
- `AttemptArgs` 增加 `structuredOutput?: boolean`（标记本轮是否结构化模式）。

### 3.3 `runAttempt`（`session/runtime.ts`）
当 `args.structuredOutput` 为真：
- `streamText` 传 `toolChoice: "required"`。
- `stopWhen` 改为 `[stepCountIs(DEFAULT_MAX_STEPS), hasToolCall(STRUCTURED_OUTPUT_TOOL_NAME)]`。
非结构化模式行为完全不变（保持现有 `stopWhen: stepCountIs(DEFAULT_MAX_STEPS)`，无 `toolChoice`）。

### 3.4 `executeTurn`（`session/runtime.ts`）
- 若 `input.outputSchema` 提供：把 `buildStructuredOutputToolDef(input.outputSchema)` **追加**到 `ctx.toolDefs`（与远程工具并存），并在 `streamAssistant` 的 `AttemptArgs` 里置 `structuredOutput: true`。

### 3.5 结果捕获（`session/runtime-drain.ts` + `StreamOutcome`）
- `StreamOutcome` 增加 `structured: unknown | null`（`resetOutcome` 初始化为 null）。
- `drainStream` 处理 `tool-call` chunk 时，若 `toolName === STRUCTURED_OUTPUT_TOOL_NAME`，把 `args` 写入 `state.structured`。
- 持久化天然发生：该调用照常落库为 tool-call part（零迁移）。

### 3.6 `done` 事件（`session/events.ts`）
- `{ type: "done"; usage; finishReason }` 增加 `structured?: unknown`。
- `finalizeAssistant` 在成功分支 yield `done` 时带上 `outcome.structured ?? undefined`。

### 3.7 API（`api/routers/sessions.ts` + `user-sessions.ts`）
- 复用一个 `outputSchemaInput = z.record(z.string(), z.unknown()).optional()`（与 `remoteToolSchema.parameters` 同款 JSON Schema 形状）。
- `promptInput` 增加 `outputSchema`。
- `run` handler：把 `outputSchema` 透传给 `runTurn`；返回从 `Message` 升级为 `{ message: Message; structured: unknown | null }`。`run` 的 drain 改用一个能同时返回 `Message` + 末次 `done.structured` 的小工具（`drainWithStructured`）。
- `prompt` handler：透传 `outputSchema`；结构化结果通过 `done.structured` 事件自然流出，无需额外改动。
- 两个 router（agent 平面 + user 平面）改动一致。

### 3.8 client（`packages/client`）
- `AgentClient.run`/`prompt` 入参增加可选 `outputSchema`。
- `run` 返回 envelope `{ message, structured }`；`prompt` 消费方可从 `done` 事件读 `structured`。
- 同时覆盖 `createAgentClientFrom`（agent 平面）与 `createUserSessionClientFrom`（user 平面）。

---

## 4. 数据流（一次结构化 + 工具循环的 turn）

```
client.run(text, { outputSchema })
  → api run handler: runTurn({ sessionId, text, tools, outputSchema })
    → executeTurn: ctx.toolDefs = [...remoteTools, StructuredOutputToolDef]
                   AttemptArgs.structuredOutput = true
      → runAttempt: streamText({ toolChoice:"required",
                                 stopWhen:[stepCountIs(50), hasToolCall("StructuredOutput")] })
        → 模型调 remote tool → park/resolve（远程）→ 结果喂回 → 继续
        → 模型调 StructuredOutput(args=JSON) → drain 写 state.structured=args
                                              → hasToolCall 命中 → 循环停
      → finalizeAssistant: done { ..., structured }
  → drainWithStructured 收集 message + structured
  → 返回 { message, structured }
```

---

## 5. 错误处理

- **未交卷**：跑到 `stepCountIs(DEFAULT_MAX_STEPS)` 仍未调 `StructuredOutput` → `state.structured` 保持 null，正常 `done`（不 emit error），`run` 返回 `structured: null`。调用方据此判断未产出。
- **参数不符 schema**：依赖 AI SDK 在 `toolChoice:"required"` 下对工具参数的校验/重试（现有 `experimental_repairToolCall` 仍返回 null = 不本地修正，交回模型重试）。
- **既有错误路径**（provider error、abort、SessionBusy）不变；结构化模式只在成功路径附加 `structured`。

---

## 6. 测试策略

`packages/agent`（用现有 fake model 脚本化 tool-call，参考 `runtime-tools.test.ts`）：
1. **纯抽取**：无远程工具 + outputSchema，fake 模型第一步调 `StructuredOutput` → `done.structured` == 期望对象。
2. **工具循环 + 收尾**：fake 先调一个远程工具、再调 `StructuredOutput` → 远程结果照常喂回，最终 `structured` 正确。
3. **未交卷**：fake 到步数上限不调 `StructuredOutput` → `structured` 为 null、`done` 正常。
4. **无 outputSchema 回归**：现有 runtime 行为完全不变（无 `toolChoice`、`stopWhen` 仍单条件）。
5. `structured-output.ts` 单测：`buildStructuredOutputToolDef` 形状（name/parameters/execute no-op）。

`packages/client`：`run` 透传 outputSchema、返回 `{message, structured}` 形状；`prompt` 从 done 读 structured。

---

## 7. 落点文件清单

**Task A（agent 核心）**
- 新增 `packages/agent/src/session/structured-output.ts`（+ 单测）
- 改 `packages/agent/src/session/runtime.ts`（RunTurnInput/AttemptArgs/runAttempt/executeTurn）
- 改 `packages/agent/src/session/runtime-drain.ts`（捕获 structured 入 StreamOutcome）
- 改 `packages/agent/src/session/retry-helpers.ts`（`StreamOutcome.structured` + `resetOutcome`）
- 改 `packages/agent/src/session/events.ts`（done 加 structured）
- 改 `packages/agent/src/session/runtime.ts` finalize（done 带 structured）
- 测试：新增 `structured-output.test.ts` + 扩 `runtime-tools.test.ts` 或新增 `runtime-structured.test.ts`

**Task B（API + client 透传）**
- 改 `packages/api/src/routers/sessions.ts` + `user-sessions.ts`（promptInput/run 加 outputSchema；run 返回 envelope；新增 `drainWithStructured`）
- 改 `packages/client/src/index.ts`（run/prompt 透传 outputSchema + 暴露 structured；两个 client 工厂）
- 测试：扩 `packages/client/src/index.test.ts`

---

## 8. 决策记录

1. **schema 过网络用 JSON Schema**（非 zod）——与 `remoteToolSchema.parameters` 一致，可序列化。
2. **结果持久化复用 tool-call part，零迁移**——不给 `Message` 加字段。
3. **`run` 返回 `{ message, structured }` envelope**——破坏性升级，但 `run` 用得少、最直观（用户确认）。
4. **未交卷返回 `structured: null`**，不 emit error。
5. **`StructuredOutput` 为特例 server-side 工具**，不引入通用 server 工具框架（YAGNI）。
