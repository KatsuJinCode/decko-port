import { rawItemStrings } from "../render/pointer-list.js";

export type AssetInputFormat = "scss" | "css" | "js";

export interface AssetInputCardRef {
  name: string;
  dbContent?: string | null;
  setKeys?: string;
  id?: number;
  trash?: boolean;
  virtual?: boolean;
}

export interface AssetInputDeps {
  fetchByName(
    name: string,
  ): AssetInputCardRef | undefined | Promise<AssetInputCardRef | undefined>;
  renderInputView(
    item: AssetInputCardRef,
    format: AssetInputFormat,
    view: string,
  ): string | null | Promise<string | null>;
}

export interface AssetInputFormatSpec {
  format: AssetInputFormat;
  view: string;
  groupOverride?: boolean;
}

const ASSET_INPUT_FORMAT_RULES: ReadonlyArray<{ token: string; spec: AssetInputFormatSpec }> = [
  { token: "SELF-style_mod", spec: { format: "scss", view: "core" } },
  { token: "TYPE_PLUS_RIGHT-mod-Xstyle", spec: { format: "scss", view: "core" } },
  { token: "TYPE_PLUS_RIGHT-mod-Xscript", spec: { format: "js", view: "core" } },
  { token: "TYPE-css", spec: { format: "css", view: "compressed" } },
  { token: "TYPE-scss", spec: { format: "scss", view: "core" } },
  { token: "TYPE-skin", spec: { format: "css", view: "concat" } },
  { token: "TYPE-bootswatch_skin", spec: { format: "css", view: "compressed" } },
  { token: "TYPE-java_script", spec: { format: "js", view: "compressed" } },
  { token: "TYPE-coffee_script", spec: { format: "js", view: "compressed" } },
  { token: "TYPE-local_style_folder_group", spec: { format: "scss", view: "core", groupOverride: true } },
  { token: "TYPE-local_style_manifest_group", spec: { format: "scss", view: "core", groupOverride: true } },
  { token: "TYPE-local_script_folder_group", spec: { format: "js", view: "core", groupOverride: true } },
  { token: "TYPE-local_script_manifest_group", spec: { format: "js", view: "core", groupOverride: true } },
];

export function inputFormatFor(setKeys: string | undefined): AssetInputFormatSpec | undefined {
  if (setKeys === undefined || setKeys === "") return undefined;
  const tokens = setKeys.split(/\s+/);
  for (const { token, spec } of ASSET_INPUT_FORMAT_RULES) {
    if (tokens.includes(token)) return spec;
  }
  return undefined;
}

export function assetInputCardName(itemName: string): string {
  return `${itemName}+*asset input`;
}

function isVirtualItem(item: AssetInputCardRef): boolean {
  return item.virtual ?? item.id === undefined;
}

export async function inputItemCards(
  deps: AssetInputDeps,
  outputterName: string,
): Promise<AssetInputCardRef[]> {
  const outputter = await deps.fetchByName(outputterName);
  if (outputter === undefined) {
    throw new Error(`card not found: ${outputterName}`);
  }
  const itemNames = rawItemStrings(outputter.dbContent ?? "");
  const items: AssetInputCardRef[] = [];
  for (const name of itemNames) {
    if (name === "") continue;
    const item = await deps.fetchByName(name);
    if (item === undefined) continue;
    if (item.trash === true) continue;
    items.push(item);
  }
  return items;
}

export async function assembleAssetInputContent(
  deps: AssetInputDeps,
  item: AssetInputCardRef,
): Promise<string | null> {
  const spec = inputFormatFor(item.setKeys);
  if (spec === undefined) return null;
  return (await deps.renderInputView(item, spec.format, spec.view)) ?? null;
}

export async function assetInputContent(
  deps: AssetInputDeps,
  item: AssetInputCardRef,
): Promise<string | null> {
  if (isVirtualItem(item)) return assembleAssetInputContent(deps, item);
  return assembleAssetInputContent(deps, item);
}

export async function findInvalidInput(
  deps: AssetInputDeps,
  outputterName: string,
): Promise<string | null> {
  const items = await inputItemCards(deps, outputterName);
  for (const item of items) {
    if (inputFormatFor(item.setKeys) === undefined) return item.name;
  }
  return null;
}

export async function inputFromItemCards(
  deps: AssetInputDeps,
  outputterName: string,
  joint = "\n",
): Promise<string> {
  const items = await inputItemCards(deps, outputterName);
  const contents: string[] = [];
  for (const item of items) {
    const content = await assetInputContent(deps, item);
    if (content !== null) contents.push(content);
  }
  return contents.join(joint);
}
