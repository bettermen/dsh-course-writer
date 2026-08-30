#!/bin/bash
# 虾说 — 一键同步到本机 DeepSeek Harness 桌面客户端
#
# 用法：bash scripts/sync-local.sh
#
# 做四件事：
#   1. 构建 host + client
#   2. 打包 tgz
#   3. 安装到 ~/.dsh/profiles/desktop（file: 依赖需手动解压，pnpm 不跟踪 tgz 内容变化）
#   4. 同步预设到 ~/.dsh/.agent-presets/course-writer
#
# 完成后重启 DSH 桌面客户端生效。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="${HOME}/.dsh/profiles/desktop"
PLUGIN_DIR="${DESKTOP}/node_modules/@dsh-external/dsh-course-writer"
cd "$ROOT"

# 版本号从 package.json 自动读取，避免升级后文件名写死导致 cp 失败
PKG_NAME="$(/Users/tangliang/.workbuddy/binaries/node/versions/24.14.0/bin/node -p "require('./package.json').name.replace('@','') .replace('/','-')")"
PKG_VERSION="$(/Users/tangliang/.workbuddy/binaries/node/versions/24.14.0/bin/node -p "require('./package.json').version")"
TGZ_NAME="${PKG_NAME}-${PKG_VERSION}.tgz"
echo "   版本：${PKG_VERSION}（${TGZ_NAME}）"
export PATH="/Users/tangliang/.workbuddy/binaries/node/versions/24.14.0/bin:${PATH}"

echo "→ [1/4] 构建…"
npm run build

echo "→ [2/4] 打包…"
# 清理历史版本 tgz，避免 npm pack 后残留多版本文件
rm -f dsh-external-dsh-course-writer-*.tgz
npm pack > /dev/null

if [ ! -d "$DESKTOP" ]; then
  echo "✗ 未找到本机 DSH desktop profile：$DESKTOP" >&2
  exit 1
fi

echo "→ [3/4] 安装到本机 profile…"
rm -f "${DESKTOP}"/dsh-external-dsh-course-writer-*.tgz "${DESKTOP}"/dsh-course-writer-*.tgz
cp "$TGZ_NAME" "${DESKTOP}/${TGZ_NAME}"
rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
tar -xzf "$TGZ_NAME" -C "$PLUGIN_DIR" --strip-components=1

echo "→ [4/4] 同步预设…"
mkdir -p "${HOME}/.dsh/.agent-presets/course-writer"
cp assets/presets/course-writer/preset.yml "${HOME}/.dsh/.agent-presets/course-writer/preset.yml"
cp assets/presets/course-writer/agent.cordis.yml "${HOME}/.dsh/.agent-presets/course-writer/agent.cordis.yml"

echo ""
echo "✓ 同步完成：$PLUGIN_DIR"
echo "  预设：$(head -1 "${HOME}/.dsh/.agent-presets/course-writer/preset.yml")"
echo "  请重启 DeepSeek Harness 桌面客户端生效。"
