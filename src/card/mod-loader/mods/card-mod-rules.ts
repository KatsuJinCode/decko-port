import { str, type ViewResult } from "../../render/format.js";
import { ONE_LINE_CHARACTER_LIMIT, truncate } from "../../render/text-helpers.js";
import { stripTags } from "../../render/nest-syntax.js";
import { CARDTYPE_GROUPS } from "../../render/cardtype-groups.js";

import { UnsupportedViewError, RenderFormat, type RenderCard, type ViewContext, type ViewFn } from "../../render/format.js";
import { serializerFollowsLive } from "../../render/deployment-follow-live-config.js";
import { processHelpContent } from "../../render/help-popover.js";
import { registeredSettingHelpText } from "../../render/setting-help-text.js";
import { emitAttrs, h, newSlotId, slotOptionsJson } from "../../render/slot-html.js";
import { ruleBarRightHtml } from "../../render/rule-bar-right.js";
import { kramdownToStashedHtml } from "../../render/kramdown.js";
import { DeckoName } from "../../name.js";
import { PATTERN_TABLE, findPattern } from "../../set-patterns/registry.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import { labelForParsedSet, parseSetName } from "../../set-patterns/set-name.js";
import { setNamesForCard, ruleLookupKeysForCard } from "../../set-patterns/card-patterns.js";
import { cardFormShell, submitButton } from "../mod-form-substrate.js";
import { typeField, typeFormgroup } from "./card-mod-edit.js";
import { cardWallClockNow } from "../../wall-clock.js";
import { getDefaultModLoader } from "../../mod-loader.js";
import { modSlotWrap, viewWrapInherited } from "../mod-view-helpers.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventFn,
  ModEventRegistration,
  ModSetModuleFile,
} from "../mod-manifest.js";
import { engineOwnedEvent } from "../mod-manifest.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

function isSetCard(ctx: ViewContext): boolean {
  return ctx.fmt.card.typeCode === "set";
}

function isRuleCard(ctx: ViewContext): boolean {
  const card = ctx.fmt.card;
  if (ctx.fmt.engine.cardIsRule?.(card) ?? false) return true;
  if (card.unknown === true || !card.name.isCompound) return false;
  if (card.setKeys.split(/\s+/).includes("RULE")) return true;
  const rightKey = card.name.rightName?.key;
  const leftKey = card.name.leftName?.key;
  if (rightKey === undefined || leftKey === undefined) return false;
  const right = ctx.fmt.engine.fetchRenderCard(rightKey);
  const left = ctx.fmt.engine.fetchRenderCard(leftKey);
  return right?.typeCode === "setting" && left?.typeCode === "set";
}

function assertSetCard(ctx: ViewContext, view: string): void {
  if (!isSetCard(ctx)) {
    throw new UnsupportedViewError(view, ctx.fmt.card.name.s);
  }
}

function assertRuleCard(ctx: ViewContext, view: string): void {
  if (!isRuleCard(ctx)) {
    throw new UnsupportedViewError(view, ctx.fmt.card.name.s);
  }
}

function assertRuleSetCard(ctx: ViewContext, view: string): void {
  if (!(ctx.fmt.engine.cardMatchesRuleSet?.(ctx.fmt.card) ?? false)) {
    throw new UnsupportedViewError(view, ctx.fmt.card.name.s);
  }
}

const setLabelView: ViewFn = (ctx) => {
  assertSetCard(ctx, "set_label");
  return `<strong class="set-label">${setCardLabel(ctx)}</strong>`;
};

function setCardLabel(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const tagKey = card.name.tagName?.key;
  const tagCard =
    tagKey !== undefined ? ctx.fmt.engine.fetchRenderCard(tagKey) : undefined;
  const patternCode = tagCard?.record.codename;
  const spec =
    patternCode !== undefined
      ? PATTERN_TABLE.find((candidate) => candidate.code === patternCode)
      : undefined;
  const anchor = card.name.leftName?.s;
  return spec?.label(anchor) ?? "";
}

const inputView: ViewFn = (ctx) => {
  assertSetCard(ctx, "input");
  return "Cannot currently edit Sets";
};

export function setOneLineContentView(ctx: ViewContext): string {
  assertSetCard(ctx, "one_line_content");
  return viewWrapInherited(ctx, "one_line_content", "");
}

function customTypes(ctx: ViewContext): readonly string[] {
  const grouped = new Set(Object.values(CARDTYPE_GROUPS).flat());
  return ctx.fmt.createableTypes().filter((typeName) => !grouped.has(typeName));
}

const groupedListView: ViewFn = (ctx) => {
  if (ctx.fmt.card.name.key !== "cardtype") {
    throw new UnsupportedViewError("grouped_list", ctx.fmt.card.name.s);
  }
  const sections: string[] = [];
  for (const [group, types] of Object.entries(CARDTYPE_GROUPS)) {
    const typeList = group === "Custom" ? customTypes(ctx) : types;
    if (typeList.length === 0) {
      sections.push("");
      continue;
    }
    const listing = typeList.map((typeName) => listingItem(ctx, typeName));
    sections.push(`<h5>${group}</h5>`);
    sections.push(`<p>${listing.join("\n")}</p>`);
  }
  return sections.join("\n");
};

function listingItem(ctx: ViewContext, typeName: string): string {
  const target = ctx.fmt.engine.fetchRenderCard(typeName);
  const rendered =
    target !== undefined
      ? ctx.fmt.nestRecord(target, "bar")
      : ctx.fmt.nest({ syntax: `{{${typeName}|view:bar}}`, name: typeName, options: { view: "bar", extra: {} }, comment: undefined });
  return `<div class="item-bar">${rendered}</div>`;
}

const ruleHelpView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  if (isRuleCard(ctx)) {
    return ruleHelpAlert(ctx);
  }
  if (card.typeCode === "setting") {
    const ruleCard = ctx.fmt.engine.fetchRenderCard(`*all+${card.name.s}`);
    if (ruleCard === undefined) return "";
    return ctx.fmt.nestRecord(ruleCard, "rule_help");
  }
  throw new UnsupportedViewError("rule_help", card.name.s);
};

function ruleHelpAlert(ctx: ViewContext): string {
  const help = ruleBasedHelp(ctx);
  return `<div class="alert alert-info rule-instruction">${help}</div>`;
}

function ruleHelpRaw(ctx: ViewContext): string | undefined {
  const registryHit = registeredSettingHelpText(
    ctx.fmt.card.record?.codename,
    rightPartCodename(ctx),
  );
  if (registryHit !== undefined) return registryHit;
  const ruleCard = helpRuleCard(ctx);
  return ruleCard === undefined ? undefined : ruleCard.dbContent;
}

function rightPartCodename(ctx: ViewContext): string | undefined {
  const rightKey = ctx.fmt.card.name.rightName?.key;
  if (rightKey === undefined) return undefined;
  return ctx.fmt.engine.fetchRenderCard(rightKey)?.record?.codename;
}

function ruleBasedHelp(ctx: ViewContext): string {
  const resolver = ctx.fmt.engine.helpRules;
  if (resolver !== undefined) {
    return resolver.ruleBasedHelpForCard(ctx.fmt, ctx.fmt.card);
  }
  const raw = ruleHelpRaw(ctx);
  if (raw === undefined) return "";
  return processHelpContent(ctx.fmt, raw);
}

function helpRuleCard(ctx: ViewContext): RenderCard | undefined {
  const card = ctx.fmt.card;
  if (card.unknown === true) return undefined;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*help")) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (ctx.fmt.engine.isDenied(record)) continue;
    return record;
  }
  return undefined;
}

const overlayTitleView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "overlay_title");
  return editRuleTitle(ctx);
};

function editRuleTitle(ctx: ViewContext): string {
  return `<h5 class="title fw-bold">${settingTitle(ctx)}</h5>`;
}

function settingTitle(ctx: ViewContext): string {
  const tag = ctx.fmt.card.name.tagName?.s ?? ctx.fmt.card.name.s;
  return tag.replaceAll("*", "");
}

