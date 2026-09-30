/**
 * 实时驱动回路：一边播放视频/摄像头，一边按目标帧率跑姿态估计，
 * 把每帧的姿态直接喂给「骨架叠加」与「Spine 角色」。
 *
 * 与批量流水线（`pipeline.ts`）的区别：
 * * 批量：逐帧 seek → 跑完全片 → 烘焙动画 → 导出；
 * * 实时：跟播放头走，只做"当前这一帧"的估计，用于即时预览与角色跟随。
 *
 * 两者共用同一套 Rust 解码/平滑/骨骼代码，只是实时模式把窗口缩到很小。
 */

import type { Engine } from "./engine";
import { decodeOutput, prepareInput, type PoseModel } from "./inference";
import type { BoneFrame, DecodeConfig, Pose2D, RigConfig, SmoothConfig } from "./types";
import type { FrameSource } from "./video";

export interface LiveSample {
  pose: Pose2D | null;
  /** 当前帧的骨骼局部旋转角（顺序同 `BONE_NAMES`）。 */
  rotations: number[] | null;
  /** 该帧是否骨骼完整。 */
  valid: boolean;
  /** 本次推理耗时（毫秒），用于界面显示实时帧率。 */
  inferenceMs: number;
}

export interface LiveDriverOptions {
  decode: DecodeConfig;
  smooth: SmoothConfig;
  rig: RigConfig;
  flipX: boolean;
  /** 目标检测帧率，默认 15；越高越跟手、CPU 越忙。 */
  targetFps?: number;
}

export class LiveDriver {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly poseBuffer: Pose2D[][] = [];
  private running = false;
  private lastRunAt = 0;
  private frameHandle = 0;
  private busy = false;
  /** 调试：状态变化时才上报，避免刷屏 */
  private lastNote = "";

  constructor(
    private readonly engine: Engine,
    private readonly model: PoseModel,
    private readonly source: FrameSource,
    private options: LiveDriverOptions,
    private readonly onSample: (sample: LiveSample) => void,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器不支持 2D 画布上下文");
    this.context = context;
  }

  /** 运行中会动态更新参数（界面调参即时生效）。 */
  update(options: Partial<LiveDriverOptions>): void {
    this.options = { ...this.options, ...options };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poseBuffer.length = 0;
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.poseBuffer.length = 0;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    const interval = 1000 / (this.options.targetFps ?? 15);
    if (this.busy || now - this.lastRunAt < interval) return;
    this.lastRunAt = now;
    this.busy = true;
    void this.runOnce().finally(() => {
      this.busy = false;
    });
  };

  private async runOnce(): Promise<void> {
    const element = this.source.element;
    if (!element) {
      this.note("没有媒体元素");
      return;
    }
    if (element.readyState < 2) {
      this.note(`媒体未就绪 readyState=${element.readyState}`);
      return;
    }
    // 视频暂停时不做无意义的重复推理；摄像头流永远不 pause
    if (element.paused) {
      this.note("媒体处于暂停");
      return;
    }

    // 1) 抓当前画面
    this.context.drawImage(element, 0, 0, this.source.width, this.source.height);
    const image = this.context.getImageData(0, 0, this.source.width, this.source.height);
    const rgba = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);

    // 2) 推理 + Rust 解码
    const started = performance.now();
    const prepared = prepareInput(
      this.model,
      this.engine,
      rgba,
      this.source.width,
      this.source.height,
      this.options.flipX,
    );
    const results = await this.model.session.run({ [this.model.inputName]: prepared.tensor });
    const poses = decodeOutput(this.model, this.engine, results, prepared, this.options.decode);

    // 3) 用一个小滑动窗口做平滑，避免实时画面抖
    this.poseBuffer.push(poses);
    const window = Math.max(1, Math.min(this.options.smooth.bufferSize, 7));
    while (this.poseBuffer.length > window) this.poseBuffer.shift();
    const smoothed = this.engine.smoothPoses(this.poseBuffer, this.options.smooth);
    const pose = smoothed.at(-1)?.[0] ?? null;

    // 4) 姿态 → 骨骼旋转（复用内核）
    let rotations: number[] | null = null;
    let valid = false;
    if (pose) {
      const bones: BoneFrame[] = this.engine.posesToBones(
        [[pose]],
        this.options.rig,
        this.source.height,
      );
      rotations = bones[0]?.rotations ?? null;
      valid = bones[0]?.valid ?? false;
    }

    this.onSample({
      pose,
      rotations,
      valid,
      inferenceMs: performance.now() - started,
    });
    this.note(pose ? "实时驱动中" : "实时运行中，但这一帧没检测到人");
  }

  private note(message: string): void {
    if (!import.meta.env.DEV || this.lastNote === message) return;
    this.lastNote = message;
    // eslint-disable-next-line no-console
    console.info("[live-driver]", message);
  }
}
