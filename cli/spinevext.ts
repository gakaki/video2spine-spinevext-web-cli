#!/usr/bin/env node
/**
 * SpineVExt Node CLI：视频 → Spine 骨骼动画工程。
 *
 * 浏览器版把重活交给 wasm + onnxruntime-web；这个 CLI 复用**同一份 Rust 核心**
 * （`crates/spinevext-node`，napi-rs 绑定），只是换了取帧与推理运行时：
 *
 *   ffmpeg 取帧 → onnxruntime-node 前向 → napi 解码/骨骼/动画 → JSON + Atlas + PNG
 *
 * 用法：
 *   node cli/spinevext.ts <input.mp4> [--out ./out] [--fps 15] [--max-width 960]
 *
 * Node 22+ 可以直接执行 TypeScript（类型擦除），所以这里不需要额外的编译步骤。
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { zipSync } from "fflate";
import * as ort from "onnxruntime-node";

import * as core from "../native/index.js";
import { inferModelSpec, type TensorMeta } from "../src/core/model-spec.ts";
import { encodePng } from "./png.ts";

const DEFAULT_MODEL = "public/models/movenet-singlepose-lightning.onnx";

interface Options {
  input: string;
  out: string;
  name: string;
  fps: number;
  maxWidth: number;
  model: string;
  confidence: number;
  smooth: number;
  atlasWidth: number;
  imageScale: number;
  maxPoses: number;
}

function usage(): never {
  console.log(`用法：node cli/spinevext.ts <input.mp4> [选项]

选项：
  --out <dir>           输出目录（默认 ./out）
  --name <name>         工程名（默认取输入文件名）
  --fps <n>             采样帧率（默认 15）
  --max-width <n>       取帧宽度上限（默认 960）
  --model <path>        ONNX 模型路径（默认 ${DEFAULT_MODEL}）
  --confidence <0-1>    置信度阈值（默认 0.3）
  --max-poses <n>       最多检测人数（默认 1）
  --smooth <n>          平滑窗口帧数（默认 5，1 = 关闭）
  --atlas-width <n>     图集最大宽度（默认 4096）
  --image-scale <n>     图集缩放（默认 1）`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) break;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const separator = body.indexOf("=");
      const key = separator === -1 ? body : body.slice(0, separator);
      const inline = separator === -1 ? undefined : body.slice(separator + 1);
      if (key.length === 0) usage();
      const value = inline ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`选项 ${token} 缺少取值`);
        usage();
      }
      if (inline === undefined) index += 1;
      flags.set(key, value);
    } else {
      positional.push(token);
    }
  }
  const input = positional[0];
  if (!input) usage();
  if (flags.has("help")) usage();

  const number = (key: string, fallback: number) => {
    const raw = flags.get(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      console.error(`选项 --${key} 需要是数字，收到 ${raw}`);
      process.exit(1);
    }
    return value;
  };

  const name = flags.get("name") ?? basename(input, extname(input));
  return {
    input,
    out: flags.get("out") ?? "out",
    name,
    fps: number("fps", 15),
    maxWidth: number("max-width", 960),
    model: flags.get("model") ?? DEFAULT_MODEL,
    confidence: number("confidence", 0.3),
    smooth: number("smooth", 5),
    atlasWidth: number("atlas-width", 4096),
    imageScale: number("image-scale", 1),
    maxPoses: number("max-poses", 1),
  };
}

interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

function probeVideo(path: string): VideoInfo {
  const raw = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(raw) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.find((item) => item.codec_type === "video");
  if (!stream?.width || !stream.height) {
    throw new Error("ffprobe 没能读到视频尺寸，请确认输入是有效的视频文件");
  }
  return {
    width: stream.width,
    height: stream.height,
    duration: Number(parsed.format?.duration ?? 0),
  };
}

/** 把整段视频解成 RGBA 帧流，逐帧回调。 */
async function decodeFrames(
  input: string,
  width: number,
  height: number,
  fps: number,
  onFrame: (rgba: Uint8Array, index: number) => Promise<void> | void,
): Promise<number> {
  const args = [
    "-v",
    "error",
    "-i",
    input,
    "-vf",
    `fps=${fps},scale=${width}:${height}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ];
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
  const frameBytes = width * height * 4;
  let pending = Buffer.alloc(0);
  let index = 0;

  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    while (pending.length >= frameBytes) {
      const frame = pending.subarray(0, frameBytes);
      pending = pending.subarray(frameBytes);
      await onFrame(new Uint8Array(frame), index);
      index += 1;
    }
  }

  const exitCode: number = await new Promise((resolveExit) =>
    child.on("close", (code) => resolveExit(code ?? 0)),
  );
  if (exitCode !== 0) throw new Error(`ffmpeg 退出码 ${exitCode}`);
  return index;
}

function metadataRecord(
  entries: ReadonlyArray<{ name: string; type: string; shape: number[] }>,
): Record<string, TensorMeta> {
  return Object.fromEntries(
    entries.map((entry) => [entry.name, { dims: entry.shape, type: entry.type }]),
  );
}

/** 取一个一定存在的模型输出，缺了就直接报错，避免到处写 `!`。 */
function requireOutput(
  results: ort.InferenceSession.OnnxValueMapType,
  name: string | undefined,
): ort.Tensor {
  if (!name) throw new Error("模型输出名为空");
  const value = results[name];
  if (!value) throw new Error(`模型没有输出 ${name}`);
  return value;
}

/** 断言输出张量是 float32，避免把非 Float32Array 当数值数组用。 */
function asFloat32(tensor: ort.Tensor): Float32Array {
  if (!(tensor.data instanceof Float32Array)) {
    throw new Error("模型输出张量不是 float32");
  }
  return tensor.data;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const info = probeVideo(options.input);
  const width = Math.min(info.width, options.maxWidth);
  const height = Math.max(2, Math.round((info.height * width) / info.width / 2) * 2);
  const frameEstimate = Math.max(1, Math.floor(info.duration * options.fps));

  console.log(
    `输入 ${options.input}：${info.width}×${info.height}，${info.duration.toFixed(2)}s\n` +
      `取帧 ${width}×${height} @ ${options.fps}fps，预计 ${frameEstimate} 帧`,
  );

  const session = await ort.InferenceSession.create(resolve(options.model));
  const spec = inferModelSpec(
    metadataRecord(session.inputMetadata as never),
    metadataRecord(session.outputMetadata as never),
  );
  console.log(`模型：${spec.kind} ${spec.inputWidth}×${spec.inputHeight}（${spec.inputType}）`);

  const decodeConfig = {
    confidenceThreshold: options.confidence,
    nmsRadius: 20,
    maxPoses: options.maxPoses,
    stride: spec.poseNet?.stride ?? 16,
    multiPose: options.maxPoses > 1,
    heatmapLayout: spec.poseNet?.heatmapLayout ?? "nhwc",
    offsetLayout: spec.poseNet?.offsetLayout ?? "nhwc",
    offsetOrder: "yx",
    displacementLayout: "nhwc",
    offsetInPixels: true,
  };

  const poses: Array<Array<ReturnType<typeof core.decodeRegression>>> = [];
  const started = Date.now();

  const frameCount = await decodeFrames(
    options.input,
    width,
    height,
    options.fps,
    async (rgba, index) => {
      if (spec.kind === "movenet") {
        const data = core.preprocessLetterbox(
          rgba,
          width,
          height,
          spec.inputWidth,
          spec.inputHeight,
          false,
        );
        const tensor = new ort.Tensor("int32", data, [1, spec.inputHeight, spec.inputWidth, 3]);
        const results = await session.run({ [spec.inputName]: tensor });
        const output = requireOutput(results, session.outputNames[0]);
        const transform = core.letterboxTransformFor(
          width,
          height,
          spec.inputWidth,
          spec.inputHeight,
        );
        poses.push([
          core.decodeRegression(
            asFloat32(output),
            17,
            spec.inputWidth,
            spec.inputHeight,
            transform,
          ),
        ]);
      } else {
        const heads = spec.poseNet!;
        const data = core.preprocess(
          rgba,
          width,
          height,
          spec.inputWidth,
          spec.inputHeight,
          [0.482941176, 0.454509803, 0.404156862],
          255,
          false,
        );
        const tensor = new ort.Tensor("float32", data, [1, 3, spec.inputHeight, spec.inputWidth]);
        const results = await session.run({ [spec.inputName]: tensor });
        const heatmap = requireOutput(results, heads.heatmapName);
        const dims: readonly number[] = heatmap.dims;
        const heatmapWidth = (heads.heatmapLayout === "nchw" ? dims[3] : dims[2]) ?? 0;
        const heatmapHeight = (heads.heatmapLayout === "nchw" ? dims[2] : dims[1]) ?? 0;
        const forward = heads.forwardName ? results[heads.forwardName] : undefined;
        const backward = heads.backwardName ? results[heads.backwardName] : undefined;
        poses.push(
          core.decodePoses(
            asFloat32(heatmap),
            asFloat32(requireOutput(results, heads.offsetName)),
            forward ? asFloat32(forward) : new Float32Array(0),
            backward ? asFloat32(backward) : new Float32Array(0),
            heatmapWidth,
            heatmapHeight,
            17,
            decodeConfig,
            core.transformFor(width, height, spec.inputWidth, spec.inputHeight),
          ),
        );
      }

      if (index > 0 && index % 25 === 0) {
        process.stdout.write(`  已处理 ${index} 帧\r`);
      }
    },
  );

  process.stdout.write("\n");
  if (frameCount === 0) throw new Error("没有取到任何帧");
  console.log(`推理完成：${frameCount} 帧，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const smoothed = core.smoothPoses(poses, {
    bufferSize: options.smooth,
    confidenceThreshold: options.confidence,
  });
  const rigConfig = {
    minConfidentKeypoints: 6,
    confidenceThreshold: Math.min(options.confidence, 0.25),
  };
  const bones = core.posesToBones(smoothed, rigConfig, height);
  const animation = core.buildAnimation(
    bones,
    smoothed,
    { fps: options.fps, baseFrame: -1, propagate: true },
    rigConfig,
    height,
  );

  const layout = core.packFrames(width, height, animation.frames.length, {
    maxWidth: options.atlasWidth,
    padding: 2,
    scale: options.imageScale,
  });
  console.log(
    `图集：${layout.atlasWidth}×${layout.atlasHeight}，${layout.regions.length} 个 region`,
  );

  // 再解一次帧，把画面按布局画进图集缓冲
  const atlas = new Uint8Array(layout.atlasWidth * layout.atlasHeight * 4);
  const regionByIndex = new Map(layout.regions.map((region) => [region.index, region]));
  await decodeFrames(options.input, width, height, options.fps, (rgba, index) => {
    const region = regionByIndex.get(index);
    if (!region) return;
    for (let row = 0; row < region.height; row += 1) {
      const sourceY = Math.min(height - 1, Math.floor((row * height) / region.height));
      for (let column = 0; column < region.width; column += 1) {
        const sourceX = Math.min(width - 1, Math.floor((column * width) / region.width));
        const sourceOffset = (sourceY * width + sourceX) * 4;
        const targetOffset = ((region.y + row) * layout.atlasWidth + region.x + column) * 4;
        atlas[targetOffset] = rgba[sourceOffset]!;
        atlas[targetOffset + 1] = rgba[sourceOffset + 1]!;
        atlas[targetOffset + 2] = rgba[sourceOffset + 2]!;
        atlas[targetOffset + 3] = rgba[sourceOffset + 3]!;
      }
    }
  });

  const exportConfig = {
    name: options.name,
    animationName: "video",
    frameWidth: width,
    frameHeight: height,
    frameCount: animation.frames.length,
    fps: options.fps,
    regionPrefix: "frame_",
    imageName: `${options.name}.png`,
    imageScale: options.imageScale,
  };

  const json = core.buildSpineJson(animation, exportConfig);
  const atlasText = core.buildAtlas(layout, exportConfig.imageName, "Linear,Linear", "none");
  const png = encodePng(layout.atlasWidth, layout.atlasHeight, atlas);

  mkdirSync(options.out, { recursive: true });
  const zip = zipSync(
    {
      [`${options.name}.json`]: new TextEncoder().encode(json),
      [`${options.name}.atlas`]: new TextEncoder().encode(atlasText),
      [exportConfig.imageName]: png,
    },
    { level: 6 },
  );
  const zipPath = resolve(options.out, `${options.name}.zip`);
  writeFileSync(zipPath, zip);

  // 同时散装一份，方便直接拖进 Spine
  writeFileSync(resolve(options.out, `${options.name}.json`), json);
  writeFileSync(resolve(options.out, `${options.name}.atlas`), atlasText);
  writeFileSync(resolve(options.out, exportConfig.imageName), png);

  const validFrames = animation.validity.filter(Boolean).length;
  console.log(
    `\n导出完成：${zipPath}\n` +
      `  ${options.name}.json  Spine 4.3 骨架 + 动画\n` +
      `  ${options.name}.atlas 图集描述\n` +
      `  ${exportConfig.imageName}  ${layout.atlasWidth}×${layout.atlasHeight}\n` +
      `  有效骨骼帧 ${validFrames}/${animation.frames.length}，基准帧 #${animation.baseFrame}`,
  );
}

await main();