export function ruleCoreView(ctx: ViewContext, baseCore: ViewFn): string {
  assertRuleCard(ctx, "core");
  const typeCode = ctx.fmt.card.typeCode;
  if (typeCode === "search_type" || ctx.fmt.card.typeName === "Search") {
    return ctx.fmt.renderRaw();
  }
  return str(baseCore(ctx));
}

export function ruleOneLineContentView(ctx: ViewContext): string {
  assertRuleCard(ctx, "one_line_content");
  if (ctx.fmt.card.id === undefined) {
    return "";
  }
  const rightSetting = ctx.fmt.card.name.rightName?.s;
  return `<div class="text-muted one-line">${ruleOneLineInner(ctx, rightSetting)}</div>`;
}

function ruleOneLineInner(ctx: ViewContext, rightSetting: string | undefined): string {
  const card = ctx.fmt.card;
  if (rightSetting === "*default") {
    const raw = card.dbContent;
    return `${card.typeName ?? ""} : ${raw.trim() === "" ? "<em>empty</em>" : raw}`;
  }
  if (rightSetting === "*structure") {
    return `${card.typeName ?? ""} : ${card.dbContent}`;
  }
  if (card.typeName !== "Markdown") {
    return h(truncate(stripTags(card.dbContent), ONE_LINE_CHARACTER_LIMIT));
  }
  return truncatedCore(card.dbContent);
}

const ruleOneLineContentViewFn: ViewFn = (ctx) => {
  const body = ruleBarRightHtml(ctx.fmt.card, ctx.fmt.engine, (card) => {
    const sub = new RenderFormat(card, ctx.fmt.engine, {
      parent: ctx.fmt,
      maxDepth: ctx.fmt.maxDepth,
      nestQuietErrors: true,
    });
    if (card.typeName === "Markdown") {
      try {
        return sub.processContent(kramdownToStashedHtml(card.dbContent ?? ""));
      } catch (error) {
        if (error instanceof UnsupportedViewError) return card.dbContent ?? "";
        throw error;
      }
    }
    try {
      return sub.renderView("core");
    } catch (error) {
      if (error instanceof UnsupportedViewError) return card.dbContent;
      throw error;
    }
  });
  return viewWrapInherited(ctx, "one_line_content", str(body));
}

function ruleRawOneLineInner(content: string): string {
  return content.length > 60 ? `${content.slice(0, 60)}...` : content;
}

function truncatedCore(content: string): string {
  return content.length > 60 ? `${content.slice(0, 60)}...` : content;
}

export function ruleRawOneLineContentView(ctx: ViewContext): string {
  assertRuleCard(ctx, "raw_one_line_content");
  if (ctx.fmt.card.id === undefined) {
    return "";
  }
  return `<div class="text-muted one-line">${truncatedCore(ctx.fmt.card.dbContent)}</div>`;
}

const ruleHelpTextView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "help_text");
  const help = ctx.fmt.engine.helpRules?.ruleHelpTextBytes(ctx.fmt);
  return help ?? "";
};

function select2TimestampSeconds(): number {
  return Math.floor(cardWallClockNow().getTime() / 1000);
}

function relatedSetsNames(card: RenderCard): string[] {
  const sets = [`${card.name.s}+*self`];
  const known = card.unknown !== true;
  if (known && !card.name.isCompound) sets.push(`${card.name.s}+*right`);
  return sets;
}

