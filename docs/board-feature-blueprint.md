# Board(看板)功能蓝图 — 完整复刻文档

> 目的:本文档记录 better-agent 曾实现的 Board 功能的**全部设计与实现细节**。功能代码已于 2026-07-03 从仓库移除(本文档提交的同一批次);任何 agent 依照本文即可在当前代码基上重建一个等价实现。
> 移除前最后包含该功能的提交:见本文档所在提交的父提交。需要参考原始代码时 `git log --diff-filter=D` 找删除点,`git show <sha>^:<path>` 取回。

## 1. 功能概览

一个 per-user 的 Sprint 看板(Todo / In Progress / Done 三列),支持:
- 卡片拖拽换列/排序(dnd-kit),行内快速建卡,卡片弹窗编辑,搜索(标题或 `task-N`);
- Sprint 管理(创建/开始/完成/删除,同一时刻至多一个 active);
- **AI 助理抽屉**:右下角按钮唤出毛玻璃抽屉(无遮罩、浮于主布局、从右滑入),用自然语言操作看板("把 task-3 挪到进行中"),绑定用户选定的 agent;
- 看板 UI 的直接操作(按钮/拖拽)与 AI 的自然语言操作**共用同一条接口**(详见 §5,这是整个设计的核心)。

## 2. 数据模型(Postgres / drizzle)

两张表,均以 `userId` 隔离(无跨用户可见性):

```ts
// packages/db/src/schema/task-board.ts
tasks:   id uuid PK, user_id uuid NOT NULL, seq int NOT NULL,        // 每用户递增的人类可读编号(task-7)
         sprint_id uuid NULL,                                        // null = backlog(后期 UI 移除了 backlog,仍留列)
         title text, description text default '',
         status text $type<TaskStatus> default 'todo',               // 'todo' | 'in_progress' | 'done'
         position double precision default 0,                       // 列内排序(浮点中点插入法)
         created_at/updated_at timestamptz
  索引: (user_id), (user_id,status,position), (user_id,sprint_id,status,position)

sprints: id uuid PK, user_id uuid NOT NULL, name text, goal text default '',
         start_date/end_date timestamptz NULL,
         status text $type<SprintStatus> default 'future',           // 'future' | 'active' | 'completed'
         created_at/updated_at timestamptz
```

要点:
- **`seq`**:每用户自增(insert 时 `max(seq)+1`),UI 与 AI 都用 `task-N` 称呼卡片 —— 这是 AI 可用性的关键(用户不会说 uuid)。
- **`position` 浮点排序**:插入两卡之间取中点 `(a+b)/2`;列首 `first-1`,列尾 `last+1`。无需全列重排。
- 类型定义放 `packages/agent/src/task/types.ts`(`Task`/`Sprint`/`TaskStatus`/`SprintStatus`),供 db/api/agent 三层共用。

## 3. 存储层(packages/db/src/repositories/)

`task-store.ts` / `sprint-store.ts`,接口定义在 `@better-agent/agent/ports`:

```ts
interface TaskStore {
  create(userId, {title, description?, sprintId?, status?}): Promise<Task>;   // seq 自增在此实现
  get(userId, id); getBySeq(userId, seq);                                     // 双引用:uuid 与 task-N
  listColumn(userId, sprintId|null, status): Promise<Task[]>;                 // 按 position 升序
  listBacklog(userId): Promise<Task[]>;
  move(userId, id, {status, position}): Promise<Task|null>;                   // 换列 + 排序一次完成
  update(userId, id, patch); remove(userId, id): Promise<boolean>;
}
interface SprintStore {
  create/get/list/update/remove(userId, ...);
  active(userId): Promise<Sprint|null>;
  setStatus(userId, id, status);   // startSprint 时把其它 active 置回 future(单 active 不变量)
}
```

每个方法第一个参数都是 `userId` —— 隔离在存储层强制,不依赖上层记得过滤。集成测试用 PGlite(`createTestDb()`)。

## 4. AI 工具层(packages/agent/src/tool/)

`task-tools.ts` + `sprint-tools.ts`,`buildTaskToolDefs(store, userId)` / `buildSprintToolDefs(store, userId)` 返回 `ToolDef[]`(闭包捕获 userId,工具签名里**不暴露** userId)。

