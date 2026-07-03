# Prod 部署(k3s ×2 节点)— design spec

**Goal:** main 分支 push 自动部署 prod 到自有 2 台服务器的 k3s 集群;dev→Workers 测试环境流程不变。覆盖:镜像构建、环境变量/secrets、数据库迁移、前后端部署、备份。

## 已确认决策
- 数据库:**集群内自建 Postgres**(StatefulSet + local-path PVC,固定节点;**每日 pg_dump → R2 的备份 CronJob 是强制配套**)。
- 附件:**继续 R2,走 S3 API**(aws4fetch 适配现有 `R2Bucket` 接口:get/put/delete)。
- 触发:**main push 自动**(migrate Job 成功 → 滚动更新)。
- Secrets:**SOPS + age**,密文进 git,CI 解密后 apply。

## 侦察结论(移植成本低)
- `apps/server/src/index.ts` 已是 Node 入口(@hono/node-server);env 走 dotenv/process.env;`REDIS_URL` 的 ioredis 全套实现已存在(锁/取消/pending/限流)→ 集群内 Redis 即插即用,且 **k3s 上没有 waitUntil 30s 限制**,可续传回合完整化。
- authz:已有 `AUTHZ_URL` + HTTP 回退(fail-closed);v1 让 k3s 通过公网 URL 调用仍部署在 Workers 的 authz,不单独容器化。
- web/admin:TanStack Start + nitro,`node-server` preset 产出 `.output/server/index.mjs`,`node` 直接跑。

## 架构
- 节点:node1 = k3s server(control-plane,也跑负载),node2 = agent。Traefik(k3s 内置)做 Ingress,cert-manager + Let's Encrypt 签 TLS。域名三个:`api.<domain>` / `app.<domain>` / `admin.<domain>`(overlay 里占位,runbook 说明替换)。
- 工作负载(namespace `better-agent`):
  - `server` Deployment ×2 副本(跨节点反亲和;Redis 协调已内建);
  - `web`、`admin` Deployment 各 ×1;
  - `redis` Deployment ×1(appendonly,PVC 1Gi);
  - `postgres` StatefulSet ×1(PVC 10Gi,nodeSelector 固定 node1;资源限制;pg16-alpine 固定 tag);
  - `migrate` Job:镜像 = server 镜像,command 跑 drizzle migrate(复用 db 包的 migrate 脚本);CI 先跑它、`kubectl wait` 成功后才滚动更新;
  - `pg-backup` CronJob:每日 pg_dump | gzip → aws4/兼容 CLI 推 R2(`backups/` 前缀,文件名含日期)。

## 镜像(ghcr.io/<owner>/better-agent-{server,web,admin})
多阶段 Dockerfile:`node:22-alpine` + corepack pnpm;`pnpm deploy --filter` 或 workspace 构建后拷贝产物:
- server:`pnpm -F server build`(tsdown)→ runtime 层 `node dist/index.mjs`(还需 db 包的 migrations 目录供 migrate Job 使用);
- web/admin:`NITRO_PRESET=node-server pnpm -F <app> build` → runtime 层 `node .output/server/index.mjs`(build 时需要 VITE_SERVER_URL 等 build-time 变量 → 用 build-arg)。

## 代码改动(仓库内,唯一需要写"产品代码"的部分)
1. `apps/server/src/s3-bucket.ts`:aws4fetch(固定版本)实现 `R2Bucket`(GET/PUT/DELETE object);
2. `packages/env/src/server.ts` 增加可选 `S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY`;
3. `apps/server/src/index.ts`:S3 env 齐备时构造 bucket 传入 buildServices(现在 Node 入口不传 uploads → 附件在 k3s 上原本不可用)。

## Secrets / 配置
- `deploy/secrets/prod.secrets.example.yaml`(明文模板,列出全部键)→ 实际 `prod.secrets.yaml` 用 `sops -e` 加密后进 git;`.sops.yaml` 配 age recipient;
- CI:`SOPS_AGE_KEY` 存 GitHub Secret,解密 → `kubectl apply`;
- 非敏感配置(WEB_URL/ADMIN_URL/CORS_ORIGIN 等)进 ConfigMap(overlay 明文)。

## CI(.github/workflows/deploy-prod.yml,on: push main)
1. buildx 构建三镜像推 ghcr(tag = sha);
2. `KUBECONFIG`(GitHub Secret,k3s kubeconfig 指公网 6443)+ sops 解密 secrets apply;
3. `kustomize edit set image` 三个 sha tag → 先 apply migrate Job(`kubectl wait --for=condition=complete`,失败即中止)→ apply 其余 → `kubectl rollout status`。

## Runbook(deploy/README.md)
服务器初始化(k3s install server/agent、cert-manager、ghcr pull secret、age 密钥生成、DNS 记录、首次 secrets 加密、kubeconfig 导出给 CI)、日常操作(回滚 = 重跑上一个 sha 的 workflow / kubectl rollout undo、备份恢复演练步骤)。

## 边界 / 不做
- 2 节点无 HA 控制面(node1 挂 = 不能变更,负载仍在 node2);
- 无蓝绿/金丝雀(滚动更新);
- authz 暂留 Workers;
- 监控/告警(Prometheus 等)后续迭代。

## 约束
仓库硬约束照旧(文件行数/函数行数/无 any/依赖固定);manifests 与 Dockerfile 无法在本机 e2e 验证(无 k3s/docker),交付时以 tsc + 本地构建 + YAML 结构自查为准,runbook 写清首跑验证步骤。
