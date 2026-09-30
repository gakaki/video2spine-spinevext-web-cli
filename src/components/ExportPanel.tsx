/**
 * 右侧导出栏：导出内容（角色工程 / 视频帧图集）、角色选择、图集参数、导出与进度。
 */

import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Readout, Segmented, SliderField } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { DEMO_CHARACTERS } from "@/core/character";
import type { SpinevextController } from "@/hooks/useSpinevext";
import { characterLabel, useI18n } from "@/i18n";
import { formatBytes, formatCount } from "@/lib/format";

export interface ExportPanelProps {
  controller: SpinevextController;
}

/** 估算导出的图集体积（RGBA 未压缩）。 */
function estimateAtlasBytes(
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  scale: number,
  padding: number,
  maxWidth: number,
): { bytes: number; width: number; height: number } {
  const scaledWidth = Math.max(1, Math.round(frameWidth * scale));
  const scaledHeight = Math.max(1, Math.round(frameHeight * scale));
  const perRow = Math.max(1, Math.floor((maxWidth + padding) / (scaledWidth + padding)));
  const rows = Math.max(1, Math.ceil(frameCount / perRow));
  const width = Math.min(maxWidth, perRow * (scaledWidth + padding) + padding);
  const height = rows * (scaledHeight + padding) + padding;
  return { bytes: width * height * 4, width, height };
}

