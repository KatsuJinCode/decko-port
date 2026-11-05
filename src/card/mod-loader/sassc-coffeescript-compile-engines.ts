import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compile as coffeeCompile } from "coffeescript";

export type SasscStyle = "compressed" | "expanded" | "nested" | "compact";

export class SasscCompileError extends Error {
  readonly sourceName: string;

  constructor(sourceName: string, detail: string) {
    super(`SassC compile failed for ${sourceName}: ${detail.split("\n")[0]}`);
    this.name = "SasscCompileError";
    this.sourceName = sourceName;
  }
}

function libsassProgram(): string {
  const named = process.env["DECKO_SASSC"];
  if (named !== undefined && named !== "") return named;
  const exe = process.platform === "win32" ? ".exe" : "";
  return fileURLToPath(
    new URL(`../../../tools/libsass/build/sassc-stdin${exe}`, import.meta.url),
  );
}

export function sasscRender(input: string, style: SasscStyle = "compressed"): string {
  if (input === "") return "";
  const program = libsassProgram();
  const run = spawnSync(program, [style], {
    input,
    windowsHide: true,
    maxBuffer: 1 << 28,
  });
  if (run.error !== undefined) {
    throw new SasscCompileError(
      "(inline source)",
      `the LibSass program at ${program} could not run: ${run.error.message}`,
    );
  }
  if (run.status !== 0) {
    throw new SasscCompileError("(inline source)", run.stderr.toString("utf8").trim() || `exit ${run.status}`);
  }
  return run.stdout.toString("utf8");
}

export function compressCss(input: string): string {
  return sasscRender(input, "compressed");
}

export function compileScss(scss: string, style: "expanded" | "compressed" = "expanded"): string {
  return sasscRender(scss, style);
}

export function compileCoffeeScript(script: string, noWrap: boolean): string {
  return coffeeCompile(script, { bare: noWrap });
}

export function scriptCompressedView(
  cardName: string,
  core: string,
  compressAssets: boolean,
): string {
  if (compressAssets) {
    throw new Error(
      "uglify surface unported: 00_script.rb try_compress runs Uglifier.new(harmony: true).compile; " +
        "no js minifier is installed in the engine (the oracle deck runs compress_assets=false, " +
        "the identity arm this port pins)",
    );
  }
  return `// ${cardName}\n${core}`;
}

export const styleGroupFileExtensions = ["css", "scss"] as readonly string[];

export const scriptGroupFileExtensions = ["js", "coffee"] as readonly string[];

function listDirRecursive(base: string, prefix: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSorted(base);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      out.push(...listDirRecursive(`${base}/${entry.name}`, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function readdirSorted(dir: string): Array<{ name: string; isDirectory: boolean }> {
  const dirents = readDirEntries(dir);
  return dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function readDirEntries(dir: string): Array<{ name: string; isDirectory: boolean }> {
  return readdirSync(dir).map((name) => {
    let isDirectory = false;
    try {
      isDirectory = statSync(`${dir}/${name}`).isDirectory();
    } catch {
      isDirectory = false;
    }
    return { name, isDirectory };
  });
}

export function folderGroupRelativePaths(
  assetsPath: string | undefined | null,
  validFileExtensions: readonly string[],
): string[] {
  if (!assetsPath) return [];
  const all = listDirRecursive(assetsPath, "");
  return all.filter((rel) => validFileExtensions.some((ext) => rel.endsWith(`.${ext}`)));
}

export function folderGroupPaths(
  assetsPath: string | undefined | null,
  validFileExtensions: readonly string[],
): string[] {
  if (!assetsPath) return [];
  return folderGroupRelativePaths(assetsPath, validFileExtensions).map(
    (rel) => `${assetsPath}/${rel}`,
  );
}

export function manifestGroupItems(
  manifest: Record<string, { items?: string[] }> | null | undefined,
  groupName: string,
): string[] {
  return manifest?.[groupName]?.items ?? [];
}

export function styleAssetConstants(
  path: string,
): { typeCode: "scss" | "css"; setModule: "Abstract::AssetScss" | "Abstract::AssetCss" } | undefined {
  if (path.endsWith(".scss")) {
    return { typeCode: "scss", setModule: "Abstract::AssetScss" };
  }
  if (path.endsWith(".css")) {
    return { typeCode: "css", setModule: "Abstract::AssetCss" };
  }
  return undefined;
}

export function scriptAssetConstants(
  path: string,
): { typeCode: "coffee_script" | "java_script"; setModule: "Abstract::AssetCoffeeScript" | "Abstract::AssetJavaScript" } | undefined {
  if (path.endsWith(".js.coffee")) {
    return { typeCode: "coffee_script", setModule: "Abstract::AssetCoffeeScript" };
  }
  if (path.endsWith(".js")) {
    return { typeCode: "java_script", setModule: "Abstract::AssetJavaScript" };
  }
  return undefined;
}
