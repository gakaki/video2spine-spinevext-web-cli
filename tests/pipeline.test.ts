import { describe, expect, it } from "vite-plus/test";

import { BONE_NAMES, type Pose2D } from "@/core/types";
import { testEngine } from "./helpers/engine";

/** 造一个标准站姿：躯干竖直、四肢完整。 */
function standingPose(offsetX = 0): Pose2D {
  const keypoints = Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0 }));
  const set = (index: number, x: number, y: number) => {
    keypoints[index] = { x: x + offsetX, y, score: 0.9 };
  };
  set(0, 320, 120);
  set(5, 290, 240);
  set(6, 350, 240);
  set(7, 260, 340);
  set(8, 380, 340);
  set(9, 240, 430);
  set(10, 400, 430);
  set(11, 300, 430);
  set(12, 340, 430);
  set(13, 300, 580);
  set(14, 340, 580);
  set(15, 300, 720);
  set(16, 340, 720);
  return { score: 0.9, keypoints };
}

describe("后处理链路（平滑 → 骨骼 → 动画）", () => {
  it("产出与骨骼数量一致的逐帧旋转角", async () => {
    const engine = await testEngine();
    const frames = [[standingPose(0)], [standingPose(4)], [standingPose(8)]];
    const smoothed = engine.smoothPoses(frames, { bufferSize: 3, confidenceThreshold: 0.3 });
    expect(smoothed).toHaveLength(3);
    // 平滑是加权平均，中间帧会被两侧拉一点
    expect(smoothed[1]?.[0]?.keypoints[0]?.x).toBeGreaterThan(320);
    expect(smoothed[1]?.[0]?.keypoints[0]?.x).toBeLessThan(328);

    const bones = engine.posesToBones(
      smoothed,
      { minConfidentKeypoints: 6, confidenceThreshold: 0.25 },
      800,
    );
    expect(bones).toHaveLength(3);
    expect(bones[0]?.valid).toBe(true);
    expect(bones[0]?.rotations).toHaveLength(BONE_NAMES.length);
    expect(bones[0]?.rotations.every((value) => Number.isFinite(value))).toBe(true);

    const animation = engine.buildAnimation(
      bones,
      smoothed,
      { fps: 30, baseFrame: -1, propagate: true },
      { minConfidentKeypoints: 6, confidenceThreshold: 0.25 },
      800,
    );
    expect(animation.frames).toHaveLength(3);
    expect(animation.skeleton.map((bone) => bone.name)).toEqual([...BONE_NAMES]);
    expect(animation.skeleton[0]?.parent).toBeNull();
    const torso = animation.skeleton.find((bone) => bone.name === "torso");
    expect(torso?.length).toBeGreaterThan(0);
  });

  it("骨骼不完整的帧会被基准帧回填", async () => {
    const engine = await testEngine();
    const empty: Pose2D = { score: 0, keypoints: [] };
    const frames = [[standingPose(0)], [empty], [standingPose(0)]];
    const bones = engine.posesToBones(
      frames,
      { minConfidentKeypoints: 6, confidenceThreshold: 0.25 },
      800,
    );
    expect(bones[1]?.valid).toBe(false);
    const animation = engine.buildAnimation(
      bones,
      frames,
      { fps: 30, baseFrame: -1, propagate: true },
      { minConfidentKeypoints: 6, confidenceThreshold: 0.25 },
      800,
    );
    expect(animation.frames[1]).toEqual(animation.frames[animation.baseFrame]);
    expect(animation.validity).toEqual([true, false, true]);
  });

  it("导出 JSON 的结构满足 Spine 3.8", async () => {
    const engine = await testEngine();
    const frames = [[standingPose(0)], [standingPose(6)]];
    const bones = engine.posesToBones(
      frames,
      { minConfidentKeypoints: 6, confidenceThreshold: 0.25 },
      800,
    );
    const animation = engine.buildAnimation(
      bones,
      frames,
      { fps: 30, baseFrame: -1, propagate: true },
      { minConfidentKeypoints: 6, confidenceThreshold: 0.25 },
      800,
    );
    const json = engine.buildSpineJson(animation, {
      name: "demo",
      animationName: "walk",
      frameWidth: 640,
      frameHeight: 800,
      frameCount: 2,
      fps: 30,
      regionPrefix: "frame_",
      imageName: "demo.png",
      imageScale: 1,
    });
    const parsed = JSON.parse(json) as ExportedSpine;
    // 格式版本必须和内核声明的那个一致（锁定值见 engine.spineVersion）
    expect(parsed.skeleton.spine).toBe(engine.spineVersion);
    expect(parsed.skeleton.width).toBe(640);
    const timeline = parsed.animations.walk?.slots.video?.attachment ?? [];
    expect(timeline.map((key) => key.name)).toEqual(["frame_0000", "frame_0001", "frame_0000"]);
    // Spine 4.x：skins 是数组，附件挂在 attachments 下，并显式声明 type
    expect(parsed.skins[0]?.name).toBe("default");
    expect(Object.keys(parsed.skins[0]?.attachments.video ?? {})).toEqual([
      "frame_0000",
      "frame_0001",
    ]);
    expect(parsed.skins[0]?.attachments.video?.frame_0000?.type).toBe("region");
  });
});

/** 导出 JSON（Spine 4.3）里我们关心的那部分结构。 */
interface ExportedSpine {
  skeleton: { spine: string; width: number; height: number };
  bones: Array<{ name: string; parent?: string }>;
  slots: Array<{ name: string; bone: string }>;
  skins: Array<{
    name: string;
    attachments: Record<string, Record<string, { type: string; width: number; height: number }>>;
  }>;
  animations: Record<
    string,
    {
      slots: Record<string, { attachment: Array<{ time: number; name: string }> }>;
      // Spine 4.x 的 rotate 时间轴用 value 表示角度
      bones: Record<string, { rotate: Array<{ time: number; value: number }> }>;
    }
  >;
}
