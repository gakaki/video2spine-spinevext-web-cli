/**
 * 演示角色舞台：把实时姿态重定向到 Spine 角色上，跟着视频/摄像头一起动。
 */

import { useEffect, useRef, useState } from "react";

import { Segmented, SliderField } from "@/components/controls";
import type {
  CharacterAsset,
  CharacterStage as CharacterStageHandle,
  DemoCharacter,
} from "@/core/character";
import { createCharacterStage, DEMO_CHARACTERS } from "@/core/character";
import type { LiveSample } from "@/core/live-driver";
import { characterLabel, useI18n } from "@/i18n";
import { BONE_NAMES, type BoneFrame } from "@/core/types";

export interface CharacterStageProps {
  liveSample: LiveSample | null;
  /** 播放中由实时回路驱动；暂停时用批量结果里对应帧驱动。 */
  resultFrame: BoneFrame | null;
  live: boolean;
  /** 当前选中的角色：内置 id 或 `custom`。 */
  characterId: string;
  customCharacter: CharacterAsset | null;
  onSelectCharacter: (id: string) => void;
}

export function CharacterStage({
  liveSample,
  resultFrame,
  live,
  characterId,
  customCharacter,
  onSelectCharacter,
}: CharacterStageProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<CharacterStageHandle | null>(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hasIdle, setHasIdle] = useState(true);
  const [errorText, setErrorText] = useState("");

  /** 内置角色给 URL，自定义角色给已加载的字节资源 */
  const source: DemoCharacter | CharacterAsset =
    characterId === "custom" && customCharacter
      ? customCharacter
      : (DEMO_CHARACTERS.find((item) => item.id === characterId) ?? DEMO_CHARACTERS[0]!);
  const rigLabel = Object.values(source.rig).filter(Boolean).join(" / ");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    setStatus("loading");
    setErrorText("");

    void (async () => {
      try {
        const stage = await createCharacterStage(canvas, source);
        if (disposed) {
          stage.dispose();
          return;
        }
        stageRef.current = stage;
        stage.setZoom(zoom);
        setHasIdle(stage.hasIdle);
        setStatus("ready");
      } catch (cause) {
        if (disposed) return;
        setStatus("error");
        setErrorText(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      disposed = true;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
    // zoom 通过下面的 effect 单独同步，避免重建整个角色
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    stageRef.current?.setZoom(zoom);
  }, [zoom]);

  // 把姿态喂给角色：播放中用实时结果，暂停时用批量结果
  const frame: BoneFrame | null = live
    ? liveSample?.rotations
      ? {
          rotations: liveSample.rotations,
          confidence: liveSample.pose?.score ?? 0,
          valid: liveSample.valid,
        }
      : null
    : resultFrame;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || status !== "ready") return;
    if (frame) {
      stage.applyFrame(frame);
    } else {
      // 没有姿态时让角色回到待机动画，避免僵住
      stage.playIdle();
    }
    // frame 每帧都是新对象，用骨骼角度的字符串作为依赖更稳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.rotations.join(","), status]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-border bg-black">
        <canvas ref={canvasRef} className="block h-auto w-full" style={{ aspectRatio: "1 / 1" }} />
        {status !== "ready" ? (
          <div className="absolute inset-0 grid place-items-center bg-black/70">
            <div className="text-center">
              {status === "loading" ? (
                <p className="text-xs text-muted-foreground">{t("character.loading")}</p>
              ) : (
                <>
                  <p className="tag-label text-destructive">character error</p>
                  <p className="mt-2 max-w-sm text-xs text-muted-foreground">{errorText}</p>
                </>
              )}
            </div>
          </div>
        ) : null}
        {status === "ready" && !frame ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
            <span className="numeral rounded-sm bg-black/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {t("character.none", {
                state: hasIdle ? t("character.idlePlaying") : t("character.idleStatic"),
              })}
            </span>
          </div>
        ) : null}
      </div>

      <Segmented
        label={t("character.picker")}
        value={characterId}
        options={[
          ...DEMO_CHARACTERS.map((item) => ({
            value: item.id,
            label: characterLabel(item.id, item.name),
          })),
          ...(customCharacter ? [{ value: "custom", label: customCharacter.name }] : []),
        ]}
        hint={t("character.picker.hint")}
        onChange={onSelectCharacter}
      />

      <SliderField
        label={t("character.zoom")}
        value={zoom}
        min={0.5}
        max={2}
        step={0.05}
        digits={2}
        suffix="×"
        onChange={setZoom}
      />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("character.rigNote", {
          bones: rigLabel,
          mapped: Object.values(source.rig).filter(Boolean).length,
          total: BONE_NAMES.length,
        })}
      </p>
    </div>
  );
}
