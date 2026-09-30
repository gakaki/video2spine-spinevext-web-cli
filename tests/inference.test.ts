import { describe, expect, it } from "vite-plus/test";

import { inferModelSpec } from "@/core/inference";

type Meta = Record<string, { dims: number[]; type: string }>;

describe("模型家族自动识别", () => {
  it("识别 MoveNet 直接回归模型", () => {
    const input: Meta = { input: { dims: [1, 192, 192, 3], type: "int32" } };
    const output: Meta = { output_0: { dims: [1, 1, 17, 3], type: "float32" } };
    const spec = inferModelSpec(input, output);
    expect(spec.kind).toBe("movenet");
    expect(spec.inputWidth).toBe(192);
    expect(spec.inputHeight).toBe(192);
    expect(spec.inputType).toBe("int32");
    expect(spec.poseNet).toBeUndefined();
  });

  it("识别 ResNet50 PoseNet（heatmap 恰好 17×17 也不会误判布局）", () => {
    const input: Meta = { Data: { dims: [1, 3, 257, 353], type: "float32" } };
    const output: Meta = {
      float_heatmaps: { dims: [1, 17, 17, 23], type: "float32" },
      float_short_offsets: { dims: [1, 34, 17, 23], type: "float32" },
      displacement_fwd: { dims: [1, 32, 17, 23], type: "float32" },
      displacement_bwd: { dims: [1, 32, 17, 23], type: "float32" },
    };
    const spec = inferModelSpec(input, output);
    expect(spec.kind).toBe("posenet");
    // NCHW 的 257 是高度、353 是宽度
    expect(spec.inputHeight).toBe(257);
    expect(spec.inputWidth).toBe(353);
    expect(spec.poseNet?.heatmapLayout).toBe("nchw");
    expect(spec.poseNet?.offsetChannels).toBe(34);
    expect(spec.poseNet?.forwardName).toBe("displacement_fwd");
    expect(spec.poseNet?.backwardName).toBe("displacement_bwd");
    // 257 / 17 ≈ 16，即原版 PoseNet ResNet50 的输出步长
    expect(spec.poseNet?.stride).toBe(15);
  });

  it("识别 NHWC MobileNet PoseNet", () => {
    const input: Meta = { input: { dims: [1, 257, 257, 3], type: "float32" } };
    const output: Meta = {
      heatmaps: { dims: [1, 33, 33, 17], type: "float32" },
      offsets: { dims: [1, 33, 33, 34], type: "float32" },
    };
    const spec = inferModelSpec(input, output);
    expect(spec.kind).toBe("posenet");
    expect(spec.poseNet?.heatmapLayout).toBe("nhwc");
    expect(spec.poseNet?.stride).toBe(8);
  });

  it("无法识别时给出明确的报错", () => {
    const input: Meta = { input: { dims: [1, 224, 224, 3], type: "float32" } };
    const output: Meta = { logits: { dims: [1, 1000], type: "float32" } };
    expect(() => inferModelSpec(input, output)).toThrow(/无法识别/);
  });
});
