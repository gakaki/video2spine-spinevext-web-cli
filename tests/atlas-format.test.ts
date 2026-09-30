import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { baseName, parseAtlasPageNames, resolvePagePath } from "@/core/atlas-format";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * 有的图集：页属性**不缩进**，region 属性缩进两格，
 * region 里也有 `size:`（必须靠 region 独有字段排除）。
 */
const MOLA_LIKE = [
  "images/tail-fin.png",
  "size: 69,74",
  "format: RGBA8888",
  "filter: Linear,Linear",
  "repeat: none",
  "角2",
  "  rotate: false",
  "  xy: 0, 0",
  "  size: 69, 74",
  "  orig: 69, 74",
  "  offset: 0, 0",
  "  index: -1",
  "images/head.png",
  "size: 128,128",
  "format: RGBA8888",
  "filter: Linear,Linear",
  "repeat: none",
].join("\n");

/** Spine 官方示例那套图集：页块缩进、没有 format，只有 size / filter / scale。 */
const SPINEBOY_LIKE = [
  "spineboy.png",
  "\tsize: 1024, 256",
  "\tfilter: Linear, Linear",
  "\tscale: 0.5",
  "crosshair",
  "\tbounds: 186, 17, 45, 45",
  "front-bracer",
  "\tbounds: 613, 3, 29, 40",
].join("\n");

describe("atlas 页名解析", () => {
  it("页属性不缩进的图集：只挑出页，region 不会被当成页", () => {
    expect(parseAtlasPageNames(MOLA_LIKE)).toEqual(["images/tail-fin.png", "images/head.png"]);
  });

  it("官方示例式图集：页块没有 format 也能认出来", () => {
    expect(parseAtlasPageNames(SPINEBOY_LIKE)).toEqual(["spineboy.png"]);
  });

  it("空文本没有页", () => {
    expect(parseAtlasPageNames("")).toEqual([]);
  });

  it("页名能拼成相对角色目录的路径，也能只取文件名", () => {
    expect(resolvePagePath("demo/hero/", "images/head.png")).toBe("demo/hero/images/head.png");
    expect(resolvePagePath("demo/hero", "head.png")).toBe("demo/hero/head.png");
    expect(resolvePagePath("demo/hero/", "/abs/head.png")).toBe("/abs/head.png");
    expect(baseName("images/head.png")).toBe("head.png");
  });
});

describe.skipIf(!existsSync(join(ROOT, "public/demo/spineboy/spineboy.atlas")))(
  "内置演示角色的图集",
  () => {
    const read = (page: string) => readFileSync(join(ROOT, "public/demo", page), "utf8");

    it("Spineboy：旧式页块（没有 format）也认得出来", () => {
      const pages = parseAtlasPageNames(read("spineboy/spineboy.atlas"));
      expect(pages).toEqual(["spineboy.png"]);
      expect(existsSync(join(ROOT, "public/demo/spineboy", pages[0]!))).toBe(true);
    });
  },
);
