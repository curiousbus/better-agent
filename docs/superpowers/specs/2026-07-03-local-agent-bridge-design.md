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

## 3. 关键架构取舍(需 review 拍板)

### 3.1 传输:WebSocket vs SSE+POST 中继 ★最重要
- **WebSocket**(双向低延迟,最贴合终端):在 **Cloudflare Workers 上需要 Durable Objects** 来维持有状态配对 —— **新基建、有状态、按用量计费**。
- **SSE 下行 + POST 上行 + Redis pub/sub**(复用现有基建,零新依赖):延迟略高但对"驱动编码 agent"完全够用;而且我们即将上的 **k3s 部署没有 waitUntil 30s 限制 + 有真 Redis**,长连接中继在 k3s 上非常自然。
- **建议**:一期用 **SSE+POST+Redis 中继**(与现有可续传回合、pending-store 同源),避免引入 Durable Objects;若延迟体感差,二期再评估 WebSocket/DO 或直接把 bridge 中继放 k3s。

### 3.2 认证与信任模型 ★安全关键
- bridge 驱动的是**本地编码 agent**,能跑任意命令、改任意文件 —— 权力极大。
- **专用 bridge token**:用户在 web 生成一个**限定用途、可撤销、绑定该用户**的 bridge token,启动 client 时传入;server 侧校验并把 session 绑到该用户。
- **仅本人可 observe/input**:controller 端点走 `authorizedUserProcedure`,session.userId 必须等于 caller。
- **本地显式授权**:client 启动时用户显式指定 `--dir`,agent 只在该目录工作;client 打印醒目提示"该会话可被你的 better-agent 账号远程操控"。
- **不代管 agent 的密钥**:本地 agent 用它自己的凭证(Anthropic/OpenAI key 等),better-agent 不接触。

### 3.3 与现有"远程工具协议"的关系
- 现有 remote-tools 是"server 端 LLM 调用 → 客户端执行工具 → 交回结果"(pending-store/submitToolResult)。**bridge 不复用它** —— bridge 没有 server 端 LLM 回合,是纯双向中继。但两者共享 **Redis 跨实例协调**的基建思路。

## 4. 分期
- **一期(MVP)**:Claude Code adapter(stream-json 双向)+ SSE/POST/Redis 中继 + web 终端视图 + bridge token。跑通"网页发指令 → 本地 Claude Code 执行 → 输出回网页"。
- **二期**:opencode(ACP)+ codex adapter;事件类型细化渲染(diff/工具卡)。
- **三期**:pi-agent;多会话管理;可选 WebSocket/DO 或 k3s 常驻中继降延迟;移动端终端优化。

## 5. 待确认(review 问题)
1. 传输选 **SSE+POST+Redis 中继**(推荐,零新基建)还是 WebSocket+Durable Objects?
2. 一期只做 **Claude Code** 一个 adapter 打通链路,可接受吗?
3. bridge token 的形态:复用 agent token 机制,还是新建独立的 bridge-token 表 + 生成/撤销 UI?
4. 是否需要**多人协作观看**同一 bridge session(只读旁观),还是一期仅本人?
5. 中继要不要把事件流**落库**做回放(成本 vs 价值),还是只保留内存/Redis 最近窗口?

## 6. 不做/边界(一期)
- 不代管本地 agent 的模型密钥;不做本地文件的云端镜像;不做 agent 进程的资源隔离(信任本地环境);移动端终端只保证可读可输入,不做完整 IDE。

## 约束
遵守仓库硬约束;新 CLI 包与中继路由需类型/lint 全绿;传输若上 WebSocket/DO 属**大成本基建,先 review 再建**(参照之前 Queues 的 待定 原则)。
