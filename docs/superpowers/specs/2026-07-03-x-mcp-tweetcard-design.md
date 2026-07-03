# X 采集 MCP 工具 + TweetCard genui — design spec

**Goal:** 把 `~/stocks` 的 X 采集能力做成 better-agent 的 MCP 工具(搜用户/搜推文/查某人推文),用户用自己的 X `auth_token` 鉴权;新增一个 TweetCard genui 组件,agent 把推文数据渲染成卡片。

## 调研结论(已确认)
- stocks 用 `twitter-openapi-typescript@0.0.55`(**非官方抓取**,cookie `auth_token`,非 X 官方 API)。能力:`getUserApi().getUserByScreenName`(查用户)、`getTweetApi().getSearchTimeline`(搜推文)、`getUserTweets`(某人推文)。normalize 层产出 `NormalizedTweet`/`NormalizedProfile`。
- Workers 兼容:库 `require("crypto")` + 传递依赖 `x-client-transaction-id-generater`(依赖纯 JS 的 `node-html-parser`,无 jsdom)。mcp worker 已有 `nodejs_compat` → 假定可覆盖(**已决:直接全量实现,不 spike**)。
- genui:client 工具取数 + 组件 manifest + RENDERERS 渲染。MCP 是服务端工具、genui 在浏览器,两者不共享状态 → agent 读 MCP 工具输出后发 TweetCard 节点、从数据填 props。

## 决策(已确认)
1. **鉴权复用现有 MCP bearer 通道**:X 工具挂在 mcp worker;用户在 /integrations 加一个 MCP server 指向 mcp worker URL,`auth_token` 填在现成的 bearer token 字段。better-agent 加密存储 + 每轮转发 Authorization 头;mcp worker **无状态**,每请求从 `Authorization: Bearer <auth_token>` 读 token。零新增存储。
2. **TweetCard 自建**、magicui 风格、props 驱动、完全自包含(无外部请求)。

## Part A — mcp worker X 工具(apps/mcp)

### A1. 移植 stocks 的 x/ 切片到 `apps/mcp/src/x/`
从 `~/stocks/packages/data-connectors/src/x/` 逐字复制(仅改 import 路径):
- `x-errors.ts`、`x-types.ts`、`x-normalize-helpers.ts`、`x-normalize.ts`、`x-raw-timeline.ts`、`x-client.ts`(`createXClient(authToken)`)。
- 依赖:`twitter-openapi-typescript: 0.0.55` + `twitter-openapi-typescript-generated: 0.0.38` 加进 better-agent catalog + apps/mcp deps。

### A2. 三个高层取数函数 `apps/mcp/src/x/x-tools-impl.ts`
- `searchUsers(client, screenName)` → `NormalizedProfile`(getUserByScreenName;404 → 友好 not-found)。
- `searchTweets(client, query, limit)` → `NormalizedTweet[]`(getSearchTimeline;走 raw-timeline 解析,取一页,limit≤20)。
- `userTweets(client, screenName, limit)` → 先 getUserByScreenName 拿 restId,再 fetchUserTweets(maxPages=1, sinceId=null),截断 limit。
> 注:search/userTweets 都复用 raw-timeline 的 walker;getSearchTimeline 的 instructions 结构与 UserTweets 一致(TimelineAddEntries + TimelineTweet),同一个 `parseTimeline` 即可,search 无 sinceId 停止逻辑。

### A3. MCP 工具定义 + auth 透传
- 传输层(`app.ts`)从 `c.req.header("authorization")` 提取 bearer,传进 `handleMessage(message, { authToken })`。
- `mcp-server.ts` 的 tools:
  - `x_search_users { screen_name }`
  - `x_search_tweets { query, limit? }`
  - `x_user_tweets { screen_name, limit? }`
  每个 execute:无 authToken → isError「需要在 MCP server 配置里填 X auth_token」;有则 `createXClient(authToken)` → 调 A2 → 返回 `content:[{type:"text", text: JSON.stringify(result)}]`。JSON 里放**归一化后的字段**(TweetCard 要用的都在)。
- 保留握手/tools-list;删掉 mock `get_mock_data`。
- 错误:XAuthError → isError「auth_token 失效,请更新」;XRateLimitError → 「X 限流,稍后再试」;其它 → 通用。

### A4. 测试
`apps/mcp/src/x/*.test.ts`:用录制的 X GraphQL JSON 夹具(从 stocks 的 test 夹具借,或手写最小 JSON)测 normalize + timeline 解析;transport 测「无 auth 头 → isError」。**不打真实 X**(无 token,CI 不可复现)。

## Part B — TweetCard genui(apps/web/src/genui)

### B1. manifest 新增组件
`TweetCard`,props(全部 optional 除 authorHandle/text):
```
authorName, authorHandle, authorAvatarUrl?, verified?(bool),
text, postedAt?(iso string), url?,
likeCount?, retweetCount?, replyCount?, viewCount?,
mediaUrls?(string[]  仅图片 url)
```
描述:引导 agent「展示推文时,每条用一个 TweetCard;从 x_* 工具结果里填字段」。

### B2. renderers 新增渲染
`TweetCardNode`:magicui 风格自包含卡 —— 圆角边框卡、头像圆图(`<img>` 直接用 X 头像 url,允许外链图片;若 CSP 拦截则退化为姓名首字母圆底)、作者名+蓝V(verified)+ @handle + 相对时间、正文(保留换行)、图片网格(mediaUrls,最多 4,`<img>`)、底部一行 reply/retweet/like/view 计数(lucide 图标 + 紧凑数字如 1.2K)。纯展示、无交互、无外部请求(图片除外)。数字格式化 helper(compact)。
> 拆分:卡片头(TweetCardHeader)、正文+媒体、计数栏(TweetCardStats)三个子组件,避免 50 行超限。

### B3. 不改动
genui 的 client DATA_TOOLS/HANDLERS 不动(TweetCard 无 action、无 client 工具;数据来自 MCP 服务端工具,agent 转填 props)。

## 用户使用路径(验收)
1. /integrations → Add MCP server → URL 填 mcp worker 地址、bearer 填自己的 X `auth_token` → 保存(连通验证会调 tools/list,不需要 token 就能列工具);
2. 编辑 agent → Tools → MCP → 勾上该 server;
3. 聊天开 genui 开关,问「看看 @elonmusk 最近的推文」→ agent 调 `x_user_tweets` → 拿到推文 → 发 TweetCard 树 → 渲染成卡片。

## 边界/风险
- 非官方抓取:auth_token 会过期、可能触发 X 风控/限流;仅供内部/受控使用。
- Workers 兼容若实测不通(crypto/transaction-id),回退:X 工具改由 apps/server(Node/k3s)承载,MCP 传输不变。**先按 Workers 实现,部署后用真实 token 验证**。
- genui 渲染依赖 agent 正确转填 props;推文多时 token 消耗大(建议默认 limit 5)。

## 约束
仓库硬约束照旧(文件≤299 行、函数≤50 行、无 any、魔数仅 -1/0/1、依赖固定、className 行内不写 `foo[bar]`)。mcp worker 无法本机 e2e(无 token),以 tsc + 单测 + 结构自查为准。