工具清单(15 个):
- task:`listSprintColumn{sprintId?,status}`、`listBacklog`、`createTask{title,description?,sprintId?,status?}`、`moveTask{id|seq,status,position?}`、`updateTask{id|seq,...patch}`、`deleteTask{id|seq}`、`getTask{id|seq}`
- sprint:`listSprints`、`activeSprint`、`createSprint{name,goal?,startDate?,endDate?}`、`getSprint{id}`、`updateSprint{id,...}`、`startSprint{id}`、`completeSprint{id}`、`deleteSprint{id}`

实现要点:
- **`id|seq` 双引用**:`resolveTaskId(store, userId, args)` —— args 里给了 `seq` 就 `getBySeq`,否则用 `id`。模型几乎总是用 seq(因为上下文里显示 task-N)。参数 schema 两者都可选,`required` 只放语义必需项(如 moveTask 的 `status`)。
- 返回 `ok(data)` = `{output: JSON.stringify(data)}`;错误返回 `{output: msg, isError: true}`(模型可读并自纠)。
- `moveTask.position` 可选:缺省追加列尾。

## 5. ★ AI 与 UI 的协调 —— 单接口双路径(本功能最重要的设计)

看板的一切写操作都走 **`userSessions.prompt`** 这一个 oRPC SSE 端点,入参二选一:

```ts
promptOrToolCallsInput = { sessionId, text, ... }                    // A. 模型回合(自然语言)
                       | { sessionId, toolCalls: [{name, args}] }    // B. 直连工具(无模型)
```

**路径 B(UI 按钮/拖拽 → streamToolCalls)**:不经过模型,把命名工具并发执行(`Promise.all` + `streamSettled` 谁先完成先产出谁的 `tool-result` 事件),最后补一个 `done`。事件形状与模型回合完全一致 → **前端消费一份流协议**。UI 的拖拽=一次 `moveTask` 直连;行内建卡=一次 `createTask` 直连。快(无模型延迟)、确定(无幻觉)、免费(零 token)。

**路径 A(AI 抽屉 → 模型回合)**:走 runtime.runTurn,但 board 工具的绑定有三条纪律:
1. **`surfaces: ["board"]` 显式开启**:prompt 入参带 `surfaces` 数组;`streamUserTurn` 只在 `surfaces?.includes("board")` 时把 board 工具并入本轮工具集。普通聊天页不带 → 聊天 agent 不背 15 个看板工具的 token/干扰(工具装配三源合并见 `agent-tool-defs.ts`)。
2. **破坏性工具不给模型**:`NL_UNSAFE_TOOLS = {deleteTask, deleteSprint, completeSprint}` 从模型回合过滤掉 —— 模糊指令("清理一下")不该能删任务;删除只能从 UI 按钮走路径 B。教训来源:曾发生模型把"完成任务"理解为删除。
3. **上下文注入而非指望模型自查**:抽屉每次发送在 text 前拼一个 PREAMBLE:当前 sprint + 各列任务快照(**上限 40 条**,`MAX_CONTEXT_TASKS=40`,防 token 爆炸),每条 `task-N: title [status]`;外加行为规则("完成=改 status,永远不要删除"、"引用任务用 seq")。这样模型开口就知道 task-3 是谁。

配套防护(runtime 层,通用非 board 专属):doom-loop(同工具同参数连续 3 次拦截)、会话锁、截断。

## 6. 前端(apps/web/src/board/,TanStack Router 路由 /board)

### 6.1 状态:模块级 store + 乐观更新
- `board-store.ts`:组件外的模块 store(`subscribe/getSnapshot` + useSyncExternalStore),持有 tasks/sprints/当前 sprint;**乐观更新**:拖拽先改 store 立即渲染,`board-client.ts` 发直连 toolCalls,失败回滚 + toast。
- `board-client.ts`:封装路径 B —— 复用聊天的 AgentClient SSE(`client.stream` 带 `toolCalls`),把 tool-result 事件解析回 store。会话按 tab 记忆(`board-session.ts`,sessionStorage 存 sessionId,复用同一会话)。
- `use-sprints.ts`:sprint 列表/active 的加载与操作;`use-board-handlers.ts`:把 store 操作绑到 UI 事件。

