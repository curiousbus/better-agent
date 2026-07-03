# Prod 部署(k3s ×2)Runbook

架构与决策见 `docs/superpowers/specs/2026-07-03-k3s-prod-deploy-design.md`。
流向:**dev push → Cloudflare Workers 测试环境(不变);main push → k3s prod(本目录)**。

## 目录
- `docker/`:三镜像的 Dockerfile(server 独立;web/admin 共用 `app.Dockerfile`,`--build-arg APP=web|admin`)
- `k8s/base` + `k8s/overlays/prod`:Kustomize 清单
- `secrets/`:SOPS+age 加密的 Secret(见下)
- CI:`.github/workflows/deploy-prod.yml`

## 一、服务器初始化(一次性,已脚本化)

```bash
# node1(root):k3s server + cert-manager,结束时打印 join token 和 hostname
scp deploy/scripts/bootstrap-node1.sh node1: && ssh node1 ./bootstrap-node1.sh

# node2(root):
scp deploy/scripts/bootstrap-node2.sh node2: && ssh node2 ./bootstrap-node2.sh https://<node1-ip>:6443 <token>
```

DNS:`api./app./admin.<domain>` 三条 A 记录指向两台服务器(或前面的 LB IP)。

## 二、占位符 + Secrets + GitHub(一次性,已脚本化)

```bash
# 1) 占位符(owner/域名/node1 主机名/ACME 邮箱)一次替换,git diff 检查后提交
./deploy/scripts/configure.sh <github-owner> <domain> <node1-hostname> <acme-email>

# 2) 生成 age 密钥 → 编辑真实 secrets → 原地加密(需要 brew install sops age)
./deploy/scripts/setup-secrets.sh

# 3) 配置 GitHub Secrets/Variables(需要 gh auth;先把 node1 的
#    /etc/rancher/k3s/k3s.yaml 拷到本机并把 server 改成公网 IP)
./deploy/scripts/setup-github.sh ~/.config/better-agent/prod-age.key ./k3s.yaml https://api.<domain>
```

ghcr 私有镜像时:`kubectl -n better-agent create secret docker-registry ghcr-pull --docker-server=ghcr.io --docker-username=<u> --docker-password=<PAT>` 并在各 Deployment 加 `imagePullSecrets`(把 GitHub Packages 设为 public 可跳过)

## 四、日常发布

merge 到 main 即自动:构建三镜像(tag=sha)→ 解密 apply secrets → **migrate Job 先行,失败即中止** → 滚动更新 → rollout status 验证。

- 回滚:Actions 里对旧 commit `workflow_dispatch`,或 `kubectl -n better-agent rollout undo deploy/server`
- 看日志:`kubectl -n better-agent logs deploy/server -f`
- 手动迁移:`kubectl -n better-agent create job --from=cronjob/... ` 不适用 —— 直接重跑 workflow 的 migrate 步骤,或 `kubectl -n better-agent delete job migrate && kubectl apply -f deploy/k8s/base/migrate-job.yaml`

## 五、备份与恢复

- 每日 03:20 `pg_dump | gzip` → R2 `backups/` 前缀(CronJob `pg-backup`);在 R2 控制台给该前缀设 30 天生命周期。
- 恢复演练(务必在上线后做一次):
  ```bash
  aws s3 cp s3://$S3_BUCKET/backups/<file> - --endpoint-url $S3_ENDPOINT \
    | gunzip | kubectl -n better-agent exec -i postgres-0 -- psql -U better_agent -d better_agent
  ```

## 六、首跑验证清单

1. `kubectl -n better-agent get pods` 全 Running;
2. `curl https://api.<domain>/rpc/healthCheck` 返回 OK;
3. web/admin 页面可开、能登录(注意 WEB_URL/ADMIN_URL/CORS_ORIGIN 与真实域名一致);
4. 上传一张聊天图片(验证 R2 S3 通路);
5. 手动触发一次 `pg-backup`(`kubectl -n better-agent create job --from=cronjob/pg-backup backup-test`)确认 R2 里出现文件;
6. 发一条长回复中途刷新页面 —— k3s 上无 waitUntil 30s 限制,回合应完整续传。

## 已知边界
- 2 节点无 HA 控制面:node1 宕机 = 集群不可变更(node2 上的副本仍在服务);
- postgres 单副本钉 node1,node1 磁盘故障靠 R2 备份恢复(RPO = 最多 24h,要更小就加密频率);
- authz(邀请门控)暂留 Workers,由 `AUTHZ_URL` 跨网调用;留空即关闭门控。
