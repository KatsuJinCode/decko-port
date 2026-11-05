export interface UglifierResult {
  code?: string;
  map?: string;
  error?: { message?: string; line?: number; col?: number } | string;
}
export function formatUglifierSyntaxError(result: UglifierResult, source: string): string | undefined {
  const raw = formatUglifierRawError(result, source);
  if (raw === undefined) return undefined;
  return raw.replace(/\x1b\[(36|91)m(.*?)\x1b\[0m/g,
    (_match, code: string, text: string) => `<span style='color: ${code === "36" ? "darkcyan" : "lightcoral"}; '>${text}</span>`);
}

export function formatUglifierRawError(result: UglifierResult, source: string): string | undefined {
  if (result.error === undefined) return undefined;
  const error = result.error;
  const message = typeof error === "string" ? error : error.message ?? "";
  let context = "";
  if (typeof error !== "string" && error.line !== undefined && error.line !== null) {
    const lines = source.split("\n");
    while (lines.at(-1) === "") lines.pop();
    const lineIndex = error.line - 1;
    const low = Math.max(lineIndex - 8, 0);
    const high = Math.min(error.line + 8, lines.length);
    const width = String(high).length;
    const formatted = lines.slice(low, high).map((line, index) => {
      if (low + index !== lineIndex) return `\x1b[36m${String(low + index + 1).padStart(width + 1)}\x1b[0m ${line}`;
      const chars = Array.from(line);
      const column = error.col ?? 0;
      return `\x1b[91m${" => ".padStart(width + 2)}\x1b[0m${chars.slice(0, column).join("")}\x1b[91m${chars.slice(column).join("")}\x1b[0m`;
    });
    context = `--\n${formatted.join("\n")}\n==`;
  }
  return `${message}\n${context}`;
}
