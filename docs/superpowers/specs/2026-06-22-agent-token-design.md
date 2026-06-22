# better-agent Agent Token 鉴权 —— 设计文档

> 日期：2026-06-22
> 关联：[`2026-06-16-agent-runtime-design.md`](./2026-06-16-agent-runtime-design.md) 第 11 节把「鉴权（service key / admin token）」列为延后的单列阶段；本文即该阶段的 chat 面部分。
> 状态：设计已确认，待转实现计划（writing-plans）。

## 1. 目标与范围

确立一条**基础准则**：每个 agent 创建后都自动生成一个 token；任何持有该 token 的 client 都能以「该 agent 的身份」创建会话并对话（chat）。token 即 agent 在 chat 面上的身份凭证。`packages/client` 的 Agent SDK 改为携带 token，`apps/admin`（以及后续 `apps/web`、外部集成方）统一通过 SDK 发起对话请求，便于把本项目集成到其它地方。

**本期交付**：
- `agents` 表加 token（单列、哈希存储、只显示一次）。
- 创建 agent 时自动生成 token；提供「轮换（rotate）」端点。
- oRPC chat 面端点（`sessions.create/get/listMessages/run/prompt`）改为 token 鉴权，并按 token 所属 agent 限定作用域。
- Agent SDK 用 token 取代 agentId。
- admin 改用 Agent SDK 跑对话，并在 UI 上承接 token 的展示/缓存/轮换。

**明确不做 / 延后（非目标）**：
- 管理面（`agents.*` / `providers.*` / `sessions.list` 全量列表）的鉴权 —— 暂保持 public，后续单独设计 admin 鉴权。
- 一个 agent 多 token、token 过期 / scope / 最后使用时间（last-used）追踪。
- 构建 `apps/web` 的对话 UI（本期只把 SDK 准备好，web 可照admin的模式接入）。

> 单列 `token_hash` 的模型为未来「升级到 `agent_tokens` 表（多 token / 吊销 / 命名）」留了空间，且不破坏 SDK 契约（SDK 只认 token 字符串）。

## 2. 两个面（plane）

```
管理面 Management plane（public，admin UI 经 raw oRPC 调用）
  agents.list/get/create/update/delete   providers.*   sessions.list（全量）
        │ create / rotateToken 返回一次性明文 token
        ▼
对话面 Chat plane（token 鉴权，作用域限定为 token 所属 agent）
  sessions.create / get / listMessages / run / prompt
        ▲
        │ Authorization: Bearer <token>
  Agent SDK（packages/client） ← apps/admin 对话、apps/web、外部集成方
```

- 管理面：信任环境（admin），本期保持 public。创建 / 轮换 agent 时由管理面返回一次性明文 token。
- 对话面：必须带 token；token 反查出 agent，所有操作只能作用于该 agent 自己的会话。

## 3. 数据模型

`agents` 表新增**一列**：

```
token_hash  text  not null  unique
```

- **token 格式**：`ba_` 前缀 + 32 字节随机（base64url 编码），约 43 字符。前缀便于识别与日志脱敏。
- **存储**：只存 `sha256(token)` 的 hex。**明文永不落库**，仅在 `create` / `rotateToken` 的返回值里出现一次。
- **迁移**：为已有行回填一个新生成的 hash（明文丢弃 → 这些旧 agent 需轮换一次才能拿到可用 token；当前无生产数据）。
- `AgentConfig` 类型**不变**（不含 token 字段）。create / rotate 走单独的返回结构 `{ agent: AgentConfig; token: string }`。

## 4. Token 服务与存储（packages）

**`packages/agent`** 新增纯函数 `TokenService`（可单测，无 IO）：

```ts
interface TokenService {
  generate(): { token: string; hash: string }; // 随机 token + 其 sha256
  hash(token: string): string;                  // 给鉴权查找用
}
```

**`AgentStore`（port + drizzle 实现）** 调整：
- `create(input)`：入参增加 `tokenHash`（由 router 生成后传入）。
- 新增 `rotateToken(id, tokenHash): Promise<AgentConfig | null>`。
- 新增 `findByTokenHash(hash): Promise<AgentConfig | null>`（鉴权反查，走 `token_hash` 唯一索引）。

> token 的「生成」职责在 agents router（管理面）：调用 `TokenService.generate()` → 把 hash 交给 store → 把明文随响应返回一次。store 只认 hash，不产生明文。

## 5. oRPC 鉴权接线

