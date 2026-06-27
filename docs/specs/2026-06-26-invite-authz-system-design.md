# 邀请码 / API 授权系统 —— 设计方案

**状态:** 待评审(尚未实现)。

## 目标

一个**独立部署**的授权服务("authz")。apps/web 的用户登录后(用现有认证),必须**兑换一个邀请码**;之后该用户在 web 上发起的**每一个数据请求**,都要经过授权才放行。**apps/admin 和 agent 通道完全不受影响。**

## 范围 / 非目标

- **只作用于 apps/web** 的用户数据请求。**不碰** agent 通道(`agentProcedure`),**不碰** apps/admin。
- 登录、兑换这几个接口本身**豁免**(否则还没授权的用户连登录/兑换都做不了)。

## 架构

新增一个同级可部署应用 `apps/authz` —— 一个 Cloudflare Worker(Hono),**自带独立的 Neon 数据库、独立的认证、以及一个极简的内置后台 UI** 来管理邀请码。

```
apps/web ──登录──▶ 主 server(现有认证)            apps/admin(不变)
   │                     │  ▲
   │ 每个数据请求         │  │ ② 吊销时 authz 回调"清缓存"(service secret)
   │ (带 token)           ▼  │
   │               authz-client ──service secret──▶ apps/authz Worker ──▶ authz Neon 库
   │                  ▲                                (邀请码、授权记录、后台管理员)
   │ 未授权跳 /invite │ ① 读主 server 自己库里的缓存(带 60s TTL,过期回 authz 核验)
   └──────────────────┘
```

- **apps/web 不直接连 authz**,由**主 server 中转**(authz 只对内,用共享的 `AUTHZ_SERVICE_SECRET` 调用)。

## 数据模型

**authz 自己的库(唯一事实来源):**
- `invite_codes`:`id`、`code`(唯一)、`label`、`source`(来源,生成时填的自由文本)、`maxRedemptions`(= 1,一次性)、`redemptions`、`active`、`createdAt`。
- `grants`:`id`、`subject`(web 用户 id)、`codeId`(外键)、`createdAt`,`subject` 唯一。
- 后台管理员:内置一个(`jacksonwen001@gmail.com` + 部署时生成的随机密码)+ 后台 UI 用的 JWT。**不允许注册。**

**主 server 的库(只是缓存,不是事实来源):**
- `web_authz_cache`:`subject`(userId,主键)、`authorized`(bool)、`code`、`checkedAt`(上次跟 authz 核验的时间)。

## authz Worker 接口

**后台(JWT 认证,给 authz 后台 UI 用):**
- `login(email, password)` → token
- `codes.list()` / `codes.create({label, source})` / `codes.revoke(id)`
  - `revoke` 不只是把码置为 inactive,**还会找出该码的所有 grant,逐个回调主 server 的"清缓存"接口**(见 ②)。

**服务间(机器对机器,只由主 server 用 `AUTHZ_SERVICE_SECRET` 调用):**
- `authorize({ subject })` → `{ authorized: boolean }`
- `redeem({ subject, code })` → `{ authorized, reason? }` —— 校验码(active、未超出 maxRedemptions),建/更新 grant,兑换数 +1。

## 流程

1. 用户在 apps/web 登录(现有主 server 认证)→ 拿到用户信息 + token。
2. 进 app 时,`AuthzGuard` 问主 server `invite.status`:
   - 主 server 读 `web_authz_cache`;命中且 `authorized` → 直接放行。
   - 未命中或缓存过期(`now - checkedAt > 60s`)→ 回 authz `authorize` 核验,刷新缓存。
   - 结果未授权 → 跳转 **`/invite`**。
3. `/invite`:用户输入码 → `invite.redeem({code})` → 主 server → authz `redeem`。成功后主 server 把 `web_authz_cache` 写成 `authorized=true, checkedAt=now`,用户放行。
4. **之后每个 web 数据请求**:`authorizedUserProcedure` 中间件读缓存;命中且未过期 → 放行;过期 → 回 authz 核验刷新;未授权 → `403`,web 收到 403 跳回 `/invite`。

## 缓存策略(①+②,TTL = 60s)—— 修正后

这是上一版的硬伤修复:缓存**必须带 TTL + 回源核验**,否则吊销不生效。

- **① 短 TTL(60s)**:每个请求先读 `web_authz_cache`;`checkedAt` 超过 60s 就**回 authz 重新核验**并刷新(或清除)。所以**就算没有推送,吊销最多 60s 也会生效**——不会"永远不知道"。性能上每个用户大约每分钟才回一次 authz,其余走缓存。
- **② 即时吊销(推送)**:authz `codes.revoke` 时,**主动回调主 server** 的内部"清缓存"接口,把相关用户的 `web_authz_cache` 删掉 → **下一个请求立刻回源、立刻拦下**。
- authz 始终是**唯一事实来源**;主 server 的 `web_authz_cache` 只是 60s 内有效的副本,且能被 ② 立即清掉。

## 主 server 改动

- `apps/server/src/authz-client.ts` —— `authorize()` / `redeem()`,带 `AUTHZ_SERVICE_SECRET` 调 authz Worker。
- `web_authz_cache` 表 + 读/写/清的仓储。
- 新增 `authorizedUserProcedure = userProcedure.use(authzMiddleware)`:读缓存(过期则回源),未授权抛 `FORBIDDEN`。用在所有 **web 数据** 路由;`auth.*` / `invite.status` / `invite.redeem` 仍用普通 `userProcedure`。**绝不**加到 `agentProcedure` / admin。
- 一个 `invite` 路由:`status` + `redeem(code)`。
- 一个**内部接口**(用 `AUTHZ_SERVICE_SECRET` 校验,只给 authz 调)`authzInvalidate({ subjects })` —— 删掉这些用户的缓存(②)。

## apps/web 改动

- `AuthzGuard` 包住 app 外壳:未授权跳 `/invite`。
- `/invite` 路由(一个输入框 + 提交)。任何请求返回 `403` 时,oRPC 客户端跳 `/invite`。

## apps/authz(新应用)—— 极简后台 UI

一个单页(登录 + 邀请码表格:新建[填 label + source] / 列表 / 吊销),同一套 shadcn。跟 web/admin 一样 SPA 模式构建、当静态资源 Worker 部署;authz Worker 同时提供服务接口 + 后台接口。**只有内置管理员,不能注册。**

## 部署

- 新增 GitHub Action job:迁移 authz Neon 库 → seed 它的管理员 → 部署 `better-agent-authz` Worker → 构建并部署 authz 后台 SPA。
- 新增 secret:`AUTHZ_DATABASE_URL`、`AUTHZ_ADMIN_EMAIL`、`AUTHZ_ADMIN_PASSWORD`、`AUTHZ_JWT_SECRET`、`AUTHZ_SERVICE_SECRET`。
- **主 server** 拿到 `AUTHZ_URL` + `AUTHZ_SERVICE_SECRET`(调 authz);**authz** 拿到 `MAIN_SERVER_URL` + 同一个 `AUTHZ_SERVICE_SECRET`(吊销时回调主 server 清缓存)。

## 已确认的决策(2026-06-26)

1. **authz 自带后台 UI**(极简邀请码页)。
2. **缓存 = ①+②,TTL 60s**:主 server 缓存授权(60s),过期回 authz 核验;authz 吊销时回调主 server **立即**清缓存。吊销既"最多 60s 兜底",又能"即时生效"。
3. **一次性码**(`maxRedemptions = 1`),生成时填 `source`(自由文本)。