const cardSelectView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  const setOptions = relatedSetsNames(card).map((setName) => {
    const parsed = parseSetName(setName);
    const label = labelForParsedSet(parsed);
    return `<option value="${h(DeckoName.parse(setName).urlKey)}">${h(label)}</option>`;
  });
  const options = [`<option value=""></option>`, ...setOptions].join("\n");
  const select2Id = `${ctx.fmt.uniqueId()}-${select2TimestampSeconds()}`;
  return modSlotWrap(
    ctx,
    "card_select",
    `<form role="filter" data-slot-selector=".card-slot._fixed-slot" class="nodblclick slotter"` +
      ` action="/?view=filtered_accordion_rule_list" accept-charset="UTF-8" data-remote="true" method="get">` +
      `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
      `<select name="mark" id="mark" class="_submit-on-select form-control _close-rule-overlay-on-select"` +
      ` data-minimum-results-for-search="Infinity" data-placeholder="Select set"` +
      ` data-select2-id="${select2Id}">` +
      options +
      `</select>\n` +
      `<div class="card-slot _fixed-slot"></div>` +
      `</form>`,
  );
};

import { SETTING_GROUPS, visibleGroupSettings, barSettingListBody, templateLinkView } from "../../render/views.js";
import { buildVirtualRuleCard } from "../../render/virtual-rule-card.js";

const SETTING_SHORT_HELP_TEXT: ReadonlyMap<string, string> = new Map([
  ["structure", "control card's content / structure"],
  ["default", "type/content template for new cards"],
  ["input_type", "edit interface"],
  ["guide", "appears in the full editor view to guide users"],
  ["help", "help text people will see when editing"],
  ["thanks", "destination after card is created"],
  ["head", "head tag content"],
  ["create", "who can create cards"],
  ["read", "who can view cards"],
  ["update", "who can update cards"],
  ["delete", "who can delete cards"],
]);

const COMMON_SETTINGS: ReadonlySet<string> = new Set([
  "create", "read", "update", "delete", "structure", "default", "guide",
]);
const FIELD_SETTINGS: ReadonlySet<string> = new Set([
  "default", "help", "input_type", "content_options", "content_option_view",
]);

function recentSettingsCodenames(ctx: ViewContext): Set<string> {
  const list = ctx.fmt.engine.fetchRenderCard("*recent_settings");
  if (list === undefined || list.unknown === true) return new Set();
  const codenames = new Set<string>();
  for (const line of list.dbContent.split("\n")) {
    const item = line.trim();
    if (item === "") continue;
    const itemCard = ctx.fmt.engine.fetchRenderCard(item);
    const codename = itemCard?.record.codename;
    if (codename !== undefined) codenames.add(codename);
  }
  return codenames;
}

function categoriesForSetting(ctx: ViewContext, setting: string): string[] {
  const result = ["all"];
  if (FIELD_SETTINGS.has(setting)) result.push("field");
  if (recentSettingsCodenames(ctx).has(setting)) result.push("recent");
  if (COMMON_SETTINGS.has(setting)) result.push("common");
  return result;
}

function settingTitleFor(setting: string): string {
  return setting;
}

function shortHelpTextDiv(setting: string): string {
  return `<div class="help-text">${SETTING_SHORT_HELP_TEXT.get(setting) ?? ""}</div>`;
}

const BOARD_SLOT_SELECTOR =
  ".board-main > .overlay-container > .card-slot._bottomlay-slot," +
  ".board-main > ._overlay-container-placeholder > .card-slot";

const BOARD_PATH_LAYOUT_QUERY = "layout=overlay&slot%5Bitems%5D%5Bview%5D=closed";
const BOARD_PATH_QUERY = "slot%5Bitems%5D%5Bview%5D=closed";

function boardLinkAnchor(opts: {
  classList: string;
  href: string;
  text: string;
  extraAttrs?: Array<[string, string]>;
}): string {
  const attrs: Array<[string, string]> = [
    ["rel", "nofollow"],
    ["class", `${opts.classList} slotter slotter`],
    ...(opts.extraAttrs ?? []),
    ["data-slot-selector", BOARD_SLOT_SELECTOR],
    ["data-slotter-mode", "override"],
    ["href", opts.href],
    ["data-remote", "true"],
  ];
  return `<a ${attrs.map(([k, v]) => `${k}="${h(v)}"`).join(" ")}>${opts.text}</a>`;
}

const BOARD_PILL_UL_CLASSES = "nav nav-pills _auto-single-select board-pills flex-column";
const BOARD_PILL_LI_CLASSES = "nav-item";

function listTag(items: string[], ulClass: string, liClass: string): string {
  const lis = items.map((item) => `<li class="${liClass}">${item}</li>`);
  return `<ul class="${ulClass}">${lis.join("\n")}</ul>`;
}

function boardPills(items: string[]): string {
  return listTag(items, BOARD_PILL_UL_CLASSES, BOARD_PILL_LI_CLASSES);
}

function accordionWrap(ctx: ViewContext, inner: string): string {
  return `<div class="${ctx.voo.classy("accordion")}">${inner}</div>`;
}

function accordionItem(
  ctx: ViewContext,
  title: string,
  body: string,
  context: string,
): string {
  const collapseId = `card-${ctx.fmt.card.name.safeKey}-${context}-collapse-id`;
  const accordionButtonClass = serializerFollowsLive()
    ? "accordion-button collapsed"
    : "collapsed accordion-button";
  return (
    `<div class='${ctx.voo.classy("accordion-item")}'>\n` +
    `<h2 class='accordion-header nodblclick w-100'>\n` +
    `<button class='${accordionButtonClass}' data-bs-target='#${collapseId}' data-bs-toggle='collapse' type='button'>\n` +
    `${title}\n` +
    `</button>\n</h2>\n` +
    `<div class='accordion-collapse collapse' id='${collapseId}'>\n` +
    `<div class='${serializerFollowsLive() ? "d0-card-body accordion-body" : "accordion-body d0-card-body"}'>\n` +
    `${body}\n</div>\n</div>\n</div>\n`
  );
}

function countBadge(count: number): string {
  return `<span class="_count badge bg-secondary ms-3">${count}</span>`;
}

function settingListItem(
  ctx: ViewContext,
  setting: string,
  itemView: string,
  extraNestOpts: Record<string, unknown> = {},
): string {
  const settingCard = ctx.fmt.engine.findSettingCard?.(setting);
  if (settingCard === undefined) return "";
  if (ctx.fmt.engine.isDenied(settingCard)) return "";
  const setCard = ctx.fmt.card;
  const stored = ctx.fmt.engine.fetchRenderCard(`${setCard.name.s}+*${setting}`);
  const ruleCard =
    stored !== undefined && stored.unknown !== true
      ? stored
      : buildVirtualRuleCard({
          setCard,
          settingCard,
          settingCodename: setting,
          engine: ctx.fmt.engine,
        });
  return ctx.fmt.nestRecord(ruleCard, itemView, {
    nest_name: ruleCard.name.s,
    show: [itemView],
    home_view: itemView,
    ...extraNestOpts,
  });
}

function categorySettingListItems(
  ctx: ViewContext,
  category: string,
  itemView: string,
  extraNestOpts: Record<string, unknown> = {},
): string[] {
  const visible = visibleSettingsInGroupOrder();
  const settings = categoryAllSettingsSorted(category, visible, ctx);
  return settings.map((setting) => settingListItem(ctx, setting, itemView, extraNestOpts));
}

function visibleSettingsInGroupOrder(): string[] {
  return SETTING_GROUPS.flatMap((group) => [...visibleGroupSettings(group)]);
}

function categoryAllSettingsSorted(
  category: string,
  visible: string[],
  ctx: ViewContext,
): string[] {
  if (category === "all") return [...visible].sort();
  if (category === "common") return visible.filter((s) => COMMON_SETTINGS.has(s));
  if (category === "field") return visible.filter((s) => FIELD_SETTINGS.has(s));
  if (category === "recent") {
    const recent = recentSettingsCodenames(ctx);
    return visible.filter((s) => recent.has(s));
  }
  return [...visibleGroupSettings(category)];
}

function pillSettingListItems(ctx: ViewContext, openRuleInModal: boolean): string[] {
  return categorySettingListItems(
    ctx,
    "all",
    openRuleInModal ? "rule_nest_editor_link" : "rule_board_link",
  );
}

function settingListSlotWrap(ctx: ViewContext, view: string, inner: string, extraClasses: string): string {
  return modSlotWrap(ctx, view, inner, extraClasses);
}

const overlayRuleListLinkView: ViewFn = (ctx) => {
  assertSetCard(ctx, "overlay_rule_list_link");
  const anchor = boardLinkAnchor({
    classList: "edit-rule-link btn btn-primary",
    href: `/${ctx.fmt.urlKey()}/core?${BOARD_PATH_LAYOUT_QUERY}`,
    text: "Show existing rules",
  });
  return `<div>${anchor}</div>`;
};

const barSettingListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "bar_setting_list");
  return barSettingListBody(ctx);
};

const pillSettingListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "pill_setting_list");
  return settingListSlotWrap(
    ctx,
    "pill_setting_list",
    boardPills(pillSettingListItems(ctx, false)),
    "_setting-list",
  );
};

const modalPillSettingListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "modal_pill_setting_list");
  return boardPills(pillSettingListItems(ctx, true));
};

const accordionRuleListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "accordion_rule_list");
  ctx.voo.classUp("accordion", "bar-accordion");
  return categoryAccordion(ctx, "rule_board_link", (list) => boardPills(list));
};

const accordionBarListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "accordion_bar_list");
  ctx.voo.classUp("accordion", "bar-accordion");
  return categoryAccordion(ctx, "bar", (list) =>
    listTag(list, "nav flex-column", "nav-item"),
  );
};

function categoryAccordion(
  ctx: ViewContext,
  view: string,
  buildList: (list: string[]) => string,
): string {
  ctx.voo.classUp("accordion-item", "_setting-group");
  const groupItems = SETTING_GROUPS.map((group) => {
    const list = visibleGroupSettings(group).map((setting) =>
      settingListItem(ctx, setting, view),
    );
    return accordionItem(
      ctx,
      `${group} ${countBadge(list.length)}`,
      buildList(list),
      group,
    );
  });
  return `<div class="_setting-list">${accordionWrap(ctx, groupItems.join("\n"))}</div>`;
}

function filterRadio(name: string, label: string, checked: boolean): string {
  return (
    `<input type="radio" class="btn-check _setting-category" name="options" id="${name}" autocomplete="off" ${checked ? "checked" : ""}>\n` +
    `<label class="btn btn-outline-primary" for="${name}">${label}</label>\n`
  );
}

function filterButtons(selected: string): string {
  return (
    `<div class="my-4 mx-2 _setting-filter">` +
    [
      `<label>Settings</label>`,
      filterRadio("all", "All", selected === "all"),
      filterRadio("common", "Common", selected === "common"),
      filterRadio("field", "Field", selected === "field_related"),
      filterRadio("recent", "Recent", selected === "recent"),
    ].join("\n") +
    `</div>`
  );
}

function settingFilter(ctx: ViewContext, view: string, selectedCategory: string, mark: string | undefined): string {
  const action =
    mark === undefined
      ? `/${ctx.fmt.urlKey()}/${view}`
      : `/?view=${view}`;
  return (
    `<form role="filter" data-slot-selector=".card-slot._setting-list" class="nodblclick slotter"` +
    ` action="${h(action)}" accept-charset="UTF-8" data-remote="true" method="get">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    filterButtons(selectedCategory) +
    `</form>`
  );
}

function filteredRuleList(
  ctx: ViewContext,
  filterView: string,
  selectedCategory: string,
  mark: string | undefined,
  listBody: ViewFn,
): string {
  return `${settingFilter(ctx, filterView, selectedCategory, mark)}\n${listBody(ctx)}`;
}

const boardRulesTabView: ViewFn = (ctx) => {
  assertSetCard(ctx, "board_rules_tab");
  ctx.voo.classUp("accordion-item", "_setting-group");
  ctx.voo.classUp("accordion-item", "_setting-list");
  return settingListSlotWrap(
    ctx,
    "board_rules_tab",
    filteredRuleList(ctx, "accordion_rule_list", "common", "", accordionRuleListView),
    "d-flex flex-column gap-3 mx-3 mt-2",
  );
};

const filteredAccordionRuleListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "filtered_accordion_rule_list");
  return filteredRuleList(ctx, "accordion_rule_list", "common", undefined, accordionRuleListView);
};

