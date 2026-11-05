import { rawItemStrings } from "../render/pointer-list.js";
import {
  assembleStyleInput,
  contentOf,
  STYLE_INPUTTER_TYPES,
  StyleAssetUnsupportedError,
  type AssetInputStore,
  type StyleAssetDeps,
  type StyleCard,
} from "./skin-stylesheet.js";
import { modScriptFileContent, modScriptGroups } from "./script-sources.js";
import { ScriptCompressionError } from "./script-compressor.js";

export const SCRIPT_INPUTTER_TYPES: ReadonlySet<string> = new Set(["java_script", "coffee_script"]);

function compileCoffee(deps: StyleAssetDeps, script: string, what: string): string {
  if (deps.compileCoffee === undefined) {
    throw new StyleAssetUnsupportedError(
      `${what}: this host has no CoffeeScript compiler configured (the coffeeCompiler engine option)`,
    );
  }
  return deps.compileCoffee(script, false);
}

function compressCore(deps: StyleAssetDeps, core: string, name: string): string {
  if (deps.compressAssets !== true) return core;
  if (deps.compressScript === undefined) {
    throw new StyleAssetUnsupportedError(
      `${name}: compress_assets is on and this host has no script compressor configured (the scriptCompressor engine option)`,
    );
  }
  try {
    return deps.compressScript(core);
  } catch (e) {
    throw new ScriptCompressionError(name, e);
  }
}

function leafChunk(deps: StyleAssetDeps, name: string, type: string, content: string, what: string): string {
  const core = type === "coffee_script" ? compileCoffee(deps, content, what) : content;
  return `// ${name}\n${compressCore(deps, core, name)}`;
}

export function assembleScriptInput(deps: StyleAssetDeps, card: StyleCard): string | undefined {
  if (card.typeCode === undefined || !SCRIPT_INPUTTER_TYPES.has(card.typeCode)) return undefined;
  return leafChunk(deps, card.name, card.typeCode, contentOf(deps, card), card.name);
}

export function assembleModScriptInput(deps: StyleAssetDeps, card: StyleCard): string | undefined {
  const match = /^mod: (.+)\+\*script$/.exec(card.name);
  if (match === null) return undefined;
  const groups = modScriptGroups(match[1]!.replace(/ /g, "_"));
  if (groups === undefined) return undefined;
  return groups
    .map((group) =>
      group.files
        .map((file) => leafChunk(deps, file.name, file.type, modScriptFileContent(file), file.name))
        .join("\n"),
    )
    .join("\n\n");
}

export async function assetInputVia(
  deps: StyleAssetDeps,
  store: AssetInputStore,
  card: StyleCard,
  assemble: (card: StyleCard) => string | undefined | Promise<string | undefined>,
): Promise<string> {
  const stored = await store.read(card);
  if (stored !== undefined && stored.trim() !== "") return stored;
  const content = (await assemble(card)) ?? "";
  await store.save(card, content);
  return content;
}

export async function scriptOutputContent(
  deps: StyleAssetDeps,
  store: AssetInputStore,
  outputter: StyleCard,
): Promise<string> {
  const parts: string[] = [];
  for (const itemName of rawItemStrings(contentOf(deps, outputter))) {
    if (itemName === "") continue;
    const item = await deps.card(itemName);
    if (item === undefined) continue;
    if (item.typeCode !== undefined && STYLE_INPUTTER_TYPES.has(item.typeCode)) {
      parts.push(await assetInputVia(deps, store, item, (c) => assembleStyleInput(deps, store, c)));
    } else if (item.typeCode !== undefined && SCRIPT_INPUTTER_TYPES.has(item.typeCode)) {
      parts.push(await assetInputVia(deps, store, item, (c) => assembleScriptInput(deps, c)));
    } else if (/^mod: .+\+\*script$/.test(item.name)) {
      parts.push(await assetInputVia(deps, store, item, (c) => assembleModScriptInput(deps, c)));
    } else {
      throw new StyleAssetUnsupportedError(`${item.name} is not a valid asset input card`);
    }
  }
  return parts.join("\n");
}
