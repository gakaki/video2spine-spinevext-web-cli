import { describe, expect, it } from "vite-plus/test";

import { testEngine } from "./helpers/engine";

describe("Rust 内核的 TypeScript 绑定", () => {
  it("暴露版本号与 17 个 COCO 关节点", async () => {
    const engine = await testEngine();
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
    // 导出格式版本锁定在这里：改这个数字就要同步改 Rust 的 SPINE_VERSION
    expect(engine.spineVersion).toBe("4.3.23");
    expect(engine.keypointNames).toHaveLength(17);
    expect(engine.keypointNames[0]).toBe("nose");
    expect(engine.keypointNames[16]).toBe("rightAnkle");
  });

  it("preprocess 输出 NCHW 且按 mean/scale 归一化", async () => {
    const engine = await testEngine();
    // 2x2 纯红图
    const rgba = new Uint8Array(16);
    for (let index = 0; index < 4; index += 1) {
      rgba[index * 4] = 255;
      rgba[index * 4 + 3] = 255;
    }
    const tensor = engine.preprocess(rgba, 2, 2, 2, 2, [0.5, 0.25, 0], 255, false);
    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(3 * 2 * 2);
    expect(tensor[0]).toBeCloseTo(0.5, 5);
    expect(tensor[4]).toBeCloseTo(-0.25, 5);
  });

  it("preprocessLetterbox 输出整型 RGB 与坐标变换", async () => {
    const engine = await testEngine();
    const rgba = new Uint8Array(4 * 2 * 4).fill(200);
    const result = engine.preprocessLetterbox(rgba, 4, 2, 4, 4, false);
    expect(result.data).toBeInstanceOf(Int32Array);
    expect(result.data.length).toBe(4 * 4 * 3);
    expect(result.transform.scale).toBeCloseTo(1, 6);
    expect(result.transform.offsetY).toBeCloseTo(1, 6);
    // 第一行是补的黑边
    expect(Array.from(result.data.slice(0, 12))).toEqual(Array.from({ length: 12 }, () => 0));
  });

  it("decodeRegression 把归一化坐标映射回源图像素", async () => {
    const engine = await testEngine();
    const values = new Float32Array(17 * 3);
    values[0] = 0.5;
    values[1] = 0.5;
    values[2] = 0.8;
    const pose = engine.decodeRegression(values, 17, 192, 192, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(pose.keypoints).toHaveLength(17);
    expect(pose.keypoints[0]?.x).toBeCloseTo(96, 3);
    expect(pose.keypoints[0]?.y).toBeCloseTo(96, 3);
    expect(pose.keypoints[0]?.score).toBeCloseTo(0.8, 5);
  });

  it("角度平滑在 ±180° 边界处不塌成 0", async () => {
    const engine = await testEngine();
    const smoothed = engine.smoothAngleSeries(new Float32Array([179, -179, 178]), 3);
    expect(Array.from(smoothed).every((value) => Math.abs(value) > 170)).toBe(true);
  });

  it("packFrames 与 buildAtlas 生成可用的图集描述", async () => {
    const engine = await testEngine();
    const layout = engine.packFrames(320, 180, 10, { maxWidth: 1024, padding: 2, scale: 1 });
    expect(layout.regions).toHaveLength(10);
    expect(layout.atlasWidth).toBeLessThanOrEqual(1024);
    const atlas = engine.buildAtlas(layout, "demo.png", "Linear,Linear", "none");
    expect(atlas).toMatch(/^demo\.png\n/);
    expect(atlas).toContain(`size: ${layout.atlasWidth},${layout.atlasHeight}`);
    expect(atlas).toContain("frame_0000");
  });
});
