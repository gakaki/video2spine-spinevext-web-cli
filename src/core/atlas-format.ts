/**
 * Spine `.atlas` 文本的最小解析。
 *
 * 只需要一件事：找出图集引用了哪些**页图片**。
 *
 * 图集文本是「名字行 + 若干 `key: value` 行」的块序列，
 * 页块在前、region 块在后，两边的缩进并不统一（官方示例的页块缩进、
 * 有的工程页块不缩进），所以只能靠**键**区分，不能靠缩进：
 *
 * * 页块：有 `format:` / `filter:` / `repeat:`，或者有 `size:` 且没有任何 region 键
 * * region 块：有 `bounds:`（Spine 4.1+）或 `xy:` / `rotate:` / `offsets:` / `index:`
 *
 * 两个条件都要判：有的工程 region 里也写了 `size:`，只看 `size:` 会把 region
 * 误判成页；而官方示例的图集页块里没有 `format:`，只看 `format:` 又会漏掉页。
 */

/** `key: value` 行（页属性或 region 属性）。 */
const PROPERTY = /^[A-Za-z][A-Za-z0-9_]*\s*:/;
/** 只有页块才会有的键。 */
const PAGE_ONLY = /^(format|filter|repeat|pma)\s*:/;
/** 只有 region 块才会有的键。 */
const REGION_ONLY = /^(bounds|xy|offsets|rotate|index|orig|offset)\s*:/;
const SIZE = /^size\s*:/;

function isPageBlock(block: string[]): boolean {
  // 属性行可能带缩进（官方示例用 tab、有的工程用两个空格），判定前先去缩进
  const keys = block.map((line) => line.trim());
  if (keys.some((line) => REGION_ONLY.test(line))) return false;
  return keys.some((line) => PAGE_ONLY.test(line)) || keys.some((line) => SIZE.test(line));
}

/** 图集里的一个块：名字行 + 它下面那些 `key: value` 行（保留原缩进）。 */
export interface AtlasBlock {
  name: string;
  lines: string[];
  isPage: boolean;
  /** 名字行在原始文本里的行号（重写时只改这一行，其余原样保留）。 */
  lineIndex: number;
}

/** 按块切开图集文本，页块与 region 块都返回，顺序保持原样。 */
export function parseAtlasBlocks(atlasText: string): AtlasBlock[] {
  const blocks: AtlasBlock[] = [];
  let current: { name: string; lineIndex: number } | null = null;
  let block: string[] = [];

  const flush = () => {
    if (current) {
      blocks.push({ ...current, lines: block, isPage: isPageBlock(block) });
    }
    current = null;
    block = [];
  };

  atlasText.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    // 空行不结束块：有的导出器在块之间不写空行，靠空行会切错
    if (trimmed.length === 0) return;
    if (PROPERTY.test(trimmed)) {
      block.push(raw.replace(/\s+$/, ""));
      return;
    }
    flush();
    current = { name: trimmed, lineIndex: index };
  });
  flush();

  return blocks;
}

export function parseAtlasPageNames(atlasText: string): string[] {
  return parseAtlasBlocks(atlasText)
    .filter((block) => block.isPage)
    .map((block) => block.name);
}

/** 图集里的一个 region：名字 + 它落在哪一页上。 */
export interface AtlasRegion {
  name: string;
  /** 所在页的名字（原样，可能是 `images/foo.png` 这样的相对路径）。 */
  page: string;
}

/**
 * 列出所有 region 及所属页。
 *
 * Spine 的图集文本里 region 紧跟在它所属的页块后面，所以"最近一个页块"
 * 就是它的页；单页图集（官方示例那种）也自然成立。
 */
export function parseAtlasRegions(atlasText: string): AtlasRegion[] {
  const regions: AtlasRegion[] = [];
  let page: string | null = null;
  for (const block of parseAtlasBlocks(atlasText)) {
    if (block.isPage) {
      page = block.name;
      continue;
    }
    if (page) regions.push({ name: block.name, page });
  }
  return regions;
}

/** 把页名解析成相对某个基准目录的路径（绝对 URL 原样返回）。 */
export function resolvePagePath(baseDir: string, pageName: string): string {
  if (/^(https?:)?\/\//.test(pageName) || pageName.startsWith("/")) return pageName;
  const base = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return `${base}${pageName.replace(/^\.?\//, "")}`;
}

/** 取文件名（图集里可能写成 `images/foo.png`，比对时要按文件名）。 */
export function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
