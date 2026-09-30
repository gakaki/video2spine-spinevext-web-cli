/**
 * 左侧控制栏：输入源、采样、检测参数、骨骼与动画。
 */

import { Camera, Film, Play, Square } from "lucide-react";
import { useRef } from "react";

import { Readout, Segmented, SliderField, ToggleField } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { SpinevextController } from "@/hooks/useSpinevext";
import { useI18n } from "@/i18n";
import { formatCount, formatSeconds } from "@/lib/format";

export interface ControlPanelProps {
  controller: SpinevextController;
}

export function ControlPanel({ controller }: ControlPanelProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    busy,
    source,
    result,
    sampling,
    setSampling,
    decode,
    setDecode,
    smooth,
    setSmooth,
    rig,
    setRig,
    anim,
    setAnim,
    loadVideo,
    loadWebcam,
    detect,
    cancel,
    stage,
  } = controller;

  const detecting = stage === "detecting";
  const canDetect = Boolean(source) && !busy;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("control.input.title")}</CardTitle>
          <CardDescription className="text-[11px]">{t("control.input.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadVideo(file);
              event.target.value = "";
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Film aria-hidden />
              {t("control.input.pick")}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void loadWebcam()}>
              <Camera aria-hidden />
              {t("control.input.webcam")}
            </Button>
          </div>

          {source ? (
            <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
              <Readout label={t("control.source.name")} value={source.name} />
              <Readout
                label={t("control.source.resolution")}
                value={`${source.width}×${source.height}`}
              />
              <Readout label={t("control.source.frames")} value={formatCount(source.frameCount)} />
              <Readout
                label={t("control.source.duration")}
                value={formatSeconds(source.frameCount / source.fps)}
              />
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
              {t("control.input.empty")}
            </p>
          )}

          <Separator />

          <SliderField
            label={t("control.sampling.fps")}
            value={sampling.fps}
            min={2}
            max={30}
            step={1}
            suffix={t("control.sampling.fps.suffix")}
            disabled={busy}
            hint={t("control.sampling.fps.hint")}
            onChange={(fps) => setSampling((current) => ({ ...current, fps }))}
          />
          <SliderField
            label={t("control.sampling.start")}
            value={sampling.startTime}
            min={0}
            max={120}
            step={0.1}
            digits={1}
            suffix={t("control.sampling.seconds")}
            disabled={busy}
            onChange={(startTime) => setSampling((current) => ({ ...current, startTime }))}
          />
          <SliderField
            label={t("control.sampling.end")}
            value={sampling.endTime ?? 0}
            min={0}
            max={120}
            step={0.1}
            digits={1}
            suffix={t("control.sampling.seconds")}
            disabled={busy}
            hint={t("control.sampling.end.hint")}
            onChange={(endTime) =>
              setSampling((current) => ({ ...current, endTime: endTime === 0 ? null : endTime }))
            }
          />
          <Segmented
            label={t("control.maxWidth")}
            value={sampling.maxWidth}
            disabled={busy}
            options={[
              { value: 480, label: "480" },
              { value: 640, label: "640" },
              { value: 960, label: "960" },
              { value: 1280, label: "1280" },
            ]}
            hint={t("control.maxWidth.hint")}
            onChange={(maxWidth) => setSampling((current) => ({ ...current, maxWidth }))}
          />
          <ToggleField
            label={t("control.flipX")}
            checked={sampling.flipX}
            disabled={busy}
            hint={t("control.flipX.hint")}
            onChange={(flipX) => setSampling((current) => ({ ...current, flipX }))}
          />

          <Separator />

          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!canDetect} onClick={() => void detect()}>
              <Play aria-hidden />
              {t("control.detect")}
            </Button>
            <Button variant="outline" disabled={!detecting} onClick={cancel}>
              <Square aria-hidden />
              {t("control.stop")}
            </Button>
          </div>
          {result ? (
            <p className="numeral text-[11px] text-muted-foreground">
              {t("control.readyFrames", { count: formatCount(result.animation.frames.length) })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("control.params.title")}</CardTitle>
          <CardDescription className="text-[11px]">{t("control.params.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SliderField
            label={t("control.confidence")}
            value={decode.confidenceThreshold}
            min={0}
            max={1}
            step={0.01}
            digits={2}
            disabled={busy}
            onChange={(confidenceThreshold) =>
              setDecode((current) => ({ ...current, confidenceThreshold }))
            }
          />
          <SliderField
            label={t("control.maxPoses")}
            value={decode.maxPoses}
            min={1}
            max={6}
            step={1}
            disabled={busy}
            hint={t("control.maxPoses.hint")}
            onChange={(maxPoses) => setDecode((current) => ({ ...current, maxPoses }))}
          />
          <SliderField
            label={t("control.nms")}
            value={decode.nmsRadius}
            min={0}
            max={120}
            step={1}
            suffix=" px"
            disabled={busy || decode.maxPoses <= 1}
            onChange={(nmsRadius) => setDecode((current) => ({ ...current, nmsRadius }))}
          />
          <SliderField
            label={t("control.smooth")}
            value={smooth.bufferSize}
            min={1}
            max={15}
            step={1}
            suffix={t("control.smooth.suffix")}
            disabled={busy}
            hint={t("control.smooth.hint")}
            onChange={(bufferSize) => setSmooth((current) => ({ ...current, bufferSize }))}
          />
          <SliderField
            label={t("control.minKeypoints")}
            value={rig.minConfidentKeypoints}
            min={1}
            max={17}
            step={1}
            suffix={t("control.minKeypoints.suffix")}
            disabled={busy}
            hint={t("control.minKeypoints.hint")}
            onChange={(minConfidentKeypoints) =>
              setRig((current) => ({ ...current, minConfidentKeypoints }))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("control.anim.title")}</CardTitle>
          <CardDescription className="text-[11px]">{t("control.anim.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Segmented
            label={t("control.baseFrame")}
            value={anim.baseFrame < 0 ? "auto" : "manual"}
            disabled={busy}
            options={[
              { value: "auto", label: t("control.baseFrame.auto") },
              { value: "manual", label: t("control.baseFrame.manual") },
            ]}
            hint={t("control.baseFrame.hint")}
            onChange={(mode) =>
              setAnim((current) => ({
                ...current,
                baseFrame: mode === "auto" ? -1 : Math.max(0, result?.animation.baseFrame ?? 0),
              }))
            }
          />
          {anim.baseFrame >= 0 ? (
            <SliderField
              label={t("control.baseFrame.index")}
              value={anim.baseFrame}
              min={0}
              max={Math.max(0, (result?.animation.frames.length ?? 1) - 1)}
              step={1}
              disabled={busy}
              onChange={(baseFrame) => setAnim((current) => ({ ...current, baseFrame }))}
            />
          ) : null}
          <ToggleField
            label={t("control.propagate")}
            checked={anim.propagate}
            disabled={busy}
            hint={t("control.propagate.hint")}
            onChange={(propagate) => setAnim((current) => ({ ...current, propagate }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
