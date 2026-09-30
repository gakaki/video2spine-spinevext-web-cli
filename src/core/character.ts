/**
 * 演示角色：把检测到的姿态**实时重定向**到 Spine 角色上。
 *
 * 重定向用的是"加法式局部旋转"：
 *
 * ```
 * 角色骨骼.rotation = 角色静止角 + (当前帧局部角 − 基准帧局部角)
 * ```
 *
 * 因为我们的骨骼树与角色的骨骼树都是链式的，逐级叠加局部增量就能让整条链
 * 跟着视频动，而不需要知道角色的骨骼长度、朝向或绑定姿势。
 *
 * 角色来源有两种，渲染路径完全一样：
 * * 内置演示角色（给 URL，按需 fetch）
 * * 用户上传的工程（给字节，直接解）
 */

import * as spine from "@esotericsoftware/spine-webgl";

import { BONE_NAMES, type BoneFrame } from "./types";

/** 我们的骨骼 → 角色骨骼的名字映射（缺的骨骼直接跳过）。 */
export interface CharacterRig {
  torso?: string;
  head?: string;
  upperArmL?: string;
  lowerArmL?: string;
  upperArmR?: string;
  lowerArmR?: string;
  upperLegL?: string;
  lowerLegL?: string;
  upperLegR?: string;
  lowerLegR?: string;
}

export interface DemoCharacter {
  id: string;
  name: string;
  jsonUrl: string;
  atlasUrl: string;
  rig: CharacterRig;
  /** 左右镜像：视频里人的左手在画面右侧，有些角色需要翻转。 */
  flipSides?: boolean;
  /** 角色整体缩放（1 = 自动适配画布）。 */
  scale?: number;
  /** 单根骨骼允许的最大转角增量（度），防止姿态抖动时四肢翻折。 */
  maxDelta?: number;
  /** 默认播放的待机动画名；没有就不播。 */
  idleAnimation?: string;
  /**
   * 要组合使用的皮肤名（按顺序叠加）。
   *
   * 官方示例里有的角色把身体放在单独的 skin 里（`mix-and-match` 的 `skin-base`、
   * `goblins` 的 `goblin`），默认皮肤几乎是空的——只挂 default 会画不出东西，
   * 包围盒也会算成 Infinity。这里显式列出要叠的皮肤；上传的工程走下面的启发式。
   */
  skins?: string[];
}

/** 已加载好的角色资源：图集页是字节，内置与上传共用同一条渲染路径。 */
export interface CharacterAsset {
  id: string;
  name: string;
  json: string;
  atlas: string;
  pages: Array<{ path: string; data: Uint8Array }>;
  rig: CharacterRig;
  maxDelta: number;
  scale?: number;
  idleAnimation?: string;
  skins?: string[];
  /** 由用户上传（而不是内置演示角色）。 */
  custom?: boolean;
}

/**
 * 内置演示角色。
 *
 * 全部来自 **Spine 官方示例**（`EsotericSoftware/spine-runtimes` 的 4.3 分支），
 * 每个角色目录里都带一份 `LICENSE.txt`——官方许可允许再分发，但要求随附该文件，
 * 且不得商用。想换成自己的角色，把它放进 `public/demo/<名字>/`（JSON + atlas + PNG），
 * 在这里加一条；或者直接在导出面板上传工程（骨骼名会走 `guessRig` 自动认）。
 *
 * 几个注意点：
 * * 官方示例的骨骼命名五花八门（`front-/rear-`、`left-/right-`、`body-up + leg-up/leg-down`），
 *   `guessRig` 只能猜出常见的那几种，所以内置角色的映射都是**逐个对着骨架写死**的；
 * * 只映射角色真正有的骨骼：多写的映射会被运行时静默跳过，界面上的"映射了几根"就和实际对不上；
 * * `idleAnimation` 是没人驱动时播的动画；`goblins` 只有一条 `walk`，就当待机用（会原地走，
 *   看起来比僵着强）。
 */
