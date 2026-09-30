/**
 * 视频舞台：**实时**把播放中的画面画进 canvas，并叠加骨架/关键点。
 *
 * 这里刻意每帧 `drawImage(videoElement)`，而不是"换帧时 seek 一次"——
 * 后者在播放时看起来就是一张卡住的图。视频元素本身就是最好的播放器：
 * 播放、暂停、拖动时间轴都交给它，我们只负责在它上面画骨架。
 */

import { useEffect, useRef } from "react";

import type { LiveSample } from "@/core/live-driver";
import type { PipelineResult } from "@/core/pipeline";
import type { FrameSource } from "@/core/video";
import { useI18n } from "@/i18n";
import { solveBoneChain } from "@/lib/rig-preview";

/** COCO 骨架连线，用于画关键点之间的连线。 */
const COCO_EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];

const CONFIDENCE_FLOOR = 0.2;

export interface StageCanvasProps {
  frameSource: FrameSource | null;
  result: PipelineResult | null;
  frameIndex: number;
  showKeypoints: boolean;
  showBones: boolean;
  /** 实时回路给出的当前姿态；播放时用它，暂停时用批量结果。 */
  liveSample: LiveSample | null;
  /** 是否有实时信号（摄像头恒为真，视频要看是否在播放）。 */
  live: boolean;
}

interface DrawState {
  result: PipelineResult | null;
  frameIndex: number;
  showKeypoints: boolean;
  showBones: boolean;
  liveSample: LiveSample | null;
  live: boolean;
}

export function StageCanvas(props: StageCanvasProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<DrawState>({
    result: props.result,
    frameIndex: props.frameIndex,
    showKeypoints: props.showKeypoints,
    showBones: props.showBones,
    liveSample: props.liveSample,
    live: props.live,
  });
  stateRef.current = {
    result: props.result,
    frameIndex: props.frameIndex,
    showKeypoints: props.showKeypoints,
    showBones: props.showBones,
    liveSample: props.liveSample,
    live: props.live,
  };

  const source = props.frameSource;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    let handle = requestAnimationFrame(function loop() {
      handle = requestAnimationFrame(loop);
      const element = source.element;
      const state = stateRef.current;

      if (element && element.readyState >= 2 && element.videoWidth > 0) {
        context.drawImage(element, 0, 0, source.width, source.height);
      } else {
        context.fillStyle = "#000";
        context.fillRect(0, 0, source.width, source.height);
      }

      // 播放中用实时姿态；暂停/拖动时回落到批量结果
      const pose = state.live
        ? (state.liveSample?.pose ?? null)
        : (state.result?.poses[state.frameIndex]?.[0] ?? null);
      const animation = state.result?.animation;

      if (state.showBones && animation) {
        const rotations = animation.frames[state.frameIndex];
        if (rotations) {
          const segments = solveBoneChain(
            animation.skeleton,
            rotations,
            animation.rootX,
            animation.rootY,
            source.height,
          );
          context.lineWidth = Math.max(2, source.width / 320);
          context.strokeStyle = "#b6ff2e";
          context.lineCap = "round";
          for (const segment of segments) {
            if (segment.name === "root") continue;
            context.beginPath();
            context.moveTo(segment.from.x, segment.from.y);
            context.lineTo(segment.to.x, segment.to.y);
            context.stroke();
          }
        }
      }

      if (state.showKeypoints && pose) {
        drawKeypoints(context, pose, source.width);
      }
    });

    return () => cancelAnimationFrame(handle);
  }, [source]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-black">
      <canvas
        ref={canvasRef}
        className="block h-auto w-full"
        style={{ aspectRatio: `${source?.width ?? 4} / ${source?.height ?? 3}` }}
      />
      {!source ? (
        <div className="stage-grid absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="tag-label">{t("canvas.signalWaiting")}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t("canvas.placeholder")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function drawKeypoints(
  context: CanvasRenderingContext2D,
  pose: NonNullable<LiveSample["pose"]>,
  width: number,
): void {
  const radius = Math.max(3, width / 220);
  COCO_EDGES.forEach(([from, to]) => {
    const a = pose.keypoints[from];
    const b = pose.keypoints[to];
    if (!a || !b || a.score < CONFIDENCE_FLOOR || b.score < CONFIDENCE_FLOOR) return;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineWidth = radius * 0.6;
    context.strokeStyle = "rgba(255,255,255,0.55)";
    context.stroke();
  });
  pose.keypoints.forEach((keypoint) => {
    if (keypoint.score < CONFIDENCE_FLOOR) return;
    context.beginPath();
    context.arc(keypoint.x, keypoint.y, radius, 0, Math.PI * 2);
    context.fillStyle = keypoint.score > 0.5 ? "#b6ff2e" : "#ffb02e";
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(0,0,0,0.6)";
    context.stroke();
  });
}
