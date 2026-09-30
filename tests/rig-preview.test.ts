import { describe, expect, it } from "vite-plus/test";

import { BONE_NAMES, type SkeletonBone } from "@/core/types";
import { solveBoneChain } from "@/lib/rig-preview";

/** 造一条最简骨架：躯干竖直向上、双臂水平。 */
function skeleton(): SkeletonBone[] {
  const rest: Record<string, Partial<SkeletonBone>> = {
    root: {},
    hip: {},
    torso: { length: 100 },
    head: { x: 100, length: 40 },
    "upperArm.L": { x: 0, y: 0, length: 60 },
    "lowerArm.L": { x: 60, length: 60 },
    "upperArm.R": { x: 0, y: 0, length: 60 },
    "lowerArm.R": { x: 60, length: 60 },
    "upperLeg.L": { length: 90 },
    "lowerLeg.L": { x: 90, length: 90 },
    "upperLeg.R": { length: 90 },
    "lowerLeg.R": { x: 90, length: 90 },
    "foot.L": { x: 90, length: 30 },
    "foot.R": { x: 90, length: 30 },
  };
  return BONE_NAMES.map((name) => ({
    name,
    parent: null,
    length: 0,
    x: 0,
    y: 0,
    rotation: 0,
    ...rest[name],
  }));
}

describe("预览用的正向运动学", () => {
  it("关节角全为 0 时骨骼沿各自局部 +x 展开", () => {
    // 站姿：骨盆不旋转，躯干相对骨盆抬起 90°
    const rotations = Array.from({ length: 14 }, () => 0);
    rotations[2] = 90;
    const segments = solveBoneChain(skeleton(), rotations, 100, 100, 400);
    const torso = segments.find((segment) => segment.name === "torso");
    // root 在 (100,100)（y 向上），屏幕坐标 y = 400 - 100 = 300
    expect(torso?.from).toEqual({ x: 100, y: 300 });
    expect(torso?.to.x).toBeCloseTo(100, 6);
    expect(torso?.to.y).toBeCloseTo(200, 6);
    const head = segments.find((segment) => segment.name === "head");
    expect(head?.from.x).toBeCloseTo(100, 6);
    expect(head?.from.y).toBeCloseTo(200, 6);
  });

  it("局部旋转会绕父骨骼末端转动子骨骼", () => {
    const rotations = Array.from({ length: 14 }, () => 0);
    // torso 从 +90° 再转 +90° → 朝屏幕左侧
    rotations[2] = 180;
    const segments = solveBoneChain(skeleton(), rotations, 100, 100, 400);
    const torso = segments.find((segment) => segment.name === "torso");
    expect(torso?.to.x).toBeCloseTo(0, 6);
    expect(torso?.to.y).toBeCloseTo(300, 6);
  });
});