### 6.2 拖拽(dnd-kit)—— 全是踩坑得来的细节
- **碰撞检测**:`pointerWithin` 优先、fallback `closestCorners`(纯 closestCorners 在跨列时体感差)。
- **`MeasuringStrategy.Always`**:列内容动态增减,不开会错位。
- **DragOverlay 必须 `createPortal` 到 `document.body`**:任何带 transform/filter 的祖先(路由过渡动画!)都会成为 position:fixed 的包含块,导致拖影偏离鼠标。
- **onDragOver 绝不改 store**:拖拽中改数据会重挂被拖节点 → dnd-kit 误判 drag end("松手前就报 move failed")。onDragOver 只记录 `overColumn`(用于列高亮),真正的 move 在 onDragEnd。
- **落点解析**(`drag-resolve.ts`):over 是卡片则取其列 + 计算中点 position;over 是列则追加列尾。
- **列高亮**:拖拽中非目标列 `opacity-40`,目标列 `bg-primary/5 ring-2 ring-primary`;droppable ref 挂在列的外层 div(挂内层会出现"移到卡片上列不亮")。

### 6.3 布局细节(全部来自用户验收)
- 卡片**固定高 h-32** + `shrink-0`(不同列卡片对齐);标题 `line-clamp-2`,描述 `text-sm text-foreground/70 line-clamp-1`(曾因 xs+muted 被批看不清)。
- 卡片静息**无边框无 ring**,仅拖拽 overlay `ring-2 ring-primary`;dnd-kit 的 role=button 聚焦方框要 `outline-none` 干掉(圆角卡四角会漏边框线)。
- 列滚动:页面 flex 链路必须 `flex-1 min-h-0` 贯穿到列容器再 `overflow-y-auto`,否则列不滚、卡片被压扁。
- 加载骨架按真实布局:sprint 栏 + 搜索框 + 三列各两张 h-32 卡。

### 6.4 AI 抽屉(board-command-bar.tsx)
- 右下角圆形按钮唤出;**portal 到 body** 浮在主布局之上;`bg-background/70 backdrop-blur-md` 毛玻璃、**无遮罩**;`translate-x` CSS 过渡右进右出(不要用 motion 的 AnimatePresence,见聊天页的教训)。
- 内部是精简聊天(消息列表自动滚底 + 输入框),header 显示绑定的 agent 名;发送时拼 §5.3 的 PREAMBLE + `surfaces:["board"]`。
- 收到 tool-result 事件后刷新 board store(AI 改了数据,看板要跟着动)。

## 7. 重建步骤(checklist)

1. db:建 `task-board.ts` schema(§2)→ 迁移 → `task-store`/`sprint-store`(§3)+ PGlite 集成测试;ports 加接口;server/api services 两处接线(`packages/api/src/services.ts` 类型 + `apps/server/src/services.ts` 装配,**都要改**)。
2. agent:`task/types.ts` + `task-tools.ts`/`sprint-tools.ts`(§4)+ 单测(尤其 seq 引用与 isError 路径)。
3. api:`board-defs.ts`(全量 defs + NL 安全子集)、`tool-calls-stream.ts`(并发直连 + streamSettled)、`user-sessions.prompt` 的双路径入参与 `surfaces` 门控(§5);client 包类型同步(`surfaces`/`toolCalls` 透传)。
4. web:board/ 目录(§6),路由 + 侧边栏项;先做列表/建卡,再拖拽(严格照 §6.2 的坑),最后 AI 抽屉。
5. 全程遵守仓库硬约束:文件 ≤299 行、函数 ≤50 行、无 any、魔数仅 -1/0/1、className 行内不要写 `foo[bar]` 下标(tailwind 检查脚本误报)。

## 8. 当时已知的未尽事项
- backlog 列已从 UI 移除但 schema 仍支持(sprintId null);
- 看板无多人协作/实时同步(单用户假设,store 无跨 tab 同步);
- position 浮点长期插入会精度耗尽(未做重整化,插入上万次量级才会遇到)。
