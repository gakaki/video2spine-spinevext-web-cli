import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

/**
 * 允许任何人访问所需的响应头。
 *
 * * `Access-Control-Allow-Origin: *` —— 任何来源都能抓取模型 / wasm / 图集
 * * `Cross-Origin-Resource-Policy: cross-origin` —— 允许被别的站点嵌入引用
 *
 * 注意：这里**故意不加** COOP/COEP。加了虽然能开 ONNX Runtime 的多线程，
 * 但会把跨域资源全部挡掉，代价远大于收益——我们本来就把线程数设成 1。
 */
const permissiveHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig({
  fmt: {},
  lint: {
    categories: {
      correctness: "error",
      suspicious: "warn",
    },
    ignorePatterns: ["dist", "src/wasm/pkg", "node_modules"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
  // 迁移时生成的 Vitest v4 兼容项（clearMocks: false）已经去掉：
  // 本仓库的用例都不依赖 mock 调用历史，去掉后全部通过。
  // Rust 侧的构建与验证都交给 Vite+ 的任务系统统一调度（带缓存与依赖）。
  // 注意：同名脚本不能再写进 package.json，否则 Vite+ 会报冲突。
  run: {
    tasks: {
      /** 把 Rust 核心编译成 WASM（浏览器侧绑定）。 */
      wasm: {
        command: "bash scripts/build-wasm.sh",
        cache: {
          input: ["crates/spinevext-core/**", "scripts/build-wasm.sh"],
          output: ["src/wasm/pkg/**"],
        },
      },
      /** 用 napi-rs 把同一份 Rust 核心编译成 Node 原生插件。 */
      native: {
        command: "bash scripts/build-native.sh",
        cache: {
          input: ["crates/**", "scripts/build-native.sh"],
          output: ["native/**"],
        },
      },
      /** 下载默认姿态模型（含校验）。 */
      model: {
        command: "node scripts/fetch-model.mjs",
        cache: { output: ["public/models/**"] },
      },
      /** Rust 工作区测试（32 个用例）。 */
      "rust:test": "cargo test --workspace",
      /** 一次性准备：模型 + 两种 Rust 绑定。 */
      setup: {
        command: ["vp run model", "vp run wasm", "vp run native"],
      },
      /** 交付前的完整校验。 */
      verify: {
        command: ["vp check", "vp run rust:test", "vp test run", "vp build"],
      },
    },
  },
  plugins: lazyPlugins(() => [tailwindcss(), react()]),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // onnxruntime-web 内部用 `new URL('...wasm', import.meta.url)` 找运行时。
  // 一旦被 Vite 预打包（optimizeDeps），那个相对路径就落到 .vite/deps 下，
  // 服务器会返回 index.html，于是报 "expected magic word 00 61 73 6d"。
  // 排除预打包后，dev 直接按源码路径提供，build 则把 .wasm 作为资源产物一起发。
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  server: {
    host: true,
    port: 5183,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    headers: permissiveHeaders,
  },
  preview: {
    host: true,
    port: 4183,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    headers: permissiveHeaders,
  },
});
