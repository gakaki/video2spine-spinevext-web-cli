import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { DICTIONARY, LANGUAGES, LANGUAGE_LABELS } from "@/i18n/dictionary";
import { getLanguage, setLanguage, t } from "@/i18n";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("文案表", () => {
  /** 英文里本来就该是空串的后缀（单位写在标签里了）。 */
  const EMPTY_OK = new Set(["control.minKeypoints.suffix"]);

  it("每种语言都把 key 写全了，没有空串", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      for (const language of LANGUAGES) {
        const text = entry[language];
        const allowedEmpty = EMPTY_OK.has(key);
        if (typeof text !== "string" || (!allowedEmpty && text.trim().length === 0)) {
          missing.push(`${key} → ${language}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("占位符在各语言里都留住了", () => {
    const holes = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).toSorted();
    const broken: string[] = [];
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      const base = holes(entry["zh-CN"]);
      for (const language of LANGUAGES) {
        if (holes(entry[language]).join() !== base.join()) {
          broken.push(`${key} → ${language}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("语言选择器上的名字用各语言自己的写法", () => {
    expect(LANGUAGE_LABELS["zh-CN"]).toBe("中文");
    expect(LANGUAGE_LABELS.en).toBe("English");
    expect(LANGUAGE_LABELS.ja).toBe("日本語");
  });
});

describe("t()", () => {
  it("换语言之后同一条 key 给出对应语言，并支持占位符", () => {
    setLanguage("zh-CN");
    expect(t("app.stage.ready")).toBe("已完成");
    expect(t("stage.frames", { count: 90 })).toBe("90 帧");

    setLanguage("en");
    expect(t("app.stage.ready")).toBe("Ready");
    expect(t("stage.frames", { count: 90 })).toBe("90 frames");

    setLanguage("ja");
    expect(t("app.stage.ready")).toBe("完成");
    expect(t("stage.frames", { count: 90 })).toBe("90 フレーム");

    setLanguage("zh-CN");
    expect(getLanguage()).toBe("zh-CN");
  });

  it("缺 key 时回落成 key 本身，不会炸", () => {
    // @ts-expect-error 故意传一个不存在的 key，模拟字典漏项
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});

describe("界面文案不留硬编码", () => {
  it("组件里除了注释不该再出现中文", () => {
    const files = [
      "src/App.tsx",
      ...readdirSync(join(ROOT, "src/components"))
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => `src/components/${name}`),
      "src/hooks/useSpinevext.ts",
    ];
    const leftovers: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释（含 JSX 里的 {/* */}）
        .replace(/^\s*\/\/.*$/gm, ""); // 行注释
      for (const [index, line] of text.split("\n").entries()) {
        if (/[\u4e00-\u9fff]/.test(line)) leftovers.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
    expect(leftovers).toEqual([]);
  });
});
