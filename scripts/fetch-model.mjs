#!/usr/bin/env node
// 下载默认姿态模型：MoveNet SinglePose Lightning (ONNX)。
// 输入 [1,192,192,3] int32，输出 [1,1,17,3] float —— 见 docs/model-spec.md。
// 默认走 huggingface 国内镜像，失败再回退官方域名。
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "public/models/movenet-singlepose-lightning.onnx");
const expectedBytes = 9413268;
const expectedSha256 = "1ad4f8d6c2f776a9967db3993c9ca740bc350104f9d37c151dc183fc29a464ad";
const sources = [
  "https://hf-mirror.com/Xenova/movenet-singlepose-lightning/resolve/main/onnx/model.onnx",
  "https://huggingface.co/Xenova/movenet-singlepose-lightning/resolve/main/onnx/model.onnx",
];

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function isComplete(path) {
  try {
    const info = await stat(path);
    if (info.size !== expectedBytes) return false;
    return (await sha256(path)) === expectedSha256;
  } catch {
    return false;
  }
}

if (await isComplete(target)) {
  console.log(`模型已就绪：${target}`);
  process.exit(0);
}

await mkdir(dirname(target), { recursive: true });

for (const url of sources) {
  try {
    console.log(`下载 ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
    if (!(await isComplete(target))) {
      const info = await stat(target).catch(() => null);
      throw new Error(
        `文件校验失败（大小 ${info?.size ?? 0} 字节，期望 ${expectedBytes} 字节），可能下载被截断`,
      );
    }
    console.log(`完成：${target} (${(expectedBytes / 1024 / 1024).toFixed(2)} MiB)`);
    process.exit(0);
  } catch (error) {
    console.warn(`失败：${error instanceof Error ? error.message : String(error)}`);
    await rm(target, { force: true });
  }
}

console.error(
  [
    "无法下载默认模型。手动放置文件即可：",
    `  目标路径：${target}`,
    `  期望大小：${expectedBytes} 字节`,
    `  期望 sha256：${expectedSha256}`,
  ].join("\n"),
);
process.exit(1);
