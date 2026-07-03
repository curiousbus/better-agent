#!/usr/bin/env bash
# 把 manifests/workflow 里的占位符一次性替换成真实值(本机仓库内执行)。
# 用法:./deploy/scripts/configure.sh <github-owner> <domain> <node1-hostname> <acme-email>
# 例:  ./deploy/scripts/configure.sh curiousbus trendf.top node1 ops@trendf.top
set -euo pipefail
cd "$(dirname "$0")/../.."

OWNER="${1:?usage: configure.sh <github-owner> <domain> <node1-hostname> <acme-email>}"
DOMAIN="${2:?missing domain}"
NODE1="${3:?missing node1 hostname}"
EMAIL="${4:?missing acme email}"

FILES=(
  deploy/k8s/base/server.yaml
  deploy/k8s/base/web.yaml
  deploy/k8s/base/admin.yaml
  deploy/k8s/base/migrate-job.yaml
  deploy/k8s/base/ingress.yaml
  deploy/k8s/overlays/prod/kustomization.yaml
  deploy/k8s/overlays/prod/cert-issuer.yaml
)

for f in "${FILES[@]}"; do
  sed -i.bak \
    -e "s#ghcr.io/OWNER#ghcr.io/${OWNER}#g" \
    -e "s#example\.com#${DOMAIN}#g" \
    -e "s#NODE1_HOSTNAME#${NODE1}#g" \
    -e "s#ops@${DOMAIN}#${EMAIL}#g" \
    "$f" && rm -f "$f.bak"
done
# cert-issuer 邮箱(上面 domain 替换后可能已是 ops@<domain>,再强制成指定值)
sed -i.bak "s#email: .*#email: ${EMAIL}#" deploy/k8s/overlays/prod/cert-issuer.yaml && rm -f deploy/k8s/overlays/prod/cert-issuer.yaml.bak

echo "==> 占位符已替换:owner=${OWNER} domain=${DOMAIN} node1=${NODE1} acme=${EMAIL}"
echo "==> 域名将是:api.${DOMAIN} / app.${DOMAIN} / admin.${DOMAIN}"
echo "==> 检查改动:git diff deploy/"
