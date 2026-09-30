/**
 * 应用状态机：加载内核与模型 → 取帧 → 检测 → 导出。
 *
 * 所有重活都在 Rust/WASM 与 ONNX Runtime 里，这里只负责编排与状态维护。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadEngine, type Engine } from "@/core/engine";
import { loadPoseModel, type PoseModel } from "@/core/inference";
import { LiveDriver, type LiveSample } from "@/core/live-driver";
import { DEMO_CHARACTERS, type CharacterAsset } from "@/core/character";
import {
  bakeCharacterProject,
  loadBuiltInCharacterAsset,
  loadUserCharacterAsset,
  packCharacterProject,
} from "@/core/character-project";
import {
  PipelineCancelled,
  runPipeline,
  type PipelineOptions,
  type PipelineResult,
} from "@/core/pipeline";
import {
  buildExportBundle,
  downloadBundle,
  DEFAULT_EXPORT_OPTIONS,
  type ExportBundle,
} from "@/core/export";
import {
  DEFAULT_ANIM_CONFIG,
  DEFAULT_DECODE_CONFIG,
  DEFAULT_PACK_CONFIG,
  DEFAULT_RIG_CONFIG,
  DEFAULT_SMOOTH_CONFIG,
  type AnimConfig,
  type DecodeConfig,
  type ExportConfig,
  type PackConfig,
  type RigConfig,
  type SmoothConfig,
} from "@/core/types";
import { createVideoFrameSource, createWebcamFrameSource, type FrameSource } from "@/core/video";
import { characterLabel, t, type MessageKey } from "@/i18n";
import { baseName } from "@/lib/format";

export const DEFAULT_MODEL_PATH = "models/movenet-singlepose-lightning.onnx";

export type Stage =
  | "boot"
  | "idle"
  | "detecting"
  /** 正在拼图集、生成 Spine 预览包 */
  | "rendering"
  | "ready"
  | "exporting"
  | "error";

/**
 * 状态栏消息：存的是文案 key + 参数，不是翻好的字符串——
 * 这样切换语言时已显示的消息也会跟着重译。
 */
