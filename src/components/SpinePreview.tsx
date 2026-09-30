/**
 * Spine 实时预览：用官方 `@esotericsoftware/spine-webgl` 运行时播放**导出的**工程。
 *
 * 这里渲染的就是导出 zip 里那份 JSON + atlas + 图集 PNG，
 * 所以"预览好看"等价于"导出的工程能跑"。
 */

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SliderField } from "@/components/controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createSpinePreview, type SpinePreview as SpinePreviewHandle } from "@/core/spine-preview";
import type { ExportBundle } from "@/core/export";
import { useI18n } from "@/i18n";

export interface SpinePreviewProps {
  bundle: ExportBundle | null;
  frameWidth: number;
  frameHeight: number;
  /** 导出参数变了、缓存过期 */
  stale: boolean;
  busy: boolean;
  onRebuild: () => void;
}

export function SpinePreview({
  bundle,
  frameWidth,
  frameHeight,
  stale,
  busy,
  onRebuild,
}: SpinePreviewProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<SpinePreviewHandle | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [animations, setAnimations] = useState<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bundle) return;
    let disposed = false;
    setStatus("loading");
    setErrorText("");

    void (async () => {
      try {
        const preview = await createSpinePreview(canvas, {
          json: bundle.json,
          atlas: bundle.atlas,
          png: bundle.png,
          frameWidth,
          frameHeight,
        });
        if (disposed) {
          preview.dispose();
          return;
        }
        previewRef.current = preview;
        preview.setSpeed(speed);
        preview.setZoom(zoom);
        setAnimations(preview.animationNames);
        setStatus("ready");
      } catch (cause) {
        if (disposed) return;
        setStatus("error");
        setErrorText(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      disposed = true;
      previewRef.current?.dispose();
      previewRef.current = null;
    };
    // speed / zoom 通过下面的 effect 单独同步，避免重建整个运行时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, frameWidth, frameHeight]);

  useEffect(() => {
    previewRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    previewRef.current?.setZoom(zoom);
  }, [zoom]);

  const togglePlay = () => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.toggle();
    setPlaying(preview.playing);
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-border bg-black">
        <canvas ref={canvasRef} className="block h-[420px] w-full" />
        {status !== "ready" ? (
          <div className="absolute inset-0 grid place-items-center bg-black/70">
            <div className="text-center">
              {status === "loading" ? (
                <>
                  <Loader2 className="mx-auto size-5 animate-spin text-primary" aria-hidden />
                  <p className="mt-2 text-xs text-muted-foreground">{t("preview.loading")}</p>
                </>
              ) : (
                <>
                  <p className="tag-label text-destructive">spine runtime error</p>
                  <p className="mt-2 max-w-md text-xs text-muted-foreground">{errorText}</p>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={togglePlay} disabled={status !== "ready"}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {playing ? t("stage.pause") : t("stage.play")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={status !== "ready"}
          onClick={() => previewRef.current?.restart()}
        >
          <RotateCcw aria-hidden />
          {t("preview.rewind")}
        </Button>
        {animations.length > 0 ? (
          <Badge variant="outline" className="numeral">
            animation: {animations.join(", ")}
          </Badge>
        ) : null}
        {stale ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRebuild}>
            {t("preview.stale")}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 rounded-lg border border-border bg-card/60 p-3 sm:grid-cols-2">
        <SliderField
          label={t("preview.speed")}
          value={speed}
          min={0.25}
          max={3}
          step={0.25}
          digits={2}
          suffix="×"
          onChange={setSpeed}
        />
        <SliderField
          label={t("preview.zoom")}
          value={zoom}
          min={0.6}
          max={1.8}
          step={0.05}
          digits={2}
          suffix="×"
          onChange={setZoom}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("preview.note")}</p>
    </div>
  );
}
