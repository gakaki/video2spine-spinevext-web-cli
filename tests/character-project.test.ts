import * as spine from "@esotericsoftware/spine-webgl";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { parseAtlasPageNames } from "@/core/atlas-format";
import { pickIdleAnimation, type CharacterAsset } from "@/core/character";
import { bakeCharacterProject, guessRig, packCharacterProject } from "@/core/character-project";
import { BONE_NAMES } from "@/core/types";

/** 导出的工程里不允许出现非 ASCII 字符（跨工具读写时的 MISSING 元凶）。 */
function hasNonAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) return true;
  }
  return false;
}

const torsoIndex = BONE_NAMES.indexOf("torso");
const headIndex = BONE_NAMES.indexOf("head");

/** 造一份最小角色工程：只有 root / torso / head 三根骨骼。 */
function makeAsset(rig: CharacterAsset["rig"]): CharacterAsset {
  return {
    id: "custom",
    name: "fixture",
    json: JSON.stringify({
      // 故意写一个别的 4.3.x：导出时必须被盖成我们锁定的版本
      skeleton: { spine: "4.3.75-beta" },
      bones: [{ name: "root" }, { name: "torso", rotation: 3 }, { name: "head" }],
    }),
    atlas: "fixture.png\nsize: 8,8\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n",
    pages: [{ path: "fixture.png", data: new Uint8Array([1, 2, 3]) }],
    rig,
    maxDelta: 60,
  };
}

/** 造一段"视频检测结果"：只让指定的骨骼随时间转动。 */
function makeFrames(moving: Array<[number, number[]]>): number[][] {
  return [0, 1, 2].map((frameIndex) =>
    BONE_NAMES.map((_, boneIndex) => {
      const hit = moving.find(([index]) => index === boneIndex);
      return hit ? (hit[1][frameIndex] ?? 0) : 0;
    }),
  );
}

describe("骨骼名映射猜测", () => {
  it("认得出 torso / head / arm-l / leg-r 这套命名", () => {
    const rig = guessRig(["root", "hip", "torso", "head", "arm-l", "arm-r", "leg-l", "leg-r"]);
    expect(rig).toMatchObject({
      torso: "torso",
      head: "head",
      upperArmL: "arm-l",
      upperArmR: "arm-r",
      upperLegL: "leg-l",
      upperLegR: "leg-r",
    });
  });

  it("认得出 front-/rear- 这套官方示例命名（与内置 Spineboy 的左右约定一致）", () => {
    const rig = guessRig([
      "root",
      "torso",
      "head",
      "rear-upper-arm",
      "rear-lower-arm",
      "front-upper-arm",
      "front-lower-arm",
      "rear-thigh",
      "rear-shin",
      "front-thigh",
      "front-shin",
    ]);
    expect(rig).toMatchObject({
      upperArmL: "rear-upper-arm",
      lowerArmL: "rear-lower-arm",
      upperArmR: "front-upper-arm",
      lowerArmR: "front-lower-arm",
      upperLegL: "rear-thigh",
      lowerLegL: "rear-shin",
      upperLegR: "front-thigh",
      lowerLegR: "front-shin",
    });
  });

  it("认得出 upperArm.L / upperLeg.R 这套标准命名", () => {
    const rig = guessRig([
      "root",
      "hip",
      "torso",
      "head",
      "upperArm.L",
      "upperArm.R",
      "upperLeg.L",
      "upperLeg.R",
    ]);
    expect(rig).toMatchObject({
      upperArmL: "upperArm.L",
      upperArmR: "upperArm.R",
      upperLegL: "upperLeg.L",
      upperLegR: "upperLeg.R",
    });
  });
});

