import { staticUglifier, staticUglifierStringLiteralRanges } from "./uglify-harmony-static.generated.js";
import { uglifierOptionsFor } from "./uglify-harmony-options.js";
import { formatUglifierSyntaxError, type UglifierResult } from "./uglify-harmony-diagnostics.js";

export function staticUglifyHarmonySyntaxError(source: string): string | undefined {
  return formatUglifierSyntaxError(staticUglifier(uglifierOptionsFor(source)) as UglifierResult, source);
}

export function staticUglifyHarmonyStringLiteralRanges(source: string): Array<{value: string; start: number; end: number}> {
  const ranges = staticUglifierStringLiteralRanges(source) as Array<{value: string; start: number; end: number}>;
  for (const range of ranges) {
    if (typeof range.value !== "string" || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.end <= range.start || range.end > source.length) throw new Error("Invalid static JavaScript string literal span");
  }
  return ranges;
}

export function staticUglifyHarmonyCompile(source: string): string {
  const result = staticUglifier(uglifierOptionsFor(source)) as UglifierResult;
  if (result.error !== undefined) {
    const message = typeof result.error === "string" ? result.error : result.error.message ?? JSON.stringify(result.error);
    throw new Error(`uglify-harmony compile failed: ${message}`);
  }
  if (typeof result.code !== "string") throw new Error("uglify-harmony compile returned no code");
  return result.code;
}
