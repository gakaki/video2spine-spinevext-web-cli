#!/usr/bin/env bash
# 构建 Rust 核心为 WASM，产物直接落到 src/wasm/pkg 供 Vite 引入。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/wasm/pkg"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "缺少 wasm-pack：cargo install wasm-pack" >&2
  exit 1
fi

mkdir -p "$OUT"

wasm-pack build "$ROOT/crates/spinevext-core" \
  --target web \
  --release \
  --out-dir "$OUT" \
  --out-name spinevext_core

echo "WASM 产物："
ls -la "$OUT"
