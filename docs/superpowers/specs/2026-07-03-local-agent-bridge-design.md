# 本地编码 Agent 桥接(Local Agent Bridge)— design spec(待 review)

> 状态:**调研 + 设计草案,供 review**。不实现,先对齐架构与取舍。
> 目标:用户在本地跑一个 client,它驱动本地的 **Claude Code / Codex / opencode / pi-agent**,把 agent 的输出实时流到 better-agent server;server 端接受用户输入,把指令回传给 client,client 喂给本地 agent 继续操作。等于"用手机/网页远程操控你桌面上的编码 agent"。

## 1. 调研结论:各 agent 的可编程驱动接口(已查证)

| Agent | 驱动方式 | 形态 |
|---|---|---|
| **Claude Code** | `claude -p --output-format stream-json --input-format stream-json`(**双向 NDJSON**),或 Claude Agent SDK(TS/Python) | 写 JSON 到 stdin,读 NDJSON 事件从 stdout —— 最理想的双向驱动 |
| **opencode** | `opencode serve`(headless HTTP,OpenAPI 3.1 + SSE,SQLite 会话),或 **ACP**(Agent Client Protocol,stdin/stdout nd-JSON) | 二选一 |
| **Codex CLI** | `codex exec` JSONL,或持久 app-server JSON-RPC | 二选一 |
| **pi-agent** | CLI(文档较少,预期同类 stdin/stdout 或 exec-json) | 待补 |

**统一线索**:这些都归结为「**一个长驻子进程 + 双向结构化消息流**」——要么 stdin/stdout NDJSON(Claude Code stream-json、opencode ACP),要么本地 HTTP+SSE(opencode serve、codex app-server)。所以 bridge 只需对每个 agent 写一个薄 **adapter**,把它归一化成统一的 `{事件流 ↑, 指令流 ↓}`。ACP 已是事实标准(opencode 等支持),可作为首选归一模型。

## 2. 架构:三段 + 一个中继

```
[本地 agent 进程] ←stdin/stdout NDJSON→ [Bridge Client(本地 Node CLI)] ←持久连接→ [Server 中继] ←SSE↓/POST↑→ [Web 终端视图]
```

### 2.1 Bridge Client(本地,新 `apps/bridge-cli` 或 `packages/bridge`)
- Node CLI:`better-agent-bridge --agent claude-code --dir ~/project --token <bridge-token>`。
- 按 `--agent` 选 adapter,spawn 本地 agent 的流式模式,双向桥接:
  - **上行**:把 agent 的 NDJSON 事件归一化后推给 server;
  - **下行**:从 server 收到的用户指令写进 agent stdin。
- adapter 接口:`start(dir) → {events: AsyncIterable, send(cmd)}`;每个目标 agent 一个实现(claude-code / opencode-acp / codex-exec / pi)。
- 断线重连、心跳、优雅退出。

### 2.2 Server 中继(新 `bridge` 路由 + Redis pub/sub)
- 一个 **bridge session** 配对两端:**bridge**(本地 client)与 **controller**(web 用户)。这是**中继/发布订阅**,不是 LLM 回合模型 —— 更接近"网页版终端"或看板的直连通道。
- 端点:
  - `bridge.connect`(bridge 侧,SSE 下行 agent 事件 + 单独 POST 上行 agent 事件到 session);
  - `bridge.observe`(controller 侧,SSE 下行 agent 事件);
  - `bridge.input`(controller 侧,POST 用户指令 → 经 pub/sub 转给 bridge)。
- 跨 isolate/实例:走 **Redis pub/sub**(现成的 `REDIS_URL` 基建;pending-store 已证明可行)。事件也可短期留存供刚进入的 observer 回放最近 N 条。
- 会话状态:`bridge_sessions` 表(id / userId / agentKind / label / status / createdAt);事件不必全量落库(终端流量大),按需只留最近窗口。

### 2.3 Web 终端视图(apps/web 新路由 `/bridge`)
- 类终端:等宽输出区(渲染归一化事件:agent 消息 / 工具调用 / 文件改动 / 命令输出)+ 底部输入框。
- 绑定一个在线 bridge session;显示连接状态。复用聊天的 SSE 消费模式。

## 3. 关键架构取舍

### 3.1 传输(已定,2026-07-04 更新):**原生 SSE push + 真 Redis pub/sub**(server 已迁至 Docker)

> **背景变更**:server 已从 Cloudflare Workers 迁到**自托管 Docker(单机 Node + compose 自带 Redis,`ioredis` 已在用**:pending-store / session-lock 都走 `new Redis(REDIS_URL)`)。原方案为 Workers 限制(无常驻 SUBSCRIBE、SSE 会被回收、Upstash REST 按调用计费)所做的"轮询中继"妥协**全部失效**,升级为原生推送。

