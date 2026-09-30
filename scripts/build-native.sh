#!/usr/bin/env bash
# 用 napi-rs 把同一份 Rust 核心编译成 Node 原生插件，产物放到 native/。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v cargo >/dev/null 2>&1; then
  echo "缺少 cargo：请先安装 Rust 工具链" >&2
  exit 1
fi

pnpm exec napi build \
  --cwd crates/spinevext-node \
  --platform \
  --release \
  --esm \
  --output-dir ../../native

echo "napi 产物："
ls -la "$ROOT/native"
