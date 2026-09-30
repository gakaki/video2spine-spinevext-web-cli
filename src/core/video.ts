/**
 * 取帧层：把视频文件或摄像头画面变成一帧帧 RGBA 像素。
 *
 * 对应原版的 AVProVideo + `VideoToSpineSkeleManager.CapturedFrame`：
 * 都是"按时间轴逐帧 seek、画进画布、读回像素"。
 */

/** 取帧源的统一接口。 */
export interface FrameSource {
  /** 采样后的帧宽（像素）。 */
  readonly width: number;
  /** 采样后的帧高（像素）。 */
  readonly height: number;
  /** 采样帧数。 */
  readonly frameCount: number;
  /** 采样帧率。 */
  readonly fps: number;
  /**
   * 正在播放的媒体元素（文件视频或摄像头流）。
   *
   * 实时预览直接 `drawImage(element)` 就得到真正的实时画面，
   * 不需要逐帧 seek——之前的实现只在换帧时画一次，看起来就是"卡住的图"。
   */
  readonly element: HTMLVideoElement | null;
  /** 实时总时长（秒）；摄像头为 `Infinity`。 */
  readonly duration: number;
  /** 当前播放位置（秒）。 */
  readonly currentTime: number;
  /** 是否暂停。 */
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  /** 跳到指定时刻（秒）。 */
  seek(time: number): void;
  /** 读取第 `index` 帧的像素。 */
  readFrame(index: number): Promise<ImageData>;
  dispose(): void;
}

export interface VideoSourceOptions {
  /** 采样帧率，越高越精细也越慢。 */
  fps: number;
  /** 从视频的第几秒开始采样。 */
  startTime: number;
  /** 到第几秒结束（`undefined` 表示到片尾）。 */
  endTime?: number | undefined;
  /** 采样分辨率上限，超过就等比缩小，避免大视频拖慢推理。 */
  maxWidth: number;
  /** 水平镜像（自拍视角）。会在取帧时就翻转，保证骨骼与画面对齐。 */
  flipX: boolean;
}

export const DEFAULT_VIDEO_OPTIONS: VideoSourceOptions = {
  fps: 15,
  startTime: 0,
  maxWidth: 960,
  flipX: false,
};

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持 2D 画布上下文");
  return context;
}

function fitSize(width: number, height: number, maxWidth: number) {
  if (width <= maxWidth) return { width, height };
  const ratio = maxWidth / width;
  return { width: maxWidth, height: Math.round(height * ratio) };
}

/**
 * 基于 `<video>` 的取帧源。视频元素只在内存里，不挂到 DOM 上，
 * 通过 `currentTime` + `seeked` 事件精确取帧。
 */
export async function createVideoFrameSource(
  file: File,
  options: Partial<VideoSourceOptions> = {},
): Promise<FrameSource> {
  const config = { ...DEFAULT_VIDEO_OPTIONS, ...options };
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // 预览时循环播放，方便一直看着角色跟随效果
  video.loop = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("无法读取这个视频文件"));
  });

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const start = Math.max(0, Math.min(config.startTime, duration));
  const end = Math.max(start, Math.min(config.endTime ?? duration, duration));
  const size = fitSize(video.videoWidth, video.videoHeight, config.maxWidth);
  const canvas = createCanvas(size.width, size.height);
  const context = context2d(canvas);
  const frameCount = Math.max(1, Math.floor((end - start) * config.fps));

  const seek = (time: number) =>
    new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = Math.min(Math.max(time, 0), duration || 0);
    });

  return {
    width: size.width,
    height: size.height,
    frameCount,
    fps: config.fps,
    element: video,
    duration,
    get currentTime() {
      return video.currentTime;
    },
    get paused() {
      return video.paused;
    },
    async play() {
      await video.play();
    },
    pause() {
      video.pause();
    },
    seek(time: number) {
      video.currentTime = Math.min(Math.max(time, 0), duration || 0);
    },
    async readFrame(index: number) {
      const time = start + index / config.fps;
      await seek(time);
      context.save();
      if (config.flipX) {
        context.translate(size.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, 0, 0, size.width, size.height);
      context.restore();
      return context.getImageData(0, 0, size.width, size.height);
    },
    dispose() {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * 基于 `getUserMedia` 的取帧源。
 *
 * 摄像头是**一直活着的**：预览直接画这个 video 元素（所以实时），
 * 批量检测要用的帧则在 `readFrame` 被调用时按目标帧率现抓一张——
 * 这样"开始检测"不会把界面卡在录制上，实时角色也能同时跟着动。
 */
export async function createWebcamFrameSource(
  options: Partial<VideoSourceOptions> & { duration?: number } = {},
): Promise<FrameSource> {
  const config = { ...DEFAULT_VIDEO_OPTIONS, ...options };
  const recordSeconds = options.duration ?? 4;
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0) return resolve();
    video.onloadeddata = () => resolve();
  });

  const size = fitSize(video.videoWidth, video.videoHeight, config.maxWidth);
  const canvas = createCanvas(size.width, size.height);
  const context = context2d(canvas);
  const frameCount = Math.max(1, Math.floor(recordSeconds * config.fps));
  const startedAt = performance.now();

  return {
    width: size.width,
    height: size.height,
    frameCount,
    fps: config.fps,
    element: video,
    duration: Number.POSITIVE_INFINITY,
    get currentTime() {
      return video.currentTime;
    },
    get paused() {
      return video.paused;
    },
    async play() {
      await video.play();
    },
    pause() {
      // 摄像头没有"暂停"的概念，停止推进取帧即可
    },
    seek() {
      // 直播流不可 seek
    },
    async readFrame(index: number) {
      // 按采样节奏等到该抓这一帧的时刻，再抓"此刻"的画面
      const due = startedAt + (index * 1000) / config.fps;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      context.save();
      if (config.flipX) {
        context.translate(size.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, 0, 0, size.width, size.height);
      context.restore();
      return context.getImageData(0, 0, size.width, size.height);
    },
    dispose() {
      video.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
