import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { uglifierOptionsFor } from "./uglify-harmony-options.js";
import { formatUglifierRawError, formatUglifierSyntaxError, type UglifierResult } from "./uglify-harmony-diagnostics.js";

const VENDOR_DIR_NAME = "uglifier-4.2.1-uglify-harmony";

const SNAPSHOT_FILES = [
  "es5.js",
  "split.js",
  "source-map.js",
  "uglify-harmony.js",
  "uglifier.js",
] as const;

function locateSnapshotDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 8; up += 1) {
    const candidate = join(dir, "vendor", VENDOR_DIR_NAME);
    try {
      readFileSync(join(candidate, "uglify-harmony.js"));
      return candidate;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error(
    `vendored uglifier snapshot not found: no vendor/${VENDOR_DIR_NAME} ` +
      `on the ancestor path of ${import.meta.url}`,
  );
}

interface UglifyNode {
  TYPE: string;
  value?: unknown;
  start?: { pos?: number };
  end?: { endpos?: number };
}
interface UglifyParser {
  parse(source: string): { walk(walker: unknown): void };
  TreeWalker: new (visit: (node: UglifyNode) => void) => unknown;
}
export interface JavaScriptStringLiteralRange {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}
let sandbox: { uglifier: (options: unknown) => { code?: string; error?: unknown }; parser: UglifyParser } | undefined;

function uglifierSandbox(): ReturnType<typeof loadSandbox> {
  if (sandbox === undefined) sandbox = loadSandbox();
  return sandbox;
}

function loadSandbox() {
  const snapshotDir = locateSnapshotDir();
  const source = SNAPSHOT_FILES.map((f) => readFileSync(join(snapshotDir, f), "utf8")).join("\n");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const callable = (context as { uglifier?: unknown }).uglifier;
  if (typeof callable !== "function") {
    throw new Error(
      `vendored uglifier snapshot did not define uglifier() (${snapshotDir})`,
    );
  }
  const parser = (context as { UglifyJS?: UglifyParser }).UglifyJS;
  if (typeof parser?.parse !== "function" || typeof parser.TreeWalker !== "function") {
    throw new Error("vendored uglifier snapshot did not expose its parser/walker");
  }
  return { uglifier: callable as (options: unknown) => { code?: string; error?: unknown }, parser };
}

export function uglifyHarmonyStringLiteralRanges(source: string): JavaScriptStringLiteralRange[] {
  const { parser } = uglifierSandbox(), ranges: JavaScriptStringLiteralRange[] = [];
  parser.parse(source).walk(new parser.TreeWalker(node => {
    if (node.TYPE !== "String") return;
    const start = node.start?.pos, end = node.end?.endpos;
    if (typeof node.value !== "string" || typeof start !== "number" || typeof end !== "number"
      || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > source.length) {
      throw new Error("vendored uglifier returned an invalid string literal span");
    }
    ranges.push({ value: node.value, start, end });
  }));
  return ranges;
}

export function uglifyHarmonyCompile(source: string): string {
  const result = uglifierSandbox().uglifier(uglifierOptionsFor(source)) as {
    code?: string;
    error?: { message?: string } | string;
  };
  if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
    const message =
      typeof result.error === "string"
        ? result.error
        : (result.error.message ?? JSON.stringify(result.error));
    throw new Error(`uglify-harmony compile failed: ${message}`);
  }
  const code = result?.code;
  if (typeof code !== "string") {
    throw new Error("uglify-harmony compile returned no code");
  }
  return code;
}

export function uglifyHarmonySyntaxError(source: string): string | undefined {
  return formatUglifierSyntaxError(uglifierSandbox().uglifier(uglifierOptionsFor(source)) as UglifierResult, source);
}

export function uglifyHarmonyRawError(source: string): string | undefined {
  return formatUglifierRawError(uglifierSandbox().uglifier(uglifierOptionsFor(source)) as UglifierResult, source);
}