function pillRuleLink(ctx: ViewContext, targetView: string): string {
  const card = ctx.fmt.card;
  const title = settingTitle(ctx);
  const rightKey = card.name.rightName?.key;
  const settingCard =
    rightKey !== undefined ? ctx.fmt.engine.fetchRenderCard(rightKey) : undefined;
  const setting =
    settingCard?.record.codename ?? (rightKey?.startsWith("*") ? rightKey.slice(1) : title);
  const categories = categoriesForSetting(ctx, setting);
  const key = DeckoName.parse(title).key;
  return boardLinkAnchor({
    classList: `edit-rule-link nav-link _rule-item ${categories.map((c) => `_category-${c}`).join(" ")}`,
    href: `/${card.name.urlKey}/${targetView}?${BOARD_PATH_QUERY}`,
    text: `${title}${shortHelpTextDiv(setting)}`,
    extraAttrs: [
      ["data-bs-toggle", "pill"],
      ["data-category", categories.join(" ")],
      ["data-cy", `${key}-pill`],
    ],
  });
}

const ruleNestEditorLinkView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "rule_nest_editor_link");
  return pillRuleLink(ctx, "modal_rule");
};

const ruleBoardLinkView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "rule_board_link");
  return pillRuleLink(ctx, "overlay_rule");
};

export function ruleSidesStatement(setTypeId: number, settingTypeId: number): {
  sql: string;
  params: unknown[];
} {
  const ruleJoin =
    "FROM cards rules\n" +
    "  JOIN cards sets ON rules.left_id = sets.id\n" +
    "  JOIN cards settings ON rules.right_id = settings.id\n" +
    "WHERE sets.type_id = ? AND settings.type_id = ?\n" +
    "  AND rules.trash = 0 AND sets.trash = 0 AND settings.trash = 0";
  return {
    sql:
      "WITH RECURSIVE reached(id) AS (\n" +
      `  SELECT rules.id ${ruleJoin}\n` +
      "  UNION\n" +
      "  SELECT j.left_id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
      "    WHERE j.left_id IS NOT NULL\n" +
      "  UNION\n" +
      "  SELECT j.right_id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
      "    WHERE j.right_id IS NOT NULL\n" +
      ")\n" +
      "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.id IN (SELECT id FROM reached)",
    params: [setTypeId, settingTypeId],
  };
}

async function prepareRuleCache(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const setTypeId = host.codenames.peekId("set");
  const settingTypeId = host.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return;
  const recentSettingsId = host.codenames.peekId("recent_settings");
  const results = await host.batch([
    ruleSidesStatement(setTypeId, settingTypeId),
    ...(recentSettingsId !== undefined
      ? [{ sql: "SELECT * FROM cards WHERE id = ? AND trash = 0", params: [recentSettingsId] }]
      : []),
  ]);
  const rows = (results[0] as { rows: Record<string, unknown>[] } | undefined)?.rows ?? [];
  if (rows.length > 0) {
    await host.composeAndCacheRows(rows);
  }
  if (recentSettingsId !== undefined) {
    const recentRows =
      (results[1] as { rows: Record<string, unknown>[] } | undefined)?.rows ?? [];
    if (recentRows.length > 0) await host.composeAndCacheRows(recentRows);
  }
}

function quickEditSettingTitle(ctx: ViewContext): string {
  return ctx.fmt.card.name.tagName.s.replace(/\*/g, "");
}

function quickEditShortHelpText(settingCodename: string): string {
  return `<div class="help-text">${SETTING_SHORT_HELP_TEXT.get(settingCodename) ?? ""}</div>`;
}

function ruleSettingCodename(ctx: ViewContext): string | undefined {
  const rightKey = ctx.fmt.card.name.rightName?.key;
  const right =
    rightKey !== undefined ? ctx.fmt.engine.fetchRenderCard(rightKey) : undefined;
  return right?.record.codename;
}

function quickEditCategoryClasses(ctx: ViewContext): string {
  const setting = ruleSettingCodename(ctx) ?? "";
  const cats = ["all"];
  if (FIELD_SETTINGS.has(setting)) cats.push("field");
  const recentCard = ctx.fmt.engine.fetchRenderCard("*recent settings");
  const recentItems = new Set(
    (recentCard?.record.dbContent ?? "")
      .split("\n")
      .map((line) => line.trim().replace(/^\*/, ""))
      .filter((s) => s !== ""),
  );
  if (recentItems.has(setting)) cats.push("recent");
  if (COMMON_SETTINGS.has(setting)) cats.push("common");
  return cats.map((c) => `_category-${c}`).join(" ");
}

function quickForm(ctx: ViewContext): string {
  const { fmt } = ctx;
  const setting = ruleSettingCodename(ctx);
  return cardFormShell(ctx, {
    formClass: "card-form slotter autosave",
    id: fmt.card.id === undefined ? "new_card" : `edit_card_${fmt.card.id}`,
    htmlAttrs: [
      ["data-slot-selector", ".set-info.card-slot"],
      ...(setting === "default"
        ? [[
            "data-update-foreign-slot",
            ".card-slot.quick_edit-view.RIGHT-Xinput_type,.card-slot.quick_edit-view.RIGHT-Xcontent_option.card-slot.quick_edit-view.RIGHT-Xcontent_option_view",
          ] as [string, string]]
        : setting === "input_type"
          ? [["data-update-foreign-slot", ".card-slot.quick_edit-view.RIGHT-Xcontent_option_view"] as [string, string]]
          : []),
    ],
    action: `/update/${fmt.urlKey()}`,
    methodSpoof: fmt.card.id === undefined ? null : "patch",
    success: { view: "quick_edit_success" },
    body: quickEditorBody(ctx, setting),
  });
}

const RIGHT_DEFAULT_CARDTYPE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  Text: ["RichText", "PlainText", "Markdown", "Phrase", "HTML"],
  Data: ["Number", "Toggle", "Date", "URI"],
  Upload: ["File", "Image"],
  Organize: ["List", "Pointer", "Link list", "Nest list"],
};
const RIGHT_STRUCTURE_CARDTYPE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  Text: ["RichText", "PlainText", "Markdown", "Phrase", "HTML"],
  Organize: ["Search", "Nest list"],
};

function quickEditorBody(ctx: ViewContext, setting: string | undefined): string {
  const { fmt } = ctx;
  if (setting === "default") {
    const typeGroup =
      `<div class="form-group type-formgroup"${formgroupCardAttrs(fmt)}>` +
      `<label for="card_type">Type</label>\n` +
      `<div class="editor type-editor">` +
      typeField(ctx, {
        cls: "type-field rule-type-field _submit-on-select",
        groups: RIGHT_DEFAULT_CARDTYPE_GROUPS,
      }) +
      `\n` +
      `<input type="hidden" name="assign" id="assign" value="true" autocomplete="off" /></div></div>`;
    const contentGroup =
      `<div class="form-group card-editor"${formgroupCardAttrs(fmt)}>` +
      `<label for="card_content">Content</label>\n` +
      `<div class="editor content-editor">` +
      `<input class="d0-card-content _submit-after-typing form-control" type="text" value="${h(fmt.card.dbContent)}" name="card[content]" id="card_content" /></div></div>`;
    return typeGroup + contentGroup;
  }
  if (setting === "help") {
    return (
      `<div class="form-group"${formgroupCardAttrs(fmt)}>` +
      `<label for="card_content">Content</label>\n` +
      `<div class="editor content-editor">` +
      `<input value="${h(fmt.card.dbContent)}" class="d0-card-content _submit-after-typing form-control" type="text" name="card[content]" id="card_content" /></div></div>`
    );
  }
  return str(fmt.renderView("content_formgroup", { hide: ["conflict_tracker"] }));
}

