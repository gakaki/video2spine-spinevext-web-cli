/**
 * 把一份已经导出的角色工程按最新规则重写一遍（名字转英文、页图片平铺、去掉 images）。
 *
 * 用来修旧产物 / 手工验证：
 * ```bash
 * pnpm exec vite-node scripts/normalize-export.ts <输入目录> <输出目录>
 * ```
 * 输入目录里要有 `<名字>.json`、`<名字>.atlas` 和图集页图片。
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";

import { zipSync, type Zippable } from "fflate";

// 相对路径引入：这样用 jiti / vite-node / 将来的 Node CLI 都能直接跑
import { parseAtlasPageNames } from "../src/core/atlas-format";
import { normalizeCharacterProject } from "../src/core/character-project";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("用法：vite-node scripts/normalize-export.ts <输入目录> <输出目录>");
  process.exit(1);
}

// 目录里找骨架 JSON 与 atlas：不看目录名，避免 "xxx (1)" 这种副本名对不上
const entries = readdirSync(input);
const jsonFile = entries.find((entry) => entry.endsWith(".json"));
const atlasFile = entries.find((entry) => entry.endsWith(".atlas"));
if (!jsonFile || !atlasFile) {
  console.error(`输入目录里没找到 .json / .atlas：${input}`);
  process.exit(1);
}
const name = parse(jsonFile).name;
const json = readFileSync(join(input, jsonFile), "utf8");
const atlas = readFileSync(join(input, atlasFile), "utf8");
const pages = parseAtlasPageNames(atlas).map((page) => ({
  path: page,
  data: new Uint8Array(readFileSync(join(input, page))),
}));

const fixed = normalizeCharacterProject({ json, atlas, pages });

mkdirSync(output, { recursive: true });
writeFileSync(join(output, `${name}.json`), fixed.json);
writeFileSync(join(output, `${name}.atlas`), fixed.atlas);
for (const page of fixed.pages) {
  writeFileSync(join(output, page.path), page.data);
}

const files: Zippable = {
  [`${name}.json`]: new TextEncoder().encode(fixed.json),
  [`${name}.atlas`]: new TextEncoder().encode(fixed.atlas),
};
for (const page of fixed.pages) files[page.path] = page.data;
writeFileSync(`${output}.zip`, zipSync(files, { level: 6 }));

console.log(`输入 ${input}`);
console.log(`输出 ${output}（+ ${output}.zip）`);
console.log(`页图片 ${fixed.pages.length} 张，改名 ${fixed.renames.length} 处`);
console.log(
  fixed.renames
    .slice(0, 8)
    .map(([from, to]) => `${from}→${to}`)
    .join("  "),
);
