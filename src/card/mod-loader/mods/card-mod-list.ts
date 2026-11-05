import type { RenderCard, ViewContext, ViewFn } from "../../render/format.js";
import { UnsupportedViewError } from "../../render/format.js";
import { superViewStep } from "../mod-view-helpers.js";
import { setModuleShortname } from "../mod-registrar.js";
import { DeckoName } from "../../name.js";
import { CodenameNotFoundError } from "../../name/errors.js";
import { warmRuleCards } from "./rule-card-warm.js";
import { inputView as editorBaseInputView } from "./card-mod-edit.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import { safeSetKeys } from "../../render/set-keys.js";
import { h } from "../../render/slot-html.js";
import { rawItemStrings } from "../../render/pointer-list.js";
import type { SQLDatabaseDriver } from "../../../server/driver.js";
import { addValidationErrors } from "../mod-validation-errors.js";
import {
  FOLLOW_OPTION_CARD_NAMES,
  followOptionLabel,
} from "../../follow/follow-options.js";
import type { CardRecord } from "../../fetch/card-record.js";
import { FetchEngine } from "../../fetch.js";
import { resolveTypeId } from "../../actions/type-resolution.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventCard,
  ModEventFn,
} from "../mod-manifest.js";

const LIST_FAMILY = new Set(["pointer", "list"]);

const LIST_INPUT_MODULE = setModuleShortname("abstract/01_list/html_views");

function listFamilyCard(fmt: ViewContext["fmt"]): boolean {
  return LIST_FAMILY.has(fmt.card.typeCode ?? "");
}

function baseViewNotPorted(view: string, fmt: ViewContext["fmt"]): Error {
  return new Error(
    `${view}: ${fmt.card.name.s} is not a pointer/list-family card; the ` +
      `base-format view (card-mod-format/card-mod-edit) is not ported`,
  );
}

function itemNames(card: RenderCard, context: "raw" | undefined): string[] {
  const items = rawItemStrings(card.dbContent);
  if (context === "raw") return items;
  return items.map((item) => DeckoName.parse(item).absoluteName(card.name).s);
}

function filteredItems(items: string[], limit: number, offset: number): string[] {
  if (limit <= 0 && offset <= 0) return items;
  return items.slice(offset, limit > 0 ? offset + limit : undefined);
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

function pointerItems(
  ctx: ViewContext,
  itemView: string,
  limit: number,
  offset: number,
): string[] {
  const names = filteredItems(itemNames(ctx.fmt.card, undefined), limit, offset);
  return names.map((name) => {
    const itemCard = fetchItemCardOrUnknown(ctx.fmt, name);
    const rendered = ctx.fmt.nestRecord(itemCard, itemView, {});
    return `<div class="pointer-item item-${itemView}">${rendered}</div>`;
  });
}

function implicitItemView(ctx: ViewContext): string {
  const items = ctx.voo.items;
  const view = items !== undefined && items !== null
    ? (items as { view?: unknown }).view
    : undefined;
  return typeof view === "string" && view !== "" ? view : "bar";
}

function ruleCard(
  ctx: ViewContext,
  setting: string,
): ReturnType<ViewContext["fmt"]["engine"]["fetchRenderCard"]> {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
    isNew: card.record.isNew === true,
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, setting)) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined || record.unknown === true) continue;
    if (ctx.fmt.engine.isDenied(record)) continue;
    return record;
  }
  return undefined;
}

function optionsCardUrlKey(ctx: ViewContext): string {
  const rule = ruleCard(ctx, "*content_options");
  if (rule !== undefined) return rule.name.urlKey;
  const card = ctx.fmt.card;
  if (card.name.isCompound) {
    const rightName = card.name.rightName?.s;
    const right = rightName === undefined ? undefined : ctx.fmt.engine.fetchRenderCard(rightName);
    if (right?.typeCode === "cardtype" && right.name !== undefined) {
      return DeckoName.parse(`${right.name.s}+*type+by_name`).urlKey;
    }
  }
  const all = ctx.fmt.engine.fetchRenderCard("*all");
  return all?.name.urlKey ?? "*all";
}

