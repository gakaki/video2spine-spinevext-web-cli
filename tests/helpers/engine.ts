/**
 * Vitest 里加载 Rust/WASM 内核的公共入口。
 *
 * `wasm-pack --target web` 的默认加载路径是 fetch `import.meta.url` 旁边的
 * `.wasm`，Node 里没有 file:// 的 fetch，所以测试直接把文件字节喂给 init。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEngine, type Engine } from "@/core/engine";

export const WASM_PATH = resolve("src/wasm/pkg/spinevext_core_bg.wasm");

let cached: Engine | null = null;

export async function testEngine(): Promise<Engine> {
  cached ??= await loadEngine({ wasm: readFileSync(WASM_PATH) });
  return cached;
}
