#!/usr/bin/env bash
# node2(agent)一键加入集群。
# 用法:root 身份在 node2 上执行 ./bootstrap-node2.sh https://<node1-ip>:6443 <token>
set -euo pipefail

K3S_URL="${1:?usage: bootstrap-node2.sh https://<node1-ip>:6443 <token>}"
K3S_TOKEN="${2:?usage: bootstrap-node2.sh https://<node1-ip>:6443 <token>}"

if command -v k3s >/dev/null 2>&1; then
  echo "==> k3s already installed, skipping"
  exit 0
fi
echo "==> joining ${K3S_URL}"
curl -sfL https://get.k3s.io | K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" sh -
echo "DONE — 在 node1 上用 'k3s kubectl get nodes' 确认两节点 Ready"
