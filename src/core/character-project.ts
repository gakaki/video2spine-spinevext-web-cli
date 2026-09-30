/**
 * 角色工程：把**视频里检测到的骨骼数据**烘焙到选定的 Spine 角色上，导出成可编辑的工程。
 *
 * 产出的是「角色的美术 + 视频的动作」：
 * * 骨架 / 皮肤 / 图集 —— 用角色自己的（内置演示角色或用户上传的工程）
 * * 动画 —— 用刚才视频检测出的骨骼角度，重定向到角色骨骼后写成 `rotate` 时间轴
 *
 * 与「视频帧图集」导出（把每帧画面当 region 附件）是两种不同的产物，用户可以选。
 */

import { unzipSync, zipSync, type Zippable } from "fflate";

import {
  baseName,
  parseAtlasBlocks,
  parseAtlasPageNames,
  parseAtlasRegions,
  resolvePagePath,
} from "./atlas-format";
import {
  DEMO_CHARACTERS,
  type CharacterAsset,
  type CharacterRig,
  type DemoCharacter,
} from "./character";
import { BONE_NAMES } from "./types";

/** 图集的一页（含原始相对路径，导出时会按同样结构打包）。 */
export type CharacterPage = CharacterAsset["pages"][number];

// `import.meta.env` 只有 Vite 里才有；写成可选链，脚本 / Node 侧也能加载本模块
const BASE_URL = import.meta.env?.BASE_URL || "/";

