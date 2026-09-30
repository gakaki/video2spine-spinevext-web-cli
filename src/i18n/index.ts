/**
 * 极简 i18n：不引第三方库，一个模块级 store + `t()` + React hook。
 *
 * * 组件用 `useI18n()` 拿 `t`，切换语言自动重渲染；
 * * 非组件代码（`useSpinevext` 的状态消息）直接 `import { t }`，
 *   它读的是同一个模块级当前语言。
 *
 * 默认语言是 **English**（仓库面向英文读者）；用户在标题栏选过就记在 localStorage，
 * 下次进来还用他选的那门。中文 / 日本語 都在标题栏一键可达。
 */

import { useSyncExternalStore } from "react";

import { DICTIONARY, LANGUAGES, type Language, type MessageKey } from "./dictionary";

export type { Language, MessageKey };
export { LANGUAGE_LABELS, LANGUAGES } from "./dictionary";

const STORAGE_KEY = "spinevext-language";

/** 没存过用户选择时用的语言。仓库面向英文读者，所以是英文而不是跟随浏览器。 */
export const DEFAULT_LANGUAGE: Language = "en";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function detectLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // 隐私模式下 localStorage 会抛错，忽略即可
  }
  // 不跟浏览器语言走：默认英文，其它语言由用户显式切换（切换后的选择会被记住）
  return DEFAULT_LANGUAGE;
}

let current: Language = detectLanguage();
const listeners = new Set<() => void>();

// 首屏就把 <html lang> 定好（无障碍与字体回退都看它）
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // 存不上也无所谓，本次会话生效
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 取文案；`{name}` 这类占位符用 params 替换，缺 key 时回落到 key 本身。 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const entry = DICTIONARY[key];
  let text = entry?.[current] ?? entry?.["en"] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export interface I18n {
  language: Language;
  setLanguage: (next: Language) => void;
  t: typeof t;
}

export function useI18n(): I18n {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { language, setLanguage, t };
}

/** 内置演示角色的显示名：按 id 查文案，用户上传的角色用它们自己的工程名。 */
const CHARACTER_NAME_KEYS: Record<string, MessageKey> = {
  spineboy: "character.name.spineboy",
  mixandmatch: "character.name.mixandmatch",
  circus: "character.name.circus",
  goblins: "character.name.goblins",
};

export function characterLabel(id: string, fallback: string): string {
  const key = CHARACTER_NAME_KEYS[id];
  return key ? t(key) : fallback;
}
