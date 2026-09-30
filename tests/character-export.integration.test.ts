/**
 * 角色工程导出的端到端验证（用真实检测结果，不造假数据）。
 *
 * 链路：
 * ```
 * 纯 Rust CLI 跑 .test-assets/person-rot.mp4      真实视频 → 真实逐帧骨骼角度
 *   → 读回 CLI 导出的 Spine JSON，还原成逐帧骨骼矩阵
 *   → bakeCharacterProject / packCharacterProject   浏览器导出用的同一份代码
 *   → 解 zip 断言：图集与图片是角色的，动画是刚才视频检测出来的
 * ```
 *
 * 依赖 `target/release/spinevext` 与测试视频，缺任何一个就跳过，
 * 这样在没跑过 Rust 构建的机器上也不会误报失败。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { baseName, parseAtlasPageNames, resolvePagePath } from "@/core/atlas-format";
import type { CharacterAsset } from "@/core/character";
import { bakeCharacterProject, guessRig, packCharacterProject } from "@/core/character-project";
import { BONE_NAMES } from "@/core/types";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "target/release/spinevext");
const VIDEO = join(ROOT, ".test-assets/person-rot.mp4");
const SPINEBOY = join(ROOT, "public/demo/spineboy");
const WORK = join(ROOT, ".test-assets/character-export");

const available = existsSync(CLI) && existsSync(VIDEO) && existsSync(SPINEBOY);

/** 从磁盘读一份内置角色资源（与浏览器 fetch 到的是同样的字节）。 */
function readSpineboy(): CharacterAsset {
  const json = readFileSync(join(SPINEBOY, "spineboy-pro.json"), "utf8");
  const atlas = readFileSync(join(SPINEBOY, "spineboy.atlas"), "utf8");
  const pages = parseAtlasPageNames(atlas).map((page) => ({
    path: page,
    data: new Uint8Array(readFileSync(resolvePagePath(`${SPINEBOY}/`, page))),
  }));
  const boneNames = (JSON.parse(json) as { bones: Array<{ name: string }> }).bones.map(
    (bone) => bone.name,
  );
  const rig = guessRig(boneNames);
  expect(Object.values(rig).filter(Boolean).length).toBeGreaterThanOrEqual(8);
  return { id: "spineboy", name: "Spineboy", json, atlas, pages, rig, maxDelta: 60 };
}

/** 把 CLI 导出的 Spine JSON 还原成「逐帧 × BONE_NAMES」的骨骼角度矩阵。 */
function framesFromExport(path: string, animation: string): number[][] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    animations: Record<string, { bones: Record<string, { rotate: Array<{ value: number }> }> }>;
  };
  const timelines = doc.animations[animation]!.bones;
  const frameCount = Math.max(...Object.values(timelines).map((bone) => bone.rotate.length));
  return Array.from({ length: frameCount }, (_, frameIndex) =>
    BONE_NAMES.map((name) => timelines[name]?.rotate[frameIndex]?.value ?? 0),
  );
}