describe("把视频骨骼数据烘焙进角色工程", () => {
  it("写进的是角色自己的骨骼，数值等于静止角 + 相对基准帧的增量", () => {
    const asset = makeAsset({ torso: "torso", head: "head" });
    const frames = makeFrames([
      [torsoIndex, [10, 30, 50]],
      [headIndex, [-4, 0, 4]],
    ]);

    const baked = bakeCharacterProject(asset, {
      frames,
      baseFrame: 0,
      fps: 30,
      animationName: "video",
      spineVersion: "4.3.23",
    });

    const parsed = JSON.parse(baked.json) as {
      skeleton: { spine: string };
      bones: Array<{ name: string; rotation?: number }>;
      animations: Record<
        string,
        { bones: Record<string, { rotate: Array<{ time: number; value: number }> }> }
      >;
    };
    const timelines = parsed.animations.video!.bones;
    // 角色工程里原本写的 4.3.75-beta 会被盖成锁定的 4.3.23
    expect(parsed.skeleton.spine).toBe("4.3.23");
    // torso 静止角 3，基准帧 10 → 3、23、43
    expect(timelines.torso!.rotate).toEqual([
      { time: 0, value: 3 },
      { time: 1 / 30, value: 23 },
      { time: 2 / 30, value: 43 },
    ]);
    // head 骨骼没写 rotation，静止角按 0 算
    expect(timelines.head!.rotate.map((key) => key.value)).toEqual([0, 4, 8]);
    // 角色的骨骼定义原样保留
    expect(parsed.bones.map((bone) => bone.name)).toEqual(["root", "torso", "head"]);
    expect(baked.mappedBones.toSorted()).toEqual(["head", "torso"]);
  });

  it("超出限幅的增量会被夹住，全程不动的骨骼不写时间轴", () => {
    const asset = makeAsset({ torso: "torso", head: "head" });
    const frames = makeFrames([[torsoIndex, [0, 200, 0]]]);

    const baked = bakeCharacterProject(asset, {
      frames,
      baseFrame: 0,
      fps: 30,
      animationName: "video",
      spineVersion: "4.3.23",
    });
    const parsed = JSON.parse(baked.json) as {
      animations: Record<string, { bones: Record<string, { rotate: Array<{ value: number }> }> }>;
    };
    expect(parsed.animations.video!.bones.torso!.rotate.map((key) => key.value)).toEqual([
      3, 63, 3,
    ]);
    expect(parsed.animations.video!.bones.head).toBeUndefined();
  });

  it("一根骨骼都映射不上时报错，而不是导出空工程", () => {
    const asset = makeAsset({ torso: "torso" });
    const frames = makeFrames([[headIndex, [0, 20, 40]]]);
    expect(() =>
      bakeCharacterProject(asset, {
        frames,
        baseFrame: 0,
        fps: 30,
        animationName: "video",
        spineVersion: "4.3.23",
      }),
    ).toThrow(/没能映射到角色的任何骨骼/);
  });

  it("打包出来的是角色自己的美术，不是视频帧", () => {
    const asset = makeAsset({ torso: "torso" });
    const baked = bakeCharacterProject(asset, {
      frames: makeFrames([[torsoIndex, [0, 10, 20]]]),
      baseFrame: 0,
      fps: 30,
      animationName: "video",
      spineVersion: "4.3.23",
    });

    const files = unzipSync(packCharacterProject(baked, "take01"));
    expect(Object.keys(files).toSorted()).toEqual(["fixture.png", "take01.atlas", "take01.json"]);
    // 图集页用的就是角色自己的字节
    expect(Array.from(files["fixture.png"] ?? [])).toEqual([1, 2, 3]);
    // atlas 文本来自角色工程
    expect(new TextDecoder().decode(files["take01.atlas"])).toBe(asset.atlas);
  });
});

describe("挑待机动画", () => {
  it("配置里写的名字优先", () => {
    expect(pickIdleAnimation([{ name: "walk" }, { name: "idle/breathe" }], "idle/breathe")).toBe(
      "idle/breathe",
    );
  });

  it("没配名字就找名字里带 idle 的那条", () => {
    expect(pickIdleAnimation([{ name: "run" }, { name: "idle" }], "")).toBe("idle");
  });

  it("一条都没有时返回 null，而不是空串", () => {
    // 空串会让 Spine 的 findAnimation 抛 `animationName cannot be null.`，
    // 于是"上传一个只有自己动画的工程"会整个角色加载失败。
    expect(pickIdleAnimation([{ name: "video" }], "")).toBeNull();
    expect(pickIdleAnimation([], "idle")).toBeNull();
  });
});

/**
 * 中文命名的工程（用户上传的那类）导出后的样子。
 *
 * 用合成夹具而不是真实素材：既保住"改名 + 平铺 + 官方运行时能加载"这几条回归，
 * 又不把仓库撑大。夹具刻意模仿脏数据——页属性不缩进、region 里也有 `size:`、
 * 页名带 `images/` 前缀、部位名是中文。
 */
const CHINESE_ATLAS = [
  "images/face.png",
  "size: 8,8",
  "format: RGBA8888",
  "filter: Linear,Linear",
  "repeat: none",
  "脸",
  "  rotate: false",
  "  xy: 0, 0",
  "  size: 8, 8",
  "  orig: 8, 8",
  "  offset: 0, 0",
  "  index: -1",
  "images/arm-l.png",
  "size: 4,4",
  "format: RGBA8888",
  "filter: Linear,Linear",
  "repeat: none",
  "左臂",
  "  rotate: false",
  "  xy: 0, 0",
  "  size: 4, 4",
  "  orig: 4, 4",
  "  offset: 0, 0",
  "  index: -1",
].join("\n");