**新方案**:
- **下行即时 push**:controller 打开一条**长驻 SSE**(Node 进程随便开);server 对每个 session `SUBSCRIBE bridge:{sid}:events`,`PUBLISH` 一到就写给 SSE —— **即时,不再是 300ms–1s 轮询级**。bridge client 拿指令同理(SSE 订阅 `commands↓`)或保留轮询(本地 Node 进程,成本为零,实现更简单可后换)。
- **上行仍是 POST**:agent 事件产生即 POST;server `RPUSH` 进滚动窗口 + `PUBLISH` 通知订阅者。
- **滚动窗口降级为重连回放缓冲**(不再是主数据通道):每 (session, dir) 一个 capped list(如 500 条 / 15 分钟 TTL),SSE 断线重连时带 `lastEventId` 先 `LRANGE` 回放增量、再接上直播。**轮询作为兜底路径保留**(同一 read(afterId) 接口),不是主通道。
- **单实例简化**:当前 server 是单 Node 进程,理论上进程内 EventEmitter 直连即可;**仍走 Redis(pub/sub + 窗口)** —— 代价极低(compose 里现成),换来 server 重启不丢缓冲、日后横向扩容不改协议。
- **实现注意**:SSE 经外层 Caddy 反代(默认不缓冲流式响应,无需特殊配置),但 server 侧要**定期发心跳注释行(`:ping`)**防链路超时断连;终端输出仍需**截断超长行 + 限窗口**。
- ~~Upstash REST 调用成本控制 / 自适应轮询频率~~ —— 自建 Redis,零调用成本,整段删除。

> 一句话:部署迁移把"为 Workers 妥协的轮询"升级成"Node 原生 SSE push + 真 Redis pub/sub":延迟从秒级到即时,复杂度反而下降(删掉自适应轮询/成本控制),复用 server 现有的 ioredis 基建。

### 3.2 认证与信任模型 ★安全关键
- bridge 驱动的是**本地编码 agent**,能跑任意命令、改任意文件 —— 权力极大。
- **专用 bridge token**:用户在 web 生成一个**限定用途、可撤销、绑定该用户**的 bridge token,启动 client 时传入;server 侧校验并把 session 绑到该用户。
- **仅本人可 observe/input**:controller 端点走 `authorizedUserProcedure`,session.userId 必须等于 caller。
- **本地显式授权**:client 启动时用户显式指定 `--dir`,agent 只在该目录工作;client 打印醒目提示"该会话可被你的 better-agent 账号远程操控"。
- **不代管 agent 的密钥**:本地 agent 用它自己的凭证(Anthropic/OpenAI key 等),better-agent 不接触。

### 3.3 与现有"远程工具协议"的关系
- 现有 remote-tools 是"server 端 LLM 调用 → 客户端执行工具 → 交回结果"(pending-store/submitToolResult)。**bridge 不复用它** —— bridge 没有 server 端 LLM 回合,是纯双向中继。但两者共享 **Redis 跨实例协调**的基建思路。

## 4. 范围(一期全做,已定)

一期即覆盖**全部四个 adapter** + 中继 + web 终端 + bridge token。adapter 接口很薄,四个共享同一归一化协议与中继/UI,一起做可行:
- **Claude Code**:stream-json 双向(stdin JSON / stdout NDJSON)。
- **opencode**:ACP(stdin/stdout nd-JSON)优先;或 `opencode serve` HTTP+SSE。
- **Codex**:`codex exec` JSONL 或 app-server JSON-RPC。
- **pi-agent**:⚠️ 驱动接口文档少,**实现前需先确认它的 headless/streaming CLI 形态**(预期同类 stdin/stdout NDJSON);若无合适接口,pi 降级为二期,不阻塞其余三个。

共享层:归一化事件模型(消息 / 工具调用 / 文件改动 / 命令输出 / 状态)、Workers 轮询中继、bridge token、web 终端视图。

## 5. 决策(review 已完成,全部锁定;传输项 2026-07-04 随部署迁移更新)
- **传输**:**原生 SSE push + 真 Redis pub/sub**(server 在 Docker/Node 上;ioredis 现成),滚动窗口只作重连回放缓冲,轮询仅兜底。(原"Workers 轮询中继"方案随 server 迁出 Workers 作废。)
- **bridge token**:**独立 `bridge_tokens` 表**(可命名、可撤销、审计;与 agent token 语义分离)。
- **多人旁观**:**一期仅本人**(session.userId === caller;中继底层已支持多 observer,权限收紧即可)。
- **事件持久化**:**只留 Redis 滚动窗口**(会话结束即失,不落库)。
- **adapter 范围**:一期 = **Claude Code + opencode + Codex** 三个;**pi-agent 降二期**(headless 接口待确认)。

## 6. 不做/边界(一期)
- 不代管本地 agent 的模型密钥;不做本地文件的云端镜像;不做 agent 进程的资源隔离(信任本地环境);移动端终端只保证可读可输入,不做完整 IDE。

## 约束
遵守仓库硬约束;新 CLI 包与中继路由需类型/lint 全绿;传输若上 WebSocket/DO 属**大成本基建,先 review 再建**(参照之前 Queues 的 待定 原则)。
