# k3s 生产上线操作清单

> 配套文档:部署设计 `docs/superpowers/specs/2026-07-03-k3s-prod-deploy-design.md`,完整 runbook `deploy/README.md`。
> 流向:dev push → Cloudflare Workers 测试环境(不变);**main push → k3s prod(自动)**。
> 下列步骤按顺序执行;大多数是一条命令。标注 **【只能人做】** 的是无法脚本化的部分。

## 操作步骤

### 1. 初始化 node1(k3s 控制面 + cert-manager)约 3 分钟

```bash
scp deploy/scripts/bootstrap-node1.sh node1:
ssh node1 ./bootstrap-node1.sh
```

结束时会打印:**node2 加入用的 token**、**node1 的 hostname**(第 4 步要用)。

### 2. node2 加入集群 约 1 分钟

```bash
scp deploy/scripts/bootstrap-node2.sh node2:
ssh node2 ./bootstrap-node2.sh https://<node1-ip>:6443 <token>
# 在 node1 上确认:k3s kubectl get nodes 两节点 Ready
```

### 3. DNS 三条 A 记录 【只能人做】约 2 分钟

在域名 DNS 面板添加,指向服务器 IP:

- `api.<域名>` → 服务器 IP
- `app.<域名>` → 服务器 IP
- `admin.<域名>` → 服务器 IP

### 4. 替换 manifests 占位符 约 1 分钟

```bash
./deploy/scripts/configure.sh <github-owner> <域名> <node1主机名> <acme邮箱>
git diff deploy/     # 检查后提交
```

### 5. 准备各平台凭证 【只能人做】约 5 分钟

- Cloudflare 面板 → R2 → 为附件桶创建 **S3 API Token**(记下 access key id + secret + endpoint);
- 确认 Resend API key;
- (可选)Google OAuth client id/secret。

### 6. 填写并加密 secrets 约 5 分钟

```bash
# 依赖:brew install sops age
./deploy/scripts/setup-secrets.sh
# 脚本会:生成 age 密钥 → 打开编辑器让你填入第 5 步的值 → 原地 sops 加密
git add deploy/secrets/prod.secrets.yaml deploy/secrets/.sops.yaml && git commit
```

> ⚠️ **age 私钥务必备份**(默认在 `~/.config/better-agent/prod-age.key`)——
> 丢失后 git 里的密文永远无法解密。

### 7. 配置 GitHub Secrets/Variables 约 2 分钟

```bash
# 先从 node1 拷 kubeconfig 到本机,并把其中 server 地址改成公网 IP:
#   scp node1:/etc/rancher/k3s/k3s.yaml ./k3s.yaml
#   把 https://127.0.0.1:6443 改成 https://<node1公网IP>:6443
./deploy/scripts/setup-github.sh ~/.config/better-agent/prod-age.key ./k3s.yaml https://api.<域名>
```

### 8. merge 到 main → 自动上线

CI 自动执行:构建三镜像(tag=commit sha)→ 解密 apply secrets → **数据库迁移 Job(失败即中止)** → 滚动更新 → rollout 验证。

上线后按 `deploy/README.md` 第六节做首跑验证(六步:pods 全 Running、`curl https://api.<域名>/` 返回 OK、web/admin 可登录、上传图片验证 R2、手动触发一次备份、长回复中途刷新验证续传)。

## 真正无法自动化的只有三样

1. **第 3 步** DNS 记录(在你的 DNS 面板操作);
2. **第 5 步** 各平台凭证的控制台创建(R2 S3 token、Resend 等);
3. **第 6 步** 在编辑器里敲入真实密钥值。

## 可选的进一步自动化(需要时再做)

- **DNS 自动化**:域名 DNS 若托管在 Cloudflare,可用 CF API(DNS 编辑权限 token)脚本建三条记录;
- **ghcr 私有镜像拉取凭证**:镜像保持私有时需要 pull secret(可并入 bootstrap 脚本,需 GitHub PAT);最简替代是把三个 package 设为 public;
- **R2 S3 token 创建**:CF API 可做,但需要更高权限 token,不建议。

## 已知边界(设计如此)

- 2 节点无 HA 控制面:node1 宕机 = 集群不可变更(node2 上的副本仍在服务);
- Postgres 单副本钉在 node1,磁盘故障靠每日备份恢复(RPO 最多 24 小时,不够就加密备份频率);
- authz(邀请门控)暂留 Workers,通过 `AUTHZ_URL` 跨网调用;secrets 里留空即关闭门控。
