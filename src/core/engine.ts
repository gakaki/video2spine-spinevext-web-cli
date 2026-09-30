/**
 * Rust 内核的 TypeScript 门面。
 *
 * `wasm-pack` 生成的声明里复杂结构都是 `any`，这一层负责把它们收敛成
 * `src/core/types.ts` 里强类型的接口，业务代码永远不直接碰 `any`。
 * 内核本身由 `bash scripts/build-wasm.sh` 生成到 `src/wasm/pkg`。
 */

import init, {
  buildAnimation,
  buildAtlas,
  buildSpineJson,
  decodePoses,
  decodeRegression,
  keypointNames,
  packFrames,
  posesToBones,
  preprocess,
  preprocessLetterbox,
  letterboxTransformFor,
  smoothAngleSeries,
  smoothPoses,
  spineVersion,
  transformFor,
  version,
} from "@/wasm/pkg/spinevext_core.js";
import type { InitInput } from "@/wasm/pkg/spinevext_core.js";

import type {
  AnimConfig,
  AnimationData,
  BoneFrame,
  DecodeConfig,
  ExportConfig,
  ImageTransform,
  LetterboxResult,
  PackConfig,
  PackLayout,
  Pose2D,
  RigConfig,
  SmoothConfig,
} from "./types";

export interface Engine {
  /** 内核版本号，用于界面展示与缓存失效。 */
  readonly version: string;
  /** 导出 JSON 里 `skeleton.spine` 写的格式版本号（锁定在 Rust 那一份）。 */
  readonly spineVersion: string;
  readonly keypointNames: readonly string[];
  /** 「cover」缩放 + 居中裁剪的坐标变换。 */
  transformFor(
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
  ): ImageTransform;
  /** RGBA 图 → 归一化 NCHW `Float32Array`。 */
  preprocess(
    rgba: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
    mean: readonly number[],
    scale: number,
    flipX: boolean,
  ): Float32Array;
  /** letterbox 预处理：RGBA → `[1,H,W,3]` 整型 RGB + 坐标变换。 */
  preprocessLetterbox(
    rgba: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
    flipX: boolean,
  ): LetterboxResult;
  /** PoseNet（heatmap + offset）解码。 */
  decodePoses(
    heatmaps: Float32Array,
    offsets: Float32Array,
    displacementsFwd: Float32Array,
    displacementsBwd: Float32Array,
    heatmapWidth: number,
    heatmapHeight: number,
    numParts: number,
    config: DecodeConfig,
  ): Pose2D[];
  /** 直接回归型模型（MoveNet）解码。 */
  decodeRegression(
    values: Float32Array,
    numParts: number,
    modelWidth: number,
    modelHeight: number,
    transform: ImageTransform,
  ): Pose2D;
  smoothPoses(frames: Pose2D[][], config: SmoothConfig): Pose2D[][];
  smoothAngleSeries(values: Float32Array, bufferSize: number): Float32Array;
  posesToBones(frames: Pose2D[][], config: RigConfig, imageHeight: number): BoneFrame[];
  buildAnimation(
    bones: BoneFrame[],
    frames: Pose2D[][],
    config: AnimConfig,
    rigConfig: RigConfig,
    imageHeight: number,
  ): AnimationData;
  buildSpineJson(animation: AnimationData, config: ExportConfig): string;
  packFrames(
    frameWidth: number,
    frameHeight: number,
    count: number,
    config: PackConfig,
  ): PackLayout;
  buildAtlas(layout: PackLayout, imageName: string, filter: string, repeat: string): string;
}

let enginePromise: Promise<Engine> | null = null;

export interface EngineInitOptions {
  /**
   * 覆盖 WASM 的加载来源。
   *
   * 浏览器里不需要传（默认按 `import.meta.url` 找同目录的 `.wasm`）；
   * Node（Vitest）里需要传入文件字节，因为没有可用的 `file://` fetch。
   */
  wasm?: InitInput;
}

/**
 * 加载并初始化 WASM 内核。重复调用只会初始化一次。
 */
export function loadEngine(options: EngineInitOptions = {}): Promise<Engine> {
  enginePromise ??= init(options.wasm ? { module_or_path: options.wasm } : undefined).then(() =>
    createEngine(),
  );
  return enginePromise;
}

function createEngine(): Engine {
  const names = keypointNames();
  return {
    version: version(),
    spineVersion: spineVersion(),
    keypointNames: names,
    transformFor: (srcWidth, srcHeight, dstWidth, dstHeight) =>
      transformFor(srcWidth, srcHeight, dstWidth, dstHeight) as ImageTransform,
    preprocess: (rgba, srcWidth, srcHeight, dstWidth, dstHeight, mean, scale, flipX) =>
      preprocess(
        rgba,
        srcWidth,
        srcHeight,
        dstWidth,
        dstHeight,
        Float32Array.from(mean),
        scale,
        flipX,
      ),
    preprocessLetterbox: (rgba, srcWidth, srcHeight, dstWidth, dstHeight, flipX) => ({
      data: preprocessLetterbox(rgba, srcWidth, srcHeight, dstWidth, dstHeight, flipX),
      transform: letterboxTransformFor(srcWidth, srcHeight, dstWidth, dstHeight) as ImageTransform,
    }),
    decodePoses: (
      heatmaps,
      offsets,
      displacementsFwd,
      displacementsBwd,
      heatmapWidth,
      heatmapHeight,
      numParts,
      config,
    ) =>
      decodePoses(
        heatmaps,
        offsets,
        displacementsFwd,
        displacementsBwd,
        heatmapWidth,
        heatmapHeight,
        numParts,
        config,
      ) as Pose2D[],
    decodeRegression: (values, numParts, modelWidth, modelHeight, transform) =>
      decodeRegression(values, numParts, modelWidth, modelHeight, transform) as Pose2D,
    smoothPoses: (frames, config) => smoothPoses(frames, config) as Pose2D[][],
    smoothAngleSeries: (values, bufferSize) => smoothAngleSeries(values, bufferSize),
    posesToBones: (frames, config, imageHeight) =>
      posesToBones(frames, config, imageHeight) as BoneFrame[],
    buildAnimation: (bones, frames, config, rigConfig, imageHeight) =>
      buildAnimation(bones, frames, config, rigConfig, imageHeight) as AnimationData,
    buildSpineJson: (animation, config) => buildSpineJson(animation, config),
    packFrames: (frameWidth, frameHeight, count, config) =>
      packFrames(frameWidth, frameHeight, count, config) as PackLayout,
    buildAtlas: (layout, imageName, filter, repeat) =>
      buildAtlas(layout, imageName, filter, repeat),
  };
}
