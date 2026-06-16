# better-agent 通用 Agent 运行时 —— 设计文档

> 日期：2026-06-16
> 背景调研：见 [`docs/research/opencode-research.md`](../../research/opencode-research.md)
> 状态：设计已确认，待转实现计划（writing-plans）。

## 1. 目标与范围

借鉴 [sst/opencode](https://github.com/sst/opencode) 的服务端架构，在现有 `better-agent`（Hono + oRPC + Drizzle + TanStack Start 的 pnpm/turbo monorepo）之上，构建一个**可配置、多 provider、有状态会话**的通用 Agent 运行时，并提供给外部项目通过 TS SDK 接入。

**本期（P1）交付**：可配置 agent（name/description/system prompt/provider/model）、数据驱动的 provider/模型目录、有状态多轮会话、流式对话、对外 TS SDK。P1 的 agent 暂无工具，是「对话型 agent 平台」；工具调用（agentic）在 P2。

**明确不做 / 延后**（详见第 11 节阶段表）：
- 鉴权（service key / admin token）—— 延后，单列阶段。
- 工具系统真实实现 —— P2。
- 上下文压缩逻辑 —— P2（schema 本期就位）。
- **Permission 真实实现 + 审批 UI —— 不做**，仅保留接口 + AllowAll 占位 + 契约。
- MCP、子 agent（task）、plan/build 模式、LSP、git 快照 —— 后期或不做。

设计原则：**结构/契约本期定死，逻辑按阶段填**。下文用 🔨 表示本期实现并接通，📐 表示本期定死结构/契约、逻辑后续阶段填。

## 2. 整体架构（隔离运行时 + 依赖注入）

采用「隔离运行时包 + 依赖注入」：`packages/agent` 只放纯运行时逻辑，通过接口（ports）依赖存储与外部能力，不直接 import DB/HTTP。Drizzle 实现放 `packages/db`，在 `apps/server` 组装。运行时可单测、可被多入口复用。

```
packages/
  agent/      新增·框架无关运行时（核心）
    provider/     provider 抽象 + AI SDK 适配器动态加载 + 模型目录（models.dev）
    session/      会话 prompt 循环（streamText + stopWhen）
    message/      消息 ↔ AI SDK 转换（parts → ModelMessage[]）
    permission/   PermissionGateway 接口 + AllowAll 占位实现
    tool/         ToolRegistry + Tool 抽象 + 远程工具协议（契约）
    agent/        agent 配置解析（prompt/provider/model → 可运行实例）
    ports.ts      仓储/能力接口（SessionStore / MessageStore / ProviderConfigStore / ModelCatalog ...）
  db/         复用·Drizzle schema + 上述 ports 的实现
  api/        复用·oRPC 路由（providers/models/agents/sessions/...）
  client/     新增·对外 TS SDK（封装 oRPC client：baseURL + agentId → run()/stream()，支持挂载远程工具）
apps/
  server/     复用·Hono 挂 oRPC（RPCHandler + OpenAPIHandler），组装运行时 + 仓储 + models.dev 拉取
  admin/      新增·管理后台：provider/key 管理、agent 创建向导、会话流式对话
  web/        复用·现有应用（消费方 / 演示用途，本期不改）
```

要点：
- `packages/agent` **不 import `packages/db`**；只定义接口，db 反向实现。
- `packages/client` **不依赖 server 内部代码**，只依赖 oRPC 契约类型（`AppRouter`）。
- web 与外部 SDK 共用同一套 oRPC 契约（类型复用）。

## 3. Provider / 模型目录（完全数据驱动）

对齐 opencode：**不硬编码 provider 集合**，以 models.dev 的 `api.json` 为事实源。

### 3.1 数据
- **`providers_catalog`**（models.dev 同步）🔨：`providerId`、`name`、`npm`（对应 AI SDK 包名）、`defaultBaseURL`、`envKeys`(jsonb)。整张 provider 列表来自 models.dev，加 provider 不改代码。
- **`models_cache`**（models.dev 同步）🔨：`providerId`、`modelId`、`name`、`contextLimit`、`maxOutputTokens`、`inputPricePerM`、`outputPricePerM`、`capabilities`(jsonb: toolCall/reasoning/vision)、`lastSyncedAt`。
- **`provider_credentials`**（Web UI 管理，DB）🔨：`providerId`、`apiKey`（**加密存**）、`baseURL?`（覆盖）、`enabled`、时间戳。

### 3.2 同步器 `ModelCatalog` 🔨
拉取 `models.dev/api.json` → 写 `providers_catalog` + `models_cache`。触发：启动时若缓存过期 + UI「刷新目录」+（可选）每日一次。**拉取失败用旧缓存，不阻断**。

### 3.3 适配器动态加载 + 模型工厂 🔨
- `loadAdapter(npm)`：按 catalog 的 `npm` 字段**动态 `import()`** AI SDK 包；**未安装/找不到则回退 `@ai-sdk/openai-compatible` + 该 provider 的 baseURL**（models.dev 上多数 provider 本就是 OpenAI 兼容）。加一个兼容型 provider 零代码。
- `createLanguageModel(providerId, modelId)`：catalog 查条目 → `loadAdapter` → 用解密 key + baseURL 实例化，返回 AI SDK `LanguageModel`。Provider 差异收敛于此。
- 预装常用适配器供动态 import 命中：`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/xai`、`@ai-sdk/openai-compatible`；其余靠 openai-compatible 兜底。

### 3.4 密钥安全 🔨
用 env 的 `CREDENTIALS_SECRET` 对称加解密；入库前加密，构建模型时解密。UI 只显示「已配置 / 末四位」，绝不回传原 key。

### 3.5 选择流程
UI 列出「已配置且 enabled」的 provider → 选 provider → 从 `models_cache` 选 model。**强制 provider→model 顺序**。

## 4. Agent 配置

**`agents`** 表 🔨：`id`、`name`、`description`、`systemPrompt`、`providerId`、`modelId`、`params`(jsonb，可选：temperature/topP/maxOutputTokens)、`createdAt`、`updatedAt`。
- MVP 必填：name / description / systemPrompt / provider / model。
- **预留（本期不建列）**：`toolPolicy`、`permissions`、`subagents`。
- **校验**：`providerId` 须有 enabled 凭证；`modelId` 须在该 provider 的 `models_cache`。
- **模型失效处理**：models.dev 后续删模型时，agent 保留原 `providerId/modelId`，UI 提示「已不在目录」，仍可运行（只要 key 在）。

## 5. Session / Message 数据模型

### 5.1 `sessions` 🔨（压缩相关字段 📐）
`id`、`agentId`（创建时绑定，**不可改**）、`title`（可空，首条 user 消息自动摘要）、`status`(active/error)、`createdAt`、`updatedAt`；`summary`(text，可空，📐)、`compactedThroughSeq`(int，可空，📐)。

### 5.2 `messages` 🔨
`id`、`sessionId`、`role`(user/assistant/system)、`seq`(会话内单调递增)、`status`(pending/streaming/complete/error/aborted)、`providerId`/`modelId`(assistant 实际所用模型；user 为空)、`usage`(jsonb)、`finishReason`(stop/length/tool-calls/error)、`error`(jsonb)、`createdAt`、`updatedAt`。

### 5.3 `message_parts` 🔨（tool-* 形状 📐）
`id`、`messageId`、`seq`、`type`、`content`(jsonb)、`status`(streaming/complete/error)、时间戳。`type` 与 `content` 形状：
```
text        : { text: string }                                    🔨
reasoning   : { text: string }                                    🔨
tool-call   : { callId, toolName, args }                          📐
tool-result : { callId, result, isError }                         📐
```
tool-* 本期不产生数据，但表结构与形状定死，工具阶段直接写入、无需迁移。

**已锁定决策**：① 模型实时解析（每轮从 agent 当前配置取 provider/model，不快照到 session）；② session 绑定单一 agent。

## 6. 转换层 `toModelMessages(session, messages, parts)` 🔨（压缩分支 📐）

→ AI SDK `ModelMessage[]`：
1. 最前拼 agent 的 `systemPrompt`（system 消息）。
2. 📐 若 `session.summary` 存在：再拼一条 system「对话摘要：…」，且只纳入 `seq > compactedThroughSeq` 的消息；否则纳入全部历史。
3. 每条消息按 role + parts 拼成 AI SDK content：text/reasoning → 文本块；tool-call → assistant 的 tool-call 块；tool-result → tool 角色的 result 块。

## 7. Agent 循环 `runTurn()` 🔨（工具分支 📐）

用 AI SDK `streamText` 的内建多步（`stopWhen` + 带 `execute` 的 tools），消费 `fullStream` 落库 + 发事件：
```
1. 落库 user 消息（text part）
2. 建 assistant 消息（streaming）
3. messages = toModelMessages(...)            // 含压缩分支
4. model = createLanguageModel(agent.providerId, agent.modelId)
5. result = streamText({
       model, system, messages,
       tools,                       // 🔨 本期空集 → 等价单步；📐 工具阶段注入注册表里被允许的工具
       stopWhen: stepCountIs(MAX_STEPS),
       abortSignal,
   })
6. for await (chunk of result.fullStream) { …见第 8 节… }
7. 收尾：assistant 置 complete + 写 usage/finishReason
```
因为本期传空 tools，循环天然退化成「一次 streamText」；事件/落库代码已按工具事件写好，工具阶段只需把工具塞进 `tools`，主循环零改动。

## 8. 流式事件 + 增量落库 🔨（tool-* 事件 📐）

消费 `fullStream`，每个 chunk 既发客户端、又增量落库：

| fullStream chunk | 落库 | 客户端事件 | 阶段 |
|---|---|---|---|
| 开始 | 建 assistant 消息 | `message-start` | 🔨 |
| `text-delta` | 追加 text part（缓冲、节流 flush） | `text-delta {delta}` | 🔨 |
| `reasoning-delta` | 追加 reasoning part | `reasoning-delta` | 🔨 |
| `tool-call` | 建 tool-call part | `tool-call` | 📐 |
| `tool-result` | 建 tool-result part | `tool-result` | 📐 |
| `step-finish` | — | `step-finish` | 🔨 |
| `finish` | 写 usage/finishReason，置 complete | `done {usage}` | 🔨 |
| 异常 | 置 error | `error {message}` | 🔨 |

- **节流落库**🔨：token 实时发客户端，text part 按间隔（约 200ms）或 finish 时落库。
- **中断**🔨：客户端断开 / abort → 取消 streamText，消息标 aborted，已落库 part 保留。

## 9. 上下文压缩 compaction 📐（P2 实现）

- **触发**：每轮前估算输入 tokens，若 `> (model.contextLimit − 预留输出) × 0.9`，或上轮 `finishReason==='length'`。
- **动作**：用一个模型（默认 agent 模型，或配更便宜的 haiku）对 `[compactedThroughSeq+1 .. 当前]` + 旧 `summary` 做总结，产出新 summary。
- **写回**：更新 `session.summary` + `session.compactedThroughSeq`。`toModelMessages`（第 6 节）随后自动只带 summary + 其后消息。
- **对客户端透明**：历史消息不删，`listMessages` 仍返回全量；只是喂 LLM 的上下文被压缩。

## 10. 外部系统挂载 tool —— 客户端远程工具（方案 A）📐（P2 实现）

**主力机制**：外部系统在自己代码里定义并执行工具；server 只编排。

- 外部 SDK 调用时随 prompt 上送**工具定义**（name + description + JSON Schema 参数）。server 把它们交给 LLM，但**不在 server 执行**。
- LLM 触发 tool-call 时，server 发 `tool-call` 事件给客户端、挂起本轮；**客户端本地执行**，经 `sessions.submitToolResult({sessionId, callId, result})` 回填；server 恢复循环。
- 复用 Permission 的「挂起→等客户端→恢复」机制，以及已定死的 tool-call/tool-result parts。SDK：`client.stream(text, { tools: { …你的工具 } })`。
- **Caveat**：server 需在内存挂着本轮执行等结果 → **单实例**（自部署可接受；多实例日后加协调层）。
- 工具来源是 `ToolRegistry` 的不同「来源」，主循环不关心来源；MCP（外部工具的标准化方案）与 Webhook 工具为后期可选来源，本期不做。

## 11. API 接口面（oRPC 路由）

**`providers`（管理端）**🔨：`catalog.list` / `catalog.refresh` / `credentials.list`（脱敏）/ `credentials.upsert` / `credentials.delete` / `models.list({providerId})`。

**`agents`（管理端）**🔨：`list` / `get` / `create` / `update` / `delete`（含第 4 节校验）。

**`sessions`**🔨：`create({agentId})` / `get` / `list` / `listMessages({sessionId})` / `prompt({sessionId,text})`→event iterator / `run({sessionId,text})`→最终消息。

**远程工具**📐：`sessions.submitToolResult({sessionId, callId, result})` + 流事件 `tool-call`（第 10 节）。

**`permissions`**📐：`respond({permissionId, decision})` —— 契约 + 事件 `permission-request` 定死；本期 gateway 自动放行，该过程返回 NotImplemented。**真实实现与审批 UI 不做。**

底层 🔨：server 同挂 `RPCHandler(/rpc)` 与 `OpenAPIHandler`，非 TS 语言以后可走 HTTP+SSE；TS SDK 走 RPC。

> 鉴权（service key 表 + 中间件 + admin token）**延后**，单列阶段；P1 自部署可信内网不鉴权。

## 12. Permission 网关（接口 🔨 + 占位 🔨 + 契约 📐，真实实现不做）

- 接口：`PermissionGateway { ask(req): Promise<"allow" | "deny"> }`。
- `PermissionRequest = { sessionId, messageId, callId, type, title, metadata }`（形状定死）。
- 本期实现 `AllowAllPermissionGateway`（恒 allow），🔨 已接进工具 execute 外层包装（暂无工具，调用点先在）。
- 📐 交互式审批（gateway 发 `permission-request` → 等 `permissions.respond`）**契约保留，逻辑不做、不排期**。

## 13. Client SDK `packages/client` 🔨

```ts
const client = createAgentClient({ baseURL, agentId /*, apiKey 鉴权阶段再加 */ });
await client.createSession();              // { sessionId }
await client.run(text, { sessionId? });    // 最终消息（无 sessionId 自动建）
for await (const ev of client.stream(text, { sessionId?, tools? })) { … } // 事件流；tools 为远程工具(📐)
await client.listMessages(sessionId);
```
内部：oRPC client 指向 baseURL、固定 agentId；只依赖 oRPC 契约类型。web 端直接用同一套契约。

## 14. 解耦（呼应第 2 节）🔨

`runTurn` 通过注入的 `SessionStore`/`MessageStore`(ports) 落库并 `yield` 事件；`packages/api` 只把事件转给 oRPC iterator。`PermissionGateway`、`ToolRegistry`、`ModelCatalog` 均为注入项 —— 后续阶段换实现，主循环不动。

## 15. 新增依赖（需 pin 固定版本，遵守仓库「禁 ^/~/latest」规则）

`ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/xai`、`@ai-sdk/openai-compatible`。

## 16. 阶段表

| 能力 | 阶段 |
|---|---|
| provider catalog + 凭证 + models_cache（数据驱动、models.dev 同步） | P1 🔨 |
| 模型工厂（动态 import + openai-compatible 回退）+ 密钥加密 | P1 🔨 |
| agent CRUD（provider→model 向导） | P1 🔨 |
| sessions + messages + message_parts + 流式 prompt/run + 历史回放 | P1 🔨 |
| Client TS SDK + HTTP/OpenAPI 底层 | P1 🔨 |
| admin 管理后台 `apps/admin`（provider/key、agent 向导、会话流式对话） | P1 🔨 |
| Permission **接口 + AllowAll 占位 + 契约** | P1 🔨/📐 |
| message tool-* parts 结构、远程工具协议、压缩字段（结构/契约就位） | P1 📐 |
| **工具系统**（ToolRegistry + 客户端远程工具实现 A + 内置服务端工具） | P2 |
| **上下文压缩**逻辑 | P2 |
| **鉴权**（service key + 中间件 + admin token） | 延后（单列阶段） |
| MCP / 自定义 provider UI / 子 agent(task) / plan-build / Webhook 工具(C) / 多语言 SDK | P3 |
| Permission 真实实现 + 审批 UI | **不做** |
| LSP / git 快照 | **不做** |
```
