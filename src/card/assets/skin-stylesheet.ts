import { DeckoName } from "../name.js";
import { rawItemStrings } from "../render/pointer-list.js";
import { bootstrapCoreScss, bootstrapFunctionsScss } from "../render/bootstrap-code-files.js";
import {
  bootswatchThemeFile,
  modStyleFileContent,
  modStyleFiles,
  modStyleGroups,
  type ModStyleGroup,
} from "./style-sources.js";
import type { CoffeeCompiler } from "./coffee-compiler.js";
import type { ScriptCompressor } from "./script-compressor.js";
import type { ScssCompiler } from "./scss-compiler.js";

export interface StyleCard {
  id: number;
  name: string;
  key: string;
  typeCode: string | undefined;
  codename: string | undefined;
  dbContent: string;
  leftId: number | undefined;
  rightId: number | undefined;
}

export interface StyleAssetDeps {
  card(name: string): Promise<StyleCard | undefined>;
  cardByCodename(codename: string): Promise<StyleCard | undefined>;
  compile: ScssCompiler | undefined;
  compileCoffee?: CoffeeCompiler | undefined;
  compressAssets?: boolean;
  compressScript?: ScriptCompressor | undefined;
  staleContent?: ReadonlyMap<string, string>;
  relativeRoot?: string;
}

export class StyleAssetUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleAssetUnsupportedError";
  }
}

export const STYLE_INPUTTER_TYPES: ReadonlySet<string> = new Set(["bootswatch_skin", "scss", "css", "skin"]);

const RECURSABLE_TYPES: ReadonlySet<string> = new Set(["pointer", "list", "link_list", "nest_list", "skin"]);

export function contentOf(deps: StyleAssetDeps, card: StyleCard): string {
  return deps.staleContent?.get(card.key) ?? card.dbContent;
}

export function renderStyleChunks(text: string, relativeRoot = ""): string {
  if (/\{\{[^{}]*\}\}/.test(text)) {
    throw new StyleAssetUnsupportedError("a nest ({{...}}) in stylesheet content is not supported");
  }
  return text.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string, offset: number) => {
    if (offset > 0 && text[offset - 1] === "\\") {
      throw new StyleAssetUnsupportedError(`an escaped link in stylesheet content is not supported: ${whole}`);
    }
    const bar = inner.indexOf("|");
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const linkText = bar === -1 ? undefined : inner.slice(bar + 1).trim();
    let path: string;
    if (target.startsWith("/")) {
      path = `${relativeRoot}/${target.slice(1)}`;
    } else if (/^(https?:|mailto:)/.test(target)) {
      path = target;
    } else {
      throw new StyleAssetUnsupportedError(`a card link in stylesheet content is not supported: ${whole}`);
    }
    return linkText !== undefined && linkText !== "" && linkText !== path ? `${linkText}[${path}]` : path;
  });
}

async function modNameOf(deps: StyleAssetDeps, modStyleCard: StyleCard): Promise<string> {
  const leftName = DeckoName.parse(modStyleCard.name).leftName;
  const left = leftName !== undefined ? await deps.card(leftName.s) : undefined;
  if (left?.codename !== undefined && left.codename !== "") return left.codename.replace(/^mod_/, "");
  return (leftName?.s ?? "").replace(/^mod: /, "").replace(/ /g, "_");
}

async function leafContents(
  deps: StyleAssetDeps,
  card: StyleCard,
  out: string[],
  seen: Set<string>,
): Promise<void> {
  if (seen.has(card.key)) return;
  seen.add(card.key);
  if (card.codename === "bootstrap_functions") return void out.push(bootstrapFunctionsScss());
  if (card.codename === "bootstrap_core") return void out.push(bootstrapCoreScss());
  if (card.codename === "style_mods") {
    for (const item of rawItemStrings(contentOf(deps, card))) {
      if (item === "") continue;
      const modCard = await deps.card(item);
      if (modCard === undefined) {
        out.push("");
        continue;
      }
      for (const file of modStyleFiles(await modNameOf(deps, modCard)) ?? []) out.push(modStyleFileContent(file));
    }
    return;
  }
  if (card.typeCode !== undefined && RECURSABLE_TYPES.has(card.typeCode)) {
    for (const item of rawItemStrings(contentOf(deps, card))) {
      if (item === "") continue;
      const itemCard = await deps.card(item);
      if (itemCard === undefined) out.push("");
      else await leafContents(deps, itemCard, out, seen);
    }
    return;
  }
  out.push(contentOf(deps, card));
}