function formgroupCardAttrs(fmt: ViewContext["fmt"]): string {
  const card = fmt.card;
  const attrs: string[] = [];
  if (card.id !== undefined) attrs.push(`data-card-id="${card.id}"`);
  if (card.name.s !== "") {
    attrs.push(`data-card-name="${h(card.name.s)}"`);
    attrs.push(`data-card-link-name="${h(fmt.urlKey())}"`);
  }
  return attrs.length === 0 ? "" : ` ${attrs.join(" ")}`;
}

function undoButton(ctx: ViewContext): string {
  const { fmt } = ctx;
  const actionId = fmt.card.record.currentRevisionId ?? "";
  const href = `/update/${fmt.urlKey()}?revert_actions%5B%5D=${actionId}&revert_to=previous`;
  return (
    `<a rel="nofollow" class="btn btn-secondary ms-2 btn-sm btn-reduced-padding slotter"` +
    ` data-slot-selector=".card-slot.quick_edit-view"` +
    ` href="${h(href)}" data-remote="true" data-method="post">undo</a>`
  );
}

function setInfoHtml(ctx: ViewContext, notifyChange: boolean): string {
  const { fmt } = ctx;
  const isNew = fmt.card.id === undefined || fmt.card.unknown === true;
  const setName = fmt.card.name.leftName;
  let label = "";
  if (setName !== undefined) {
    if (!isNew) {
      const parsed = parseSetName(setName.s);
      label =
        parsed.spec !== undefined
          ? (parsed.spec.label(parsed.anchorName?.s) ?? "")
          : "";
    } else {
      const settingCodename = ruleSettingCodename(ctx);
      const prototypeInput = prototypePatternInput(ctx, setName.s);
      const winner =
        settingCodename !== undefined && prototypeInput !== undefined
          ? fmt.engine.ruleCacheSetLabelWinner?.(
              ruleLookupKeysForCard(prototypeInput),
              settingCodename,
            )
          : undefined;
      label =
        winner !== undefined
          ? (findPattern(winner.patternCode)?.label(winner.anchorName) ?? "")
          : "";
    }
  }
  const inner =
    `<div class='form-group form-control-feedback'>\n` +
    `<label>\nSet\n</label>\n` +
    `<p class='text-muted'>\n${label || "--"}\n</p>\n` +
    (notifyChange
      ? `<p class='autosubmit-success-notification'>\n` +
        `<span class='text-success'>\nApplied!\n</span>\n` +
        `${undoButton(ctx)}\n</p>\n`
      : "") +
    `</div>\n`;
  return modSlotWrap(ctx, ctx.voo.requestedView, inner, "set-info");
}

const QUICK_EDIT_FEATURE_TYPES: Record<string, { inputType: boolean; contentOptions: boolean }> = {
  list: { inputType: true, contentOptions: true },
  pointer: { inputType: true, contentOptions: true },
  plain_text: { inputType: true, contentOptions: false },
};

function quickEditBodyOverride(ctx: ViewContext): string | undefined {
  const setting = ruleSettingCodename(ctx);
  if (setting !== "input_type" && setting !== "content_options" && setting !== "content_option_view") {
    return undefined;
  }
  const leftKey = ctx.fmt.card.name.leftName?.key;
  const defaultRule =
    leftKey !== undefined
      ? ctx.fmt.engine.fetchRenderCard(`${leftKey}+*default`)
      : undefined;
  const features =
    defaultRule === undefined || defaultRule.unknown === true
      ? undefined
      : QUICK_EDIT_FEATURE_TYPES[defaultRule.typeCode ?? ""];
  const showsInputType = features?.inputType ?? false;
  const showsContentOptions = features?.contentOptions ?? false;
  if (setting === "input_type") return showsInputType ? undefined : "";
  if (setting === "content_options") return showsContentOptions ? undefined : "";
  return showsContentOptions ? undefined : "";
}

const quickEditView: ViewFn = (ctx) => {
  assertRuleSetCard(ctx, "quick_edit");
  const override = quickEditBodyOverride(ctx);
  if (override !== undefined) {
    return modSlotWrap(ctx, "quick_edit", override);
  }
  const inner =
    `<div class='${quickEditCategoryClasses(ctx)} rule-item _rule-item'>\n` +
    `<h6 class='fw-bold'>\n${quickEditSettingTitle(ctx)}\n</h6>\n` +
    `${quickEditShortHelpText(ruleSettingCodename(ctx) ?? "")}\n` +
    `${quickForm(ctx)}\n` +
    `${setInfoHtml(ctx, false)}\n` +
    `</div>\n`;
  return modSlotWrap(ctx, "quick_edit", inner);
};

const quickEditSuccessView: ViewFn = (ctx) => {
  assertRuleSetCard(ctx, "quick_edit_success");
  return setInfoHtml(ctx, true);
};

function icon(name: string, extraClass?: string): string {
  const MATERIAL_ICONS: Readonly<Record<string, string>> = {
    modal: "fullscreen",
    new_window: "close_fullscreen",
  };
  const cls = extraClass === undefined
    ? "notranslate material-icons"
    : `${extraClass} notranslate material-icons`;
  return `<i class="${cls}">${MATERIAL_ICONS[name] ?? name}</i>`;
}

function outputJoin(parts: (ViewResult | undefined)[]): string {
  return parts.filter((p) => p !== undefined).map(str).join("\n");
}

function knownCardLink(target: string | undefined, urlKey: string, content: string): string {
  const targetAttr = target === undefined ? "" : ` target="${h(target)}"`;
  return `<a${targetAttr} class="known-card" href="/${h(urlKey)}">${content}</a>`;
}

function editRuleSuccessHash(ctx: ViewContext): { mark: string; view: string } {
  const successView = typeof ctx.voo.opts["success_view"] === "string"
    ? String(ctx.voo.opts["success_view"])
    : "open";
  const ruleContext = typeof ctx.voo.opts["rule_context"] === "string"
    ? String(ctx.voo.opts["rule_context"])
    : undefined;
  return {
    mark: ruleContext !== undefined
      ? DeckoName.parse(ruleContext).urlKey
      : ctx.fmt.urlKey(),
    view: successView,
  };
}

const APPLY_TO_SET_POPOVER =
  `<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus"` +
  ` data-bs-content="Each rule applies to a set of cards. Rules for more specific sets override rules for more general ones."` +
  ` class="ps-1 _popover_link" href="#"><i class="notranslate material-icons">help</i></a>`;

function boardRuleSetSelection(ctx: ViewContext): string {
  const radios = ruleSetOptionsRadios(ctx);
  return (
    `<div class="set-list _set-editor">` +
    `<div class="col-xs-6 mt-3 mb-5">${radios}</div></div>`
  );
}

function isPreferenceRuleName(ctx: ViewContext): boolean {
  const name = ctx.fmt.card.name;
  const parts = name.partNames;
  if (parts.length <= 2) return false;
  const engine = ctx.fmt.engine;
  const setPart = parts.slice(0, -2).map((p) => p.s).join("+");
  const setCard = engine.fetchRenderCard(setPart);
  const setTyped = setCard !== undefined && setCard.unknown !== true
    ? setCard.typeCode === "set"
    : parseSetName(setPart).spec !== undefined;
  if (!setTyped) return false;
  const preferer = parts[parts.length - 2];
  if (preferer.key === "all") return true;
  const prefererCard = engine.fetchRenderCard(preferer.s);
  return prefererCard !== undefined && prefererCard.unknown !== true &&
    prefererCard.typeCode === "user";
}

function prototypePatternInput(
  ctx: ViewContext,
  setName: string,
): PatternCardInput | undefined {
  const parsed = parseSetName(setName);
  const protoArgs = parsed.spec?.prototypeArgs(parsed.anchorName?.s);
  if (protoArgs === undefined) return undefined;
  if (protoArgs.name !== undefined) {
    const stored = ctx.fmt.engine.fetchRenderCard(protoArgs.name);
    if (stored !== undefined && stored.unknown !== true) {
      return {
        name: stored.name.s,
        typeName: stored.typeName,
        typeId: stored.id,
      };
    }
    return { name: protoArgs.name, isNew: true, typeName: protoArgs.type };
  }
  const typeName = protoArgs.type ?? "";
  const typeCard = ctx.fmt.engine.fetchRenderCard(typeName);
  const typeId =
    typeCard !== undefined && typeCard.unknown !== true
      ? typeCard.id
      : DeckoName.parse(typeName).cardId;
  return { name: "", isNew: true, typeName, typeId };
}

