/**
 * 端到端流水线：逐帧姿态估计 → 时序平滑 → 骨骼 → 动画烘焙。
 *
 * 与原版 `VideoToSpineSkeleManager` 的 `ProcessCurrentFrame` /
 * `GenerateBonesForFrame` / `PropogateList` 一一对应，只是每一步都落在 Rust 里。
 */

import type { Engine } from "./engine";
import { decodeOutput, prepareInput, type PoseModel } from "./inference";
import type {
  AnimConfig,
  AnimationData,
  BoneFrame,
  DecodeConfig,
  Pose2D,
  RigConfig,
  SmoothConfig,
} from "./types";
import type { FrameSource } from "./video";

export interface PipelineOptions {
  decode: DecodeConfig;
  smooth: SmoothConfig;
  rig: RigConfig;
  anim: AnimConfig;
  /** 水平镜像。取帧阶段已经翻转，这里只透传给预处理保持一致。 */
  flipX: boolean;
}

export interface PipelineResult {
  /** 平滑后的逐帧姿态（每帧可能有 0..n 个人）。 */
  poses: Pose2D[][];
  bones: BoneFrame[];
  animation: AnimationData;
  frameWidth: number;
  frameHeight: number;
  fps: number;
}

export interface PipelineProgress {
  phase: "detect" | "rig" | "done";
  current: number;
  total: number;
}

export type ProgressHandler = (progress: PipelineProgress) => void;

/** 中途取消：抛这个错误表示是用户主动停的，界面不要当成失败。 */
export class PipelineCancelled extends Error {
  constructor() {
    super("已被用户取消");
    this.name = "PipelineCancelled";
  }
}

/**
 * 跑完整条流水线。耗时主要在推理，所以每帧都回调一次进度。
 */
export async function runPipeline(
  engine: Engine,
  model: PoseModel,
  source: FrameSource,
  options: PipelineOptions,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const total = source.frameCount;
  const rawPoses: Pose2D[][] = [];

  for (let index = 0; index < total; index += 1) {
    if (signal?.aborted) throw new PipelineCancelled();
    const image = await source.readFrame(index);
    const rgba = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const prepared = prepareInput(model, engine, rgba, source.width, source.height, options.flipX);
    const results = await model.session.run({ [model.inputName]: prepared.tensor });
    rawPoses.push(decodeOutput(model, engine, results, prepared, options.decode));
    onProgress?.({ phase: "detect", current: index + 1, total });
  }

  onProgress?.({ phase: "rig", current: total, total });
  if (signal?.aborted) throw new PipelineCancelled();
  const poses = engine.smoothPoses(rawPoses, options.smooth);
  const bones = engine.posesToBones(poses, options.rig, source.height);
  const animation = engine.buildAnimation(bones, poses, options.anim, options.rig, source.height);
  onProgress?.({ phase: "done", current: total, total });

  return {
    poses,
    bones,
    animation,
    frameWidth: source.width,
    frameHeight: source.height,
    fps: source.fps,
  };
}