const oneLineContentView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) throw baseViewNotPorted("one_line_content", ctx.fmt);
  const implicit = implicitItemView(ctx);
  const itemView = implicit === "name" ? "name" : "link";
  const items = pointerItems(ctx, itemView, 10, 0);
  const body = `<div class="pointer-list one-line-pointer-list">${items.join(", ")}</div>`;
  return `<div class="text-muted">${body}</div>`;
};

function itemsForInput(ctx: ViewContext): string[] {
  const items = itemNames(ctx.fmt.card, "raw");
  return items.length === 0 ? [""] : items;
}

function icon(name: string): string {
  return `<i class="notranslate material-icons">${name}</i>`;
}

function listInputHtml(ctx: ViewContext): string {
  const items = itemsForInput(ctx);
  const ulClasses = ctx.voo.classy("pointer-list-editor", "pointer-list-ul");
  const optionsCard = optionsCardUrlKey(ctx);
  const rows = items
    .map(
      (item) =>
        `<li class='pointer-li mb-1'>\n` +
        `<span class='input-group'>\n` +
        `<span class='input-group-text handle'>\n` +
        `${icon("reorder")}\n` +
        `</span>\n` +
        `<input type="text" name="pointer_item" id="pointer_item" value="${h(item)}" class="pointer-item-text form-control" data-options-card="${h(optionsCard)}" placeholder="" />\n` +
        `<button class='pointer-item-delete btn btn-secondary' type='button'>\n` +
        `${icon("close")}\n` +
        `</button>\n` +
        `</span>\n` +
        `</li>\n`,
    )
    .join("");
  return (
    `<ul class='${ulClasses}'>\n` +
    rows +
    `</ul>\n` +
    `<span class='input-group'>\n` +
    `<button class='_pointer-item-add btn btn-secondary' type='submit'>\n` +
    `${icon("add")}\n` +
    `add another\n` +
    `</button>\n` +
    `</span>\n`
  );
}

const listView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) {
    throw new UnsupportedViewError("list", ctx.fmt.card.name.s);
  }
  return listInputHtml(ctx);
};

const checkboxView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) {
    throw new UnsupportedViewError("checkbox", ctx.fmt.card.name.s);
  }
  return checkboxInputHtml(ctx);
};

const selectView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) {
    throw new UnsupportedViewError("select", ctx.fmt.card.name.s);
  }
  return selectInputHtml(ctx);
};

const multiselectView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) {
    throw new UnsupportedViewError("multiselect", ctx.fmt.card.name.s);
  }
  return multiselectInputHtml(ctx);
};

const radioView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) {
    throw new UnsupportedViewError("radio", ctx.fmt.card.name.s);
  }
  return radioInputHtml(ctx);
};

const autocompleteView: ViewFn = (ctx) => {
  if (!listFamilyCard(ctx.fmt)) {
    throw new UnsupportedViewError("autocomplete", ctx.fmt.card.name.s);
  }
  return autocompleteInputHtml(ctx);
};

function hiddenContentField(ctx: ViewContext): string {
  const prefix = typeof ctx.voo.opts["form_name_prefix"] === "string"
    ? (ctx.voo.opts["form_name_prefix"] as string)
    : "card";
  const idPrefix = prefix === "card" ? "card" : prefix.replace(/\]/g, "").replace(/[\[+]/g, "_");
  return (
    `<input class="d0-card-content form-control" autocomplete="off" type="hidden" ` +
    `value="${h(ctx.fmt.card.dbContent)}" name="${prefix}[content]" id="${idPrefix}_content" />`
  );
}

function listFamilyInputHtml(ctx: ViewContext): string {
  const rule = ruleCard(ctx, "*input_type");
  const inputType =
    rule?.dbContent
      ?.replace(/[[\]]/g, "")
      .replace(/ /g, "_")
      .trim() ?? "";
  if (inputType === "radio") return radioInputHtml(ctx);
  if (inputType === "checkbox") return checkboxInputHtml(ctx);
  if (inputType === "select") return selectInputHtml(ctx);
  if (inputType === "multiselect") return multiselectInputHtml(ctx);
  if (inputType === "autocomplete") return autocompleteInputHtml(ctx);
  if (inputType === "" || inputType === "list") return listInputHtml(ctx);
  throw new Error(
    `input editor "${inputType}" (the card's *input_type rule) is not ported ` +
      `- see src/card/mod-loader/mods/card-mod-list.ts header`,
  );
}

