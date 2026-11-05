import { edgeAssetSources } from "../../../vendor/edge-script-source-snapshot.js";

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
    throw new Error("script sources need a Node filesystem (the vendored fixtures/vendor/ tree); this runtime has none");
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
    if (fs().existsSync(new URL("mod-script-assets/manifest.json", candidate))) {
      vendorDir = candidate;
      return candidate;
    }
  }
  throw new Error("fixtures/vendor/mod-script-assets/manifest.json not found next to the engine sources");
}

export interface ModScriptFile {
  file: string;
  name: string;
  type: string;
  sha256: string;
}

export interface ModScriptGroup {
  group: string;
  groupType: string;
  files: ModScriptFile[];
}

let manifest: Record<string, ModScriptGroup[]> | undefined;
export function modScriptGroups(modName: string): readonly ModScriptGroup[] | undefined {
  if (manifest === undefined) {
    const text = readVendored("mod-script-assets/manifest.json");
    if (text === undefined) throw new Error("vendored script sources not found: mod-script-assets/manifest.json");
    manifest = (JSON.parse(text) as { mods: Record<string, ModScriptGroup[]> }).mods;
  }
  return manifest[modName];
}

export function modScriptFileContent(file: ModScriptFile): string {
  const text = readVendored(`mod-script-assets/${file.file}`);
  if (text === undefined) throw new Error(`vendored script source not found: mod-script-assets/${file.file}`);
  return text;
}

export function scriptSourcesAvailable(): boolean {
  return readVendored("mod-script-assets/manifest.json") !== undefined;
}
