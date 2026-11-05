import type { RenderCard, ViewContext, ViewFn } from "../../render/format.js";
import { DeckoName } from "../../name.js";
import { scanNests } from "../../render/nest-syntax.js";
import { rawItemStrings } from "../../render/pointer-list.js";
import { safeSetKeys } from "../../render/set-keys.js";
import type { CardRecord } from "../../fetch/card-record.js";
import { h, cgiEscape } from "../../render/slot-html.js";
import { NoMethodError, rubyDefaultInspect, stableIdentity } from "../../render/format.js";
import type {
  DeckoModManifest,
} from "../mod-manifest.js";

const LIST_FAMILY = new Set(["pointer", "list"]);

interface RefChunk {
  name: string;
  options: Record<string, string>;
}

function familyRefChunks(card: RenderCard): RefChunk[] {
  return rawItemStrings(card.dbContent)
    .filter((s) => s !== "")
    .map((item) => ({
      name: DeckoName.parse(item).absoluteName(card.name).s,
      options: {},
    }));
}

function chunkRefChunks(card: RenderCard): RefChunk[] {
  const out: RefChunk[] = [];
  for (const piece of scanNests(card.dbContent)) {
    const nest = piece.nest;
    if (nest === undefined || nest.comment !== undefined) continue;
    const options: Record<string, string> = {};
    for (const [key, value] of Object.entries(nest.options)) {
      if (typeof value === "string") options[key] = value;
    }
    options["nest_name"] = nest.name;
    options["nest_syntax"] = nest.syntax;
    out.push({
      name: DeckoName.parse(nest.name).absoluteName(card.name).s,
      options,
    });
  }
  return out;
}

function eachItemNameWithOptions(fmt: ViewContext["fmt"]): RefChunk[] {
  return LIST_FAMILY.has(fmt.card.typeCode ?? "")
    ? familyRefChunks(fmt.card)
    : chunkRefChunks(fmt.card);
}

function fetchItemCardOrUnknown(fmt: ViewContext["fmt"], name: string): RenderCard {
  const known = fmt.engine.fetchRenderCard(name);
  if (known !== undefined) return known;
  const parsed = DeckoName.parse(name);
  const record: CardRecord = {
    id: undefined,
    codename: undefined,
    leftId: undefined,
    rightId: undefined,
    typeId: undefined,
    dbContent: undefined,
    trash: false,
    creatorId: undefined,
    updaterId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    currentRevisionId: undefined,
    readRuleClass: undefined,
    readRuleId: undefined,
    referencesExpired: undefined,
    name: parsed,
    key: parsed.key,
    isNew: true,
    fromTrash: false,
    uncacheable: false,
  };
  fmt.engine.reportUnknownCard?.(parsed.key);
  return {
    record,
    name: parsed,
    key: parsed.key,
    typeName: undefined,
    typeId: undefined,
    typeCode: undefined,
    id: undefined,
    dbContent: "",
    setKeys: safeSetKeys({ name: parsed, typeId: undefined, typeName: undefined, leftTypeName: undefined }),
    unknown: true,
  };
}

function implicitItemView(ctx: ViewContext): string {
  const items = ctx.voo.items as Record<string, string> | undefined;
  const view = items?.["view"];
  return typeof view === "string" && view !== "" ? view : "bar";
}

function itemViewOptions(ctx: ViewContext, newOptions: Record<string, string>): Record<string, string> {
  const items = ctx.voo.items as Record<string, string> | undefined;
  const options = { ...(items ?? {}), ...newOptions };
  if (options["view"] === undefined || options["view"] === "") {
    options["view"] = implicitItemView(ctx);
  }
  return options;
}

function pathQuery(slot: Record<string, string>, cardName: string | undefined): string {
  const pairs: string[] = [];
  if (cardName !== undefined) pairs.push(`card%5Bname%5D=${cgiEscape(cardName)}`);
  for (const key of Object.keys(slot).sort()) {
    pairs.push(`slot%5B${cgiEscape(key)}%5D=${cgiEscape(slot[key])}`);
  }
  return `?${pairs.join("&")}`;
}

function nestPath(fmt: ViewContext["fmt"], name: string, tabOptions: Record<string, string>): string {
  const slot: Record<string, string> = {};
  for (const [key, value] of Object.entries(tabOptions)) {
    if (key !== "view") slot[key] = value;
  }
  const parsed = DeckoName.parse(name);
  const view = tabOptions["view"] ?? "";
  const base = `${parsed.urlKey}/${view}`;
  let cardName: string | undefined;
  if (parsed.urlKey !== name.replace(/ /g, "_") && fmt.engine.fetchRenderCard(parsed.key) === undefined) {
    cardName = name;
  }
  return `/${base}${pathQuery(slot, cardName)}`;
}

function tabId(fmt: ViewContext["fmt"], name: string): string {
  return `tab-${fmt.uniqueId()}-${DeckoName.parse(name).safeKey}`;
}

function tabLabelBytes(
  ctx: ViewContext,
  itemCard: RenderCard,
  tabOptions: Record<string, string>,
): string {
  const title = tabOptions["title"];
  if (title === undefined) return ctx.fmt.nestRecord(itemCard, "title", {});
  const escaped = h(title);
  const body = escaped.split("+").join('<span class="joint">+</span>');
  return `<span class="card-title" title="${escaped}">${body}</span>`;
}