function isFollowRuleCard(card: RenderCard): boolean {
  if (!card.name.isCompound) return false;
  return card.name.rightName?.key === "*follow";
}

function editorOptionPairs(ctx: ViewContext, editor: string): Array<[string, string]> {
  if (isFollowRuleCard(ctx.fmt.card)) {
    const optionNames = [...FOLLOW_OPTION_CARD_NAMES];
    for (const selected of itemNames(ctx.fmt.card, undefined)) {
      if (selected === "") continue;
      if (!optionNames.includes(selected)) optionNames.push(selected);
    }
    return optionNames.map((name) => [name, name]);
  }
  const pairs = ctx.fmt.engine.optionsCardPairs?.(ctx.fmt.card);
  if (pairs === undefined) {
    throw new Error(
      editor +
        " input: the engine does not carry the options walk (optionsCardPairs)",
    );
  }
  return pairs;
}

function optionLabelText(ctx: ViewContext, option: string): string {
  const optionCard = ctx.fmt.engine.fetchRenderCard(option);
  if (optionCard === undefined || optionCard.unknown === true) return h(option);
  const viewRule = ruleCard(ctx, "*content_option_view");
  if (viewRule !== undefined && viewRule.dbContent !== "smart_label") {
    throw new Error(
      `option label view rule ${viewRule.dbContent} is not ported - only ` +
        `:smart_label (options_api.rb:77)`,
    );
  }
  return ctx.fmt.nestRecord(optionCard, "smart_label", {});
}

function radioInputHtml(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const pairs = editorOptionPairs(ctx, "radio");
  if (pairs.length === 0) return "<ul class='pointer-radio-list'>\nno options\n</ul>\n";
  const firstName = itemNames(card, undefined)[0];
  const inputName = `pointer_radio_button-${card.key}`;
  const followRule = isFollowRuleCard(card);
  const rows = pairs
    .map(([, option]) => {
      const key = DeckoName.parse(option).key;
      const checked = option === firstName ? ` checked="checked"` : "";
      const label = followRule
        ? h(followOptionLabel(DeckoName.parse(option).tagName?.s.replace(/^\*/, "") ?? ""))
        : optionLabelText(ctx, option);
      return (
        `<li class='pointer-radio radio form-check'>\n` +
        `<input type="radio" name="${inputName}" id="pointer-radio-${key}" value="${h(option)}" ` +
        `class="pointer-radio-button form-check-input "${checked} />\n` +
        `<label class="form-check-label" for="pointer-radio-${key}">${label}</label>\n` +
        `</li>\n`
      );
    })
    .join("");
  return `<ul class='pointer-radio-list'>\n${rows}</ul>\n`;
}

function checkboxInputHtml(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const pairs = editorOptionPairs(ctx, "checkbox");
  const selected = itemNames(card, undefined);
  const rows = pairs
    .map(([, option]) => {
      const key = DeckoName.parse(option).key;
      const id = `pointer-checkbox-${key}`;
      const checked = selected.includes(option) ? ` checked="checked"` : "";
      return (
        `<div class='pointer-checkbox'>\n` +
        `<input type="checkbox" name="pointer_checkbox-${ctx.fmt.uniqueId()}" id="${id}" value="${h(option)}" ` +
        `class="pointer-checkbox-button "${checked} />\n` +
        `<label class="form-check-label" for="${id}">${optionLabelText(ctx, option)}</label>\n` +
        `</div>\n`
      );
    })
    .join("");
  return `<div class='pointer-checkbox-list'>\n${rows}</div>\n`;
}

function optionsForSelect(pairs: Array<[string, string]>, selected: string[]): string {
  return pairs
    .map(([label, value]) =>
      `<option${selected.includes(value) ? ` selected="selected"` : ""} value="${h(value)}">${h(label)}</option>`,
    )
    .join("\n");
}

function rubyItemNames(content: string): string[] {
  const rawFields = content.split(/\n+/);
  while (rawFields.length > 0 && rawFields[rawFields.length - 1] === "") rawFields.pop();
  return rawFields.map((i) => i.replace(/\[\[|\]\]/g, "").trim());
}

function editorOptionNames(ctx: ViewContext, editor: string): {
  optionNames: string[];
  selectedItems: string[];
} {
  const card = ctx.fmt.card;
  const pairs = editorOptionPairs(ctx, editor);
  const optionNames = pairs.map(([, name]) => name);
  const selectedItems = rubyItemNames(card.dbContent).map(
    (item) => DeckoName.parse(item).absoluteName(card.name).s,
  );
  return { optionNames, selectedItems };
}

