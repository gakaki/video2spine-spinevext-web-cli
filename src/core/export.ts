/**
 * 导出打包：Spine JSON + Atlas + 图集 PNG，压成一个 zip 下载。
 *
 * 对应原版的 `GenerateSkins` / `GenerateSlots` / `SaveJsonOutput` 与
 * `SimpleFileBrowser` 保存对话框。
 */

import { zipSync, type Zippable } from "fflate";

import type { Engine } from "./engine";
import type { AnimationData, ExportConfig, PackConfig, PackLayout } from "./types";
import type { FrameSource } from "./video";

export interface ExportOptions {
  pack: PackConfig;
  filter: string;
  repeat: string;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  pack: { maxWidth: 4096, padding: 2, scale: 1 },
  filter: "Linear,Linear",
  repeat: "none",
};

export interface ExportBundle {
  /** `name.json` 的内容。 */
  json: string;
  /** `name.atlas` 的内容。 */
  atlas: string;
  /** `name.png` 的字节。 */
  png: Uint8Array;
  layout: PackLayout;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((value) => resolve(value), "image/png"),
  );
  if (!blob) throw new Error("导出图集失败：画布无法编码为 PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 生成导出三件套。
 *
 * 图集画面是**重新从视频里读一遍**的：推理阶段不保留每帧的像素副本，
 * 否则一段 10 秒的视频会占掉上 GB 内存。
 */
export async function buildExportBundle(
  engine: Engine,
  animation: AnimationData,
  source: FrameSource,
  config: ExportConfig,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportBundle> {
  const total = animation.frames.length;
  const layout = engine.packFrames(source.width, source.height, total, options.pack);
  const canvas = createCanvas(layout.atlasWidth, layout.atlasHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持 2D 画布上下文");

  for (const region of layout.regions) {
    const image = await source.readFrame(region.index);
    const buffer = document.createElement("canvas");
    buffer.width = image.width;
    buffer.height = image.height;
    const bufferContext = buffer.getContext("2d");
    if (!bufferContext) throw new Error("浏览器不支持 2D 画布上下文");
    bufferContext.putImageData(image, 0, 0);
    context.drawImage(buffer, region.x, region.y, region.width, region.height);
    onProgress?.(region.index + 1, total);
  }

  const json = engine.buildSpineJson(animation, config);
  const atlas = engine.buildAtlas(layout, config.imageName, options.filter, options.repeat);
  const png = await canvasToPng(canvas);
  return { json, atlas, png, layout };
}

/** 把导出结果压成 zip 字节。 */
export function createBundleZip(bundle: ExportBundle, config: ExportConfig): Uint8Array {
  const base = config.name.replace(/\.json$/i, "");
  const files: Zippable = {
    [`${base}.json`]: new TextEncoder().encode(bundle.json),
    [`${base}.atlas`]: new TextEncoder().encode(bundle.atlas),
    [config.imageName]: bundle.png,
  };
  return zipSync(files, { level: 6 });
}

/** 把导出结果压成 zip 并触发浏览器下载。 */
export function downloadBundle(bundle: ExportBundle, config: ExportConfig): void {
  const base = config.name.replace(/\.json$/i, "");
  const zipped = createBundleZip(bundle, config);
  const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${base}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}
