import type { RenderFormat, RenderCard } from "./format.js";
import { DeckoName } from "../name.js";
import { getNameEnvironment } from "../name/environment.js";
import {
  bootstrapCoreContent,
  bootstrapCoreScss,
  bootstrapFunctionsContent,
  bootstrapFunctionsScss,
} from "./bootstrap-code-files.js";
import { rawItemStrings } from "./pointer-list.js";
import {
  bootswatchThemeFile,
  modStyleFileContent,
  modStyleFiles,
} from "../assets/style-sources.js";

export function toPointerContent(items: readonly string[]): string {
  return items
    .map((item) => {
      let s = item.toString().trim();
      if (s.startsWith("[[")) s = s.slice(2);
      if (s.endsWith("]]")) s = s.slice(0, -2);
      return s;
    })
    .join("\n");
}

export function listInputOptionsContent(): string {
  return toPointerContent([
    "radio",
    "checkbox",
    "select",
    "multiselect",
    "list",
    "autocomplete",
    "text area",
    "text field",
    "ace editor",
    "calendar",
    "tinymce editor",
  ]);
}

export type ContentFn = (fmt: RenderFormat) => string;

export interface RegisteredContentOverride {
  readonly setPath: string;
  readonly modName: string;
  readonly fn: ContentFn;
  readonly supersedesType?: boolean;
  readonly belongsTo?: (card: RenderCard) => boolean;
}

function contentOverrideAppliesTo(
  card: RenderCard,
  reg: RegisteredContentOverride,
): boolean {
  return reg.belongsTo !== undefined ? reg.belongsTo(card) : cardBelongsToSet(card, reg.setPath);
}

export class ContentOverrideRegistry {
  private readonly byPath = new Map<string, RegisteredContentOverride>();

  register(entry: RegisteredContentOverride): void {
    this.byPath.set(entry.setPath, entry);
  }

  forPath(setPath: string): RegisteredContentOverride | undefined {
    return this.byPath.get(setPath);
  }

  clear(): void {
    this.byPath.clear();
  }

  paths(): string[] {
    return [...this.byPath.keys()];
  }

  size(): number {
    return this.byPath.size;
  }
}

const BUILT_IN_DEFAULT_REGISTRY = new ContentOverrideRegistry();
BUILT_IN_DEFAULT_REGISTRY.register({
  setPath: "self/bootstrap_core",
  modName: "bootstrap",
  fn: bootstrapCoreContent,
  supersedesType: false,
});
BUILT_IN_DEFAULT_REGISTRY.register({
  setPath: "self/bootstrap_function",
  modName: "bootstrap",
  fn: bootstrapFunctionsContent,
  supersedesType: false,
});
BUILT_IN_DEFAULT_REGISTRY.register({
  setPath: "self/*alert",
  modName: "layout",
  fn: () => "<!-- *alerts is deprecated. please remove from layout -->",
  supersedesType: false,
});
BUILT_IN_DEFAULT_REGISTRY.register({
  setPath: "self/*foot",
  modName: "layout",
  fn: () => "<!-- *foot is deprecated. please remove from layout -->",
  supersedesType: false,
});
BUILT_IN_DEFAULT_REGISTRY.register({
  setPath: "self/*input_type+*right+*content_option",
  modName: "list",
  fn: () => listInputOptionsContent(),
  supersedesType: false,
});
BUILT_IN_DEFAULT_REGISTRY.register({
  setPath: "type/bootswatch_skin",
  modName: "bootstrap",
  fn: bootswatchSkinRenderContent,
  supersedesType: false,
});

export function listItemContentOverride(card: RenderCard): string | undefined {
  return cardBelongsToSet(card, "self/*input_type+*right+*content_option")
    ? listInputOptionsContent()
    : undefined;
}

export function registerBuiltInContentOverride(entry: RegisteredContentOverride): void {
  BUILT_IN_DEFAULT_REGISTRY.register(entry);
}

const SKIN_RECURSABLE_TYPES: ReadonlySet<string> = new Set([
  "pointer",
  "list",
  "link_list",
  "nest_list",
  "skin",
]);

function skinThemeName(fmt: RenderFormat, card: RenderCard, depth: number): string {
  if (depth < 20) {
    const name = card.name?.s ?? "";
    const pointer = name === "" ? undefined : fmt.engine.fetchRenderCard(`${name}+parent`);
    const first =
      pointer !== undefined && pointer.unknown !== true
        ? rawItemStrings(pointer.dbContent)[0]
        : undefined;
    const parent =
      first !== undefined && first !== "" ? fmt.engine.fetchRenderCard(first) : undefined;
    if (
      parent !== undefined &&
      parent.unknown !== true &&
      parent.id !== undefined &&
      parent.id !== card.id
    ) {
      return skinThemeName(fmt, parent, depth + 1);
    }
  }
  return (card.record.codename ?? "").replace(/_skin$/, "");
}