export const DEMO_CHARACTERS: DemoCharacter[] = [
  {
    id: "spineboy",
    name: "Spineboy",
    jsonUrl: "demo/spineboy/spineboy-pro.json",
    atlasUrl: "demo/spineboy/spineboy.atlas",
    idleAnimation: "idle",
    rig: {
      torso: "torso",
      head: "head",
      upperArmL: "rear-upper-arm",
      upperArmR: "front-upper-arm",
      upperLegL: "rear-thigh",
      lowerLegL: "rear-shin",
      upperLegR: "front-thigh",
      lowerLegR: "front-shin",
    },
  },
  {
    // 模块化角色：一页图集 + 多套皮肤（配件/服装），手臂腿都有 front/back 两条
    id: "mixandmatch",
    name: "Mix & Match",
    jsonUrl: "demo/mix-and-match/mix-and-match-pro.json",
    atlasUrl: "demo/mix-and-match/mix-and-match-pma.atlas",
    idleAnimation: "idle",
    // 这是个模块化角色：基础皮肤只有身体零件，头发/衣服/眼睛都是独立皮肤。
    // 官方预组合好的整套在 full-skins/ 下（boy / girl / girl-blue-cape / girl-spring-dress），
    // 用其中一套才是一个完整角色。
    skins: ["full-skins/boy"],
    rig: {
      torso: "body-up",
      head: "head",
      upperArmR: "arm-front-up",
      lowerArmR: "arm-front-down",
      upperArmL: "arm-back-up",
      lowerArmL: "arm-back-down",
      upperLegR: "leg-up",
      lowerLegR: "leg-down",
      upperLegL: "leg-up-back",
      lowerLegL: "leg-down-back",
    },
  },
  {
    // 秋千上的杂技演员：身体是 body-up，头在 face 骨骼上，四条肢体只有一节
    id: "circus",
    name: "Celestial Circus",
    jsonUrl: "demo/celestial-circus/celestial-circus-pro.json",
    atlasUrl: "demo/celestial-circus/celestial-circus.atlas",
    idleAnimation: "wind-idle",
    rig: {
      torso: "body-up",
      head: "face",
      upperArmR: "arm-front-up",
      upperArmL: "arm-back-up",
      upperLegR: "leg-front",
      lowerLegR: "leg-front-down",
      upperLegL: "leg-back",
      lowerLegL: "leg-back-down",
    },
  },
  {
    // 哥布林：标准 left-/right- 命名，`guessRig` 也能猜对，这里照样写死避免歧义
    id: "goblins",
    name: "Goblins",
    jsonUrl: "demo/goblins/goblins-pro.json",
    atlasUrl: "demo/goblins/goblins-pma.atlas",
    idleAnimation: "walk",
    // 哥布林的身体在 goblin 皮肤里（另外还有 goblingirl 可选）
    skins: ["default", "goblin"],
    rig: {
      torso: "torso",
      head: "head",
      upperArmL: "left-arm",
      upperArmR: "right-arm",
      upperLegL: "left-upper-leg",
      lowerLegL: "left-lower-leg",
      upperLegR: "right-upper-leg",
      lowerLegR: "right-lower-leg",
    },
  },
];

export interface CharacterStage {
  /** 用某一帧的骨骼旋转驱动角色（传 null 表示这一帧没检测到人）。 */
  applyFrame(frame: BoneFrame | null): void;
  setVisible(visible: boolean): void;
  /** 相对"刚好铺满"的缩放倍数。 */
  setZoom(zoom: number): void;
  /** 播放内置待机动画（在没人驱动时保持角色有呼吸感）。 */
  playIdle(): void;
  /** 这个角色有没有可播的待机动画（上传的工程可能一个动画都没有）。 */
  hasIdle: boolean;
  dispose(): void;
}

const BASE_URL = import.meta.env.BASE_URL || "/";

/**
 * 挑待机动画：显式名字优先，其次名字里带 `idle` 的，都没有就返回 null。
 *
 * 必须返回 null 而不是空串：Spine 的 `findAnimation("")` 会直接抛
 * `animationName cannot be null.`，上传的工程常常只有一条自己命名的动画。
 */
export function pickIdleAnimation(
  animations: ReadonlyArray<{ name: string }>,
  preferred: string,
): string | null {
  if (preferred) {
    const exact = animations.find((animation) => animation.name === preferred);
    if (exact) return exact.name;
  }
  const fuzzy = animations.find((animation) => /idle/i.test(animation.name));
  return fuzzy ? fuzzy.name : null;
}

