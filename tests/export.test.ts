import { unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { createBundleZip, type ExportBundle } from "@/core/export";
import type { ExportConfig } from "@/core/types";

const config: ExportConfig = {
  name: "demo",
  animationName: "walk",
  frameWidth: 320,
  frameHeight: 180,
  frameCount: 2,
  fps: 30,
  regionPrefix: "frame_",
  imageName: "demo.png",
  imageScale: 1,
};

const bundle: ExportBundle = {
  json: '{"skeleton":{}}',
  atlas: "demo.png\nsize: 4,4\n",
  png: new Uint8Array([137, 80, 78, 71]),
  layout: { atlasWidth: 4, atlasHeight: 4, regions: [] },
};

describe("导出打包", () => {
  it("zip 内含 json / atlas / png 三个文件", () => {
    const zipped = createBundleZip(bundle, config);
    const files = unzipSync(zipped);
    expect(Object.keys(files).toSorted()).toEqual(["demo.atlas", "demo.json", "demo.png"]);
    expect(new TextDecoder().decode(files["demo.json"])).toBe(bundle.json);
    expect(Array.from(files["demo.png"] ?? [])).toEqual([137, 80, 78, 71]);
  });

  it("工程名带扩展名时不会重复拼接", () => {
    const zipped = createBundleZip(bundle, { ...config, name: "take01.json" });
    const files = unzipSync(zipped);
    expect(Object.keys(files).toSorted()).toEqual(["demo.png", "take01.atlas", "take01.json"]);
  });
});