function skinLoadContent(fmt: RenderFormat, names: readonly string[]): string {
  const out: string[] = [];
  for (const name of names) {
    const card = fmt.engine.fetchRenderCard(name);
    if (card === undefined || card.unknown === true) continue;
    skinLeafContents(fmt, card, out, new Set());
  }
  return out.join("\n");
}

function skinLeafContents(
  fmt: RenderFormat,
  card: RenderCard,
  out: string[],
  seen: Set<string>,
): void {
  if (seen.has(card.key)) return;
  seen.add(card.key);
  if (card.record.codename === "bootstrap_functions") return void out.push(bootstrapFunctionsScss());
  if (card.record.codename === "bootstrap_core") return void out.push(bootstrapCoreScss());
  if (card.record.codename === "style_mods") {
    for (const item of rawItemStrings(card.dbContent)) {
      if (item === "") continue;
      for (const file of modStyleFiles(skinModNameOf(fmt, item)) ?? []) {
        out.push(modStyleFileContent(file));
      }
    }
    return;
  }
  if (card.typeCode !== undefined && SKIN_RECURSABLE_TYPES.has(card.typeCode)) {
    for (const item of rawItemStrings(card.dbContent)) {
      if (item === "") continue;
      const itemCard = fmt.engine.fetchRenderCard(item);
      if (itemCard === undefined || itemCard.unknown === true) out.push("");
      else skinLeafContents(fmt, itemCard, out, seen);
    }
    return;
  }
  out.push(card.dbContent);
}

function skinModNameOf(fmt: RenderFormat, item: string): string {
  const leftName = DeckoName.parse(item).leftName;
  const left = leftName !== undefined ? fmt.engine.fetchRenderCard(leftName.s) : undefined;
  if (left?.record.codename !== undefined && left.record.codename !== "") {
    return left.record.codename.replace(/^mod_/, "");
  }
  return (leftName?.s ?? "").replace(/^mod: /, "").replace(/ /g, "_");
}

export function bootswatchSkinRenderContent(fmt: RenderFormat): string {
  const card = fmt.card;
  const name = card.name?.s ?? "";
  const theme = skinThemeName(fmt, card, 0);
  const pre = bootstrapFunctionsScss();
  const variables = [
    skinLoadContent(fmt, [`${name}+*colors`, `${name}+*variables`]),
    bootswatchThemeFile(theme, "variables"),
  ].join("\n");
  const post = [
    bootstrapCoreScss(),
    skinLoadContent(fmt, ["style: mods"]),
  ].join("\n");
  const stylesheets = [
    bootswatchThemeFile(theme, "bootswatch"),
    skinLoadContent(fmt, [`${name}+*stylesheets`]),
  ].join("\n");
  return [pre, variables, post, stylesheets].join("\n");
}

let defaultRegistry: ContentOverrideRegistry | undefined = BUILT_IN_DEFAULT_REGISTRY;

function consultRegistries(): readonly ContentOverrideRegistry[] {
  if (defaultRegistry === undefined) return [];
  return defaultRegistry === BUILT_IN_DEFAULT_REGISTRY
    ? [defaultRegistry]
    : [BUILT_IN_DEFAULT_REGISTRY, defaultRegistry];
}

export function setDefaultContentOverrideRegistry(
  registry: ContentOverrideRegistry | undefined,
): void {
  defaultRegistry = registry;
}

