# opencode 调研（用于设计 better-agent 通用 agent）

> 调研时间：2026-06-16
> 目的：借鉴 [sst/opencode](https://github.com/sst/opencode) 的架构，设计 better-agent 的通用 agent 运行时。
> 信息来源见文末「参考资料」。

---

## 一、opencode 是什么 / 技术栈

opencode（sst/opencode）是一个开源的终端 AI 编码 agent，核心是 **client-server 架构**：一个后端 server 掌管全部状态（会话、LLM 调用、工具执行、权限、MCP），多个前端（终端 TUI、桌面 Electron、Web、VSCode 插件）通过 **HTTP + SSE** 连接。

技术栈关键点（与 better-agent 高度重合）：

- **server 用 Hono**；会话/消息持久化用 **Drizzle ORM**；**TypeScript monorepo + Turbo**（运行时是 Bun）
- LLM 走 **Vercel AI SDK**（`ai` + `@ai-sdk/*`），provider 元数据来自 **models.dev**，因此「不写死 provider」就能支持 75+ 模型
- TUI 用 Go；桌面/Web 用 Solid.js + 自己的 `@opencode-ai/sdk`

**对照 better-agent**：`apps/server` 已是 **Hono + oRPC**，`packages/db` 已是 **Drizzle**，整个仓库是 **pnpm + turbo 的 TS monorepo**。也就是说 opencode 的**服务端骨架我们几乎已经有了**，差的是 agent 运行时本身。

---

## 二、最值得借鉴的 8 个核心设计

| # | opencode 的做法 | 要点 |
|---|---|---|
| 1 | **Server 持有全部状态，客户端很薄** | LLM/工具/会话/权限都在 server；client 只发 prompt、收 SSE 流。便于多端（Web/CLI/插件）共用一套后端。 |
| 2 | **Agent loop = "LLM in a loop with tools"** | 核心是 `Session.prompt()` 用 AI SDK 的 `streamText()`，靠 `stopWhen`（如 `steps>=1000 \|\| shouldStop`）循环：模型出 tool-call → 执行 → 结果喂回 → 再调模型，直到产出纯文本。 |
| 3 | **工具统一抽象** | `Tool.define(name, { description, parameters: zodSchema, execute(params, ctx) })`；`ToolRegistry` 按 agent 权限做通配过滤。`ctx` 带 `sessionID/messageID/agent/abort` 信号。内置：`read/write/edit/bash/glob/grep/list/webfetch/todoread/todowrite/task`。 |
| 4 | **细粒度权限** | 每个工具一个权限键（read/edit/bash/glob/grep/list/task/lsp/skill/external_directory），取值 `ask/allow/deny`；执行前 `Permission.ask()` 拦截，用户拒绝就停。 |
| 5 | **Agent 即配置** | 一个 agent = 系统提示 + 模型 + 工具白名单 + 权限。区分 **primary agent**（主）和 **subagent**（子）；有 `plan`（只读）/`build`（可写）两种模式，切换时注入一条 "build-switch" 系统消息。 |
| 6 | **子 agent 用 `task` 工具** | `task` 工具 spawn 一个全新 session、注入子 agent 提示、独立跑、**只把最终文本返回**给父 agent（中间过程隐藏）；可并发多个。 |
| 7 | **上下文自动压缩（compaction）** | token 接近上限（`(context_limit - output) * 0.9`）时，用一次单独的 LLM 调用把历史「总结」掉再继续。长会话必备。 |
| 8 | **结构化消息 + 快照** | 消息按 **part** 存（text / tool-call / tool-result，带状态和时间戳），`toModelMessage()` 转成 LLM 格式；每步开始用 **git 快照**做可回滚。edit 后还会跑 **LSP 诊断**喂回模型纠错。 |

**事件层**：server 用 event bus，把 `streamText` 的 `fullStream` 事件（text-delta、tool-call、tool-result、start-step、finish-step…）经 **SSE** 广播给所有客户端实时渲染。

**核心 agent loop 流程**：

1. Client 发 prompt → HTTP 到 server
2. `SessionPrompt.loop()` / `Session.prompt()` 调 `Provider.getModel()`
3. 模型返回（可能带 tool-call）
4. `Tool.execute()` 执行工具（先过 `Permission.ask()`）
5. 状态经 Drizzle 持久化
6. 响应经 SSE 流式回传
7. UI 实时更新

---

## 三、映射到 better-agent

better-agent 的优势是**服务端栈已经对齐**，重点是新增一个 agent 运行时包，把 Hono/oRPC/Drizzle/web 串起来。

**建议的包结构（草案）**

```
packages/
  agent/        ← 新增：框架无关的 agent 运行时（核心）
    session     - prompt 循环（streamText + stopWhen）
    tools       - Tool.define 抽象 + ToolRegistry + 内置工具
    provider    - 基于 Vercel AI SDK 的 provider 抽象
    permission  - Permission.ask 网关（先留接口）
    compaction  - 上下文压缩
    prompt      - 系统提示拼装（按 provider/agent）
  db/           ← 复用：加 sessions / messages / message_parts / permissions 表
  api/          ← 复用：oRPC 暴露 createSession / prompt(流式) / respondPermission
apps/
  server/       ← 复用：Hono 挂载运行时；用 oRPC 事件流（等价 SSE）推消息
  web/          ← 复用：React 客户端订阅流，渲染消息/工具调用 + shadcn/base-ui 审批弹窗
```

**新增依赖**（注意仓库的「固定版本 + 禁 `^`」规则，需 pin 版本）：

- `ai`（Vercel AI SDK）、`@ai-sdk/anthropic` 等、`zod`（已有）
- 默认模型锚定最新 Claude：`claude-opus-4-8`（主推理）、`claude-sonnet-4-6`（日常/子 agent）、`claude-haiku-4-5-20251001`（压缩/轻量）。provider 抽象保留，后续接 OpenAI/Gemini/本地等。

**两个可直接对齐的点**

1. **oRPC 替代裸 SSE**：opencode 用 HTTP+SSE，我们用 oRPC 的 **event iterator / streaming** 拿到端到端类型安全的流，比手写 SSE 更顺。
2. **Drizzle 持久化**：opencode 怎么存 message parts，照搬一套 schema 即可。

---

## 四、关键差异与取舍（不要照抄）

- **运行时**：opencode = Bun；我们 = Node（pnpm）。AI SDK 在 Node 上没问题，但 `bash`/进程类工具实现细节按 Node 写。
- **前端**：它有 Go TUI + Solid；我们只做 **React Web**（TanStack Start），先不碰 TUI。
- **LSP / git 快照 / MCP** 都是加分项，非 MVP 必需。
- **models.dev 动态元数据**：初期可先硬编码我们支持的几个模型的 context/价格，不必一上来就接 models.dev。

---

## 五、与本项目已确认的范围决策（截至调研当日）

- **不做**：LSP、git 快照。
- **第二阶段**：MCP。
- **Permission.ask**：要做，但**目前只留接口、不实现**。
- **Agent 可配置**（非硬编码）：至少包含 `name / description / system prompt / provider / model`。
- **Provider/模型**：从 models.dev 取常见模型（kimi / minimax / glm / deepseek / openrouter / openai / claude / gemini / grok），并配置各自 API key。
- **创建 agent 的交互**：先选 provider，选完才能选 model。
- 需要设计 **session 与 message** 的数据/流程模型。
- agent 后期要**提供给其他项目使用**：其他项目通过配置一个 **agent client** 发送请求。

> 上述决策的具体技术方案在 brainstorming 阶段细化，spec 见 `docs/superpowers/specs/`。

---

## 六、建议的落地顺序（MVP → 增强）

1. **MVP**：单 agent 的 `streamText` 循环 + 少量工具 + Permission 接口占位 + Drizzle 存消息 + oRPC 流式接口 + web 端流式展示。
2. **+ 工具集**：补齐内置工具 + agent 配置（prompt+模型+工具白名单）。
3. **+ 子 agent**：`task` 工具 + plan/build 模式。
4. **+ 上下文压缩**。
5. **+ MCP / 多 provider / agent client 对外开放**。

---

## 参考资料

- [sst/opencode — DeepWiki（总览）](https://deepwiki.com/sst/opencode)
- [Agent System — DeepWiki](https://deepwiki.com/sst/opencode/3.2-agent-system)
- [Tool System — DeepWiki](https://deepwiki.com/sst/opencode/5-tool-system)
- [Context Management and Compaction — DeepWiki](https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction)
- [Provider and Model Configuration — DeepWiki](https://deepwiki.com/sst/opencode/3.3-provider-and-model-configuration)
- [How Coding Agents Actually Work: Inside OpenCode — Moncef Abboud](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/)
- [Agents — OpenCode Docs](https://opencode.ai/docs/agents/)
- [Config (opencode.json) — OpenCode Docs](https://open-code.ai/en/docs/config)
- [models.dev](https://models.dev)
