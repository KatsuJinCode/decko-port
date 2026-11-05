export function numberToHumanSize(size: number): string {
  if (size < 1024) {
    if (size === 1) return "1 Byte";
    return `${size} Bytes`;
  }
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = size;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex += 1;
  }
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  let text = value.toFixed(digits);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return `${text} ${units[unitIndex]}`;
}