export function contentOverrideFor(setPath: string): RegisteredContentOverride | undefined {
  for (const reg of [...consultRegistries()].reverse()) {
    const entry = reg.forPath(setPath);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

function codenameSpelling(name: string): string {
  return name
    .replace(/^\*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function anchorCodename(name: DeckoName): string | undefined {
  const env = getNameEnvironment();
  if (env?.lexicon === undefined || env.codename === undefined) return undefined;
  const id = env.lexicon.id(name.key);
  if (id === undefined) return undefined;
  const codename = env.codename.nameForId(id);
  return codename === undefined || codename === "" ? undefined : codename;
}

function anchorCodenameOrSpelling(name: DeckoName): string | undefined {
  const codename = anchorCodename(name);
  if (codename !== undefined) return codename;
  const spelling = typeof name.s === "string" ? name.s : name.key;
  if (typeof spelling !== "string") return undefined;
  return codenameSpelling(spelling);
}

function leftTypeSpelling(setKeys: string | undefined): string | undefined {
  if (setKeys === undefined || setKeys === "") return undefined;
  for (const token of setKeys.split(" ")) {
    if (!token.startsWith("TYPE_PLUS_RIGHT-")) continue;
    const fragment = token.slice("TYPE_PLUS_RIGHT-".length).split("-")[0] ?? "";
    if (fragment === "") continue;
    return fragment.startsWith("X") && fragment.length > 1
      ? fragment.slice(1)
      : fragment;
  }
  return undefined;
}

function leftTypeCodenameStrict(setKeys: string | undefined): string | undefined {
  if (setKeys === undefined || setKeys === "") return undefined;
  const env = getNameEnvironment();
  if (env?.lexicon === undefined || env.codename === undefined) return undefined;
  for (const token of setKeys.split(" ")) {
    if (!token.startsWith("TYPE_PLUS_RIGHT-")) continue;
    const fragment = token.slice("TYPE_PLUS_RIGHT-".length).split("-")[0] ?? "";
    if (fragment === "") continue;
    const key = fragment.startsWith("X") && fragment.length > 1 ? fragment.slice(1) : fragment;
    const id = env.lexicon.id(key);
    if (id === undefined) return undefined;
    return env.codename.nameForId(id) ?? undefined;
  }
  return undefined;
}

export function cardBelongsToSet(
  card: RenderCard,
  setPath: string,
  opts?: { readonly strictCodenames?: boolean },
): boolean {
  const strict = opts?.strictCodenames === true;
  const slash = setPath.indexOf("/");
  const pattern = slash === -1 ? setPath : setPath.slice(0, slash);
  const anchor = slash === -1 ? "" : setPath.slice(slash + 1);

  if (card.name === undefined && pattern !== "all" && pattern !== "abstract") {
    return false;
  }

  switch (pattern) {
    case "all":
    case "abstract":
      return true;
    case "type":
      return (
        anchor.length > 0 &&
        card.typeName !== undefined &&
        (camelizeAnchor(card.typeName) === camelizeAnchor(anchor) ||
          DeckoName.parse(card.typeName).key === anchor)
      );
    case "right":
      if (card.name.isCompound !== true) return false;
      const rightName = card.name.rightName;
      if (rightName === undefined) return false;
      const resolved = strict ? anchorCodename(rightName) : anchorCodenameOrSpelling(rightName);
      return resolved !== undefined && resolved === anchor;
    case "type_plus_right":
      const fragments = anchor.split("/");
      if (fragments.length !== 2) return false;
      const typePlusRightName = card.name.rightName;
      if (typePlusRightName === undefined) return false;
      const rightResolved = strict
        ? anchorCodename(typePlusRightName)
        : anchorCodenameOrSpelling(typePlusRightName);
      if (rightResolved !== fragments[1]) {
        return false;
      }
      if (strict) return leftTypeCodenameStrict(card.setKeys) === fragments[0];
      return (
        leftTypeSpelling(card.setKeys) === fragments[0] ||
        leftTypeCodenameStrict(card.setKeys) === fragments[0]
      );
    case "left":
      return (
        card.name.isCompound === true && card.name.leftName?.key === anchor
      );
    case "self":
      return card.name.key === anchor;
    case "plus":
      return card.name.isCompound === true;
    case "star":
      return card.name.isStar === true;
    case "rstar":
      return card.name.isRStar === true;
    case "rule":
      return false;
    default:
      return false;
  }
}

function camelizeAnchor(anchor: string): string {
  return anchor
    .split("_")
    .map((word) => (word === "" ? "" : word[0]!.toUpperCase() + word.slice(1)))
    .join("");
}

export function resolveContentOverride(fmt: RenderFormat): string | undefined {
  return resolveContentOverrideEntry(fmt)?.fn(fmt);
}

export function resolveContentOverrideEntry(
  fmt: RenderFormat,
): RegisteredContentOverride | undefined {
  const card = fmt.card;
  let lastMatch: RegisteredContentOverride | undefined;
  for (const registry of consultRegistries()) {
    for (const setPath of registry.paths()) {
      const reg = registry.forPath(setPath);
      if (reg === undefined) continue;
      if (!contentOverrideAppliesTo(card, reg)) continue;
      lastMatch = reg;
    }
  }
  return lastMatch;
}