function prototypeSetCandidates(ctx: ViewContext, setName: string): string[] {
  const input = prototypePatternInput(ctx, setName);
  return input !== undefined ? setNamesForCard(input) : ["*all"];
}

function ruleSetOptionsRadios(ctx: ViewContext): string {
  const { fmt } = ctx;
  const ruleCard = fmt.card;
  const parts = ruleCard.name.partNames;
  const settingCodename = ruleSettingCodename(ctx) ?? "";
  const tag = `*${settingCodename}`;
  const isPreference = isPreferenceRuleName(ctx);
  const userSettingName = isPreference
    ? `${DeckoName.parse(parts[parts.length - 2].s).s}+${tag}`
    : tag;
  let candidates: string[];
  if (isPreference) {
    candidates = prototypeSetCandidates(
      ctx,
      parts.slice(0, -2).map((p) => p.s).join("+"),
    );
  } else {
    const setName = ruleCard.name.leftName;
    if (setName === undefined) return "";
    candidates = prototypeSetCandidates(ctx, setName.s);
  }
  const ruleSetKey = isPreference
    ? DeckoName.parse(parts.slice(0, -2).map((p) => p.s).join("+")).key
    : (ruleCard.name.leftName?.key ?? "");
  const first = ruleCard.id === undefined || ruleCard.unknown === true
    ? 0
    : candidates.findIndex((c) => DeckoName.parse(c).key === ruleSetKey);
  const sliced = first === -1 ? candidates : candidates.slice(first);
  const radios: string[] = [];
  let existingRules = 0;
  for (const [candidateSetName, state] of sliced
    .map((c) => {
      const ruleName = `${c}+${userSettingName}`;
      const existing = fmt.engine.fetchRenderCard(ruleName);
      const has = existing !== undefined && existing.unknown !== true;
      let state: string;
      if (has) {
        existingRules += 1;
        state = existingRules === 1 ? "current" : "overwritten";
      } else {
        state = existingRules > 0 ? "overwritten" : "available";
      }
      return [c, state] as [string, string];
    })
    .reverse()) {
    radios.push(ruleSetRadioHtml(ctx, candidateSetName, state, userSettingName));
  }
  return radios.join("\n");
}

function prototypeDefaultTypeCode(ctx: ViewContext): string | undefined {
  const setName = ctx.fmt.card.name.leftName;
  if (setName === undefined) return undefined;
  const defaultRule = ctx.fmt.engine.fetchRenderCard(`${setName.s}+*default`);
  return defaultRule === undefined || defaultRule.unknown === true
    ? undefined
    : defaultRule.typeCode;
}

function defaultRuleTypeName(ctx: ViewContext, typeCode: string): string | undefined {
  const typeCard = ctx.fmt.engine.fetchRenderCard(typeCode);
  return typeCard === undefined || typeCard.unknown === true
    ? undefined
    : typeCard.name.s;
}

function ruleSetRadioHtml(
  ctx: ViewContext,
  setName: string,
  state: string,
  userSettingName: string,
): string {
  const { fmt } = ctx;
  const radioText = `${setName}+${userSettingName}`;
  const epochSeconds = Math.floor(cardWallClockNow().getTime() / 1000);
  const id = `${fmt.uniqueId()}-${epochSeconds}`;
  const isCurrent = state === "current";
  const warning =
    setName === "*all" ? "This rule will affect all cards! Are you sure?" : "";
  const labelClasses =
    `set-label${isCurrent ? " current-set-label" : ""}`;
  const parsed = parseSetName(setName);
  const setLabel = parsed.spec !== undefined
    ? (parsed.spec.label(parsed.anchorName?.s) ?? "")
    : "";
  let extraInfo = "";
  if (isCurrent) {
    extraInfo = " <em>(current)</em>";
  } else if (state === "overwritten" || state === "exists") {
    const ruleName = `${setName}+${userSettingName}`;
    const ruleCardRecord = fmt.engine.fetchRenderCard(ruleName);
    const known = ruleCardRecord !== undefined && ruleCardRecord.unknown !== true;
    extraInfo =
      ` <em><a target="_blank" class="${known ? "known-card" : "wanted-card"}"` +
      ` href="/${h(DeckoName.parse(ruleName).urlKey)}">(${h(state)})</a></em>`;
  }
  const text = `${setLabel}${extraInfo}`;
  return (
    `<div class="form-check">` +
    `<input${warning === "" ? "" : ` warning="${h(warning)}"`} class="form-check-input" id="${h(id)}" type="radio" value="${h(radioText)}" name="card[name]" />\n` +
    `<label class="form-check-label ${labelClasses}" for="${h(id)}">${text}\n` +
    `${knownCardLink("decko_set", DeckoName.parse(setName).urlKey, icon("new_window", "text-muted"))}</label></div>`
  );
}

function editRuleButtons(ctx: ViewContext, formType: string): string {
  const { fmt } = ctx;
  const save = submitButton("Save", [
    ["class", "_rule-submit-button submit-button me-3 _update-history-pills"],
    ["data-cy", "save"],
  ]);
  const saveAndClose = submitButton("Save and Close", [
    ["data-disable-with", "Submitting"],
    ["data-cy", `submit-${formType}`],
    ["class", "_rule-submit-button submit-button me-3 _close-on-success _update-origin"],
  ]);
  const cancel =
    formType === "modal"
      ? `<button name="button" type="button" data-bs-dismiss="modal" data-cy="close-modal" class="btn-sm btn btn-secondary">Cancel</button>`
      : `<button name="button" type="button" class="_close-overlay btn-sm btn-sm btn btn-secondary" data-bs-dismiss="overlay">Cancel</button>`;
  const settingTitle = ruleSettingCodename(ctx) ?? "";
  const ruleSetName = fmt.card.name.leftName;
  const ruleSetParsed = ruleSetName !== undefined ? parseSetName(ruleSetName.s) : undefined;
  const followLabel = ruleSetParsed?.spec !== undefined
    ? (ruleSetParsed.spec.shortLabel(ruleSetParsed.anchorName?.s) ?? "")
    : "";
  const confirmMsg = `Are you sure you want to delete the *${settingTitle} rule for ${followLabel}?`;
  const del = (
    `<span class="rule-delete-section">` +
    `<a confirm="${h(confirmMsg)}" data-slotter-mode="silent-success"` +
    ` class="_close-${formType}-on-success slotter btn btn-outline-danger ms-auto"` +
    ` data-confirm="${h(confirmMsg)}" href="/delete/${h(fmt.urlKey())}?" data-remote="true">Delete</a></span>`
  );
  const parts2 = fmt.card.id === undefined ? [save, saveAndClose, cancel] : [save, saveAndClose, cancel, del];
  return `<div class="button-area">${outputJoin(parts2)}</div>`;
}

function editRuleForm(ctx: ViewContext): string {
  const { fmt } = ctx;
  const success = editRuleSuccessHash(ctx);
  const foreignSlot = ctx.voo.opts["data_update_foreign_slot"];
  const body =
    `<div class='guide-line rule-section mt-4'>\n<h5>\n<div class='guide-line-number'>1</div>\nDefine rule\n</h5>\n` +
    fmt.renderView("rule_form_card_editor") +
    `\n</div>\n<div class='rule-section'>\n<h5>\n<div class='guide-line-number'>2</div>\nApply to set\n` +
    APPLY_TO_SET_POPOVER +
    `\n</h5>\n<div class='card-editor'>\n` +
    boardRuleSetSelection(ctx) +
    `\n` +
    editRuleButtons(ctx, formType(ctx)) +
    `\n</div>\n</div>\n`;
  return cardFormShell(ctx, {
    formClass: "card-rule-form card-form slotter",
    id: fmt.card.id === undefined ? "new_card" : `edit_card_${fmt.card.id}`,
    htmlAttrs:
      typeof foreignSlot === "string"
        ? [["data-slotter-mode", "update-origin"], ["data-update-foreign-slot", foreignSlot]]
        : [["data-slotter-mode", "update-origin"]],
    action: "/card/update",
    methodSpoof: fmt.card.id === undefined ? null : "patch",
    success: success,
    body: body,
  });
}