function selectInputHtml(ctx: ViewContext): string {
  const { optionNames, selectedItems } = editorOptionNames(ctx, "select");
  const pairs: Array<[string, string]> = [["-- Select --", ""]];
  for (const name of optionNames) {
    const existing = pairs.findIndex(([label]) => label === name);
    if (existing === -1) pairs.push([name, name]);
    else pairs[existing][1] = name;
  }
  const firstName = selectedItems.length > 0 ? selectedItems[0] : undefined;
  const options = optionsForSelect(
    pairs,
    firstName === undefined ? [] : [firstName],
  );
  const groupName = `pointer_select-${ctx.fmt.uniqueId()}`;
  return (
    `<select name="${groupName}" id="${groupName}" ` +
    `class="pointer-select form-control">` +
    options +
    `</select>`
  );
}

function multiselectInputHtml(ctx: ViewContext): string {
  const { optionNames, selectedItems } = editorOptionNames(ctx, "multiselect");
  const pairs = optionNames.map((name) => [name, name] as [string, string]);
  const options = optionsForSelect(pairs, selectedItems);
  const groupName = `pointer_multiselect-${ctx.fmt.uniqueId()}`;
  return (
    `<select name="${groupName}[]" id="${groupName}" ` +
    `multiple="multiple" class="pointer-multiselect form-control">` +
    options +
    `</select>`
  );
}

function autocompleteInputHtml(ctx: ViewContext): string {
  const items = itemsForInput(ctx);
  const optionsCard = optionsCardUrlKey(ctx);
  const value = items.length > 0 ? items[0] : "";
  return (
    `<div class='pointer-list-editor pointer-list-ul'>\n` +
    `<input type="text" name="pointer_item" id="pointer_item" value="${h(value)}" ` +
    `class="pointer-item-text form-control _autocomplete " ` +
    `data-options-card="${h(optionsCard)}" placeholder="" />\n` +
    `</div>\n`
  );
}

const REFERENCE_NAME_FIELD_CLASS =
  "pointer-item-text form-control _autocomplete _reference pointer-item-text form-control group-text-middle";

function nestListInputHtml(ctx: ViewContext): string {
  const items = nestListItemsForInput(ctx.fmt.card.dbContent);
  const ulClasses = ctx.voo.classy("pointer-list-editor", "_nest-list-ul");
  const optionsCard = autocompleteOptionsCard(ctx);
  const header =
    `<div class='nest-form-header'>\n` +
    referenceListInputRow({
      prefix: "{{",
      postfix: "}}",
      firstLabel: "Name",
      secondLabel: "Options",
      showEditButton: false,
    }) +
    `\n</div>\n`;
  const rows = items
    .map(
      ([name, rawOptions], index) =>
        `<li class='pointer-li mb-2 _nest-form' data-index='${index}'>\n` +
        referenceListInputRow({
          prefix: "{{",
          postfix: "}}",
          nameValue: name,
          titleValue: rawOptions,
          nameFieldClass: REFERENCE_NAME_FIELD_CLASS,
          titleFieldClass:
            "_title _nest-options pointer-item-text form-control group-text-middle",
          showEditButton: true,
        }) +
        `\n</li>\n`,
    )
    .join("");
  return (
    header +
    `<ul class='${ulClasses}'>\n` +
    rows.replaceAll("__OPTIONS_CARD__", optionsCard) +
    `</ul>\n` +
    addAnotherSpan()
  );
}

function linkListInputHtml(ctx: ViewContext): string {
  const items = linkListItemsForInput(ctx, ctx.fmt.card.dbContent);
  const ulClasses = ctx.voo.classy("pointer-list-editor", "pointer-link-list-ul");
  const optionsCard = autocompleteOptionsCard(ctx);
  const header =
    `<div class='nest-form-header'>\n` +
    referenceListInputRow({
      prefix: "{{",
      postfix: "}}",
      firstLabel: "Link target",
      secondLabel: "Link text",
      showEditButton: false,
    }) +
    `\n</div>\n`;
  const rows = items
    .map(
      ([name, title], index) =>
        `<li class='pointer-li mb-2 _nest-form' data-index='${index}'>\n` +
        referenceListInputRow({
          prefix: "[[",
          postfix: "]]",
          nameValue: name,
          titleValue: title,
          nameFieldClass: REFERENCE_NAME_FIELD_CLASS,
          titleFieldClass: "_title pointer-item-text form-control group-text-middle",
          showEditButton: false,
        }) +
        `\n</li>\n`,
    )
    .join("");
  return (
    header +
    `<ul class='${ulClasses}'>\n` +
    rows.replaceAll("__OPTIONS_CARD__", optionsCard) +
    `</ul>\n` +
    addAnotherSpan()
  );
}