async function loadContent(deps: StyleAssetDeps, cards: ReadonlyArray<StyleCard | undefined>): Promise<string> {
  const out: string[] = [];
  for (const card of cards) {
    if (card === undefined) continue;
    await leafContents(deps, card, out, new Set());
  }
  return out.join("\n");
}

async function styleModsCore(deps: StyleAssetDeps, card: StyleCard): Promise<string> {
  const items: string[] = [];
  for (const item of rawItemStrings(contentOf(deps, card))) {
    if (item === "") continue;
    const modCard = await deps.card(item);
    if (modCard === undefined) {
      items.push("");
      continue;
    }
    items.push(await modStyleGroupsJoined(deps, modCard, "\n\n"));
  }
  return items.join(", ");
}

async function modStyleCore(deps: StyleAssetDeps, modStyleCard: StyleCard): Promise<string> {
  const groups = modStyleGroups(await modNameOf(deps, modStyleCard)) ?? [];
  return groups.map((group) => groupContent(deps, group)).join(", ");
}

async function modStyleGroupsJoined(deps: StyleAssetDeps, modCard: StyleCard, join: string): Promise<string> {
  const groups = modStyleGroups(await modNameOf(deps, modCard)) ?? [];
  return groups.map((group) => groupContent(deps, group)).join(join);
}

function groupContent(deps: StyleAssetDeps, group: ModStyleGroup): string {
  return group.files.map((f) => renderStyleChunks(modStyleFileContent(f), deps.relativeRoot)).join("\n");
}

async function isModStyleCard(deps: StyleAssetDeps, card: StyleCard): Promise<boolean> {
  if (!card.name.endsWith("+*style")) return false;
  const left = DeckoName.parse(card.name).leftName;
  if (left === undefined) return false;
  return (await deps.card(left.s))?.codename?.startsWith("mod_") === true;
}

async function themeName(deps: StyleAssetDeps, skin: StyleCard, depth = 0): Promise<string> {
  if (depth < 20) {
    const parentField = await deps.card(`${skin.name}+*parent`);
    const parentName = parentField !== undefined ? rawItemStrings(contentOf(deps, parentField))[0] : undefined;
    const parent = parentName !== undefined && parentName !== "" ? await deps.card(parentName) : undefined;
    if (parent !== undefined && parent.id !== skin.id) {
      if (parent.typeCode !== "bootswatch_skin") {
        throw new StyleAssetUnsupportedError(`not a valid theme ${parent.name}`);
      }
      return themeName(deps, parent, depth + 1);
    }
  }
  return (skin.codename ?? "").replace(/_skin$/, "");
}

export async function bootswatchSkinContent(deps: StyleAssetDeps, skin: StyleCard): Promise<string> {
  const theme = await themeName(deps, skin);
  const field = (right: string) => deps.card(`${skin.name}+${right}`);
  const pre = await loadContent(deps, [await deps.cardByCodename("bootstrap_functions")]);
  const variables = [
    await loadContent(deps, [await field("*colors"), await field("*variables")]),
    bootswatchThemeFile(theme, "variables"),
  ].join("\n");
  const post = await loadContent(deps, [
    await deps.cardByCodename("bootstrap_core"),
    await deps.cardByCodename("style_mods"),
  ]);
  const stylesheets = [
    bootswatchThemeFile(theme, "bootswatch"),
    await loadContent(deps, [await field("*stylesheets")]),
  ].join("\n");
  return [pre, variables, post, stylesheets].join("\n");
}