- **`createContext`**（已能拿到 Hono `c`）：读 `Authorization: Bearer <token>` → `TokenService.hash` → `AgentStore.findByTokenHash` → 写入 `context.authedAgent: AgentConfig | null`。无 header / 查不到 → `null`（不抛错，由各 procedure 决定）。
- **新增 `agentProcedure`**（middleware）：`context.authedAgent` 为空则 `UNAUTHORIZED`（401）。
- **`sessions.*` 对话面改用 `agentProcedure`**：
  - `create`：**去掉入参 `agentId`**，改用 `context.authedAgent.id`。
  - `get` / `listMessages` / `run` / `prompt`：先载入会话并断言 `session.agentId === authedAgent.id`，否则 `NOT_FOUND`（不泄漏他人会话存在性）。
- **保持 public（管理面）**：`sessions.list`（全量）、`agents.*`、`providers.*`、`healthCheck`。

> 现有 `streamTurn` 把失败作为终止 `error` 事件下发（保 200 + CORS）的约定不变；鉴权失败发生在建立流之前（procedure 层），返回标准 401。

## 6. Agent SDK（packages/client）

- `createAgentClient({ baseURL, token })` —— **移除 `agentId`**。RPCLink 注入 header `Authorization: Bearer <token>`。
- `createSession()` → `sessions.create({})`（不传 agentId，服务端从 token 推导）。
- 其余接口（`createSession / listMessages / run / stream`）签名不变。
- `createAgentClientFrom(client)` —— 去掉 `agentId` 形参。
- `AgentClientConfig` 由 `{ agentId, baseURL }` 改为 `{ baseURL, token }`。

```ts
const agent = createAgentClient({ baseURL: "http://localhost:3000", token: "ba_..." });
await agent.run("hello");           // 自动建会话并跑一轮
for await (const ev of agent.stream("hi")) { /* ... */ }
```

## 7. admin UX（dogfooding 路径）

show-once 哈希意味着**连 admin 也无法事后再读取 token**。承接方式：

- **创建 agent 时**：把一次性明文 token 显示在带「复制」按钮的框里，并写入 `localStorage["agentToken:<agentId>"]`。
- **agent 详情 / 对话页**：用缓存的 token 构造 Agent SDK 来跑对话。
- **缓存缺失**（在别处创建 / 清了存储 / 换了浏览器）：页面给出「重新生成 token」动作（走 `rotateToken` → 新明文 → 重新缓存），沿用既有 popover 二次确认模式（见 admin-ui-conventions）。
- admin 对话相关调用全部切到 Agent SDK：`sessions.create`、`sessions.prompt`（stream）、`sessions.listMessages` 现在都经 SDK（带 token）。**唯一保留 raw oRPC（管理面）的是 `sessions.list`**（全量列表，给 admin 的会话浏览用）。
- admin 未使用 `sessions.get`，故把它纳入 token 鉴权无破坏。
- 备注（实现期细节，非本 spec 决策）：`sessions.list` 返回全量会话；agent 详情页如需只看本 agent 的会话，可加 `agentId` 过滤——属管理面增强，可在计划中处理。

> **需明示的取舍**：重新生成会**作废任何持旧 token 的外部 client** —— 这是 show-once 的固有代价，对内部工具可接受。正常路径（创建即缓存）下外部 token 保持稳定。

## 8. 单元拆分与测试

| 单元 | 职责 | 测试 |
|---|---|---|
| `TokenService` | 生成 / 哈希 token | 单测：格式、确定性 hash、唯一性 |
| `AgentStore.{create,rotateToken,findByTokenHash}` | token_hash 的写 / 轮换 / 反查 | 集成测（PGlite）：建带 hash、轮换后旧 hash 失效、反查命中/未命中 |
| `createContext` + `agentProcedure` | header → authedAgent；缺失则 401 | api 测：有/无/错 token；跨 agent 会话访问被拒 |
| `sessions.*` 作用域 | 只能访问本 agent 会话 | api 测：A 的 token 访问 B 的 session → NOT_FOUND |
| Agent SDK | 带 token 建会话 / run / stream | 注入式 client 单测（现有 `index.test.ts` 扩展） |

## 9. 影响面清单（落地时逐项）

- `packages/db`：schema 加列 + 迁移；`agent-store` 三个方法。
- `packages/agent`：`TokenService`；`ports.ts` 的 `AgentStore` 接口；`AgentInput`/返回类型。
- `packages/api`：`context.ts`（authedAgent）；`index.ts`（agentProcedure）；`agents.ts`（create 返回 token、新增 rotateToken）；`sessions.ts`（agentProcedure + 作用域 + create 去 agentId）。
- `packages/client`：config/接口改 token。
- `apps/server`：把 `TokenService` 装进 services / context 工厂（如需）。
- `apps/admin`：创建表单展示+缓存 token；对话页用 SDK + 轮换动作。
- 测试：上表各项。