function autocompleteOptionsCard(ctx: ViewContext): string {
  const all = ctx.fmt.engine.fetchRenderCard("*all")?.name.s ?? "*all";
  const byName = ctx.fmt.engine.fetchRenderCard("by name")?.name.s ?? "by name";
  return `${all}+${byName}`;
}

function nestListItemsForInput(content: string): [string, string | undefined][] {
  const pairs: [string, string | undefined][] = [];
  for (const match of content.matchAll(/\{\{([^}]*)\}\}/g)) {
    const inner = match[1] ?? "";
    const pipe = inner.indexOf("|");
    if (pipe === -1) pairs.push([inner, undefined]);
    else pairs.push([inner.slice(0, pipe), inner.slice(pipe + 1)]);
  }
  return pairs.length === 0 ? [["", ""]] : pairs;
}

function linkListItemsForInput(
  ctx: ViewContext,
  content: string,
): [string, string | undefined][] {
  const pairs: [string, string | undefined][] = [];
  for (const match of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const inner = match[1] ?? "";
    const pipe = inner.indexOf("|");
    const target = pipe === -1 ? inner : inner.slice(0, pipe);
    const name = resolveItemMark(ctx, target);
    if (pipe === -1) pairs.push([name, name]);
    else pairs.push([name, inner.slice(pipe + 1)]);
  }
  return pairs.length === 0 ? [["", ""]] : pairs;
}

function resolveItemMark(ctx: ViewContext, target: string): string {
  const mark = /^:([A-Za-z0-9_?!]+)$/.exec(target);
  if (mark === null) return target;
  const id = ctx.fmt.engine.peekIdByCodename?.(mark[1] as string);
  const name = id === undefined ? undefined : ctx.fmt.engine.peekRegisteredNameForId?.(id);
  if (name === undefined) {
    throw new CodenameNotFoundError(`codename doesn't exist: ${mark[1]}`);
  }
  return name;
}

function referenceListInputRow(opts: {
  prefix: string;
  postfix: string;
  firstLabel?: string;
  secondLabel?: string;
  nameValue?: string;
  titleValue?: string | undefined;
  nameFieldClass?: string;
  titleFieldClass?: string;
  showEditButton: boolean;
}): string {
  const nameField = opts.firstLabel !== undefined
    ? `<span class="form-control border-0 control-label">${opts.firstLabel}</span>\n`
    : `<input type="text" name="pointer_item" id="pointer_item" value="${h(opts.nameValue ?? "")}" class="${opts.nameFieldClass}" placeholder="" data-options-card="__OPTIONS_CARD__" />\n`;
  const titleValueAttr = opts.titleValue === undefined
    ? ``
    : ` value="${h(opts.titleValue)}"`;
  const titleField = opts.secondLabel !== undefined
    ? `<span class="form-control border-0 control-label">${opts.secondLabel}</span>\n`
    : `<input type="text" name="pointer_item_title" id="pointer_item_title"${titleValueAttr} class="${opts.titleFieldClass}" />\n`;
  const editButton = !opts.showEditButton
    ? ``
    : `<div class='input-group-append ml-2'>\n` +
      `<span class='input-group-text p-0 border-primary'>\n` +
      `<button class='btn btn-primary _open-nest-editor' type='button'>\n` +
      `${icon("edit")}\n` +
      `</button>\n` +
      `</span>\n` +
      `</div>\n`;
  return (
    `<div class='input-group'>\n` +
    `<span class='input-group-text handle'>\n` +
    `${icon("reorder")}\n` +
    `</span>\n` +
    `<span class='input-group-text text-muted group-text-left input-nest-syntax'>\n` +
    `${opts.prefix}\n` +
    `</span>\n` +
    nameField +
    `<span class='input-group-text text-muted group-text-middle input-nest-syntax'>\n` +
    `|\n` +
    `</span>\n` +
    titleField +
    `<span class='input-group-text text-muted group-text-end input-nest-syntax'>\n` +
    `${opts.postfix}\n` +
    `</span>\n` +
    `<div class='input-group-append'>\n` +
    `<span class='input-group-text p-0'>\n` +
    `<button class='pointer-item-delete btn btn-secondary' type='button'>\n` +
    `${icon("close")}\n` +
    `</button>\n` +
    `</span>\n` +
    `</div>\n` +
    editButton +
    `</div>\n`
  );
}

