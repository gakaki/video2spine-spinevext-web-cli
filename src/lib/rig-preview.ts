/**
 * 预览用的正向运动学。
 *
 * 只服务于画面渲染：把 Rust 导出的骨骼静止姿态 + 每帧局部旋转角
 * 解算成屏幕上的线段。导出到 Spine 的那份数据仍然完全由 Rust 生成，
 * 这里的计算结果不会回写进任何导出物。
 */

import { BONE_PARENTS, type SkeletonBone } from "@/core/types";

export interface BoneSegment {
  name: string;
  /** 骨骼起点（图像坐标，y 向下）。 */
  from: { x: number; y: number };
  /** 骨骼终点（图像坐标，y 向下）。 */
  to: { x: number; y: number };
}

interface BoneWorld {
  x: number;
  y: number;
  /** 弧度，y 向上坐标系 */
  theta: number;
}

/**
 * @param skeleton 骨骼定义（来自 `AnimationData.skeleton`）
 * @param rotations 某一帧的局部旋转角（度）
 * @param rootX 根骨骼在 y 向上坐标里的 x
 * @param rootY 根骨骼在 y 向上坐标里的 y
 * @param imageHeight 画面高度，用于把 y 向上翻回屏幕坐标
 */
export function solveBoneChain(
  skeleton: SkeletonBone[],
  rotations: readonly number[],
  rootX: number,
  rootY: number,
  imageHeight: number,
): BoneSegment[] {
  const world = new Map<string, BoneWorld>();
  const segments: BoneSegment[] = [];

  skeleton.forEach((bone, index) => {
    const parentName = BONE_PARENTS[bone.name as keyof typeof BONE_PARENTS] ?? null;
    const parent = parentName ? world.get(parentName) : undefined;
    const parentWorld: BoneWorld = parent ?? { x: rootX, y: rootY, theta: 0 };

    // 骨骼自身的位置偏移是写在父骨骼局部坐标系里的
    const cos = Math.cos(parentWorld.theta);
    const sin = Math.sin(parentWorld.theta);
    const offsetX = parent ? bone.x : 0;
    const offsetY = parent ? bone.y : 0;
    const x = parentWorld.x + offsetX * cos - offsetY * sin;
    const y = parentWorld.y + offsetX * sin + offsetY * cos;
    const theta = parentWorld.theta + ((rotations[index] ?? 0) * Math.PI) / 180;

    world.set(bone.name, { x, y, theta });

    const tipX = x + Math.cos(theta) * bone.length;
    const tipY = y + Math.sin(theta) * bone.length;
    segments.push({
      name: bone.name,
      from: { x, y: imageHeight - y },
      to: { x: tipX, y: imageHeight - tipY },
    });
  });

  return segments;
}
