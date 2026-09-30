/**
 * 神经网络推理层。
 *
 * 原版用 Unity Barracuda 跑 ResNet50 PoseNet；浏览器里换成 ONNX Runtime Web，
 * 但它只负责"把网络算完"，**解码、坐标映射、平滑、骨骼、导出全部在 Rust 里**。
 *
 * 这一层还会自动识别模型家族：
 * * `posenet` —— heatmap + offset 输出（与原版一致的 ResNet50/MobileNet PoseNet）
 * * `movenet` —— `[1,1,17,3]` 直接回归输出（浏览器里更快，作为默认模型）
 */

// 只引入 WASM 后端（`onnxruntime-web/wasm`），避免把 WebGPU 的 28MB 运行时也打进包里。
import * as ort from "onnxruntime-web/wasm";

import type { Engine } from "./engine";
import { inferModelSpec, type ModelSpec } from "./model-spec";
import {
  POSE_NET_NORMALIZATION,
  type DecodeConfig,
  type ImageTransform,
  type LetterboxResult,
  type Pose2D,
} from "./types";

export type { PoseModelKind, PoseNetHeads } from "./model-spec";
export { inferModelSpec } from "./model-spec";

/** 已经加载好的模型：规格 + 运行时会话。 */
export interface PoseModel extends ModelSpec {
  session: ort.InferenceSession;
}

/** 一次预处理的结果：喂给模型的张量 + 坐标回映射参数。 */
export interface PreparedInput {
  tensor: ort.Tensor;
  transform: ImageTransform;
}

let ortConfigured = false;

/**
 * 配置 ONNX Runtime 的 WASM 后端。
 *
 * `numThreads = 1` 是刻意的：多线程 WASM 需要 SharedArrayBuffer，
 * 也就是需要 COOP/COEP 响应头，静态托管时经常拿不到。
 *
 * 这里不设置 `wasmPaths`：`onnxruntime-web/wasm` 的 bundle 版本会相对
 * 自身解析 `.wasm`；配合 `vite.config.ts` 里的
 * `optimizeDeps.exclude: ["onnxruntime-web"]`，dev 与 build 都能正确找到它。
 */
function configureOrt(): void {
  if (ortConfigured) return;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ortConfigured = true;
}

/** 加载 ONNX 姿态模型。 */
export async function loadPoseModel(modelUrl: string): Promise<PoseModel> {
  configureOrt();
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  const spec = inferModelSpec(
    toTensorMeta(session.inputMetadata),
    toTensorMeta(session.outputMetadata),
  );
  return { ...spec, session };
}

/**
 * ONNX Runtime 的元数据字段是 `shape`（web 与 node 都是），
 * 而 `inferModelSpec` 约定用 `dims`，这里统一转换一次。
 */
function toTensorMeta(
  entries: readonly ort.InferenceSession.ValueMetadata[],
): Record<string, { dims: readonly (number | string)[]; type: string }> {
  return Object.fromEntries(
    entries.map((entry) => {
      // ValueMetadata 是联合类型：只有张量才有 shape / type
      if (!entry.isTensor) return [entry.name, { dims: [], type: "unknown" }];
      return [entry.name, { dims: entry.shape ?? [], type: entry.type ?? "float32" }];
    }),
  );
}

/** 按模型家族把一帧 RGBA 预处理成输入张量。 */
export function prepareInput(
  model: PoseModel,
  engine: Engine,
  rgba: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  flipX: boolean,
): PreparedInput {
  if (model.kind === "movenet") {
    const letterbox: LetterboxResult = engine.preprocessLetterbox(
      rgba,
      srcWidth,
      srcHeight,
      model.inputWidth,
      model.inputHeight,
      flipX,
    );
    return {
      tensor: new ort.Tensor("int32", letterbox.data, [1, model.inputHeight, model.inputWidth, 3]),
      transform: letterbox.transform,
    };
  }

  const data = engine.preprocess(
    rgba,
    srcWidth,
    srcHeight,
    model.inputWidth,
    model.inputHeight,
    POSE_NET_NORMALIZATION.mean,
    POSE_NET_NORMALIZATION.scale,
    flipX,
  );
  return {
    tensor: new ort.Tensor("float32", data, [1, 3, model.inputHeight, model.inputWidth]),
    transform: engine.transformFor(srcWidth, srcHeight, model.inputWidth, model.inputHeight),
  };
}

function floatOutput(results: ort.InferenceSession.OnnxValueMapType, name: string): Float32Array {
  const value = results[name];
  if (!value) throw new Error(`模型没有输出 ${name}`);
  return value.data as Float32Array;
}

/** 把模型输出解码成 `Pose2D[]`（解码算法在 Rust 里）。 */
export function decodeOutput(
  model: PoseModel,
  engine: Engine,
  results: ort.InferenceSession.OnnxValueMapType,
  prepared: PreparedInput,
  decode: DecodeConfig,
): Pose2D[] {
  const heads = model.poseNet;
  if (!heads) {
    const values = floatOutput(results, Object.keys(results)[0]!);
    return [
      engine.decodeRegression(
        values,
        engine.keypointNames.length,
        model.inputWidth,
        model.inputHeight,
        prepared.transform,
      ),
    ];
  }

  const heatmap = results[heads.heatmapName]!;
  const offsets = results[heads.offsetName]!;
  const heatmapDims = heatmap.dims as number[];
  const heatmapWidth = heads.heatmapLayout === "nchw" ? heatmapDims[3]! : heatmapDims[2]!;
  const heatmapHeight = heads.heatmapLayout === "nchw" ? heatmapDims[2]! : heatmapDims[1]!;

  const forward = heads.forwardName ? results[heads.forwardName] : undefined;
  const backward = heads.backwardName ? results[heads.backwardName] : undefined;

  return engine.decodePoses(
    heatmap.data as Float32Array,
    offsets.data as Float32Array,
    forward ? (forward.data as Float32Array) : new Float32Array(0),
    backward ? (backward.data as Float32Array) : new Float32Array(0),
    heatmapWidth,
    heatmapHeight,
    engine.keypointNames.length,
    {
      ...decode,
      stride: heads.stride,
      heatmapLayout: heads.heatmapLayout,
      offsetLayout: heads.offsetLayout,
      displacementLayout: heads.displacementLayout,
      multiPose: decode.maxPoses > 1 || decode.multiPose,
      transform: prepared.transform,
    },
  );
}

/** 一步完成「预处理 → 推理 → 解码」，供流水线调用。 */
export async function runPoseModel(
  model: PoseModel,
  engine: Engine,
  rgba: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  flipX: boolean,
  decode: DecodeConfig,
): Promise<Pose2D[]> {
  const prepared = prepareInput(model, engine, rgba, srcWidth, srcHeight, flipX);
  const results = await model.session.run({ [model.inputName]: prepared.tensor });
  return decodeOutput(model, engine, results, prepared, decode);
}
