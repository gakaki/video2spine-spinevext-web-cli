/**
 * 用**官方 Spine 运行时**（`@esotericsoftware/spine-webgl`）实时播放导出的工程。
 *
 * 数据来源就是我们自己导出的三件套：JSON + atlas 文本 + 图集 PNG，
 * 所以这一屏是"导出的结果真的能在 Spine 里跑起来"的直接证据，
 * 而不是另画一套预览。
 *
 * 版本必须对齐：导出写的是 Spine 4.3 JSON（见 `crates/spinevext-core/src/spine.rs`），
 * 运行时用 4.3.x。
 */

import * as spine from "@esotericsoftware/spine-webgl";

export interface SpineBundleInput {
  /** 导出的 Spine JSON 文本。 */
  json: string;
  /** 导出的 `.atlas` 文本。 */
  atlas: string;
  /** 图集 PNG 字节。 */
  png: Uint8Array;
  /** 视频帧宽高，用来把骨架框进画面。 */
  frameWidth: number;
  frameHeight: number;
}

export interface SpinePreview {
  readonly animationNames: string[];
  readonly playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  setSpeed(speed: number): void;
  /** 相对"刚好铺满"的缩放倍数，1 = 铺满。 */
  setZoom(zoom: number): void;
  /** 回到当前动画的起点。 */
  restart(): void;
  dispose(): void;
}

type Renderer = InstanceType<typeof spine.SceneRenderer>;

/**
 * 在给定 canvas 上创建实时预览。返回的句柄负责播放控制与资源释放。
 */
export async function createSpinePreview(
  canvas: HTMLCanvasElement,
  bundle: SpineBundleInput,
): Promise<SpinePreview> {
  const bitmap = await decodePng(bundle.png);
  const context = new spine.ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
  });

  // 我们的图集是直通 alpha（非预乘），所以 pma = false
  const texture = new spine.GLTexture(context, bitmap, false, false);
  const atlas = new spine.TextureAtlas(bundle.atlas);
  // Spine 4.x 的 TextureAtlas 不再接收加载回调，页面纹理要自己挂上去
  for (const page of atlas.pages) {
    page.setTexture(texture);
  }
  const loader = new spine.AtlasAttachmentLoader(atlas);
  const json = new spine.SkeletonJson(loader);
  const data = json.readSkeletonData(JSON.parse(bundle.json));

  const skeleton = new spine.Skeleton(data);
  const stateData = new spine.AnimationStateData(data);
  const state = new spine.AnimationState(stateData);
  const animationNames = data.animations.map((animation) => animation.name);
  const first = animationNames[0];
  if (first) state.setAnimation(0, first, true);

  // twoColorTint = false：我们只用普通 region 附件
  const renderer: Renderer = new spine.SceneRenderer(canvas, context, false);

  let zoomFactor = 1;
  let speed = 1;
  let playing = true;
  let disposed = false;
  let lastTime = performance.now();
  let frameHandle = 0;

  /** 让内容刚好铺满画布，再乘上用户的缩放倍数。 */
  const fit = () => {
    renderer.resize(spine.ResizeMode.Expand);
    const viewWidth = renderer.camera.viewportWidth || canvas.width;
    const viewHeight = renderer.camera.viewportHeight || canvas.height;
    renderer.camera.position.set(0, 0, 0);
    renderer.camera.zoom =
      Math.max(bundle.frameWidth / viewWidth, bundle.frameHeight / viewHeight) * zoomFactor;
  };

  const renderFrame = (now: number) => {
    if (disposed) return;
    frameHandle = requestAnimationFrame(renderFrame);

    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (playing) {
      state.update(delta * speed);
      state.apply(skeleton);
    }
    skeleton.updateWorldTransform(spine.Physics.update);

    fit();
    const gl = context.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton);
    renderer.end();
  };
  frameHandle = requestAnimationFrame(renderFrame);

  const onResize = () => fit();
  window.addEventListener("resize", onResize);

  return {
    animationNames,
    get playing() {
      return playing;
    },
    play() {
      playing = true;
      lastTime = performance.now();
    },
    pause() {
      playing = false;
    },
    toggle() {
      playing = !playing;
      lastTime = performance.now();
    },
    setSpeed(next: number) {
      speed = next;
    },
    setZoom(next: number) {
      zoomFactor = next;
      fit();
    },
    restart() {
      state.clearTracks();
      if (first) state.setAnimation(0, first, true);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      texture.dispose();
      bitmap.close();
      context.dispose();
    },
  };
}

async function decodePng(png: Uint8Array): Promise<ImageBitmap> {
  const blob = new Blob([png as BlobPart], { type: "image/png" });
  return createImageBitmap(blob);
}