function makeChineseAsset(): CharacterAsset {
  return {
    id: "custom",
    name: "cn-rig",
    json: JSON.stringify({
      // 故意写一个别的 4.3.x，并且带着会把路径拼错的 images 字段
      skeleton: { spine: "4.3.75-beta", images: "./images/" },
      bones: [{ name: "root" }, { name: "torso", rotation: 3 }],
      slots: [
        { name: "脸", bone: "torso", attachment: "脸" },
        { name: "左臂", bone: "torso", attachment: "左臂" },
      ],
      skins: [
        {
          name: "default",
          attachments: {
            脸: { 脸: { type: "region", width: 8, height: 8 } },
            左臂: { 左臂: { type: "region", width: 4, height: 4 } },
          },
        },
      ],
      animations: {
        idle: { slots: { 脸: { attachment: [{ time: 0, name: "脸" }] } } },
      },
    }),
    atlas: CHINESE_ATLAS,
    pages: [
      { path: "images/face.png", data: new Uint8Array([1, 2, 3]) },
      { path: "images/arm-l.png", data: new Uint8Array([4, 5, 6]) },
    ],
    rig: { torso: "torso" },
    maxDelta: 60,
  };
}

function bakeChinese() {
  const asset = makeChineseAsset();
  const frames = [0, 1, 2].map((frame) =>
    BONE_NAMES.map((name) => (name === "torso" ? frame * 12 : 0)),
  );
  return {
    asset,
    baked: bakeCharacterProject(asset, {
      frames,
      baseFrame: 0,
      fps: 15,
      animationName: "video",
      spineVersion: "4.3.23",
    }),
  };
}

describe("中文命名的工程：导出时改名 + 平铺", () => {
  it("部位名按所属页的文件名换成英文", () => {
    const { baked } = bakeChinese();
    expect(baked.renames).toContainEqual(["脸", "face"]);
    expect(baked.renames).toContainEqual(["左臂", "arm-l"]);
    expect(hasNonAscii(baked.json)).toBe(false);
    expect(hasNonAscii(baked.atlas)).toBe(false);
  });

  it("页图片平铺到根目录，页名只留文件名", () => {
    const { baked } = bakeChinese();
    expect(baked.pages.map((page) => page.path)).toEqual(["face.png", "arm-l.png"]);
    expect(parseAtlasPageNames(baked.atlas)).toEqual(["face.png", "arm-l.png"]);
  });

  it("槽位名 / 附件名 / 动画引用一起改，images 字段被去掉", () => {
    const { baked } = bakeChinese();
    const doc = JSON.parse(baked.json) as {
      skeleton: Record<string, unknown>;
      slots: Array<{ name: string; attachment?: string }>;
      skins: Array<{ attachments: Record<string, Record<string, unknown>> }>;
      animations: Record<
        string,
        {
          slots?: Record<string, { attachment?: Array<{ name: string }> }>;
          bones?: Record<string, unknown>;
        }
      >;
    };
    expect(doc.skeleton.images).toBeUndefined();
    expect(doc.skeleton.spine).toBe("4.3.23");
    expect(doc.slots.map((slot) => slot.name)).toEqual(["face", "arm-l"]);
    expect(doc.slots.map((slot) => slot.attachment)).toEqual(["face", "arm-l"]);
    expect(Object.keys(doc.skins[0]!.attachments)).toEqual(["face", "arm-l"]);
    expect(doc.animations.idle!.slots!.face!.attachment!.map((key) => key.name)).toEqual(["face"]);
    // 我们烘焙进去的骨骼时间轴仍在
    expect(Object.keys(doc.animations.video!.bones ?? {})).toContain("torso");
  });

  it("官方 Spine 运行时能直接加载（region 找不到会在这里抛错）", () => {
    const { baked } = bakeChinese();
    const atlas = new spine.TextureAtlas(baked.atlas);
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const data = new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(baked.json));
    expect(atlas.pages).toHaveLength(2);
    expect(data.bones).toHaveLength(2);
  });

  it("打包后全是 ASCII 名字、图片齐全；缺图直接报错", () => {
    const { baked } = bakeChinese();
    const files = unzipSync(packCharacterProject(baked, "cn-video"));
    const names = Object.keys(files).toSorted();
    expect(names).toEqual(["arm-l.png", "cn-video.atlas", "cn-video.json", "face.png"]);
    expect(names.some((name) => hasNonAscii(name))).toBe(false);
    expect(() => packCharacterProject({ ...baked, pages: baked.pages.slice(1) }, "broken")).toThrow(
      /缺失的图/,
    );
  });
});