export function ExportPanel({ controller }: ExportPanelProps) {
  const { t } = useI18n();
  const {
    result,
    exportSettings,
    setExportSettings,
    exportProject,
    busy,
    stage,
    customCharacter,
    characterError,
    loadCustomCharacter,
  } = controller;
  const exporting = stage === "exporting";
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const characterMode = exportSettings.mode === "character";
  const frameCount = result?.animation.frames.length ?? 0;
  const estimate = estimateAtlasBytes(
    frameCount,
    result?.frameWidth ?? 960,
    result?.frameHeight ?? 540,
    exportSettings.imageScale,
    exportSettings.pack.padding,
    exportSettings.pack.maxWidth,
  );
  const tooBig = estimate.bytes > 512 * 1024 * 1024;

  const selectedCharacter =
    exportSettings.characterId === "custom"
      ? customCharacter
      : DEMO_CHARACTERS.find((item) => item.id === exportSettings.characterId);
  const mappedCount = selectedCharacter
    ? Object.values(selectedCharacter.rig).filter(Boolean).length
    : 0;
  const animationSeconds = frameCount > 0 && result ? frameCount / (result.fps || 30) : 0;

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await loadCustomCharacter(Array.from(files));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("export.title")}</CardTitle>
          <CardDescription className="text-[11px]">{t("export.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Segmented
            label={t("export.mode")}
            value={exportSettings.mode}
            disabled={busy}
            options={[
              { value: "character", label: t("export.mode.character") },
              { value: "frames", label: t("export.mode.frames") },
            ]}
            hint={characterMode ? t("export.mode.character.hint") : t("export.mode.frames.hint")}
            onChange={(mode) => setExportSettings((current) => ({ ...current, mode }))}
          />

          {characterMode ? (
            <>
              <Segmented
                label={t("export.character")}
                value={exportSettings.characterId}
                disabled={busy}
                options={[
                  ...DEMO_CHARACTERS.map((item) => ({
                    value: item.id,
                    label: characterLabel(item.id, item.name),
                  })),
                  ...(customCharacter ? [{ value: "custom", label: customCharacter.name }] : []),
                ]}
                hint={t("export.character.hint")}
                onChange={(characterId) =>
                  setExportSettings((current) => ({ ...current, characterId }))
                }
              />

              <div className="space-y-2">
                <Label className="tag-label" htmlFor="character-upload">
                  {t("export.upload")}
                </Label>
                <input
                  id="character-upload"
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".zip,.json,.atlas,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => void pickFiles(event.target.files)}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy || uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 aria-hidden className="animate-spin" />
                  ) : (
                    <Upload aria-hidden />
                  )}
                  {uploading ? t("export.upload.loading") : t("export.upload.button")}
                </Button>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("export.upload.hint")}
                </p>
                {characterError ? (
                  <p className="text-[11px] leading-relaxed text-destructive">{characterError}</p>
                ) : null}
              </div>
            </>
          ) : null}

          <Separator />

          <div className="space-y-2">
            <Label className="tag-label" htmlFor="project-name">
              {t("export.name")}
            </Label>
            <Input
              id="project-name"
              value={exportSettings.name}
              disabled={busy}
              onChange={(event) =>
                setExportSettings((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label className="tag-label" htmlFor="animation-name">
              {t("export.animation")}
            </Label>
            <Input
              id="animation-name"
              value={exportSettings.animationName}
              disabled={busy}
              onChange={(event) =>
                setExportSettings((current) => ({ ...current, animationName: event.target.value }))
              }
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("export.animation.hint")}
            </p>
          </div>

          {characterMode ? null : (
            <>
              <Separator />

              <SliderField
                label={t("export.atlasScale")}
                value={exportSettings.imageScale}
                min={0.25}
                max={1}
                step={0.05}
                digits={2}
                suffix="×"
                disabled={busy}
                hint={t("export.atlasScale.hint")}
                onChange={(imageScale) =>
                  setExportSettings((current) => ({ ...current, imageScale }))
                }
              />
              <Segmented
                label={t("export.atlasWidth")}
                value={exportSettings.pack.maxWidth}
                disabled={busy}
                options={[
                  { value: 2048, label: "2048" },
                  { value: 4096, label: "4096" },
                  { value: 8192, label: "8192" },
                ]}
                onChange={(maxWidth) =>
                  setExportSettings((current) => ({
                    ...current,
                    pack: { ...current.pack, maxWidth },
                  }))
                }
              />
              <SliderField
                label={t("export.atlasPadding")}
                value={exportSettings.pack.padding}
                min={0}
                max={8}
                step={1}
                suffix=" px"
                disabled={busy}
                hint={t("export.atlasPadding.hint")}
                onChange={(padding) =>
                  setExportSettings((current) => ({
                    ...current,
                    pack: { ...current.pack, padding },
                  }))
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("export.preview.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {characterMode ? (
            <>
              <Readout
                label={t("export.readout.character")}
                value={selectedCharacter?.name ?? t("export.readout.character.none")}
              />
              <Readout
                label={t("export.readout.mappedBones")}
                value={t("export.readout.mappedBones.value", { count: mappedCount })}
              />
              <Readout label={t("export.readout.animation")} value={exportSettings.animationName} />
              <Readout
                label={t("export.readout.framesDuration")}
                value={`${formatCount(frameCount)} · ${animationSeconds.toFixed(2)}s`}
              />
              <Readout
                label={t("export.readout.detectedBones")}
                value={formatCount(result?.animation.skeleton.length ?? 0)}
              />
              <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
                {t("export.note.character", { animation: exportSettings.animationName })}
              </p>
            </>
          ) : (
            <>
              <Readout label={t("export.readout.frames")} value={formatCount(frameCount)} />
              <Readout
                label={t("export.readout.frameSize")}
                value={`${result?.frameWidth ?? 0}×${result?.frameHeight ?? 0}`}
              />
              <Readout
                label={t("export.readout.atlasSize")}
                value={`${estimate.width}×${estimate.height}`}
              />
              <Readout label={t("export.readout.atlasBytes")} value={formatBytes(estimate.bytes)} />
              <Readout
                label={t("export.readout.skeletonBones")}
                value={formatCount(result?.animation.skeleton.length ?? 0)}
              />
              {tooBig ? (
                <p className="pt-2 text-[11px] text-destructive">{t("export.tooBig")}</p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Button className="w-full" disabled={!result || busy} onClick={() => void exportProject()}>
        <Download aria-hidden />
        {exporting
          ? t("export.submit.busy")
          : characterMode
            ? t("export.submit.character")
            : t("export.submit.frames")}
      </Button>
      {!result ? (
        <p className="text-[11px] text-muted-foreground">{t("export.needDetect")}</p>
      ) : null}
      {exporting ? <Progress value={0} className="opacity-60" /> : null}
    </div>
  );
}