async function compile(deps: StyleAssetDeps, source: string, what: string): Promise<string> {
  if (deps.compile === undefined) {
    throw new StyleAssetUnsupportedError(
      `${what}: this host has no SCSS compiler configured (the scssCompiler engine option)`,
    );
  }
  return source === "" ? "" : deps.compile(source, "compressed");
}

function majorComment(comment: string): string {
  const edge = `/* ${"-".repeat(comment.length + 4)} */`;
  return `${edge}\n/* - ${comment} - */\n${edge}\n\n`;
}

export interface AssetInputStore {
  read(inputter: StyleCard): Promise<string | undefined>;
  save(inputter: StyleCard, content: string): Promise<void>;
}

export async function assembleStyleInput(
  deps: StyleAssetDeps,
  store: AssetInputStore,
  card: StyleCard,
): Promise<string | undefined> {
  switch (card.typeCode) {
    case "bootswatch_skin":
      return compile(deps, renderStyleChunks(await bootswatchSkinContent(deps, card), deps.relativeRoot), card.name);
    case "scss":
      return renderStyleChunks(contentOf(deps, card), deps.relativeRoot);
    case "css":
      return compile(deps, renderStyleChunks(contentOf(deps, card), deps.relativeRoot), card.name);
    case "skin": {
      const parts: string[] = [];
      for (const itemName of rawItemStrings(contentOf(deps, card))) {
        if (itemName === "") continue;
        const item = await deps.card(itemName);
        if (item === undefined) {
          parts.push(majorComment(`MISSING Style Card: ${DeckoName.parse(itemName).s}`));
        } else if (item.typeCode !== undefined && STYLE_INPUTTER_TYPES.has(item.typeCode)) {
          parts.push(await assetInput(deps, store, item));
        } else if (item.typeCode !== undefined && RECURSABLE_TYPES.has(item.typeCode)) {
          throw new StyleAssetUnsupportedError(`${card.name}: a list item (${item.name}) in a skin is not supported`);
        } else {
          parts.push(renderStyleChunks(contentOf(deps, item), deps.relativeRoot));
        }
      }
      return parts.join("\n");
    }
    case "list": {
      if (card.codename === "style_mods") return styleModsCore(deps, card);
      if (await isModStyleCard(deps, card)) return modStyleCore(deps, card);
      if (await isStyleRule(deps, card)) {
        const parts: string[] = [];
        await leafContents(deps, card, parts, new Set());
        return parts.join("\n");
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

async function isStyleRule(deps: StyleAssetDeps, card: StyleCard): Promise<boolean> {
  if (card.rightId === undefined || card.rightId === null) return false;
  const style = await deps.cardByCodename("style");
  return style !== undefined && card.rightId === style.id;
}

export async function assetInput(deps: StyleAssetDeps, store: AssetInputStore, card: StyleCard): Promise<string> {
  const stored = await store.read(card);
  if (stored !== undefined) return stored;
  const content = (await assembleStyleInput(deps, store, card)) ?? "";
  await store.save(card, content);
  return content;
}

export async function assetInputContent(deps: StyleAssetDeps, store: AssetInputStore, card: StyleCard): Promise<string> {
  const current = await assetInput(deps, store, card);
  if (current.trim() !== "") return current;
  const content = (await assembleStyleInput(deps, store, card)) ?? "";
  await store.save(card, content);
  return content;
}

export async function styleOutputContent(
  deps: StyleAssetDeps,
  store: AssetInputStore,
  outputter: StyleCard,
): Promise<string> {
  const parts: string[] = [];
  for (const itemName of rawItemStrings(contentOf(deps, outputter))) {
    if (itemName === "") continue;
    const item = await deps.card(itemName);
    if (item === undefined) continue;
    if (item.typeCode === undefined || !STYLE_INPUTTER_TYPES.has(item.typeCode)) {
      throw new StyleAssetUnsupportedError(`${item.name} is not a valid asset input card`);
    }
    parts.push(await assetInputContent(deps, store, item));
  }
  return parts.join("\n");
}