function assetUrl(path: string): string {
  return `${BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** 加载内置演示角色的完整资源（含图集页图片字节）。 */
export async function loadBuiltInCharacterAsset(id: string): Promise<CharacterAsset> {
  const character = DEMO_CHARACTERS.find((item) => item.id === id) ?? DEMO_CHARACTERS[0]!;
  const baseDir = character.jsonUrl.replace(/[^/]+$/, "");
  const [json, atlas] = await Promise.all([
    fetchText(assetUrl(character.jsonUrl)),
    fetchText(assetUrl(character.atlasUrl)),
  ]);
  const pages = await Promise.all(
    parseAtlasPageNames(atlas).map(async (pageName) => ({
      path: pageName,
      data: await fetchBytes(assetUrl(resolvePagePath(baseDir, pageName))),
    })),
  );
  return {
    id: character.id,
    name: character.name,
    json,
    atlas,
    pages,
    rig: character.rig,
    maxDelta: character.maxDelta ?? 60,
  };
}

/**
 * 加载用户上传的 Spine 工程。
 *
 * 支持两种给法：
 * * 一个 zip（比如本工具导出的 zip，或 Spine 导出的工程包）
 * * 直接多选骨架 JSON + `.atlas` + 图集 PNG
 */
export async function loadUserCharacterAsset(files: File[]): Promise<CharacterAsset> {
  if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) {
    const entries = unzipSync(new Uint8Array(await files[0]!.arrayBuffer()));
    const names = Object.keys(entries);
    const jsonName = names.find((name) => /\.json$/i.test(name));
    const atlasName = names.find((name) => /\.atlas$/i.test(name));
    if (!jsonName || !atlasName) {
      throw new Error("zip 里没找到骨架 JSON 或 .atlas 文件");
    }
    const json = new TextDecoder().decode(entries[jsonName]);
    const atlas = new TextDecoder().decode(entries[atlasName]);
    const pages = parseAtlasPageNames(atlas).map((pageName) => {
      const wanted = baseName(pageName).toLowerCase();
      const hit = names.find((name) => baseName(name).toLowerCase() === wanted);
      if (!hit) throw new Error(`zip 里缺少图集页 ${pageName}`);
      return { path: pageName, data: entries[hit]! };
    });
    return buildCustomAsset(json, atlas, pages, files[0]!.name.replace(/\.zip$/i, ""));
  }

  const jsonFile = files.find((file) => /\.json$/i.test(file.name));
  const atlasFile = files.find((file) => /\.atlas$/i.test(file.name));
  if (!jsonFile || !atlasFile) {
    throw new Error("请同时选择骨架 JSON 与 .atlas 文件（或直接给一个 zip）");
  }
  const json = await jsonFile.text();
  const atlas = await atlasFile.text();
  const images = files.filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file.name));
  const pages = await Promise.all(
    parseAtlasPageNames(atlas).map(async (pageName) => {
      const wanted = baseName(pageName).toLowerCase();
      const hit = images.find((file) => file.name.toLowerCase() === wanted);
      if (!hit) throw new Error(`没有选到图集页 ${pageName}`);
      return { path: pageName, data: new Uint8Array(await hit.arrayBuffer()) };
    }),
  );
  return buildCustomAsset(json, atlas, pages, jsonFile.name.replace(/\.json$/i, ""));
}

function buildCustomAsset(
  json: string,
  atlas: string,
  pages: CharacterPage[],
  name: string,
): CharacterAsset {
  const parsed = JSON.parse(json) as { bones?: Array<{ name?: string }> };
  const boneNames = (parsed.bones ?? []).map((bone) => bone.name ?? "").filter(Boolean);
  const rig = guessRig(boneNames);
  const mapped = Object.values(rig).filter(Boolean).length;
  if (mapped === 0) {
    throw new Error(
      `没能从骨骼名里认出任何可映射的骨骼（共 ${boneNames.length} 根），例如 torso / head / arm-l / leg-l`,
    );
  }
  return { id: "custom", name, json, atlas, pages, rig, maxDelta: 60, custom: true };
}

/**
 * 从骨骼名猜一份映射表。
 *
 * 覆盖三种常见命名：`torso/arm-l/leg-r`（本项目另一条产线的 Q 版角色）、
 * `front-upper-arm/rear-thigh`（Spine 官方示例）、`upperArm.L/upperLeg.R`（标准命名）。
 */
export function guessRig(boneNames: string[]): CharacterRig {
  const lower = boneNames.map((name) => name.toLowerCase());
  // 侧别别名：`rear-`/`left-`/`l-` 当左侧，`front-`/`right-`/`r-` 当右侧。
  // 之所以把 `front-` 判成右侧，是为了与内置演示角色 Spineboy 的映射保持一致
  // （Spine 官方示例里 front/rear 表示离镜头近/远，不是左右）。
  const alias: Record<"L" | "R", string> = { L: "rear|left|l", R: "front|right|r" };

  /**
   * 按"部位写法"找一根骨骼，同时认三种写法：
   * 前缀式 `rear-upper-arm`、后缀式 `arm-l`、标准式 `upperArm.L`。
   */
  const pick = (side: "L" | "R" | null, variants: string[]): string | undefined => {
    for (const variant of variants) {
      const patterns = side
        ? [
            new RegExp(`^(?:${alias[side]})[-_.]?${variant}$`),
            new RegExp(`^${variant}[-_.]?${side === "L" ? "l" : "r"}$`),
          ]
        : [new RegExp(`^${variant}$`)];
      const index = lower.findIndex((name) => patterns.some((pattern) => pattern.test(name)));
      if (index >= 0) return boneNames[index];
    }
    return undefined;
  };

  const arm = (side: "L" | "R") => pick(side, ["upper[-_]?arm", "upperarm", "arm"]);
  const leg = (side: "L" | "R") => pick(side, ["upper[-_]?leg", "thigh", "leg"]);

  return {
    torso: pick(null, ["torso", "spine", "body", "chest", "torso\\d*"]),
    head: pick(null, ["head", "neck"]),
    upperArmL: arm("L"),
    upperArmR: arm("R"),
    lowerArmL: pick("L", ["lower[-_]?arm", "lowerarm", "forearm"]),
    lowerArmR: pick("R", ["lower[-_]?arm", "lowerarm", "forearm"]),
    upperLegL: leg("L"),
    upperLegR: leg("R"),
    lowerLegL: pick("L", ["lower[-_]?leg", "shin", "calf"]),
    lowerLegR: pick("R", ["lower[-_]?leg", "shin", "calf"]),
  };
}

export interface BakeOptions {
  /** 逐帧局部旋转角（顺序同 `BONE_NAMES`），来自视频检测的烘焙结果。 */
  frames: number[][];
  /** 基准帧下标（这一帧当作角色静止姿态）。 */
  baseFrame: number;
  fps: number;
  animationName: string;
  /** 写进 `skeleton.spine` 的格式版本号（来自 Rust 内核，全仓库同一份）。 */
  spineVersion: string;
}

export interface BakedProject {
  json: string;
  atlas: string;
  pages: CharacterPage[];
  mappedBones: string[];
  frameCount: number;
  /** 非 ASCII 部位名 → 英文名的映射（导出时做过归一化，空数组表示原名本来就干净）。 */
  renames: Array<[string, string]>;
}

/**
 * 把部位名（region / slot / 附件名）里的非 ASCII 名字映射成英文名。
 *
 * 规则：用这个 region **所在页的文件名**（去掉扩展名）当英文名——
 * 中文命名的工程（`images/face.png` / `images/hair-back.png` …）里，页文件名本来就是
 * SeeThrough 风格的英文部件名，所以这样映射既是一一对应的、不用猜语义，
 * 又和美术文件同名，导出后一眼能对上。
 *
 * 只处理非 ASCII 名字：官方示例那种已经全英文的工程原样保留（它一页上有很多
 * region，按页名改名会撞车）。同页多 region 或撞名时加 `-2`、`-3` 后缀。
 */
export function buildNameMap(atlasText: string): Map<string, string> {
  const pages = parseAtlasPageNames(atlasText);
  const regions = parseAtlasRegions(atlasText);
  const taken = new Set<string>(regions.map((region) => region.name));

  const map = new Map<string, string>();
  for (const region of regions) {
    if (isAscii(region.name)) continue;
    const stem = baseName(region.page).replace(/\.[^.]+$/, "");
    if (!stem || !isAscii(stem)) continue;
    let candidate = stem;
    for (let index = 2; taken.has(candidate) && candidate !== region.name; index += 1) {
      candidate = `${stem}-${index}`;
    }
    taken.add(candidate);
    map.set(region.name, candidate);
  }

  // 页名本身也可能是中文（这里不会，但别让页面路径把导出搞坏）
  pages.forEach((page, index) => {
    if (isAscii(page)) return;
    const stem = `page-${index + 1}`;
    if (!map.has(page)) map.set(page, stem);
  });
  return map;
}

function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value);
}

/** 递归改 JSON 里的键与字符串值：只改映射表里出现过的确切名字。 */
function renameInJson(node: unknown, renames: Map<string, string>): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      if (typeof item === "string") {
        const next = renames.get(item);
        if (next) node[index] = next;
        return;
      }
      renameInJson(item, renames);
    });
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string") {
      const next = renames.get(value);
      if (next) record[key] = next;
    } else {
      renameInJson(value, renames);
    }
    const renamedKey = renames.get(key);
    if (renamedKey && renamedKey !== key) {
      record[renamedKey] = record[key];
      delete record[key];
    }
  }
}

/**
 * 重写图集文本：页名只留文件名（平铺到工程根目录），部位名换成英文名。
 *
 * 名字行只换名字、属性行原样搬过去，同时**保证每个页块前面有一个空行**：
 * Spine 的解析器（`TextureAtlas`）是这么判定新页的——遇到空行才把
 * "下一个名字行"当页，否则一律当成上一个页的 region。反过来，如果源文件在
 * region 之间夹了空行，那些 region 会被误判成新页，所以这里统一重排成
 * "页块前留空行、其余不留"，两种脏数据都能救回来。
 */
function normalizeAtlasText(atlasText: string, renames: Map<string, string>): string {
  const lines = atlasText.split(/\r?\n/);
  const blocks = parseAtlasBlocks(atlasText);
  const out: string[] = [];
  // 第一个名字行之前的内容（图集头）原样保留
  const headerEnd = blocks[0]?.lineIndex ?? lines.length;
  out.push(...lines.slice(0, headerEnd).filter((line) => line.trim().length > 0));

  for (const block of blocks) {
    // 页块前必须有空行，Spine 靠它判断"这里是新的一页"
    if (block.isPage && out.length > 0) out.push("");
    const renamed = block.isPage
      ? baseName(renames.get(block.name) ?? block.name)
      : (renames.get(block.name) ?? block.name);
    const raw = lines[block.lineIndex];
    out.push((raw ?? block.name).replace(block.name, renamed));
    out.push(...block.lines);
  }
  return `${out.join("\n")}\n`;
}

/** 一份还没归一化的角色工程（骨架 JSON + atlas 文本 + 页图片字节）。 */
export interface CharacterProjectSource {
  json: string;
  atlas: string;
  pages: CharacterPage[];
}

export interface NormalizedCharacterProject {
  json: string;
  atlas: string;
  pages: CharacterPage[];
  /** 非 ASCII 部位名 → 英文名的映射。 */
  renames: Array<[string, string]>;
}

/**
 * 让工程能直接在 Spine 编辑器里打开：非 ASCII 部位名换英文、页图片平铺、
 * 去掉会被编辑器拿去拼路径的 `skeleton.images`。
 *
 * 已经全英文的工程（官方示例那种）只会被平铺页路径，名字不动。
 */
export function normalizeCharacterProject(
  source: CharacterProjectSource,
): NormalizedCharacterProject {
  const renames = buildNameMap(source.atlas);
  const doc = JSON.parse(source.json) as { skeleton?: Record<string, unknown> };
  if (renames.size > 0) renameInJson(doc, renames);
  const skeleton: Record<string, unknown> = { ...doc.skeleton };
  delete skeleton.images;
  doc.skeleton = skeleton;

  return {
    json: JSON.stringify(doc),
    atlas: normalizeAtlasText(source.atlas, renames),
    pages: source.pages.map((page) => ({ path: baseName(page.path), data: page.data })),
    renames: [...renames],
  };
}

/**
 * 把检测到的骨骼数据烘焙成角色的动画时间轴。
 *
 * 与实时预览用的是同一套公式：
 * `角色骨骼.rotation = 角色静止角 + clamp(当前帧局部角 − 基准帧局部角)`。
 */
export function bakeCharacterProject(asset: CharacterAsset, options: BakeOptions): BakedProject {
  const doc = JSON.parse(asset.json) as {
    skeleton?: Record<string, unknown>;
    bones?: Array<{ name?: string; rotation?: number }>;
    animations?: Record<string, unknown>;
  };
  const bones = doc.bones ?? [];
  const indexOf = new Map(bones.map((bone, index) => [bone.name ?? "", index]));
  const fps = options.fps > 0 ? options.fps : 30;
  const base = options.frames[options.baseFrame] ?? [];

  // 角色工程里写的版本号可能是任意的 4.3.x（官方示例甚至是 4.3.75-beta），
  // 导出时统一盖成我们锁定的那个版本，保证产物版本可预期。
  doc.skeleton = { ...doc.skeleton, spine: options.spineVersion };

  const boneTimelines: Record<string, { rotate: Array<{ time: number; value: number }> }> = {};
  const mapped: string[] = [];

  for (const ourName of BONE_NAMES) {
    const ourIndex = BONE_NAMES.indexOf(ourName);
    const characterName = mapBoneName(asset.rig, ourName);
    if (!characterName) continue;
    const boneIndex = indexOf.get(characterName);
    if (boneIndex === undefined) continue;
    const rest = bones[boneIndex]?.rotation ?? 0;
    const baseValue = base[ourIndex] ?? 0;
    const rotate = options.frames.map((frame, frameIndex) => {
      const raw = (frame[ourIndex] ?? 0) - baseValue;
      const delta = Math.min(Math.max(raw, -asset.maxDelta), asset.maxDelta);
      return { time: frameIndex / fps, value: round(rest + delta) };
    });
    // 全程不动的轨道没有价值，跳过
    if (rotate.every((key) => Math.abs(key.value - rotate[0]!.value) < 1e-4)) continue;
    boneTimelines[characterName] = { rotate };
    mapped.push(characterName);
  }

  if (mapped.length === 0) {
    throw new Error("视频数据没能映射到角色的任何骨骼上，检查一下骨骼命名");
  }

  doc.animations = { ...doc.animations, [options.animationName]: { bones: boneTimelines } };

  // 名字与路径归一化：中文部位名换英文、页图片平铺、去掉 skeleton.images
  // （见 normalizeCharacterProject 的注释，这三件事是 Spine 里显示 MISSING 的主因）
  const normalized = normalizeCharacterProject({
    json: JSON.stringify(doc),
    atlas: asset.atlas,
    pages: asset.pages,
  });

  return {
    ...normalized,
    mappedBones: mapped,
    frameCount: options.frames.length,
  };
}

function mapBoneName(rig: CharacterRig, ourName: string): string | undefined {
  switch (ourName) {
    case "torso":
      return rig.torso;
    case "head":
      return rig.head;
    case "upperArm.L":
      return rig.upperArmL;
    case "upperArm.R":
      return rig.upperArmR;
    case "lowerArm.L":
      return rig.lowerArmL;
    case "lowerArm.R":
      return rig.lowerArmR;
    case "upperLeg.L":
      return rig.upperLegL;
    case "upperLeg.R":
      return rig.upperLegR;
    case "lowerLeg.L":
      return rig.lowerLegL;
    case "lowerLeg.R":
      return rig.lowerLegR;
    default:
      return undefined;
  }
}

/** 压成 zip：骨架 JSON + atlas + 各页图片（保持 atlas 里的相对路径）。 */
export function packCharacterProject(project: BakedProject, name: string): Uint8Array {
  const files: Zippable = {
    [`${name}.json`]: new TextEncoder().encode(project.json),
    [`${name}.atlas`]: new TextEncoder().encode(project.atlas),
  };
  for (const page of project.pages) {
    files[page.path] = page.data;
  }
  // 图集里引用、但包里没有的页 = 打开后满屏 MISSING。这种情况宁可直接报错，
  // 也不要导出一个人看起来正常、Spine 里全是缺图的 zip。
  const missing = parseAtlasPageNames(project.atlas).filter((page) => !(page in files));
  if (missing.length > 0) {
    throw new Error(
      `图集引用了 ${missing.length} 张缺失的图，导出中止：${missing.slice(0, 3).join("、")}`,
    );
  }
  return zipSync(files, { level: 6 });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return response.text();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export type { DemoCharacter };
