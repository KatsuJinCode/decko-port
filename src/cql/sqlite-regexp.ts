import type { LocalSqliteDriver } from "../server/drivers/local-sqlite.js";

const PATTERN_CACHE_LIMIT = 512;
const patternCache = new Map<string, RegExp | null>();

const POSIX_CLASS_TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\[\[:alpha:\]\]/g, "[A-Za-z]"],
  [/\[\[:digit:\]\]/g, "[0-9]"],
  [/\[\[:alnum:\]\]/g, "[A-Za-z0-9]"],
  [/\[\[:upper:\]\]/g, "[A-Z]"],
  [/\[\[:lower:\]\]/g, "[a-z]"],
  [/\[\[:space:\]\]/g, "[ \\t\\r\\n\\v\\f]"],
  [/\[\[:blank:\]\]/g, "[ \\t]"],
  [/\[\[:punct:\]\]/g, "[!-/:-@\\[-`{-~]"],
  [/\[\[:word:\]\]/g, "[A-Za-z0-9_]"],
  [/\[\[:xdigit:\]\]/g, "[0-9A-Fa-f]"],
  [/\[\[:<:\]\]/g, "\\b"],
  [/\[\[:>:\]\]/g, "\\b"],
];

function translateMysqlPattern(pattern: string): string {
  let out = pattern;
  for (const [from, to] of POSIX_CLASS_TRANSLATIONS) {
    out = out.replace(from, to);
  }
  return out;
}

function compileOrNull(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function compileMatchPattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  const unicode = /\\p\{/.test(pattern);
  const translated = translateMysqlPattern(pattern);
  const flags = unicode ? "iu" : "i";
  compiled = compileOrNull(translated, flags);
  if (compiled === null && unicode) {
    const scripted = translated.replace(
      /\\p\{([A-Za-z]+)\}/g,
      (_m, name: string) => `\\p{Script=${name}}`,
    );
    compiled = compileOrNull(scripted, flags);
  }
  if (patternCache.size >= PATTERN_CACHE_LIMIT) patternCache.clear();
  patternCache.set(pattern, compiled);
  return compiled;
}

export function sqliteRegexpUdf(pattern: unknown, value: unknown): number | null {
  if (pattern === null || pattern === undefined || value === null || value === undefined) {
    return null;
  }
  if (typeof pattern !== "string" || typeof value !== "string") return 0;
  const compiled = compileMatchPattern(pattern);
  if (compiled === null) {
    throw new Error(`invalid REGEXP pattern: ${pattern}`);
  }
  return compiled.test(value) ? 1 : 0;
}

export function registerSqliteRegexpFunction(driver: LocalSqliteDriver): void {
  driver.registerFunction("regexp", sqliteRegexpUdf, { deterministic: true });
}
