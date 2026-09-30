/**
 * Rust 内核（`crates/spinevext-core`）数据结构在 TypeScript 侧的一一对应。
 *
 * 字段名与 Rust 的 `#[serde(rename_all = "camelCase")]` 完全一致，
 * 任何一侧改了字段名，另一侧必须同步修改，否则运行期会解析失败。
 */

/** COCO-17 关节点名字，顺序与模型输出通道一致。 */
export const KEYPOINT_NAMES = [
  "nose",
  "leftEye",
  "rightEye",
  "leftEar",
  "rightEar",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
] as const;

export type KeypointName = (typeof KEYPOINT_NAMES)[number];

/** COCO 关节点下标。 */
export const PART = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

/** 骨骼名，顺序与 Rust `BONE_NAMES` 一致。 */
export const BONE_NAMES = [
  "root",
  "hip",
  "torso",
  "head",
  "upperArm.L",
  "lowerArm.L",
  "upperArm.R",
  "lowerArm.R",
  "upperLeg.L",
  "lowerLeg.L",
  "upperLeg.R",
  "lowerLeg.R",
  "foot.L",
  "foot.R",
] as const;

/** 骨骼树：子 -> 父。 */
export const BONE_PARENTS: Record<(typeof BONE_NAMES)[number], string | null> = {
  root: null,
  hip: "root",
  torso: "hip",
  head: "torso",
  "upperArm.L": "torso",
  "lowerArm.L": "upperArm.L",
  "upperArm.R": "torso",
  "lowerArm.R": "upperArm.R",
  "upperLeg.L": "hip",
  "lowerLeg.L": "upperLeg.L",
  "upperLeg.R": "hip",
  "lowerLeg.R": "upperLeg.R",
  "foot.L": "lowerLeg.L",
  "foot.R": "lowerLeg.R",
};

export interface Keypoint {
  x: number;
  y: number;
  score: number;
}

export interface Pose2D {
  score: number;
  keypoints: Keypoint[];
}

export interface ImageTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** `preprocessLetterbox` 的返回值：整型 NHWC RGB 数据 + 坐标变换。 */
export interface LetterboxResult {
  data: Int32Array;
  transform: ImageTransform;
}

export type TensorLayout = "nhwc" | "nchw";
export type OffsetOrder = "yx" | "xy";

export interface DecodeConfig {
  confidenceThreshold: number;
  nmsRadius: number;
  maxPoses: number;
  stride: number;
  multiPose: boolean;
  heatmapLayout: TensorLayout;
  offsetLayout: TensorLayout;
  offsetOrder: OffsetOrder;
  displacementLayout: TensorLayout;
  offsetInPixels: boolean;
  transform: ImageTransform;
}

export interface SmoothConfig {
  bufferSize: number;
  confidenceThreshold: number;
}

export interface RigConfig {
  minConfidentKeypoints: number;
  confidenceThreshold: number;
}

export interface AnimConfig {
  fps: number;
  /** -1 表示自动挑选基准帧。 */
  baseFrame: number;
  propagate: boolean;
}

export interface BoneFrame {
  rotations: number[];
  confidence: number;
  valid: boolean;
}

export interface SkeletonBone {
  name: string;
  parent: string | null;
  length: number;
  x: number;
  y: number;
  rotation: number;
}

export interface AnimationData {
  fps: number;
  baseFrame: number;
  frames: number[][];
  validity: boolean[];
  skeleton: SkeletonBone[];
  rootX: number;
  rootY: number;
}

export interface PackConfig {
  maxWidth: number;
  padding: number;
  scale: number;
}

export interface PackedRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

export interface PackLayout {
  atlasWidth: number;
  atlasHeight: number;
  regions: PackedRegion[];
}

export interface ExportConfig {
  name: string;
  animationName: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  regionPrefix: string;
  imageName: string;
  imageScale: number;
}

/**
 * 原版 Unity 资源里提取出来的归一化参数
 * （asset 字符串 `resnet50-posenet-normalization-stats`）。
 */
export const POSE_NET_NORMALIZATION = {
  mean: [0.482941176, 0.454509803, 0.404156862],
  /** `pixel / scale - mean[c]` */
  scale: 255,
} as const;

export const DEFAULT_DECODE_CONFIG: DecodeConfig = {
  confidenceThreshold: 0.3,
  nmsRadius: 20,
  maxPoses: 1,
  stride: 16,
  multiPose: false,
  heatmapLayout: "nhwc",
  offsetLayout: "nhwc",
  offsetOrder: "yx",
  displacementLayout: "nhwc",
  offsetInPixels: true,
  transform: { scale: 1, offsetX: 0, offsetY: 0 },
};

export const DEFAULT_SMOOTH_CONFIG: SmoothConfig = {
  bufferSize: 5,
  confidenceThreshold: 0.3,
};

export const DEFAULT_RIG_CONFIG: RigConfig = {
  minConfidentKeypoints: 6,
  confidenceThreshold: 0.25,
};

export const DEFAULT_ANIM_CONFIG: AnimConfig = {
  fps: 30,
  baseFrame: -1,
  propagate: true,
};

export const DEFAULT_PACK_CONFIG: PackConfig = {
  maxWidth: 4096,
  padding: 2,
  scale: 1,
};
