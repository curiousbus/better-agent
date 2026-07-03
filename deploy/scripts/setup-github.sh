#!/usr/bin/env bash
# 用 gh CLI 配置部署所需的 GitHub Secrets/Variables(本机仓库内执行,需 gh auth)。
# 用法:./deploy/scripts/setup-github.sh <age.key路径> <kubeconfig路径> <https://api.域名>
set -euo pipefail
cd "$(dirname "$0")/../.."

KEY_FILE="${1:?usage: setup-github.sh <age.key> <kubeconfig> <https://api.domain>}"
KUBECONFIG_FILE="${2:?missing kubeconfig path}"
API_URL="${3:?missing PROD_API_URL}"

command -v gh >/dev/null || { echo "缺 gh CLI"; exit 1; }

if grep -q "127.0.0.1" "$KUBECONFIG_FILE"; then
  echo "!! kubeconfig 里的 server 还是 127.0.0.1 —— 先改成 https://<node1公网IP>:6443"
  exit 1
fi

gh secret set SOPS_AGE_KEY < "$KEY_FILE"
gh secret set PROD_KUBECONFIG < "$KUBECONFIG_FILE"
gh variable set PROD_API_URL --body "$API_URL"

echo "==> GitHub 配置完成:SOPS_AGE_KEY / PROD_KUBECONFIG / PROD_API_URL"
