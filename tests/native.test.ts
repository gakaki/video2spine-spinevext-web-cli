/**
 * 验证「同一份 Rust 核心，绑定两次」：
 * 浏览器走 wasm-bindgen，Node 走 napi-rs，但算法结果必须一致。
 */

import { describe, expect, it } from "vite-plus/test";

import * as native from "../native/index.js";
import { BONE_NAMES, POSE_NET_NORMALIZATION } from "@/core/types";
import { testEngine } from "./helpers/engine";

/** 造一个关节点。 */
function keypoint(x: number, y: number) {
  return { x, y, score: 0.9 };
}

describe("napi-rs 原生绑定", () => {
  it("暴露与 WASM 完全一致的元信息", async () => {
    const engine = await testEngine();
    expect(native.version()).toBe(engine.version);
    // 两种绑定读的是同一个 Rust 常量：导出的格式版本不会各写各的
    expect(native.spineVersion()).toBe(engine.spineVersion);
    expect(native.keypointNames()).toEqual([...engine.keypointNames]);
    expect(native.keypointNames()).toHaveLength(17);
  });

  it("preprocess 与 WASM 结果逐字节一致", async () => {
    const engine = await testEngine();
    const rgba = new Uint8Array(4 * 2 * 4);
    for (let index = 0; index < 8; index += 1) {
      rgba[index * 4] = (index * 32) % 256;
      rgba[index * 4 + 1] = 128;
      rgba[index * 4 + 3] = 255;
    }
    const wasm = engine.preprocess(
      rgba,
      4,
      2,
      4,
      2,
      POSE_NET_NORMALIZATION.mean,
      POSE_NET_NORMALIZATION.scale,
      false,
    );
    const nativeOut = native.preprocess(
      rgba,
      4,
      2,
      4,
      2,
      [...POSE_NET_NORMALIZATION.mean],
      POSE_NET_NORMALIZATION.scale,
      false,
    );
    expect(Array.from(nativeOut)).toEqual(Array.from(wasm));
  });

  it("decodeRegression 与 WASM 输出同一个姿态", async () => {
    const engine = await testEngine();
    const values = new Float32Array(17 * 3);
    values[0] = 0.25;
    values[1] = 0.75;
    values[2] = 0.9;
    const transform = { scale: 0.5, offsetX: 10, offsetY: 20 };

    const wasmPose = engine.decodeRegression(values, 17, 192, 192, transform);
    const nativePose = native.decodeRegression(values, 17, 192, 192, transform);
    expect(nativePose.score).toBeCloseTo(wasmPose.score ?? 0, 6);
    expect(nativePose.keypoints[0]?.x).toBeCloseTo(wasmPose.keypoints[0]?.x ?? 0, 6);
    expect(nativePose.keypoints[0]?.y).toBeCloseTo(wasmPose.keypoints[0]?.y ?? 0, 6);
  });

  it("同一套骨骼 / 动画 / 导出链路在 Node 侧可用", () => {
    const pose = {
      score: 0.9,
      keypoints: Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0 })),
    };
    pose.keypoints[0] = keypoint(320, 120);
    pose.keypoints[5] = keypoint(290, 240);
    pose.keypoints[6] = keypoint(350, 240);
    pose.keypoints[7] = keypoint(260, 340);
    pose.keypoints[8] = keypoint(380, 340);
    pose.keypoints[9] = keypoint(240, 430);
    pose.keypoints[10] = keypoint(400, 430);
    pose.keypoints[11] = keypoint(300, 430);
    pose.keypoints[12] = keypoint(340, 430);
    pose.keypoints[13] = keypoint(300, 580);
    pose.keypoints[14] = keypoint(340, 580);
    pose.keypoints[15] = keypoint(300, 720);
    pose.keypoints[16] = keypoint(340, 720);

    const frames = [[pose], [pose]];
    const rig = { minConfidentKeypoints: 6, confidenceThreshold: 0.25 };
    const bones = native.posesToBones(frames, rig, 800);
    expect(bones).toHaveLength(2);
    expect(bones[0]?.rotations).toHaveLength(BONE_NAMES.length);

    const animation = native.buildAnimation(
      bones,
      frames,
      { fps: 30, baseFrame: -1, propagate: true },
      rig,
      800,
    );
    expect(animation.skeleton.map((bone) => bone.name)).toEqual([...BONE_NAMES]);
    // 根骨骼没有父节点。注意两种绑定的差异：
    // napi-rs 把 Rust 的 `Option::None` 映射成 `undefined`，
    // wasm-bindgen 侧我们显式配置成了 `null`。
    expect(animation.skeleton[0]?.parent ?? null).toBeNull();
    expect(animation.skeleton[2]?.parent).toBe("hip");

    const json = native.buildSpineJson(animation, {
      name: "native",
      animationName: "walk",
      frameWidth: 640,
      frameHeight: 800,
      frameCount: 2,
      fps: 30,
      regionPrefix: "frame_",
      imageName: "native.png",
      imageScale: 1,
    });
    const parsed = JSON.parse(json) as {
      animations: Record<string, unknown>;
      skeleton: { spine: string };
    };
    expect(parsed.skeleton.spine).toBe(native.spineVersion());
    expect(native.spineVersion()).toBe("4.3.23");
    expect(Object.keys(parsed.animations)).toEqual(["walk"]);
  });

  it("图集装箱在 Node 侧同样可用", () => {
    const layout = native.packFrames(320, 180, 6, { maxWidth: 1024, padding: 2, scale: 1 });
    expect(layout.regions).toHaveLength(6);
    const atlas = native.buildAtlas(layout, "native.png", "Linear,Linear", "none");
    expect(atlas).toContain("frame_0005");
  });
});