function formType(ctx: ViewContext): string {
  const ft = ctx.voo.opts["form_type"];
  return ft === "modal" ? "modal" : "overlay";
}

const ruleFormView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "rule_form");
  return modSlotWrap(ctx, "rule_form", editRuleForm(ctx));
};

const ruleFormCardEditorView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "rule_form_card_editor");
  const typeFormgroup = rulesTypeFormgroup(ctx);
  const contentFormgroup = ctx.fmt.renderView("content_formgroup", { hide: ["conflict_tracker"] });
  return modSlotWrap(
    ctx,
    "rule_form_card_editor",
    outputJoin([typeFormgroup, contentFormgroup]),
    "card-editor slotter",
  );
};

function rulesTypeFormgroup(ctx: ViewContext): string | undefined {
  const setting = ruleSettingCodename(ctx);
  const registry = setting === undefined
    ? undefined
    : getDefaultModLoader()?.settingsRegistry().findByCodename(setting);
  if (registry === undefined || !registry.ruleTypeEditable) return undefined;
  const href = `/${ctx.fmt.urlKey()}/rule_form_card_editor?assign=true&mark=`;
  return typeFormgroup(ctx, {
    href,
    cls: "type-field rule-type-field _live-type-field",
    groups: ruleTypeGroups(setting),
    hrefFirst: true,
  });
}

function ruleTypeGroups(
  setting: string | undefined,
): Readonly<Record<string, readonly string[]>> | undefined {
  if (setting === "default") return RIGHT_DEFAULT_CARDTYPE_GROUPS;
  if (setting === "structure") return RIGHT_STRUCTURE_CARDTYPE_GROUPS;
  if (setting === "content_options") return { Organize: ["List", "Pointer", "Search"] };
  return undefined;
}

const ruleEditView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "rule_edit");
  const body = currentRuleForm(ctx, "modal");
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += "<div class='modal-dialog modal-dialog-centered modal-lg'>\n";
  out += "<div class='modal-content'>\n";
  out += "<div class='modal-header'>\n";
  out += `${editRuleTitle(ctx)}\n`;
  out += `${modalMenuHtml(ctx)}\n`;
  out += "</div>\n";
  out += `<div class='modal-body'>\n${body}\n</div>\n`;
  out += "</div>\n</div>\n</div>\n";
  return out;
};

function currentRuleForm(ctx: ViewContext, formTypeArg: string): string {
  return ctx.fmt.subformatView("rule_form", {
    form_type: formTypeArg,
    success_view: "overlay_rule",
  });
}

function modalMenuHtml(ctx: ViewContext): string {
  const close =
    `<a class="_close-modal btn-close" data-bs-dismiss="modal" href="">${icon("close")}</a>`;
  const popOut =
    `<a class="pop-out-modal btn-close" href="/${h(ctx.fmt.urlKey())}">${icon("modal")}</a>`;
  return `<div class="modal-menu _modal-menu ms-auto">${outputJoin([close, popOut])}</div>`;
}

const modalRuleView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "modal_rule");
  const body = currentRuleForm(ctx, "overlay");
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += "<div class='modal-dialog modal-dialog-centered'>\n";
  out += "<div class='modal-content'>\n";
  out += "<div class='modal-header'>\n";
  out += `${ctx.fmt.renderView("title")}\n`;
  out += `${modalMenuHtml(ctx)}\n`;
  out += "</div>\n";
  out += `<div class='modal-body'>\n${body}\n</div>\n`;
  out += `<div class='modal-footer'>\n`;
  out += `<button name="button" type="submit" class="btn-xs _close-modal float-end btn btn-primary" data-bs-dismiss="modal">Close</button>\n`;
  out += `</div>\n`;
  out += "</div>\n</div>\n</div>\n";
  return out;
};

const overlayRuleView: ViewFn = (ctx) => {
  assertRuleCard(ctx, "overlay_rule");
  const { fmt, voo } = ctx;
  voo.hide("menu");
  voo.hide("help");
  voo.classUp("card-slot", "_overlay d0-card-overlay bg-body");
  voo.classUp("card-slot", "_overlay");
  const body = currentRuleForm(ctx, "overlay");
  const title = editRuleTitle(ctx);
  const menu = overlayMenuHtml(ctx);
  const setKeysClass = fmt.card.setKeys;
  const slotExtras = `${voo
    .classy("card-slot")
    .split(" ")
    .filter((c) => c !== "card-slot" && c !== "")
    .join(" ")} _overlay`;
  const attrs = emitAttrs({
    id: `${fmt.card.name.safeKey}-overlay_rule-view`,
    class: [`card-slot`, `overlay_rule-view`, setKeysClass, slotExtras].filter((s) => s !== "").join(" "),
    "data-card-id": fmt.card.id === undefined ? undefined : String(fmt.card.id),
    "data-card-name": h(fmt.card.name.s),
    "data-card-type-id": fmt.card.typeId === undefined ? undefined : String(fmt.card.typeId),
    "data-card-type-name": fmt.card.typeName,
    "data-card-link-name": fmt.urlKey(),
    "data-slot-id": newSlotId(),
    "data-slot": slotOptionsJson(voo.slotOptions()),
    "data-breadcrumb": "Rule editing",
    "data-breadcrumb-class": "rules",
  });
  return (
    `<div${attrs}>` +
    `<div class="d0-card-frame">` +
    `<div class="d0-card-header bg-body">${title}\n${menu}</div>` +
    `\n\n` +
    `<div class="d0-card-body ${setKeysClass}">${body}</div>` +
    `</div></div>`
  );
};

function overlayMenuHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const helpContent = h(str(fmt.renderView("help_text")));
  const helpLink =
    `<a path="#" tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus"` +
    ` data-bs-content="${helpContent}" data-bs-placement="left"` +
    ` class="help-link ps-1 _popover_link slotter text-muted p-1 ms-1"` +
    ` href="/${h(fmt.urlKey())}/overlay_guide"` +
    ` data-slot-selector=".board-sidebar &gt; ._overlay-container-placeholder &gt; .card-slot"` +
    ` data-slotter-mode="overlay" data-remote="true">${icon("help")}</a>`;
  const newWindow =
    `<a class="text-muted p-1 ms-1 known-card" href="/${h(fmt.urlKey())}">${icon("new_window")}</a>`;
  const close =
    `<a data-bs-dismiss="overlay" class="text-muted p-1 ms-1" href="#">${icon("close")}</a>`;
  return `<div class="overlay-menu">${outputJoin([helpLink, newWindow, close])}</div>`;
}

function quickEditSettingListBody(ctx: ViewContext): string {
  const items = [...FIELD_SETTINGS].map((setting: string) =>
    quickEditSettingListItem(ctx, setting),
  );
  return `<ul class="nav nav-pills flex-column board-pills _setting-list _setting-group">${items
    .map((item: string) => `<li>${item}</li>`)
    .join("\n")}</ul>`;
}

const quickEditSettingListView: ViewFn = (ctx) => {
  assertSetCard(ctx, "quick_edit_setting_list");
  return settingListSlotWrap(ctx, "quick_edit_setting_list", quickEditSettingListBody(ctx), "_setting-list");
};

