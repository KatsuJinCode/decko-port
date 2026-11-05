import { edgeAssetSources } from "../../../vendor/edge-style-source-snapshot.js";

interface NodeSyncFs {
  readFileSync(path: string | URL, encoding: string): string;
  existsSync(path: string | URL): boolean;
}

let nodeFs: NodeSyncFs | undefined;
function fsOrNull(): NodeSyncFs | undefined {
  if (nodeFs !== undefined) return nodeFs;
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const found = proc?.getBuiltinModule?.("node:fs") as NodeSyncFs | undefined;
  if (found !== undefined) nodeFs = found;
  return found;
}

function fs(): NodeSyncFs {
  const found = fsOrNull();
  if (found === undefined) {
    throw new Error("style sources need a Node filesystem (the vendored fixtures/vendor/ tree); this runtime has none");
  }
  return found;
}

function readVendored(relativePath: string): string | undefined {
  const nodeFs = fsOrNull();
  if (nodeFs !== undefined) {
    let directory: URL;
    try { directory = vendorDirectory(); }
    catch { return edgeAssetSources[relativePath]; }
    try {
      return nodeFs.readFileSync(new URL(relativePath, directory), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      return undefined;
    }
  }
  return edgeAssetSources[relativePath];
}

let vendorDir: URL | undefined;
function vendorDirectory(): URL {
  if (vendorDir !== undefined) return vendorDir;
  for (const up of ["../../../", "../../../../"]) {
    const candidate = new URL(`${up}fixtures/vendor/`, import.meta.url);
    if (fs().existsSync(new URL("mod-style-assets/manifest.json", candidate))) {
      vendorDir = candidate;
      return candidate;
    }
  }
  throw new Error("fixtures/vendor/mod-style-assets/manifest.json not found next to the engine sources");
}

export interface ModStyleFile {
  file: string;
  type: string;
  sha256: string;
}

export const STYLE_SOURCES_MTIME: Date = new Date("2026-10-13T00:00:00Z");

let manifest: Record<string, ModStyleGroup[]> | undefined;
function vendoredManifest(): Record<string, ModStyleGroup[]> {
  if (manifest === undefined) {
    const text = readVendored("mod-style-assets/manifest.json");
    if (text === undefined) throw new Error("vendored style sources not found: mod-style-assets/manifest.json");
    manifest = (JSON.parse(text) as { mods: Record<string, ModStyleGroup[]> }).mods;
  }
  return manifest;
}

export interface ModStyleGroup {
  name: string;
  type: string;
  files: ModStyleFile[];
}

export function modStyleGroups(modName: string): readonly ModStyleGroup[] | undefined {
  return vendoredManifest()[modName];
}

export function modStyleFiles(modName: string): readonly ModStyleFile[] | undefined {
  const groups = vendoredManifest()[modName];
  if (groups === undefined) return undefined;
  return groups.flatMap((group) => group.files);
}

export function modStyleFileContent(file: ModStyleFile): string {
  const text = readVendored(`mod-style-assets/${file.file}`);
  if (text === undefined) throw new Error(`vendored style source not found: mod-style-assets/${file.file}`);
  return text;
}

export function bootswatchThemeFile(theme: string, file: "variables" | "bootswatch"): string {
  if (theme === "" || /[\\/.]/.test(theme)) return "";
  return readVendored(`bootswatch/${theme}/_${file}.scss`) ?? "";
}
