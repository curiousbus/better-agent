#!/usr/bin/env bash
# node1(control-plane)一键初始化:k3s server + cert-manager。
# 用法:root 身份在 node1 上执行 ./bootstrap-node1.sh
set -euo pipefail

CERT_MANAGER_VERSION="v1.16.3"

if ! command -v k3s >/dev/null 2>&1; then
  echo "==> installing k3s (server)"
  curl -sfL https://get.k3s.io | sh -
else
  echo "==> k3s already installed, skipping"
fi

echo "==> waiting for node Ready"
k3s kubectl wait --for=condition=Ready node --all --timeout=180s

echo "==> installing cert-manager ${CERT_MANAGER_VERSION}"
k3s kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
k3s kubectl -n cert-manager wait --for=condition=Available deploy --all --timeout=300s

echo
echo "================  DONE  ================"
echo "node2 加入用的 token:"
cat /var/lib/rancher/k3s/server/node-token
echo
echo "本机 hostname(configure.sh 的 NODE1_HOSTNAME 参数):"
hostname
echo
echo "kubeconfig:/etc/rancher/k3s/k3s.yaml(交给 setup-github.sh 前记得把 server 改成公网 IP)"