function quickEditSettingListItem(ctx: ViewContext, setting: string): string {
  const settingCard = ctx.fmt.engine.findSettingCard?.(setting);
  if (settingCard === undefined) return "";
  if (ctx.fmt.engine.isDenied(settingCard)) return "";
  const setCard = ctx.fmt.card;
  const stored = ctx.fmt.engine.fetchRenderCard(`${setCard.name.s}+*${setting}`);
  let ruleCard =
    stored !== undefined && stored.unknown !== true
      ? stored
      : buildVirtualRuleCard({
          setCard,
          settingCard,
          settingCodename: setting,
          engine: ctx.fmt.engine,
        });
  if (stored === undefined || stored.unknown === true) {
    const codenameName = DeckoName.parse(`${setCard.name.s}+*${setting}`);
    ruleCard = {
      ...ruleCard,
      name: codenameName,
      key: codenameName.key,
      record: { ...ruleCard.record, name: codenameName, key: codenameName.key },
    };
  }
  const nestName = `${setCard.name.s}+${settingCard.name.s}`;
  return ctx.fmt.nestRecord(ruleCard, "quick_edit", {
    nest_name: nestName,
    show: ["quick_edit"],
    home_view: "quick_edit",
  });
}

const nestRulesView: ViewFn = (ctx) => {
  assertSetCard(ctx, "nest_rules");
  const body = str(ctx.fmt.renderView("quick_edit_setting_list"));
  return modSlotWrap(ctx, "nest_rules", body);
};

const modalNestRulesView: ViewFn = (ctx) => {
  assertSetCard(ctx, "modal_nest_rules");
  const body = `${settingFilter(ctx, "quick_edit_setting_list", "field_related", undefined)}\n${ctx.fmt.renderView("quick_edit_setting_list")}`;
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += "<div class='modal-dialog modal-dialog-centered'>\n";
  out += "<div class='modal-content'>\n";
  out += "<div class='modal-header'>\n";
  out += `Rules for nest\n`;
  out += `${modalMenuHtml(ctx)}\n`;
  out += "</div>\n";
  out += `<div class='modal-body'>\n${body}\n</div>\n`;
  out += `<div class='modal-footer'>\n`;
  out += `<button name="button" type="submit" class="btn-xs _close-modal float-end btn btn-primary" data-bs-dismiss="modal">Close</button>\n`;
  out += `</div>\n`;
  out += "</div>\n</div>\n</div>\n";
  return out;
};

const setModules: ModSetModuleFile[] = [
  {
    setPath: "abstract/virtual_set",
  },
  {
    setPath: "all/cardtype_groups",
  },
  {
    setPath: "all/related_sets",
  },
  {
    setPath: "all/set_select",
    formats: {
      html: {
        views: [
          { view: "card_select", viewFn: cardSelectView, config: { unknown: true, cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "right/right",
  },
  {
    setPath: "right/self",
  },
  {
    setPath: "right/type",
  },
  {
    setPath: "right/type_plus_right",
  },
  {
    setPath: "rstar/rule_user",
  },
  {
    setPath: "rule/rules",
    events: [
      engineOwnedEvent({
        event: "save_recently_edited_settings",
        at: "integrate",
        on: ["save"],
        changed: ["type", "content"],
      }),
    ],
  },
  {
    setPath: "rule/html_views",
  },
  {
    setPath: "rule/bar_view",
    formats: {
      html: {
        views: [
          { view: "one_line_content", viewFn: ruleOneLineContentViewFn, config: { unknown: true, wrap: { div: { class: "text-muted one-line" } } } },
          { view: "raw_one_line_content", viewFn: ruleRawOneLineContentView, config: { unknown: true } },
          {
            view: "bar_middle",
            viewFn: (ctx) => (isRuleCard(ctx) ? null : ""),
            config: { unknown: true },
          },
        ],
      },
    },
  },
  {
    setPath: "rule/board_rules_editor",
    formats: {
      html: {
        views: [
          { view: "overlay_rule", viewFn: overlayRuleView, config: { cache: "never", unknown: true } },
          { view: "modal_rule", viewFn: modalRuleView, config: { cache: "never", unknown: true } },
          { view: "overlay_title", viewFn: overlayTitleView },
          { view: "help_text", viewFn: ruleHelpTextView, config: { unknown: true, cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "rule/editor",
    formats: {
      html: {
        views: [
          { view: "rule_edit", viewFn: ruleEditView, config: { cache: "never", unknown: true } },
          { view: "rule_help", viewFn: ruleHelpView, config: { unknown: true, perms: "none", cache: "never" } },
          { view: "rule_nest_editor_link", viewFn: ruleNestEditorLinkView, config: { unknown: true } },
          { view: "rule_board_link", viewFn: ruleBoardLinkView, config: { unknown: true } },
        ],
      },
    },
  },
  {
    setPath: "rule/quick_editor",
    formats: {
      html: {
        views: [
          { view: "quick_edit", viewFn: quickEditView, config: { unknown: true } },
          { view: "quick_edit_success", viewFn: quickEditSuccessView },
        ],
      },
    },
  },
  {
    setPath: "rule/rule_form",
    formats: {
      html: {
        views: [
          { view: "rule_form", viewFn: ruleFormView, config: { cache: "never", unknown: true } },
          { view: "rule_form_card_editor", viewFn: ruleFormCardEditorView, config: { cache: "never", unknown: true } },
        ],
      },
    },
  },
  {
    setPath: "rule/rule_form/buttons",
  },
  {
    setPath: "rule/rule_form/set_selection",
  },
  {
    setPath: "self/cardtype",
    formats: {
      html: {
        views: [{ view: "grouped_list", viewFn: groupedListView }],
      },
    },
  },
  {
    setPath: "self/recent_settings",
  },
  {
    setPath: "type/cardtype",
  },
  {
    setPath: "type/set",
  },
  {
    setPath: "type/set/html_views",
    formats: {
      html: {
        views: [
          { view: "set_label", viewFn: setLabelView },
          { view: "input", viewFn: inputView },
          { view: "one_line_content", viewFn: setOneLineContentView, config: { wrap: {} } },
        ],
      },
    },
  },
  {
    setPath: "type/set/html_views/filtered_rule_lists",
    formats: {
      html: {
        views: [
          { view: "board_rules_tab", viewFn: boardRulesTabView, config: { cache: "never" } },
          { view: "filtered_accordion_rule_list", viewFn: filteredAccordionRuleListView },
          { view: "nest_rules", viewFn: nestRulesView, config: { cache: "never", unknown: true } },
          { view: "modal_nest_rules", viewFn: modalNestRulesView, config: { cache: "never", unknown: true } },
        ],
      },
    },
  },
  {
    setPath: "type/set/html_views/rule_lists",
    formats: {
      html: {
        views: [
          { view: "bar_setting_list", viewFn: barSettingListView },
          { view: "pill_setting_list", viewFn: pillSettingListView, config: { cache: "never" } },
          { view: "modal_pill_setting_list", viewFn: modalPillSettingListView },
          { view: "accordion_rule_list", viewFn: accordionRuleListView },
          { view: "accordion_bar_list", viewFn: accordionBarListView },
          { view: "quick_edit_setting_list", viewFn: quickEditSettingListView, config: { cache: "never" } },
          { view: "overlay_rule_list_link", viewFn: overlayRuleListLinkView, config: { cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "type/set/html_views/setting_filter",
  },
  {
    setPath: "type/set/html_views/template",
    formats: {
      html: {
        views: [{ view: "template_link", viewFn: templateLinkView, config: { cache: "never" } }],
      },
    },
  },
  {
    setPath: "type/set/setting_categories",
  },
  {
    setPath: "type/setting",
    formats: {
      html: {
        views: [
          { view: "rule_help", viewFn: ruleHelpView },
          { view: "one_line_content", viewFn: (ctx) => viewWrapInherited(ctx, "one_line_content", str(ctx.fmt.renderView("rule_help"))) },
        ],
      },
    },
  },
  {
    setPath: "type_plus_right/set/setting",
  },
  {
    setPath: "type_plus_right/set/structure",
  },
];

const cardModRules: DeckoModManifest = {
  name: "rules",
  gemName: "card-mod-rules",
  group: "gem",
  setModules,
  prepareEngine: prepareRuleCache,
};

export default cardModRules;
