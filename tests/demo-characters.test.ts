/**
 * 内置演示角色的体检：素材在磁盘上、能被官方运行时加载、映射的骨骼真的存在。
 *
 * 加新角色（`src/core/character.ts` 的 `DEMO_CHARACTERS`）时，这个用例会把
 * 图集页、region、骨骼名、idle 动画全查一遍，避免"界面上有这个名字、点开却黑屏"。
 */

import * as spine from "@esotericsoftware/spine-webgl";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { parseAtlasPageNames, resolvePagePath } from "@/core/atlas-format";
import { DEMO_CHARACTERS } from "@/core/character";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));

/** `CharacterRig` 允许的键（我们的骨骼名，和 `BONE_NAMES` 不是同一套写法）。 */
const RIG_KEYS = new Set([
  "torso",
  "head",
  "upperArmL",
  "lowerArmL",
  "upperArmR",
  "lowerArmR",
  "upperLegL",
  "lowerLegL",
  "upperLegR",
  "lowerLegR",
]);

describe.each(DEMO_CHARACTERS.map((character) => [character.name, character] as const))(
  "内置演示角色：%s",
  (_name, character) => {
    const jsonPath = join(ROOT, character.jsonUrl);
    const atlasPath = join(ROOT, character.atlasUrl);

    it("素材齐了：json + atlas + 每一页图片", () => {
      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(atlasPath)).toBe(true);
      // 官方许可要求：图片随附 license 文件
      const atlasDir = dirname(atlasPath);
      expect(existsSync(join(atlasDir, "LICENSE.txt"))).toBe(true);

      const atlas = readFileSync(atlasPath, "utf8");
      const pages = parseAtlasPageNames(atlas);
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        // 页名是相对 atlas 所在目录的（注意：不能用 `xxx.atlas/..` 拼，
        // 中间那段是文件不是目录，OS 会直接 ENOTDIR）
        expect(existsSync(resolvePagePath(`${atlasDir}/`, page))).toBe(true);
      }
    });

    it("官方运行时能加载，且每个附件都能在图集里找到 region", () => {
      const atlas = new spine.TextureAtlas(readFileSync(atlasPath, "utf8"));
      const loader = new spine.AtlasAttachmentLoader(atlas);
      const data = new spine.SkeletonJson(loader).readSkeletonData(
        JSON.parse(readFileSync(jsonPath, "utf8")),
      );
      expect(data.bones.length).toBeGreaterThan(3);
      expect(atlas.pages.length).toBe(parseAtlasPageNames(readFileSync(atlasPath, "utf8")).length);
    });

    it("映射表里写的骨骼都存在，且至少映射到 6 根", () => {
      const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
        bones: Array<{ name: string }>;
      };
      const boneNames = new Set(doc.bones.map((bone) => bone.name));
      // rig 的 key 是我们的骨骼名，value 是角色骨骼名；value 必须真的存在
      const mapped = Object.entries(character.rig).filter(([, bone]) => bone);
      const missing = mapped.filter(([, bone]) => !boneNames.has(bone));
      expect(missing).toEqual([]);
      expect(mapped.length).toBeGreaterThanOrEqual(6);
      expect(mapped.every(([ours]) => RIG_KEYS.has(ours))).toBe(true);
    });

    it("待机动画名在骨架里存在", () => {
      const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
        animations: Record<string, unknown>;
      };
      const names = Object.keys(doc.animations);
      expect(names).toContain(character.idleAnimation);
    });
  },
);
