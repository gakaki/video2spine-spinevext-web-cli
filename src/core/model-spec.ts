/**
 * 姿态模型的输入/输出规格推断。
 *
 * 这里刻意不依赖任何推理运行时（不 import onnxruntime），
 * 因为浏览器（onnxruntime-web）和 Node CLI（onnxruntime-node）
 * 需要共用同一份判断逻辑。
 */

export type PoseModelKind = "posenet" | "movenet";

/** ONNX 张量元数据的最小形状。 */
export interface TensorMeta {
  dims: readonly (number | string)[];
  type: string;
}

export interface PoseNetHeads {
  heatmapName: string;
  heatmapChannels: number;
  heatmapLayout: "nhwc" | "nchw";
  offsetName: string;
  offsetChannels: number;
  offsetLayout: "nhwc" | "nchw";
  forwardName?: string;
  backwardName?: string;
  displacementLayout: "nhwc" | "nchw";
  /** heatmap 相对模型输入的下采样倍率。 */
  stride: number;
}

export interface ModelSpec {
  kind: PoseModelKind;
  inputName: string;
  inputWidth: number;
  inputHeight: number;
  inputType: "float32" | "int32";
  /** PoseNet 家族才有；MoveNet 为 `undefined`。 */
  poseNet?: PoseNetHeads;
}

type ChannelAxis = 1 | 3;

function dimsOf(metadata: TensorMeta): number[] {
  return metadata.dims.map((dim) => (typeof dim === "number" ? dim : Number(dim)));
}

/** 输入张量：靠 RGB 三通道判断是 NCHW 还是 NHWC。 */
function inputChannelAxis(dims: number[]): { axis: ChannelAxis; channels: number } | null {
  if (dims[1] === 3) return { axis: 1, channels: 3 };
  if (dims[3] === 3) return { axis: 3, channels: 3 };
  return null;
}

/**
 * 输出张量：靠 17 / 34 这两个已知通道数定位特征轴。
 *
 * 存在歧义时会优先采用与输入一致的排布——PoseNet 的 ResNet50 变体
 * heatmap 恰好是 `[1,17,17,23]`（17 既是通道数也是高度），
 * 只靠数值无法区分 NCHW 与 NHWC。
 */
function featureChannelAxis(
  dims: number[],
  preferred: ChannelAxis,
): { axis: ChannelAxis; channels: number } | null {
  const matches = (axis: ChannelAxis) => {
    const value = dims[axis];
    return value === 17 || value === 34 ? value : null;
  };
  const preferredChannels = matches(preferred);
  if (preferredChannels !== null) return { axis: preferred, channels: preferredChannels };
  const other: ChannelAxis = preferred === 1 ? 3 : 1;
  const otherChannels = matches(other);
  if (otherChannels !== null) return { axis: other, channels: otherChannels };
  return null;
}

/**
 * 从 ONNX 的输入输出元数据推断模型家族与张量布局。
 *
 * 判断依据：输出里出现通道数 17 的 4 维张量就是 heatmap（PoseNet）；
 * 只有单个 `[1,1,17,3]` 输出就是直接回归（MoveNet）。
 */
export function inferModelSpec(
  inputMetadata: Record<string, TensorMeta>,
  outputMetadata: Record<string, TensorMeta>,
): ModelSpec {
  const inputEntry = Object.entries(inputMetadata)[0];
  if (!inputEntry) throw new Error("模型没有输入张量");
  const [inputName, inputMeta] = inputEntry;
  const inputDims = dimsOf(inputMeta);
  if (inputDims.length !== 4) {
    throw new Error(`只支持 4 维输入张量，实际得到 [${inputDims.join(", ")}]`);
  }
  const inputChannels = inputChannelAxis(inputDims);
  if (!inputChannels) throw new Error("无法从输入张量推断通道位置");

  const nchw = inputChannels.axis === 1;
  const inputHeight = nchw ? inputDims[2]! : inputDims[1]!;
  const inputWidth = nchw ? inputDims[3]! : inputDims[2]!;
  const preferredAxis: ChannelAxis = nchw ? 1 : 3;
  const inputType: ModelSpec["inputType"] =
    inputMeta.type === "int32" || inputMeta.type === "uint8" ? "int32" : "float32";

  const outputs = Object.entries(outputMetadata).map(([name, meta]) => ({
    name,
    dims: dimsOf(meta),
  }));

  const heatmap = outputs.find((output) => {
    const axis = output.dims.length === 4 ? featureChannelAxis(output.dims, preferredAxis) : null;
    return axis?.channels === 17;
  });
  const offset = outputs.find((output) => {
    const axis = output.dims.length === 4 ? featureChannelAxis(output.dims, preferredAxis) : null;
    return axis?.channels === 34;
  });

  if (heatmap && offset) {
    const heatmapAxis = featureChannelAxis(heatmap.dims, preferredAxis)!;
    const offsetAxis = featureChannelAxis(offset.dims, preferredAxis)!;
    // 兼容 [1,C,H,W] 与 [1,H,W,C] 两种排布
    const heatmapHeight = heatmapAxis.axis === 1 ? heatmap.dims[2]! : heatmap.dims[1]!;
    const stride = Math.max(1, Math.round(inputHeight / Math.max(1, heatmapHeight)));
    const forward = outputs.find((output) => /fwd|forward/i.test(output.name));
    const backward = outputs.find((output) => /bwd|backward/i.test(output.name));
    return {
      kind: "posenet",
      inputName,
      inputWidth,
      inputHeight,
      inputType,
      poseNet: {
        heatmapName: heatmap.name,
        heatmapChannels: heatmapAxis.channels,
        heatmapLayout: heatmapAxis.axis === 1 ? "nchw" : "nhwc",
        offsetName: offset.name,
        offsetChannels: offsetAxis.channels,
        offsetLayout: offsetAxis.axis === 1 ? "nchw" : "nhwc",
        forwardName: forward?.name,
        backwardName: backward?.name,
        displacementLayout: "nhwc",
        stride,
      },
    };
  }

  const regression = outputs.find(
    (output) => output.dims.length === 4 && output.dims[3] === 3 && output.dims[2] === 17,
  );
  if (regression) {
    return { kind: "movenet", inputName, inputWidth, inputHeight, inputType };
  }

  throw new Error(
    `无法识别的姿态模型输出：${outputs
      .map((output) => `${output.name} [${output.dims.join(", ")}]`)
      .join(" / ")}`,
  );
}
