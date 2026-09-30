/** 时间显示：`12.35s`。 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  return `${seconds.toFixed(2)}s`;
}

/** 大数字加千位分隔，便于读帧数。 */
export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

/** 字节数转可读体积。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** 去掉扩展名的文件名。 */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "");
}