function tabContentBytes(
  ctx: ViewContext,
  itemCard: RenderCard,
  tabOptions: Record<string, string>,
): string {
  const view = tabOptions["view"] ?? "content";
  const opts: Record<string, unknown> = {
    nest_name: tabOptions["nest_name"] ?? itemCard.name.s,
  };
  for (const [key, value] of Object.entries(tabOptions)) {
    if (key !== "view" && key !== "nest_name") opts[key] = value;
  }
  return ctx.fmt.nestRecord(itemCard, view, opts);
}

interface TabState {
  paths: Map<string, { title: string; path: string }>;
  active: { name: string; content: string } | undefined;
}

function constructTab(state: TabState, ctx: ViewContext, name: string, explicitOptions: Record<string, string>): void {
  const tabOptions = itemViewOptions(ctx, explicitOptions);
  const itemCard = fetchItemCardOrUnknown(ctx.fmt, name);
  state.paths.set(name, {
    title: tabLabelBytes(ctx, itemCard, tabOptions),
    path: nestPath(ctx.fmt, name, tabOptions),
  });
  if (state.active !== undefined) return;
  state.active = { name, content: tabContentBytes(ctx, itemCard, tabOptions) };
}

function constructTabs(ctx: ViewContext, tabType: string): string {
  const state: TabState = { paths: new Map(), active: undefined };
  const items = ctx.voo.items as Record<string, string>;
  if (items["view"] === undefined || items["view"] === "") items["view"] = "content";
  for (const chunk of eachItemNameWithOptions(ctx.fmt)) {
    constructTab(state, ctx, chunk.name, chunk.options);
  }
  return tabsPanel(ctx, state.paths, state.active?.name, tabType, state.active?.content ?? "");
}

interface TabObject {
  name: string;
  active: boolean;
  title: string;
  path: string;
  id: string;
}

export function tabObjects(
  fmt: ViewContext["fmt"],
  tabHash: Map<string, { title: string; path: string }>,
  activeName: string | undefined,
): TabObject[] {
  const keys = [...tabHash.keys()];
  const requestedKey = activeName === undefined ? undefined : DeckoName.parse(activeName).key;
  const activeKey =
    keys.find((k) => DeckoName.parse(k).key === requestedKey) ?? keys[0];
  return keys.map((name) => ({
    name,
    active: name === activeKey,
    title: tabHash.get(name)!.title,
    path: tabHash.get(name)!.path,
    id: tabId(fmt, name),
  }));
}

function tabButton(tab: TabObject): string {
  const classes = [tab.active ? "active" : "load", "nav-link"].join(" ");
  const href = `#${tab.id}`;
  return (
    `<li role="presentation" class="nav-item tab-li-${DeckoName.parse(tab.name).key}">` +
    `<a data-url="${tab.path}" class="${classes}" role="tab" data-bs-toggle="tab"` +
    ` data-tab-name="${h(tab.name)}" href="${href}">${tab.title}</a></li>\n`
  );
}

function tabPane(tab: TabObject, blockContent: string): string {
  const cls = `tab-pane tab-pane-${tab.name}${tab.active ? " active" : ""}`;
  const content = tab.active ? blockContent : "";
  return `<div role="tabpanel" id="${tab.id}" class="${h(cls)}">${content}</div>\n`;
}

export function tabsPanel(
  ctx: ViewContext,
  tabHash: Map<string, { title: string; path: string }>,
  activeName: string | undefined,
  tabType: string,
  blockContent: string,
): string {
  const tabs = tabObjects(ctx.fmt, tabHash, activeName);
  let out = "<div class='tabbable tab-panel' role='tabpanel'>\n";
  out += `<ul class='${ctx.voo.classy("nav")} nav-${tabType}' role='tablist'>\n`;
  for (const tab of tabs) out += tabButton(tab);
  out += "</ul>\n<div class='tab-content'>\n";
  for (const tab of tabs) out += tabPane(tab, blockContent);
  out += "</div>\n</div>\n";
  return out;
}

const tabsView: ViewFn = (ctx) => constructTabs(ctx, "tabs");

const pillsView: ViewFn = (ctx) => constructTabs(ctx, "pills");

function staticTabsArgsMiss(ctx: ViewContext): never {
  const args = (ctx.fmt as unknown as { args?: unknown }).args;
  if (args !== undefined) return itemViewOptions(ctx, {}) as never;
  throw new NoMethodError(
    `undefined method 'args' for ${rubyDefaultInspect("Card::Format::CardActionView", stableIdentity(ctx.fmt.card.name.s))}`,
  );
}

function constructStaticTabs(ctx: ViewContext, tabType: "tabs" | "pills"): string {
  const items = rawItemStrings(ctx.fmt.card.dbContent ?? "").filter((i) => i !== "");
  if (items.length > 0) {
    staticTabsArgsMiss(ctx);
  }
  return tabsPanel(ctx, new Map(), undefined, tabType, "");
}

const tabsStaticView: ViewFn = (ctx) => constructStaticTabs(ctx, "tabs");

const pillsStaticView: ViewFn = (ctx) => constructStaticTabs(ctx, "pills");

const cardModTabs: DeckoModManifest = {
  name: "tabs",
  gemName: "card-mod-tabs",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/tabs",
      formats: {
        html: {
          views: [
            { view: "tabs", viewFn: tabsView },
            { view: "pills", viewFn: pillsView },
            { view: "tabs_static", viewFn: tabsStaticView },
            { view: "pills_static", viewFn: pillsStaticView },
          ],
        },
      },
    },
    {
      setPath: "abstract/tabs",
      formats: { html: { views: [] } },
    },
  ],
};

export default cardModTabs;