function addAnotherSpan(): string {
  return (
    `<span class='input-group'>\n` +
    `<button class='_pointer-item-add btn btn-secondary' type='submit'>\n` +
    `${icon("add")}\n` +
    `add another\n` +
    `</button>\n` +
    `</span>\n`
  );
}

const inputView: ViewFn = (ctx) => {
  const typeCode = ctx.fmt.card.typeCode ?? "";
  let editor: string;
  if (typeCode === "nest_list") {
    editor = nestListInputHtml(ctx);
  } else if (typeCode === "link_list") {
    editor = linkListInputHtml(ctx);
  } else if (listFamilyCard(ctx.fmt)) {
    editor = listFamilyInputHtml(ctx);
  } else {
    const step = superViewStep(ctx, LIST_INPUT_MODULE, "input");
    if (step.kind === "not-in-chain") {
      return editorBaseInputView(ctx);
    }
    if (step.kind === "empty") {
      throw baseViewNotPorted("input", ctx.fmt);
    }
    editor = String(step.body);
  }
  return hiddenContentField(ctx) + editor;
};

const nestListInputView: ViewFn = (ctx) => {
  if ((ctx.fmt.card.typeCode ?? "") !== "nest_list") {
    throw new UnsupportedViewError("nest_list_input", ctx.fmt.card.name.s);
  }
  return nestListInputHtml(ctx);
};

async function prepareListRules(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const setTypeId = host.codenames.peekId("set");
  const settingTypeId = host.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return;
  await warmRuleCards(host, setTypeId, settingTypeId, [
    "input_type",
    "content_options",
  ]);
}

const addAndDropItems: ModEventFn = () => {
};

const insertItemEvent: ModEventFn = () => {
};

const delistEvent: ModEventFn = (_card, _host) => {
};

const LIST_ITEM_TYPE_OVERRIDES: Readonly<Record<string, { leftType: string; types: readonly string[] }>> = {
  style: { leftType: "set", types: ["css", "scss", "skin", "bootswatch_skin"] },
  script: { leftType: "set", types: ["java_script", "coffee_script", "list"] },
  stylesheets: { leftType: "bootswatch_skin", types: ["css", "scss"] },
};

export async function listItemTypeConstraints(
  driver: SQLDatabaseDriver,
  cardName: string,
): Promise<readonly string[] | undefined> {
  const name = DeckoName.parse(cardName);
  if (name.leftName === undefined || name.rightName === undefined) return undefined;
  const rightId = await cardIdByName(driver, name.rightName);
  if (rightId === undefined) return undefined;
  const right = (await driver.query<{ codename: string | null }>(
    "SELECT codename FROM cards WHERE id = ? AND trash = 0", [rightId],
  )).rows[0];
  const override = right?.codename == null ? undefined : LIST_ITEM_TYPE_OVERRIDES[right.codename];
  if (override === undefined) return undefined;
  const left = await cardRowByName(driver, name.leftName);
  return left?.type_codename === override.leftType ? override.types : undefined;
}