function assetUrl(path: string): string {
  return `${BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/**
 * 在画布上创建角色舞台。`source` 可以是内置角色（URL）或已加载的角色资源（字节）。
 */
export async function createCharacterStage(
  canvas: HTMLCanvasElement,
  source: DemoCharacter | CharacterAsset,
): Promise<CharacterStage> {
  const demo: DemoCharacter | null = "jsonUrl" in source ? source : null;
  const asset: CharacterAsset | null = demo ? null : (source as CharacterAsset);
  const rig = demo ? demo.rig : asset!.rig;
  const maxDelta = demo ? (demo.maxDelta ?? 60) : asset!.maxDelta;
  const scaleFactor = demo ? (demo.scale ?? 1) : (asset!.scale ?? 1);
  const flipSides = demo?.flipSides ?? false;

  const jsonText = asset ? asset.json : await fetchText(assetUrl(demo!.jsonUrl));
  const atlasText = asset ? asset.atlas : await fetchText(assetUrl(demo!.atlasUrl));

  const context = new spine.ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
  });

  // 多页图集：每页各自一张贴图（有的工程把每个部件拆成独立 PNG）
  const textures = new Map<string, spine.GLTexture>();
  const atlas = new spine.TextureAtlas(atlasText);
  for (const page of atlas.pages) {
    const image = asset
      ? await decodeBytes(findPage(asset, page.name))
      : await loadImage(assetUrl(normalizePagePath(demo!, page.name)));
    // `page.pma` 是运行时从 atlas 的 `pma: true` 读出来的：预乘 alpha 的图集
    // （官方示例里有不少，文件名带 `-pma`）要按预乘方式上传，否则边缘会发暗。
    const texture = new spine.GLTexture(context, image, page.pma, false);
    page.setTexture(texture);
    textures.set(page.name, texture);
  }

  const loader = new spine.AtlasAttachmentLoader(atlas);
  const reader = new spine.SkeletonJson(loader);
  const data = reader.readSkeletonData(JSON.parse(jsonText));

  const skeleton = new spine.Skeleton(data);
  // 皮肤：显式配置优先；没配就看默认皮肤是不是"空壳"，是的话补一个不带 accessories 的皮肤
  const skin = composeSkin(data, demo ? demo.skins : asset!.skins);
  if (skin) skeleton.setSkin(skin);
  const stateData = new spine.AnimationStateData(data);
  const state = new spine.AnimationState(stateData);
  const renderer = new spine.SceneRenderer(canvas, context, false);

  // 待机动画：内置角色用配置的名字，上传的角色找名字里带 idle 的
  const idleName = demo ? (demo.idleAnimation ?? "") : (asset!.idleAnimation ?? "");
  const idle = pickIdleAnimation(data.animations, idleName);
  if (idle) state.setAnimation(0, idle, true);
  skeleton.setupPose();

  // 记录静止姿态：每个被映射的骨骼的初始 rotation
  const restCharacter = new Map<spine.Bone, number>();
  const targets: Array<{ bone: spine.Bone; ourIndex: number }> = [];
  for (const { ourName, characterName } of buildBindings(rig, flipSides)) {
    const bone = skeleton.findBone(characterName);
    const ourIndex = BONE_NAMES.indexOf(ourName);
    if (!bone || ourIndex < 0) continue;
    restCharacter.set(bone, bone.pose.rotation);
    targets.push({ bone, ourIndex });
  }
  if (targets.length === 0) {
    context.dispose();
    throw new Error("这个角色没有任何骨骼能和姿态对上（检查骨骼命名）");
  }

  let baseRotations: number[] | null = null;
  /** true = 由姿态驱动（此时不能再跑待机动画，否则会把骨骼角度覆盖回去） */
  let driven = false;
  let zoomFactor = 1;
  let visible = true;
  let disposed = false;
  let lastTime = performance.now();
  let frameHandle = 0;
  let lastProbeAt = 0;
  let probeCount = 0;

  // 骨架的静止包围盒只算一次：它决定相机取景。
  // 注意不能在每帧里算——算它要先把骨架复位（setupPose），
  // 那样会把姿态驱动写进去的骨骼角度一起清掉。
  const boundsOffset = new spine.Vector2();
  const boundsSize = new spine.Vector2();
  skeleton.setupPose();
  skeleton.updateWorldTransform(spine.Physics.update);
  skeleton.getBounds(boundsOffset, boundsSize, []);
  // 万一一条附件都没有（皮肤选错、素材损坏），包围盒会是 Infinity；
  // 这时退回骨架自己声明的尺寸，至少还能看见个大概而不是黑屏。
  const fitted =
    Number.isFinite(boundsOffset.x) && Number.isFinite(boundsSize.x) && boundsSize.x > 0;
  const contentWidth = Math.max(fitted ? boundsSize.x : data.width || 100, 1);
  const contentHeight = Math.max(fitted ? boundsSize.y : data.height || 100, 1);
  const contentCenterX = fitted
    ? boundsOffset.x + boundsSize.x / 2
    : (data.x || 0) + contentWidth / 2;
  const contentCenterY = fitted
    ? boundsOffset.y + boundsSize.y / 2
    : (data.y || 0) + contentHeight / 2;

  const fitCamera = () => {
    renderer.resize(spine.ResizeMode.Expand);
    const viewWidth = renderer.camera.viewportWidth || canvas.width;
    const viewHeight = renderer.camera.viewportHeight || canvas.height;
    renderer.camera.position.set(contentCenterX, contentCenterY, 0);
    renderer.camera.zoom =
      Math.max(
        (contentWidth * scaleFactor) / viewWidth,
        (contentHeight * scaleFactor) / viewHeight,
      ) *
      1.15 *
      zoomFactor;
  };

  const renderFrame = (now: number) => {
    if (disposed) return;
    frameHandle = requestAnimationFrame(renderFrame);
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // 被姿态驱动时绝不能跑待机动画：apply() 会把骨骼角度覆盖成动画里的值，
    // 于是角色看起来只在自己呼吸，完全不跟人动。
    if (!driven) {
      state.update(delta);
      state.apply(skeleton);
    }
    skeleton.updateWorldTransform(spine.Physics.update);
    fitCamera();

    if (import.meta.env.DEV && driven && probeCount < 6 && now - lastProbeAt > 800) {
      lastProbeAt = now;
      probeCount += 1;
      const snapshot = targets
        .map(({ bone }) => `${bone.data.name}=${bone.pose.rotation.toFixed(1)}`)
        .join(" ");
      // eslint-disable-next-line no-console
      console.info(`[character] ${snapshot}`);
    }

    const gl = context.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (visible) {
      renderer.begin();
      renderer.drawSkeleton(skeleton);
      renderer.end();
    }
  };
  frameHandle = requestAnimationFrame(renderFrame);

  return {
    applyFrame(frame) {
      if (!frame) return;
      if (!driven) {
        // 从待机切到驱动：清掉动画轨道并把骨架复位，
        // 否则没被映射到的骨骼会留在动画的最后一帧姿势上。
        state.clearTracks();
        skeleton.setupPose();
        driven = true;
      }
      // 第一帧当作基准：之后的偏差都相对它
      baseRotations ??= frame.rotations.slice();
      for (const { bone, ourIndex } of targets) {
        const rest = restCharacter.get(bone) ?? 0;
        const raw = (frame.rotations[ourIndex] ?? 0) - (baseRotations[ourIndex] ?? 0);
        // 限幅：低置信度帧偶尔会让关节角跳几十度，夹住之后动作才像人
        const delta = Math.min(Math.max(raw, -maxDelta), maxDelta);
        bone.pose.rotation = rest + delta;
      }
    },
    setVisible(next) {
      visible = next;
    },
    setZoom(next) {
      zoomFactor = next;
      fitCamera();
    },
    playIdle() {
      if (!driven) return;
      driven = false;
      baseRotations = null;
      if (idle) state.setAnimation(0, idle, true);
    },
    hasIdle: idle !== null,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      renderer.dispose();
      textures.forEach((texture) => texture.dispose());
      context.dispose();
    },
  };
}

/**
 * 挑/组合皮肤。
 *
 * * 传了名字就按名字叠加（缺的忽略）；
 * * 没传就看默认皮肤是不是空壳：Slots 里挂上的附件太少（少于槽位数的 1/4），
 *   就从其它皮肤里找一个不是 `accessories/` 开头的补上——官方示例里
 *   `mix-and-match`、`goblins` 都是这种"身体在单独皮肤里"的结构。
 */
export function composeSkin(data: spine.SkeletonData, preferred?: string[]): spine.Skin | null {
  const names = preferred?.filter((name) => data.findSkin(name)) ?? [];
  if (names.length > 0) {
    const composed = new spine.Skin("spinevext-composed");
    for (const name of names) composed.addSkin(data.findSkin(name)!);
    return composed;
  }

  const base = data.defaultSkin ?? data.skins[0] ?? null;
  if (!base) return null;
  const attached = countAttachments(base);
  const threshold = Math.max(2, Math.floor(data.slots.length / 4));
  if (attached >= threshold) return null; // 默认皮肤够用，别动它

  const filler = data.skins.find(
    (skin) =>
      skin.name !== base.name &&
      !/^accessories\b/i.test(skin.name) &&
      countAttachments(skin) > attached,
  );
  if (!filler) return null;
  const composed = new spine.Skin("spinevext-composed");
  composed.addSkin(base);
  composed.addSkin(filler);
  return composed;
}

function countAttachments(skin: spine.Skin): number {
  let total = 0;
  for (let index = 0; index < skin.getAttachments().length; index += 1) {
    if (skin.getAttachments()[index]) total += 1;
  }
  return total;
}

/** 把我们的骨骼名映射到角色骨骼名。 */
function buildBindings(
  rig: CharacterRig,
  flipSides: boolean,
): Array<{ ourName: (typeof BONE_NAMES)[number]; characterName: string }> {
  const pairs: Array<[string | undefined, string | undefined]> = flipSides
    ? [
        [rig.torso, "torso"],
        [rig.head, "head"],
        [rig.upperArmL, "upperArm.R"],
        [rig.lowerArmL, "lowerArm.R"],
        [rig.upperArmR, "upperArm.L"],
        [rig.lowerArmR, "lowerArm.L"],
        [rig.upperLegL, "upperLeg.R"],
        [rig.lowerLegL, "lowerLeg.R"],
        [rig.upperLegR, "upperLeg.L"],
        [rig.lowerLegR, "lowerLeg.L"],
      ]
    : [
        [rig.torso, "torso"],
        [rig.head, "head"],
        [rig.upperArmL, "upperArm.L"],
        [rig.lowerArmL, "lowerArm.L"],
        [rig.upperArmR, "upperArm.R"],
        [rig.lowerArmR, "lowerArm.R"],
        [rig.upperLegL, "upperLeg.L"],
        [rig.lowerLegL, "lowerLeg.L"],
        [rig.upperLegR, "upperLeg.R"],
        [rig.lowerLegR, "lowerLeg.R"],
      ];
  return pairs
    .filter(([characterName]) => Boolean(characterName))
    .map(([characterName, ourName]) => ({
      ourName: ourName as (typeof BONE_NAMES)[number],
      characterName: characterName as string,
    }));
}

/**
 * 图集里的页名是相对角色目录的路径（如 `images/tail-fin.png`）或纯文件名。
 * 两种情况都要拼到角色所在目录下才能取到图片。
 */
function normalizePagePath(character: DemoCharacter, pageName: string): string {
  if (/^(https?:)?\/\//.test(pageName) || pageName.startsWith("/")) return pageName;
  const base = character.jsonUrl.replace(/[^/]+$/, "");
  return `${base}${pageName}`;
}

/** 在已加载的资源里按页名（允许只给文件名）找到图片字节。 */
function findPage(asset: CharacterAsset, pageName: string): Uint8Array {
  const wanted = pageName.split("/").pop()?.toLowerCase() ?? pageName;
  const hit =
    asset.pages.find((page) => page.path === pageName) ??
    asset.pages.find((page) => (page.path.split("/").pop() ?? "").toLowerCase() === wanted);
  if (!hit) throw new Error(`角色资源里缺少图集页 ${pageName}`);
  return hit.data;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return response.text();
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`读取图片 ${url} 失败`));
    image.src = url;
  });
  return image;
}

async function decodeBytes(data: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([data as BlobPart], { type: "image/png" }));
}