describe.skipIf(!available)("角色工程导出（真实检测数据）", () => {
  it("导出的是角色的美术 + 视频检测出的骨骼动画", () => {
    mkdirSync(WORK, { recursive: true });
    // 1. 真实检测：纯 Rust CLI 跑视频，产出我们的 14 骨骼动画
    execFileSync(CLI, [VIDEO, "--out", WORK, "--name", "person-rot", "--fps", "15"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    const detected = join(WORK, "person-rot.json");
    expect(existsSync(detected)).toBe(true);
    const frames = framesFromExport(detected, "video");
    expect(frames.length).toBe(90);
    // CLI 还会顺手写一份视频帧图集（这里是 100 MB 级的大文件），本用例只用它的骨骼数据
    for (const junk of ["person-rot.png", "person-rot.zip"]) {
      unlinkSync(join(WORK, junk));
    }

    // 2. 用浏览器导出时的同一份代码烘焙到角色骨骼上
    const baseFrame = Math.max(
      0,
      frames.findIndex((frame) => frame.some((value) => value !== 0)),
    );
    const asset = readSpineboy();
    const baked = bakeCharacterProject(asset, {
      frames,
      baseFrame,
      fps: 15,
      animationName: "video",
      spineVersion: "4.3.23",
    });
    const zipped = packCharacterProject(baked, "spineboy-video");
    const zipPath = join(WORK, "spineboy-video.zip");
    writeFileSync(zipPath, zipped);
    process.stdout.write(`[character-export] 产物：${zipPath}\n`);

    // 3. 包里是角色的三件套，没有任何视频帧
    const files = unzipSync(zipped);
    const names = Object.keys(files).toSorted();
    expect(names).toEqual(["spineboy-video.atlas", "spineboy-video.json", "spineboy.png"]);
    expect(names.some((name) => name.startsWith("frame_"))).toBe(false);
    expect(files["spineboy.png"]!.byteLength).toBe(
      readFileSync(join(SPINEBOY, "spineboy.png")).byteLength,
    );

    // 4. 动画数据来自视频：骨骼是角色的，键值逐帧来自刚才那次检测
    const out = JSON.parse(new TextDecoder().decode(files["spineboy-video.json"])) as {
      skeleton: { spine: string };
      bones: Array<{ name: string }>;
      animations: Record<string, { bones: Record<string, { rotate: Array<{ value: number }> }> }>;
    };
    // 官方示例骨架自带 4.3.75-beta，导出时要统一成锁定的 4.3.23
    expect((JSON.parse(asset.json) as { skeleton: { spine: string } }).skeleton.spine).toBe(
      "4.3.75-beta",
    );
    expect(out.skeleton.spine).toBe("4.3.23");
    const timelines = out.animations.video!.bones;
    const mapped = Object.keys(timelines);
    expect(mapped.length).toBeGreaterThanOrEqual(4);
    expect(out.bones.some((bone) => bone.name === "front-upper-arm")).toBe(true);
    expect(mapped.every((name) => out.bones.some((bone) => bone.name === name))).toBe(true);

    for (const name of mapped) {
      expect(timelines[name]!.rotate).toHaveLength(frames.length);
    }
    const moving = mapped.filter((name) => {
      const values = timelines[name]!.rotate.map((key) => key.value);
      return Math.max(...values) - Math.min(...values) > 2;
    });
    expect(moving.length).toBeGreaterThanOrEqual(1);

    // 5. 数值就是「角色静止角 + 视频里的相对转角」
    const restOf = new Map(
      (JSON.parse(asset.json) as { bones: Array<{ name: string; rotation?: number }> }).bones.map(
        (bone) => [bone.name, bone.rotation ?? 0],
      ),
    );
    const torsoName = mapped.find((name) => name === "torso");
    if (torsoName) {
      const detectedTorso = frames.map((frame) => frame[BONE_NAMES.indexOf("torso")]!);
      const base = detectedTorso[baseFrame]!;
      const rest = restOf.get(torsoName)!;
      timelines[torsoName]!.rotate.forEach((key, index) => {
        const delta = Math.max(-60, Math.min(60, detectedTorso[index]! - base));
        expect(key.value).toBeCloseTo(rest + delta, 1);
      });
    }
  }, 300_000);

  it("上传的 zip 走的是同一条路：骨架 JSON / atlas / 图片按原样打进包里", () => {
    const asset = readSpineboy();
    const frames = Array.from({ length: 4 }, (_, frame) =>
      BONE_NAMES.map((name) => (name === "torso" ? frame * 8 : 0)),
    );
    const baked = bakeCharacterProject(asset, {
      frames,
      baseFrame: 0,
      fps: 15,
      animationName: "video",
      spineVersion: "4.3.23",
    });
    const files = unzipSync(packCharacterProject(baked, "uploaded"));
    expect(Object.keys(files).toSorted()).toEqual([
      "spineboy.png",
      "uploaded.atlas",
      "uploaded.json",
    ]);
    expect(parseAtlasPageNames(asset.atlas).map(baseName)).toEqual(["spineboy.png"]);
  });
});