function toSentence(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function eventItemNames(card: ModEventCard): string[] {
  return rawItemStrings(card.dbContent ?? "").map((item) =>
    DeckoName.parse(item).absoluteName(card.name).s,
  );
}

async function cardRowByName(
  driver: SQLDatabaseDriver,
  name: DeckoName,
): Promise<
  | { id: number; name: string | null; type_codename: string | null; type_name: string | null }
  | undefined
> {
  const shape =
    "SELECT c.id AS id, c.name, t.codename AS type_codename, t.name AS type_name " +
    "FROM cards c LEFT JOIN cards t ON t.id = c.type_id ";
  if (name.isSimple || name.leftName === undefined || name.rightName === undefined) {
    return (
      await driver
        .query<{
          id: number;
          name: string | null;
          type_codename: string | null;
          type_name: string | null;
        }>(shape + "WHERE c.key = ? AND c.trash = 0 LIMIT 1", [name.key])
        .catch(() => undefined)
    )?.rows[0];
  }
  const rightId = await cardIdByName(driver, name.rightName);
  const leftId = await cardIdByName(driver, name.leftName);
  if (rightId === undefined || leftId === undefined) return undefined;
  return (
    await driver
      .query<{
        id: number;
        name: string | null;
        type_codename: string | null;
        type_name: string | null;
      }>(shape + "WHERE c.left_id = ? AND c.right_id = ? AND c.trash = 0 LIMIT 1", [leftId, rightId])
      .catch(() => undefined)
  )?.rows[0];
}

async function cardIdByName(driver: SQLDatabaseDriver, name: DeckoName): Promise<number | undefined> {
  if (name.isSimple || name.leftName === undefined || name.rightName === undefined) {
    const row = (
      await driver
        .query<{ id: number }>("SELECT id FROM cards WHERE key = ? AND trash = 0 LIMIT 1", [name.key])
        .catch(() => undefined)
    )?.rows[0];
    return row?.id;
  }
  return (await cardRowByName(driver, name))?.id;
}

async function itemFacts(
  driver: SQLDatabaseDriver,
  itemName: string,
): Promise<{ name: string; typeCode: string; typeName: string }> {
  const row = await cardRowByName(driver, DeckoName.parse(itemName));
  if (row === undefined) {
    const typeId = await resolveTypeId(new FetchEngine(driver), { name: itemName });
    const type = (await driver.query<{ name: string; codename: string | null }>(
      "SELECT name, codename FROM cards WHERE id = ? AND trash = 0", [typeId],
    )).rows[0];
    if (type === undefined) throw new Error(`List item type ${typeId} is missing`);
    return { name: itemName, typeCode: type.codename ?? "", typeName: type.name };
  }
  return {
    name: row.name ?? itemName,
    typeCode: row.type_codename ?? "basic",
    typeName: row.type_name ?? row.type_codename ?? "Basic",
  };
}

async function codenameCardNames(driver: SQLDatabaseDriver, codenames: readonly string[]): Promise<string[]> {
  return Promise.all(
    codenames.map(async (codename) => {
      const row = (
        await driver
          .query<{ name: string }>(
            "SELECT name FROM cards WHERE codename = ? AND trash = 0 LIMIT 1",
            [codename],
          )
          .catch(() => undefined)
      )?.rows[0];
      return row?.name ?? codename;
    }),
  );
}

const validateItemType: ModEventFn = async (card, _host, ctx) => {
  const driver = ctx?.driver;
  if (driver === undefined) {
    return;
  }
  const okTypes = await listItemTypeConstraints(driver, card.name);
  if (okTypes === undefined || okTypes.length === 0) return;
  const allowedNames = await codenameCardNames(driver, okTypes);
  const messages: string[] = [];
  for (const itemName of eventItemNames(card)) {
    const item = await itemFacts(driver, itemName);
    if (okTypes.includes(item.typeCode)) continue;
    messages.push(
      `${item.name} has an invalid type: ${item.typeName}. ` +
        `Allowed types: ${toSentence(allowedNames)}.`,
    );
  }
  if (messages.length > 0) addValidationErrors(card.name, "content", messages);
};

const validateItemUniqueness: ModEventFn = async (card) => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const name of eventItemNames(card)) {
    if (!seen.has(name)) {
      seen.add(name);
      continue;
    }
    if (!dupes.includes(name)) dupes.push(name);
  }
  if (dupes.length > 0) {
    addValidationErrors(card.name, "content", [
      `duplicate item names: ${toSentence(dupes)}`,
    ]);
  }
};

const VIEW_LIST_ITEM_VIEWS = ["bar", "box", "closed", "titled", "labeled"] as const;

const viewListView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!listFamilyCard(fmt)) {
    throw new UnsupportedViewError("view_list", fmt.card.name.s);
  }
  return VIEW_LIST_ITEM_VIEWS.map((view) => {
    const content = fmt.renderView("content", { items: { view } });
    return `<p><h3>${view} items</h3>\n${content}</p>`;
  }).join("\n");
};

