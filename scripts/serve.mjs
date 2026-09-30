#!/usr/bin/env node
/**
 * 生产构建的静态服务器。
 *
 * 目标：任何人、任何来源都能访问，不被 CORS 拦住。
 * * `.wasm` 用正确的 `application/wasm` MIME（否则浏览器拒绝流式编译）
 * * 一切响应都带宽松 CORS 头
 * * 默认监听 0.0.0.0，局域网内可直接用本机 IP 打开
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT ?? 4183);
const host = process.env.HOST ?? "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".onnx": "application/octet-stream",
  ".atlas": "text/plain; charset=utf-8",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

async function resolveFile(urlPath) {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(root, safe), join(root, safe, "index.html"), join(root, "index.html")];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // 继续试下一个候选
    }
  }
  return null;
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = await resolveFile(path);
  if (!file) {
    response.writeHead(404, { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" });
    response.end("404");
    return;
  }

  const info = await stat(file);
  response.writeHead(200, {
    ...corsHeaders,
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`SpineVExt 静态服务已启动：http://localhost:${port}/`);
  console.log(`局域网内其他设备可直接访问：http://<本机IP>:${port}/`);
});
