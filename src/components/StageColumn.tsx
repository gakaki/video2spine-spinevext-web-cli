/**
 * 中间舞台：左边「视频/摄像头 + 骨架」，右边「Spine 演示角色」，两屏并排同时刷新。
 *
 * 这里不再用 tab 切换——播放时两屏是同一份实时姿态的两个视角，
 * 切开看反而看不到"角色跟着人动"这件事。
 */

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";

import { CharacterStage } from "@/components/CharacterStage";
import { StageCanvas } from "@/components/StageCanvas";
import { ToggleField } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import type { SpinevextController } from "@/hooks/useSpinevext";
import { useI18n } from "@/i18n";
import { formatCount } from "@/lib/format";

export interface StageColumnProps {
  controller: SpinevextController;
}

export function StageColumn({ controller }: StageColumnProps) {
  const { t } = useI18n();
  const {
    result,
    progress,
    source,
    frameSource,
    modelLabel,
    stage,
    busy,
    liveSample,
    exportSettings,
    setExportSettings,
    customCharacter,
  } = controller;
  const [showKeypoints, setShowKeypoints] = useState(true);
  const [showBones, setShowBones] = useState(true);
  const [playhead, setPlayhead] = useState({ time: 0, playing: false });

  const frameSrc = frameSource();

  // 跟播放头同步：视频元素自己播，这里只负责读出进度给界面
  useEffect(() => {
    const element = frameSrc?.element;
    if (!element) return;
    let handle = 0;
    let last = 0;
    const loop = (now: number) => {
      handle = requestAnimationFrame(loop);
      if (now - last < 80) return;
      last = now;
      setPlayhead({ time: element.currentTime, playing: !element.paused });
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [frameSrc]);

  const fps = frameSrc?.fps ?? 15;
  const duration = frameSrc && Number.isFinite(frameSrc.duration) ? frameSrc.duration : 0;
  const live = playhead.playing;
  const frameIndex = Math.min(
    Math.max(0, Math.round(playhead.time * fps)),
    Math.max(0, (result?.animation.frames.length ?? 1) - 1),
  );
  const resultFrame = result ? (result.bones[frameIndex] ?? null) : null;
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  const togglePlay = () => {
    const element = frameSrc?.element;
    if (!frameSrc || !element) return;
    if (element.paused) {
      void frameSrc.play();
      setPlayhead((current) => ({ ...current, playing: true }));
    } else {
      frameSrc.pause();
      setPlayhead((current) => ({ ...current, playing: false }));
    }
  };

  const step = (direction: -1 | 1) => {
    if (!frameSrc) return;
    const next = Math.min(Math.max(playhead.time + direction / fps, 0), Math.max(duration, 0));
    frameSrc.seek(next);
    setPlayhead({ time: next, playing: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="tag-label">stage</span>
          <span className="numeral rounded-sm border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
            {modelLabel ?? t("msg.loading")}
          </span>
          {source ? (
            <span className="numeral text-[11px] text-muted-foreground">
              {source.width}×{source.height} ·{" "}
              {t("stage.frames", { count: formatCount(source.frameCount) })}
            </span>
          ) : null}
          {liveSample ? (
            <span className="numeral text-[11px] text-muted-foreground">
              {t("stage.liveMs", { ms: liveSample.inferenceMs.toFixed(0) })}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <ToggleField
            label={t("stage.keypoints")}
            checked={showKeypoints}
            onChange={setShowKeypoints}
          />
          <ToggleField label={t("stage.bones")} checked={showBones} onChange={setShowBones} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <p className="tag-label">{t("stage.videoPane")}</p>
          <StageCanvas
            frameSource={frameSrc}
            result={result}
            frameIndex={frameIndex}
            showKeypoints={showKeypoints}
            showBones={showBones}
            liveSample={liveSample}
            live={live}
          />
        </div>
        <div className="space-y-2">
          <p className="tag-label">{t("stage.characterPane")}</p>
          <CharacterStage
            liveSample={liveSample}
            resultFrame={resultFrame}
            live={live}
            characterId={exportSettings.characterId}
            customCharacter={customCharacter}
            onSelectCharacter={(characterId) =>
              setExportSettings((current) => ({ ...current, characterId }))
            }
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            disabled={!frameSrc || busy}
            onClick={() => step(-1)}
            aria-label={t("stage.prevFrame")}
          >
            <SkipBack aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            disabled={!frameSrc || busy}
            onClick={togglePlay}
            aria-label={playhead.playing ? t("stage.pause") : t("stage.play")}
          >
            {playhead.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!frameSrc || busy}
            onClick={() => step(1)}
            aria-label={t("stage.nextFrame")}
          >
            <SkipForward aria-hidden />
          </Button>
          <span className="numeral text-xs text-muted-foreground">
            {playhead.time.toFixed(2)}s /{" "}
            {duration > 0 ? `${duration.toFixed(2)}s` : t("stage.live")}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {result ? (
              <span className="numeral text-[11px] text-muted-foreground">
                {t("stage.baseFrame", { index: result.animation.baseFrame })}
              </span>
            ) : null}
          </div>
        </div>

        <Slider
          value={Math.min(playhead.time, duration || 1)}
          min={0}
          max={Math.max(1, duration)}
          step={1 / fps}
          disabled={!frameSrc || duration <= 0}
          onValueChange={(next) => {
            const resolved = Array.isArray(next) ? next[0] : next;
            if (typeof resolved !== "number" || !frameSrc) return;
            frameSrc.seek(resolved);
            setPlayhead({ time: resolved, playing: false });
          }}
        />

        {result ? (
          <ValidityStrip validity={result.animation.validity} current={frameIndex} />
        ) : null}
      </div>

      {busy ? (
        <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
          <div className="flex items-baseline justify-between">
            <span className="tag-label">
              {progress.phase === "atlas"
                ? t("stage.phase.atlas")
                : progress.phase === "rig"
                  ? t("stage.phase.rig")
                  : t("stage.phase.pose")}
            </span>
            <span className="numeral text-xs text-muted-foreground">
              {progress.current} / {progress.total}
            </span>
          </div>
          <Progress value={percent} />
        </div>
      ) : null}

      {stage === "idle" && !source ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("stage.tip")}</p>
      ) : null}
    </div>
  );
}

function ValidityStrip({ validity, current }: { validity: boolean[]; current: number }) {
  const { t } = useI18n();
  return (
    <div className="flex h-4 items-stretch gap-px" aria-hidden>
      {validity.map((valid, index) => (
        <span
          key={index}
          title={`${t("stage.validity.frame", { index })}${valid ? "" : t("stage.validity.incomplete")}`}
          className="flex-1 rounded-[1px]"
          style={{
            background:
              index === current
                ? "var(--foreground)"
                : valid
                  ? "color-mix(in oklab, #b6ff2e 55%, transparent)"
                  : "color-mix(in oklab, #ffb02e 40%, transparent)",
          }}
        />
      ))}
    </div>
  );
}
