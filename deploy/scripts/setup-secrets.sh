#!/usr/bin/env bash
# 生成 age 密钥 + 引导填写并加密 prod secrets(本机仓库内执行)。
# 依赖:brew install sops age(或对应包管理器)
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v sops >/dev/null || { echo "缺 sops:brew install sops"; exit 1; }
command -v age-keygen >/dev/null || { echo "缺 age:brew install age"; exit 1; }

KEY_FILE="${AGE_KEY_FILE:-$HOME/.config/better-agent/prod-age.key}"
mkdir -p "$(dirname "$KEY_FILE")"

if [ ! -f "$KEY_FILE" ]; then
  age-keygen -o "$KEY_FILE"
  echo "==> 新 age 密钥已生成:$KEY_FILE(务必备份!丢失 = 密文全废)"
else
  echo "==> 复用已有密钥:$KEY_FILE"
fi
PUB=$(grep "public key" "$KEY_FILE" | awk '{print $NF}')

sed -i.bak "s#age: .*#age: ${PUB}#" deploy/secrets/.sops.yaml && rm -f deploy/secrets/.sops.yaml.bak
echo "==> .sops.yaml 已写入公钥 ${PUB}"

TARGET=deploy/secrets/prod.secrets.yaml
if [ ! -f "$TARGET" ]; then
  cp deploy/secrets/prod.secrets.example.yaml "$TARGET"
  echo "==> 已创建 $TARGET,现在用编辑器填入真实值后回车继续加密"
  "${EDITOR:-vi}" "$TARGET"
fi

if grep -q "^kind: Secret" "$TARGET" && ! grep -q "sops:" "$TARGET"; then
  ( cd deploy/secrets && sops -e -i "$(basename "$TARGET")" )
  echo "==> 已原地加密,可以 git add deploy/secrets/prod.secrets.yaml"
else
  echo "==> 文件似乎已加密,跳过"
fi

echo
echo "下一步:./deploy/scripts/setup-github.sh $KEY_FILE <kubeconfig路径> https://api.<domain>"