const listJsonLinksView: ViewFn = () => [];

export const listModEventPredicates = {
  item_to_insert: (card: ModEventCard): boolean =>
    card.params?.["insert_item"] !== undefined && card.params?.["insert_item"] !== null,
  "validate_item_type?": (card: ModEventCard): boolean => card.hasOkItemTypes === true,
} as const;

const cardModList: DeckoModManifest = {
  name: "list",
  gemName: "card-mod-list",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/01_list",
      formats: {
        html: {
          views: [{ view: "view_list", viewFn: viewListView }],
        },
      },
    },
    {
      setPath: "abstract/01_list/events",
      events: [
        {
          event: "add_and_drop_items",
          at: "prepare_to_validate",
          on: ["save"],
          fn: addAndDropItems,
        },
        {
          event: "insert_item_event",
          at: "prepare_to_validate",
          on: ["save"],
          when: "item_to_insert",
          fn: insertItemEvent,
        },
        {
          event: "validate_item_type",
          at: "validate",
          on: ["save"],
          when: "validate_item_type?",
          fn: validateItemType,
        },
        {
          event: "validate_item_uniqueness",
          at: "validate",
          on: ["save"],
          when: "unique_items?",
          fn: validateItemUniqueness,
        },
      ],
    },
    {
      setPath: "abstract/01_list/html_views",
      formats: {
        html: {
          views: [
            {
              view: "one_line_content",
              viewFn: oneLineContentView,
              config: { unknown: "mini_unknown" },
            },
            {
              view: "list",
              viewFn: listView,
              config: { cache: "never" },
            },
            {
              view: "checkbox",
              viewFn: checkboxView,
            },
            {
              view: "radio",
              viewFn: radioView,
            },
            {
              view: "select",
              viewFn: selectView,
            },
            {
              view: "multiselect",
              viewFn: multiselectView,
            },
            {
              view: "autocomplete",
              viewFn: autocompleteView,
            },
            {
              view: "input",
              viewFn: inputView,
              config: { unknown: true, cache: "never" },
            },
          ],
        },
      },
    },
    {
      setPath: "abstract/01_list/other_views",
      formats: {
        json: {
          views: [{ view: "links", viewFn: listJsonLinksView }],
        },
      },
    },
    {
      setPath: "abstract/codename_list",
    },
    {
      setPath: "abstract/delist",
      events: [
        {
          event: "delist",
          at: "prepare_to_store",
          on: ["delete"],
          fn: delistEvent,
        },
      ],
    },
    {
      setPath: "abstract/id_list",
    },
    {
      setPath: "abstract/reference_list",
    },
    {
      setPath: "all/supports_content_options",
    },
    {
      setPath: "right/content_option_view",
    },
    {
      setPath: "right/content_options",
    },
    {
      setPath: "self/content_option_view",
      settingOpts: {
        group: "editing",
        position: 6,
        ruleTypeEditable: false,
        helpText:
          "Label view for radio button and checkbox items.  " +
          "[[http://decko.org/Pointer|more]]",
        restrictedToType: ["list", "pointer", "session"],
      },
    },
    {
      setPath: "self/content_options",
      settingOpts: {
        group: "editing",
        position: 5,
        ruleTypeEditable: true,
        helpText:
          "Value options for [[List]] and [[Pointer]] and cards. " +
          "Can itself be a List or a [[Search]]. " +
          "[[http://decko.org/Pointer|more]]",
        restrictedToType: ["list", "pointer", "session"],
      },
    },
    {
      setPath: "self/input_type/right/content_options",
    },
    {
      setPath: "type/link_list",
      formats: {
        html: {
          views: [{ view: "input", viewFn: inputView, config: { unknown: true, cache: "never" } }],
        },
      },
    },
    {
      setPath: "type/list",
    },
    {
      setPath: "type/nest_list",
      formats: {
        html: {
          views: [
            {
              view: "nest_list_input",
              viewFn: nestListInputView,
              config: { cache: "never" },
            },
            { view: "input", viewFn: inputView, config: { unknown: true, cache: "never" } },
          ],
        },
      },
    },
    {
      setPath: "type/pointer",
    },
  ],
  prepareEngine: prepareListRules,
};

export default cardModList;