export interface StatusMessage {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface SamplingSettings {
  fps: number;
  startTime: number;
  endTime: number | null;
  maxWidth: number;
  flipX: boolean;
  webcamSeconds: number;
}

export const DEFAULT_SAMPLING: SamplingSettings = {
  fps: 15,
  startTime: 0,
  endTime: null,
  maxWidth: 960,
  flipX: false,
  webcamSeconds: 4,
};

export interface SourceInfo {
  name: string;
  kind: "file" | "webcam";
  width: number;
  height: number;
  frameCount: number;
  fps: number;
}

export interface ExportSettings {
  name: string;
  animationName: string;
  imageScale: number;
  pack: PackConfig;
  /** 导出内容：角色工程（烘焙动画）或视频帧图集 */
  mode: "character" | "frames";
  /** 导出哪个角色（mode = character 时生效） */
  characterId: string;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  name: "spinevext",
  animationName: "video",
  imageScale: 1,
  pack: DEFAULT_PACK_CONFIG,
  mode: "character",
  characterId: DEMO_CHARACTERS[0]!.id,
};

function modelUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/${DEFAULT_MODEL_PATH}`;
}

export function useSpinevext() {
  const [stage, setStage] = useState<Stage>("boot");
  const [engine, setEngine] = useState<Engine | null>(null);
  const [model, setModel] = useState<PoseModel | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  /** 检测完成后生成的 Spine 三件套；实时预览与导出共用这一份 */
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  /** 生成 bundle 时用的导出参数指纹，参数一变就说明缓存过期 */
  const [bundleKey, setBundleKey] = useState("");
  /** 实时回路给出的最新一帧姿态，喂给舞台与演示角色 */
  const [liveSample, setLiveSample] = useState<LiveSample | null>(null);
  /** 用户上传的 Spine 角色工程（图集字节 + 骨架 JSON） */
  const [customCharacter, setCustomCharacter] = useState<CharacterAsset | null>(null);
  const [characterError, setCharacterError] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });
  const [message, setMessage] = useState<StatusMessage>({ key: "msg.booting" });
  const [error, setError] = useState<string | null>(null);

  const [sampling, setSampling] = useState<SamplingSettings>(DEFAULT_SAMPLING);
  const [decode, setDecode] = useState<DecodeConfig>(DEFAULT_DECODE_CONFIG);
  const [smooth, setSmooth] = useState<SmoothConfig>(DEFAULT_SMOOTH_CONFIG);
  const [rig, setRig] = useState<RigConfig>(DEFAULT_RIG_CONFIG);
  const [anim, setAnim] = useState<AnimConfig>(DEFAULT_ANIM_CONFIG);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);

  const sourceRef = useRef<FrameSource | null>(null);
  const liveRef = useRef<LiveDriver | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const loadedEngine = await loadEngine();
        if (!alive) return;
        setEngine(loadedEngine);
        setMessage({ key: "msg.loadingModel" });
        const loadedModel = await loadPoseModel(modelUrl());
        if (!alive) return;
        setModel(loadedModel);
        setModelLabel(
          loadedModel.kind === "movenet"
            ? `MoveNet ${loadedModel.inputWidth}×${loadedModel.inputHeight}`
            : `PoseNet ${loadedModel.inputWidth}×${loadedModel.inputHeight}`,
        );
        setStage("idle");
        setMessage({ key: "msg.ready" });
      } catch (cause) {
        if (!alive) return;
        const text = cause instanceof Error ? cause.message : String(cause);
        setError(text);
        setStage("error");
        setMessage({ key: "msg.initFailed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const disposeSource = useCallback(() => {
    sourceRef.current?.dispose();
    sourceRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => disposeSource, [disposeSource]);

  const applySource = useCallback(
    (next: FrameSource, info: SourceInfo) => {
      disposeSource();
      sourceRef.current = next;
      setSource(info);
      setResult(null);
      setBundle(null);
      setBundleKey("");
      setStage("idle");
      setProgress({ current: 0, total: next.frameCount, phase: "" });
      setMessage({ key: "msg.sourceLoaded", params: { name: info.name, count: info.frameCount } });
    },
    [disposeSource],
  );

  // 实时回路：只要引擎、模型、输入源就绪就开着。
  // 视频暂停时它会自己空转（不推理），摄像头则一直跟着流跑。
  useEffect(() => {
    const activeSource = sourceRef.current;
    if (!engine || !model || !activeSource) return;
    const driver = new LiveDriver(
      engine,
      model,
      activeSource,
      {
        decode: {
          ...decode,
          confidenceThreshold: Math.min(decode.confidenceThreshold, rig.confidenceThreshold),
        },
        smooth,
        rig,
        flipX: sampling.flipX,
        targetFps: 15,
      },
      setLiveSample,
    );
    liveRef.current = driver;
    driver.start();
    return () => {
      driver.stop();
      liveRef.current = null;
    };
    // 只在"换输入源/模型"时重建回路；参数变化走下面的 update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, model, source]);

  // 调参即时生效，不用重建回路
  useEffect(() => {
    liveRef.current?.update({
      decode: {
        ...decode,
        confidenceThreshold: Math.min(decode.confidenceThreshold, rig.confidenceThreshold),
      },
      smooth,
      rig,
      flipX: sampling.flipX,
    });
  }, [decode, rig, sampling.flipX, smooth]);

  const loadVideo = useCallback(
    async (file: File) => {
      try {
        setError(null);
        setMessage({ key: "msg.parsingVideo" });
        const next = await createVideoFrameSource(file, {
          fps: sampling.fps,
          startTime: sampling.startTime,
          endTime: sampling.endTime ?? undefined,
          maxWidth: sampling.maxWidth,
          flipX: sampling.flipX,
        });
        applySource(next, {
          name: file.name,
          kind: "file",
          width: next.width,
          height: next.height,
          frameCount: next.frameCount,
          fps: next.fps,
        });
        // 工程名与动画名都跟着视频文件名走，省得每次手改（用户也可以再编辑）
        const stem = baseName(file.name);
        setExportSettings((current) => ({
          ...current,
          name: stem || current.name,
          animationName: stem || current.animationName,
        }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStage("error");
      }
    },
    [applySource, sampling],
  );

  const loadWebcam = useCallback(async () => {
    try {
      setError(null);
      setMessage({ key: "msg.recording", params: { seconds: sampling.webcamSeconds } });
      const next = await createWebcamFrameSource({
        fps: sampling.fps,
        maxWidth: sampling.maxWidth,
        flipX: sampling.flipX,
        duration: sampling.webcamSeconds,
      });
      applySource(next, {
        name: t("msg.webcam"),
        kind: "webcam",
        width: next.width,
        height: next.height,
        frameCount: next.frameCount,
        fps: next.fps,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage("error");
    }
  }, [applySource, sampling.fps, sampling.maxWidth, sampling.flipX, sampling.webcamSeconds]);

  /** 导出参数指纹：变了就说明缓存的 bundle 过期（要重拼图集）。 */
  const bundleKeyFor = useCallback(
    (target: PipelineResult) =>
      JSON.stringify({
        name: exportSettings.name,
        animationName: exportSettings.animationName,
        imageScale: exportSettings.imageScale,
        pack: exportSettings.pack,
        frames: target.animation.frames.length,
        width: target.frameWidth,
        height: target.frameHeight,
      }),
    [exportSettings],
  );
  const currentBundleKey = result ? bundleKeyFor(result) : "";
  const bundleStale = Boolean(result) && (!bundle || bundleKey !== currentBundleKey);

  /**
   * 生成 Spine 三件套（JSON + atlas + 图集 PNG）。
   *
   * 这一份既喂给官方运行时的实时预览，也直接用于导出下载——
   * 所以图集只需要拼一次，导出几乎是瞬时的。
   */
  const buildBundleFor = useCallback(
    async (target: PipelineResult): Promise<ExportBundle | null> => {
      const currentSource = sourceRef.current;
      if (!engine || !currentSource) return null;
      setStage("rendering");
      setError(null);
      setMessage({ key: "msg.buildingAtlas" });
      try {
        const config: ExportConfig = {
          name: exportSettings.name,
          animationName: exportSettings.animationName,
          frameWidth: target.frameWidth,
          frameHeight: target.frameHeight,
          frameCount: target.animation.frames.length,
          fps: target.fps,
          regionPrefix: "frame_",
          imageName: `${exportSettings.name}.png`,
          imageScale: exportSettings.imageScale,
        };
        const next = await buildExportBundle(
          engine,
          target.animation,
          currentSource,
          config,
          { ...DEFAULT_EXPORT_OPTIONS, pack: exportSettings.pack },
          (current, total) => setProgress({ current, total, phase: "atlas" }),
        );
        setBundle(next);
        setBundleKey(bundleKeyFor(target));
        setStage("ready");
        setMessage({
          key: "msg.previewReady",
          params: { width: next.layout.atlasWidth, height: next.layout.atlasHeight },
        });
        return next;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStage("error");
        return null;
      }
    },
    [bundleKeyFor, engine, exportSettings],
  );

  const renderBundle = useCallback(
    () => (result ? buildBundleFor(result) : Promise.resolve(null)),
    [buildBundleFor, result],
  );

  const detect = useCallback(async () => {
    const currentSource = sourceRef.current;
    if (!engine || !model || !currentSource) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStage("detecting");
    setError(null);
    setProgress({ current: 0, total: currentSource.frameCount, phase: "detect" });
    setMessage({ key: "msg.detecting" });

    const options: PipelineOptions = {
      decode: {
        ...decode,
        // rig 里的关节点阈值与解码阈值保持一致，避免下游拿到"看起来有效"的点
        confidenceThreshold: Math.min(decode.confidenceThreshold, rig.confidenceThreshold),
      },
      smooth,
      rig,
      anim,
      flipX: sampling.flipX,
    };

    try {
      const next = await runPipeline(
        engine,
        model,
        currentSource,
        options,
        (update) => {
          setProgress({ current: update.current, total: update.total, phase: update.phase });
        },
        controller.signal,
      );
      setResult(next);
      const valid = next.animation.validity.filter(Boolean).length;
      setMessage({
        key: "msg.detected",
        params: { frames: next.animation.frames.length, valid, base: next.animation.baseFrame },
      });
      // 顺手把 Spine 三件套拼好：预览与导出都要用，拼一次就够
      await buildBundleFor(next);
    } catch (cause) {
      if (cause instanceof PipelineCancelled) {
        setStage("idle");
        setMessage({ key: "msg.cancelled" });
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage("error");
    } finally {
      abortRef.current = null;
    }
  }, [anim, buildBundleFor, decode, engine, model, rig, sampling.flipX, smooth]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const exportProject = useCallback(async () => {
    if (!engine || !result) return;
    setStage("exporting");
    setError(null);
    try {
      // 模式一：把视频检测到的骨骼数据烘焙到选定角色上，导出角色工程
      if (exportSettings.mode === "character") {
        setMessage({ key: "msg.baking" });
        const asset =
          exportSettings.characterId === "custom"
            ? customCharacter
            : await loadBuiltInCharacterAsset(exportSettings.characterId);
        if (!asset) throw new Error(t("msg.needCharacter"));
        const baked = bakeCharacterProject(asset, {
          frames: result.animation.frames,
          baseFrame: result.animation.baseFrame,
          fps: result.fps,
          animationName: exportSettings.animationName,
          spineVersion: engine.spineVersion,
        });
        const zip = packCharacterProject(baked, exportSettings.name);
        const blob = new Blob([zip as BlobPart], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${exportSettings.name}.zip`;
        anchor.click();
        URL.revokeObjectURL(url);
        setStage("ready");
        const renamed =
          baked.renames.length > 0
            ? t("msg.exported.character.renamed", { count: baked.renames.length })
            : "";
        setMessage({
          key: "msg.exported.character",
          params: {
            name: exportSettings.name,
            bones: baked.mappedBones.length,
            frames: baked.frameCount,
            pages: baked.pages.length,
            character: characterLabel(asset.id, asset.name),
            renamed,
          },
        });
        return;
      }

      // 模式二：把视频帧打包成 Spine（每帧一个 region 附件）
      setMessage({ key: "msg.exporting" });
      const ready = bundle && !bundleStale ? bundle : await renderBundle();
      if (!ready) return;
      const config: ExportConfig = {
        name: exportSettings.name,
        animationName: exportSettings.animationName,
        frameWidth: result.frameWidth,
        frameHeight: result.frameHeight,
        frameCount: result.animation.frames.length,
        fps: result.fps,
        regionPrefix: "frame_",
        imageName: `${exportSettings.name}.png`,
        imageScale: exportSettings.imageScale,
      };
      downloadBundle(ready, config);
      setStage("ready");
      setMessage({
        key: "msg.exported.frames",
        params: {
          name: exportSettings.name,
          width: ready.layout.atlasWidth,
          height: ready.layout.atlasHeight,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage("error");
    }
  }, [bundle, bundleStale, customCharacter, engine, exportSettings, renderBundle, result]);

  /** 上传自定义 Spine 角色工程（zip 或多选 json/atlas/png）。 */
  const loadCustomCharacter = useCallback(async (files: File[]) => {
    setCharacterError("");
    try {
      const asset = await loadUserCharacterAsset(files);
      setCustomCharacter(asset);
      setExportSettings((current) => ({
        ...current,
        mode: "character",
        characterId: "custom",
        name: current.name === DEFAULT_EXPORT_SETTINGS.name ? asset.name : current.name,
      }));
      setMessage({
        key: "msg.characterLoaded",
        params: { name: asset.name, count: Object.values(asset.rig).filter(Boolean).length },
      });
      return asset;
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setCharacterError(text);
      setMessage({ key: "msg.characterFailed", params: { error: text } });
      return null;
    }
  }, []);

  const busy = stage === "detecting" || stage === "exporting" || stage === "rendering";

  return useMemo(
    () => ({
      stage,
      engine,
      model,
      modelLabel,
      source,
      result,
      bundle,
      bundleStale,
      renderBundle,
      liveSample,
      customCharacter,
      characterError,
      loadCustomCharacter,
      progress,
      message,
      error,
      busy,
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
      exportSettings,
      setExportSettings,
      frameSource: () => sourceRef.current,
      loadVideo,
      loadWebcam,
      detect,
      cancel,
      exportProject,
    }),
    [
      anim,
      bundle,
      bundleStale,
      busy,
      cancel,
      characterError,
      customCharacter,
      decode,
      detect,
      engine,
      error,
      exportProject,
      exportSettings,
      loadVideo,
      loadWebcam,
      loadCustomCharacter,
      liveSample,
      message,
      model,
      modelLabel,
      progress,
      result,
      renderBundle,
      rig,
      sampling,
      smooth,
      source,
      stage,
    ],
  );
}

export type SpinevextController = ReturnType<typeof useSpinevext>;
