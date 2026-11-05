import { NEW_FIELDS_SENTINEL, updateFormDataShell } from "./card-mod-edit.js";
import { str } from "../../render/format.js";

import type { ViewFn, ViewContext } from "../../render/format.js";
import { DeckoName } from "../../name.js";
import { stripTags } from "../../render/nest-syntax.js";
import { h } from "../../render/slot-html.js";
import { modViewSlotWrap } from "../../render/views.js";
import { modSlotWrap } from "../mod-view-helpers.js";
import {
  buttonFormGroup,
  standardSaveButtonBody,
} from "../mod-form-substrate.js";
import { createFormDataShell } from "./card-mod-edit.js";
import type { DeckoModManifest } from "../mod-manifest.js";

export const NEST_OPTIONS = [
  "view",
  "title",
  "show",
  "hide",
  "wrap",
  "help",
  "variant",
  "size",
  "params",
] as const;

export type NestOptionKey = (typeof NEST_OPTIONS)[number];
export type NestOptionPair = [string, string];

export class NestSyntaxError extends Error {
  constructor(reason: string, raw: string) {
    super(`${reason}: ${JSON.stringify(raw)}`);
    this.name = "NestSyntaxError";
  }
}

interface OptionLevel {
  [key: string]: string | OptionLevel | undefined;
}

export class NestParser {
  raw: string;
  field: boolean;
  name: string | undefined;
  view: string | undefined;
  options: NestOptionPair[];
  itemOptions: NestOptionPair[][];

  private constructor(
    raw: string,
    field: boolean,
    name: string | undefined,
    view: string | undefined,
    options: NestOptionPair[],
    itemOptions: NestOptionPair[][],
  ) {
    this.raw = raw;
    this.field = field;
    this.name = name;
    this.view = view;
    this.options = options;
    this.itemOptions = itemOptions;
  }

  static defaultSnippet(): NestParser {
    return new NestParser("{{+ }}", true, "", undefined, [], []);
  }

  static newImage(name: string): NestParser {
    return new NestParser(
      `{{${name}|view: content; size: medium}}`,
      false,
      name,
      "content",
      [["size", "medium"]],
      [],
    );
  }

  static parse(nestString: string): NestParser {
    const match = /^\{\{([^{}]*)\}\}/.exec(nestString);
    if (match === null) {
      throw new NestSyntaxError(
        "undefined method '[]' for nil: the nest chunk full_re does not match",
        nestString,
      );
    }
    const inBrackets = stripTags(match[1] ?? "");
    const pipe = inBrackets.indexOf("|");
    const name = (pipe === -1 ? inBrackets : inBrackets.slice(0, pipe)).trim();
    if (name.startsWith("#")) {
      throw new NestSyntaxError(
        "undefined method '[]' for nil: the comment-nest chunk has no options",
        nestString,
      );
    }
    const optLists = pipe === -1 ? undefined : inBrackets.slice(pipe + 1);
    return NestParser.buildFromParts(nestString, name, parseOptionChain(optLists));
  }

  private static buildFromParts(
    raw: string,
    chunkName: string,
    top: OptionLevel,
  ): NestParser {
    const fieldName = DeckoName.parse(chunkName);
    const field = fieldName.isSimpleRelative;
    const name = field ? chunkName.slice(1) : chunkName;
    const parser = new NestParser(raw, field, name, undefined, [], []);
    parser.options = parser.extractOptions(top, false);
    let cursor: string | OptionLevel | undefined = top.items;
    while (cursor !== undefined) {
      if (typeof cursor === "string") {
        throw new NestSyntaxError(
          "TypeError: no implicit conversion of Symbol into Integer (a string items: value)",
          raw,
        );
      }
      parser.itemOptions.push(parser.extractOptions(cursor, true));
      cursor = cursor.items;
    }
    return parser;
  }

  private static applicableOptions(level: OptionLevel): NestOptionKey[] {
    return NEST_OPTIONS.filter((key) => level[key] !== undefined);
  }

  private static vizValues(key: string, value: string): NestOptionPair[] {
    return value.split(/[\s,]+/).map((val) => [key, val]);
  }

  private extractOptions(level: OptionLevel, itemOptions: boolean): NestOptionPair[] {
    const res: NestOptionPair[] = [];
    for (const key of NestParser.applicableOptions(level)) {
      const value = level[key] as string;
      if (key === "show" || key === "hide") {
        res.push(...NestParser.vizValues(key, value));
      } else if (key === "view" && !itemOptions) {
        this.view = value;
      } else {
        res.push([key, value]);
      }
    }
    return res;
  }

  isEmpty(): boolean {
    return this.raw === "" || /\{\{+?\s*\|?\s*\}\}/.test(this.raw);
  }

  fieldBang(): void {
    this.raw = this.raw.replace(/\{\{\s*\+?/, "{{+");
    this.field = true;
  }

  optionValue(name: string): string | undefined {
    return this.options.find(([key]) => key === name)?.[1];
  }
}

const SHARK_KEYS: ReadonlySet<string> = new Set([
  "view", "nest_name", "nest_syntax", "wrap", "show", "hide", "unknown",
  "help", "structure", "title", "variant", "joint", "input_type", "type",
  "size", "header", "items", "cache", "edit", "separator", "filter", "params",
]);
const DEFAULT_OPTION = "view";

function* eachOption(attrString: string | undefined): Generator<[string, string]> {
  if (attrString === undefined || attrString.trim() === "") return;
  for (const pair of attrString.trim().split(";")) {
    const colon = pair.indexOf(":");
    const value = (colon === -1 ? pair : pair.slice(colon + 1)).trim();
    const key = colon === -1 ? DEFAULT_OPTION : pair.slice(0, colon).trim();
    yield [key, value];
  }
}

function optionStringToHash(listString: string | undefined, hash: OptionLevel): void {
  for (const [key, value] of eachOption(listString)) {
    if (key === "item") {
      const items = (hash.items ?? {}) as OptionLevel;
      items.view = value;
      hash.items = items;
    } else if (SHARK_KEYS.has(key)) {
      hash[key] = value;
    }
  }
}

function interpretPipedOptions(listString: string, items: OptionLevel | undefined): OptionLevel {
  const hash: OptionLevel = items === undefined ? {} : { items };
  optionStringToHash(listString, hash);
  return hash;
}

function interpretOptions(optLists: string | undefined): OptionLevel {
  if (optLists === undefined) return {};
  const rawOptions = optLists.split("|").reverse();
  let level: OptionLevel | undefined;
  for (const levelOptions of rawOptions) {
    level = interpretPipedOptions(levelOptions, level);
  }
  return level ?? {};
}

function parseOptionChain(optLists: string | undefined): OptionLevel {
  return interpretOptions(optLists);
}

export class LinkParser {
  readonly raw: string;
  field: boolean;
  name: string | undefined;
  readonly options: { title?: string };

  private constructor(
    raw: string,
    field: boolean,
    name: string | undefined,
    options: { title?: string },
  ) {
    this.raw = raw;
    this.field = field;
    this.name = name;
    this.options = options;
  }

  static defaultSnippet(): LinkParser {
    return new LinkParser("[[ ]]", false, "", {});
  }

  static parse(linkString: string): LinkParser {
    const match = /^\[\[([^\]]+)\]\]/.exec(linkString);
    if (match === null) {
      throw new NestSyntaxError(
        "undefined method '[]' for nil: the link chunk full_re does not match",
        linkString,
      );
    }
    const rawSyntax = match[1] ?? "";
    let target: string | undefined = rawSyntax;
    let linkText: string | undefined;
    const masked = rawSyntax.replace(/\{\{[^}]*\}\}/g, (incl) => "x".repeat(incl.length));
    const pipe = masked.indexOf("|");
    if (pipe !== -1) {
      target = rawSyntax.slice(0, pipe);
      linkText = rawSyntax.slice(pipe + 1);
    }
    const strip = (s: string | undefined): string | undefined =>
      s === undefined ? undefined : s.trim();
    const targetStr = strip(target);
    const isExplicit =
      targetStr !== undefined && /^(?:\/|https?:|mailto:)/.test(targetStr);
    const chunkName = isExplicit ? undefined : targetStr;
    const title =
      strip(linkText) ?? DeckoName.parse(chunkName ?? "").fullyStripped.s;
    const parser = new LinkParser(linkString, false, chunkName, { title });
    parser.field = DeckoName.parse(chunkName ?? "").isSimpleRelative;
    parser.name = parser.field ? (chunkName ?? "").slice(1) : chunkName;
    return parser;
  }

  get title(): string | undefined {
    return this.options.title;
  }
}

const CLOSE_ICON = '<i class="notranslate material-icons">close</i>';

function isModalEditorMode(editorMode: "overlay" | "modal"): boolean {
  return editorMode !== "overlay";
}

function linkEditorPartial(snippet: LinkParser): string {
  const prefixClass = snippet.field ? "show-prefix" : "hide-prefix";
  const linkNameValue =
    snippet.name !== undefined ? ` value="${h(snippet.name)}"` : "";
  const fieldChecked = snippet.field ? " checked=\"checked\"" : "";
  const linkTitleValue =
    snippet.title !== undefined ? ` value="${h(snippet.title)}"` : "";
  return (
    `<div class='row align-items-center mb-4 ms-1'>\n` +
    `<div class='col-9'>\n` +
    `<div class='${prefixClass} input-group'>\n` +
    `<div class='input-group-text text-muted _field-indicator'>\n` +
    `+\n` +
    `</div>\n` +
    `<input type="text" name="link_name" id="link_name"${linkNameValue} class="form-control _link-target _autocomplete" placeholder="URL or Card name" data-options-card="*all+by name" />\n` +
    `</div>\n` +
    `</div>\n` +
    `<div class='col-3'>\n` +
    `<input type="checkbox" name="field" id="link-editor-field" value="field"${fieldChecked} class="_link-field-toggle" />\n` +
    `<label class='form-check-label' for='link-editor-field'>field</label>\n` +
    `</div>\n` +
    `</div>\n` +
    `<div class='row align-items-center mb-4 ms-1 me-1'>\n` +
    `<div class='col-12'>\n` +
    `<label class='form-check-label' for='link_title'>Text to display</label>\n` +
    `<input type="text" name="link_title" id="link_title"${linkTitleValue} class="form-control _link-title" />\n` +
    `</div>\n` +
    `</div>\n`
  );
}

function linkEditorChrome(_ctx: ViewContext, editorMode: "overlay" | "modal", tinymceId?: string): string {
  const modal = isModalEditorMode(editorMode);
  const snippet = LinkParser.defaultSnippet();
  const applyLabel = modal ? "Apply and Close" : "Apply";
  const cancelLabel = modal ? "Cancel" : "Close";
  const applyDismiss = modal ? ` data-bs-dismiss="modal"` : "";
  const tinymceAttr = tinymceId === undefined ? "" : ` data-tinymce-id="${h(tinymceId)}"`;
  return (
    `<div class='_nest-editor'>\n` +
    `<div class='card-header d-flex'>\n` +
    `<h5 class='mt-1'>\n` +
    `Link\n` +
    `</h5>\n` +
    `<div class='ms-auto'>\n` +
    `<a data-bs-dismiss="${editorMode}" class="text-dark p-1 ms-1" href="#">${CLOSE_ICON}</a>\n` +
    `</div>\n` +
    `</div>\n` +
    `<div class='card-body'>\n` +
    `<div class='form'>\n` +
    linkEditorPartial(snippet) +
    `\n</div>\n` +
    `</div>\n` +
    `<div class='card-footer p-0'>\n` +
    `<div class='preview mx-1 my-1 form-control-feedback'>\n` +
    `Syntax preview\n` +
    `<input type="text" name="preview" id="preview" value="${h(snippet.raw)}" class="_link-preview w-100 text-muted" readonly="readonly" />\n` +
    `</div>\n` +
    `<hr class='mt-1 mb-1'>\n` +
    `<div class='form-group-inline d-flex justify-content-center py-3'>\n` +
    `<button name="button" type="submit"${tinymceAttr}${applyDismiss} class="_link-apply btn-sm me-3 btn btn-primary">${applyLabel}</button>\n` +
    `<a class='border-light text-dark btn btn-sm btn-secondary' data-bs-dismiss='${editorMode}' href='#'>\n` +
    `${cancelLabel}\n` +
    `</a>\n` +
    `</div>\n` +
    `</div>\n` +
    `</div>\n`
  );
}

const linkEditorView: ViewFn = (ctx) =>
  modViewSlotWrap(
    ctx,
    "link_editor",
    "_overlay d0-card-overlay card nodblclick",
    linkEditorChrome(ctx, "overlay", ctx.fmt.engine.requestEditorParams?.tinymce_id),
  );

const modalLinkEditorView: ViewFn = (ctx) =>
  modViewSlotWrap(
    ctx,
    "modal_link_editor",
    "nodblclick",
    `<modal>${linkEditorChrome(ctx, "modal", ctx.fmt.engine.requestEditorParams?.tinymce_id)}</modal>`,
  );

function tinymceId(): string {
  return '$(".tinymce-textarea").attr("id")';
}

const changeCreateToUpdateView: ViewFn = () =>
  `nest.changeCreateToUpdate(${tinymceId()});`;

const openNestEditorView: ViewFn = (ctx) =>
  `tm = tinymce.get(${tinymceId()});\n` +
  `nest.insertNest(tm, "{{+${ctx.fmt.card.name.tag}|view: content; size: medium}}");\n`;

const TINYMCE_HELP_TEXT =
  "    Configure [[http://tinymce.com|TinyMCE]], Decko's default\n" +
  "    [[http://en.wikipedia.org/wiki/Wysiwyg|wysiwyg]] editor.\n" +
  "    [[http://decko.org/TinyMCE|more]]\n";

const newImageButtonsView: ViewFn = (ctx) =>
  buttonFormGroup(
    ctx,
    standardSaveButtonBody(ctx, [["no_origin_update", "true"]]) ?? "",
  );

const NEST_VIEW_LIST = [
  "content",
  "titled",
  "labeled",
  "bar",
  "box",
  "open",
  "closed",
] as const;

const NEST_ALL_VIEWS: readonly string[] = [
  "accordion_bar", "act", "act_legend", "acted_at", "action_expanded", "action_summary",
  "add_autocomplete_item", "bad_address", "bar", "bar_body", "bar_bottom", "bar_left",
  "bar_menu", "bar_middle", "bar_right", "blank", "board", "board_act", "board_link",
  "board_type_formgroup", "box", "box_bottom", "box_middle", "box_top", "card_select",
  "cardboard", "carousel", "change", "close_modal_link", "closed", "closed_bar",
  "closed_content", "codename", "comment_box", "compact_missing", "conflict",
  "conflict_tracker", "content", "content_formgroup", "content_formgroups",
  "content_panel", "content_with_title", "core", "count", "created_at",
  "creator_credit", "debug_server_error", "demo", "denial", "draft_legend", "edit",
  "edit_button", "edit_buttons", "edit_form", "edit_in_form", "edit_inline",
  "edit_inline_buttons", "edit_link", "edit_name", "edit_name_row", "edit_nests",
  "edit_row", "edit_rules", "edit_structure", "edit_type", "edit_type_form",
  "edit_type_row", "email_page", "engage_tab", "errors", "expanded_bar",
  "favicon_tag", "flash", "follow_button", "follow_section", "followed",
  "follower", "full_bar", "full_page_link", "goto_autocomplete_item", "guide",
  "guide_tab", "head", "header", "header_title", "help", "help_link", "help_text",
  "hidden_content_field", "history", "history_tab", "icons", "id", "id_url",
  "input", "javascript_include_tag", "javascript_tags", "just_deleted", "key",
  "label", "labeled", "labeled_content", "last_action", "last_action_verb",
  "lead", "link", "link_editor", "linkname", "list_of_changes", "menu",
  "menu_block", "meta_tags", "mini_bar", "mini_unknown", "modal", "modal_footer",
  "modal_link", "modal_link_editor", "modal_menu", "modal_nest_editor",
  "modal_nest_image", "modal_title", "name", "name_form", "name_formgroup",
  "nav_item", "nav_link", "nav_link_in_dropdown", "navbar_links", "nest_content",
  "nest_editor", "nest_image", "new", "new_buttons", "new_fields", "new_image",
  "new_image_buttons", "new_in_modal", "new_in_modal_buttons",
  "new_type_formgroup", "not_found", "one_line_content", "open", "open_bar",
  "open_content", "overlay_guide", "overlay_header", "overlay_help_link",
  "overlay_menu", "overlay_title", "page_title", "page_title_tag", "pills",
  "pills_static", "pop_out_modal_link", "raw", "raw_one_line_content",
  "read_form", "read_formgroup", "related_tab", "rss_links", "rules_tab",
  "script_calls", "script_variables", "server_error", "short_content",
  "simple_new", "smart_label", "stylesheet_tags", "subedit_notice", "subedits",
  "tabs", "tabs_static", "template_nest", "text_without_nests", "title",
  "title_link", "title_no_link", "titled", "titled_content", "type",
  "type_formgroup", "type_info", "unfollow_url", "universal_edit_button",
  "unknown", "updated_at", "updated_by", "url", "url_link", "view_list",
];

const MATERIAL_ICONS: Record<string, string> = {
  close: "close",
  help: "help",
  remove: "close",
};

function materialIcon(key: string): string {
  return `<i class="notranslate material-icons">${MATERIAL_ICONS[key] ?? key}</i>`;
}

export interface ChromeContext {
  cardName: string;
  cardKey: string;
  leftType: string;
  idCounter: { n: number };
  nest: (target: string, view: string, opts?: Record<string, unknown>) => string;
  forceShowContentTab: () => void;
  wrap: () => string;
}

function railsTag(
  tag: string,
  attrs: Array<[string, string | undefined]>,
  content: string,
): string {
  const rendered = attrs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`);
  return `<${tag}${rendered.join("")}>${content}</${tag}>`;
}

function railsTextFieldTag(
  name: string,
  value: string | undefined,
  opts: Array<[string, string | undefined]>,
): string {
  const attrs: Array<[string, string | undefined]> = [
    ["type", "text"],
    ["name", name],
    ["id", name],
  ];
  if (value !== undefined) attrs.push(["value", value]);
  attrs.push(...opts);
  return railsTag("input", attrs, "").replace("></input>", " />");
}

function railsSelectTag(
  name: string,
  optionList: ReadonlyArray<string | undefined>,
  opts: Array<[string, string | undefined]>,
  selected?: string | undefined,
): string {
  const attrs: Array<[string, string | undefined]> = [
    ["name", name],
    ["id", name],
    ...opts,
  ];
  const attrStr = attrs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  const options = optionList
    .map((v) =>
      v === undefined
        ? `<option value=""></option>`
        : `<option${v === selected ? ` selected="selected"` : ""} value="${h(v)}">${h(v)}</option>`,
    )
    .join("\n");
  return `<select${attrStr}>${options}</select>`;
}

function helpLink(text: string, title: string): string {
  const cls = "help-link ps-1 _popover_link _card-menu-popover";
  return (
    `<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus"` +
    ` data-bs-content="${h(text)}" data-bs-placement="left" class="${cls}"` +
    ` data-bs-title="${h(title)}" href="#">${materialIcon("help")}</a>`
  );
}

function applyButton(
  applyOpts: Array<[string, string | undefined]>,
  refType: string,
  modal: boolean,
): string {
  const label = modal ? "Apply and Close" : "Apply";
  const attrs: Array<[string, string | undefined]> = [
    ["name", "button"],
    ["type", "submit"],
    ...applyOpts,
  ];
  if (modal) attrs.push(["data-bs-dismiss", "modal"]);
  attrs.push(["class", `_${refType}-apply btn-sm me-3 btn btn-primary`]);
  return `<button${attrs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${h(v!)}"`)
    .join("")}>${label}</button>`;
}

function referenceEditorChrome(
  args: {
    title: string;
    editorMode: "overlay" | "modal";
    refType: string;
    partial: string;
    applyOpts: Array<[string, string | undefined]>;
    snippetRaw: string;
    closesAfterPartial: 1 | 2;
  },
): string {
  const modal = args.editorMode !== "overlay";
  const out: string[] = [];
  out.push(`<div class='_nest-editor'>`);
  out.push(`<div class='card-header d-flex'>`);
  out.push(`<h5 class='mt-1'>`);
  out.push(h(args.title));
  out.push(`</h5>`);
  out.push(`<div class='ms-auto'>`);
  out.push(
    `<a data-bs-dismiss="${args.editorMode}" class="text-dark p-1 ms-1" href="#">${materialIcon("close")}</a>`,
  );
  out.push(`</div>`);
  out.push(`</div>`);
  out.push(`<div class='card-body'>`);
  out.push(`<div class='form'>`);
  out.push(args.partial);
  for (let i = 0; i < args.closesAfterPartial; i += 1) out.push(`</div>`);
  out.push(`<div class='card-footer p-0'>`);
  out.push(`<div class='preview mx-1 my-1 form-control-feedback'>`);
  out.push(`Syntax preview`);
  out.push(
    railsTextFieldTag("preview", args.snippetRaw, [
      ["class", `_${args.refType}-preview w-100 text-muted`],
      ["readonly", "readonly"],
    ]),
  );
  out.push(`</div>`);
  out.push(`<hr class='mt-1 mb-1'>`);
  out.push(`<div class='form-group-inline d-flex justify-content-center py-3'>`);
  out.push(applyButton(args.applyOpts, args.refType, modal));
  out.push(
    `<a class='border-light text-dark btn btn-sm btn-secondary' data-bs-dismiss='${args.editorMode}' href='#'>`,
  );
  out.push(modal ? "Cancel" : "Close");
  out.push(`</a>`);
  out.push(`</div>`);
  out.push(`</div>`);
  out.push(`</div>`);
  return out.join("\n") + "\n";
}

function nestOptionNameSelect(
  ctx: ChromeContext,
  opts: {
    selected?: string;
    level: number;
    includeViewOption: boolean;
    template: boolean;
    snippet: NestParser;
  },
): string {
  let cls = "form-control _nest-option-name";
  if (opts.selected === undefined) cls += " _new-row";
  if (opts.template) cls += " _no-select2";
  const uid = `${ctx.cardKey}-${(ctx.idCounter.n += 1)}`;
  const names = [
    "",
    ...(opts.includeViewOption ? ["view" as const] : []),
    ...NEST_OPTION_NAMES,
  ];
  const disabled = (opts.level === 0
    ? opts.snippet.options
    : (opts.snippet.itemOptions[opts.level - 1] ?? [])
  ).map(([k]) => k).filter((k) => k !== opts.selected);
  const attrStr = ` name="nest_option_name_${uid}" id="nest_option_name_${uid}"`.replace(
    / id="[^"]*"/,
    "",
  );
  const options = names
    .map((v) =>
      v === ""
        ? `<option value=""></option>`
        : `<option${v === opts.selected ? ` selected="selected"` : ""}${disabled.includes(v) ? ` disabled="disabled"` : ""} value="${v}">${v}</option>`,
    )
    .join("\n");
  return `<select${attrStr} class="${cls}" data-placeholder="Select option">${options}</select>`;
}

const NEST_OPTION_NAMES = [
  "title",
  "show",
  "hide",
  "wrap",
  "help",
  "variant",
  "size",
  "params",
] as const;

function nestOptionValueSelect(value: string | undefined): string {
  const attrs: Array<[string, string | undefined]> = [
    ["type", "text"],
    ["name", "value"],
    ["value", value],
    ["class", "_nest-option-value form-control"],
    ["disabled", value ? undefined : "disabled"],
  ];
  return `<input${attrs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("")} />`;
}

function optionsSelectRow(
  ctx: ChromeContext,
  opts: {
    template: boolean;
    name?: string;
    level: number;
    value?: string;
    viewSelectable: boolean;
    snippet: NestParser;
  },
): string {
  const rowCls = `${opts.template ? "_template " : ""}row _nest-option-row`;
  const btnCls = `${opts.name === undefined ? "d-none " : ""}btn btn-secondary input-group-text p-1 _nest-delete-option`;
  const out: string[] = [];
  out.push(`<div class='${rowCls}'>`);
  out.push(`<div class='col-6'>`);
  out.push(`<div class='input-group mb-2 me-2 d-flex flex-nowrap'>`);
  out.push(`<button class='${btnCls}' type='button'>`);
  out.push(`<small class='text-muted'>`);
  out.push(materialIcon("remove"));
  out.push(`</small>`);
  out.push(`</button>`);
  out.push(
    nestOptionNameSelect(ctx, {
      selected: opts.name,
      level: opts.level,
      includeViewOption: opts.viewSelectable,
      template: opts.template,
      snippet: opts.snippet,
    }),
  );
  out.push(`</div>`);
  out.push(`</div>`);
  out.push(`<div class='col-6 _nest-option-value-col'>`);
  out.push(nestOptionValueSelect(opts.value));
  out.push(`</div>`);
  out.push(`</div>`);
return out.join("\n");
}

function optionsSelect(
  ctx: ChromeContext,
  opts: {
    template: boolean;
    level: number;
    data: ReadonlyArray<readonly [string, string]>;
    viewSelectable: boolean;
    snippet: NestParser;
  },
): string {
  const rows: string[] = [];
  for (const [name, value] of opts.data) {
    rows.push(
      optionsSelectRow(ctx, {
        template: false,
        name,
        level: opts.level,
        value,
        viewSelectable: opts.viewSelectable,
        snippet: opts.snippet,
      }),
    );
  }
  rows.push(
    optionsSelectRow(ctx, {
      template: opts.template,
      level: opts.level,
      viewSelectable: opts.viewSelectable,
      snippet: opts.snippet,
    }),
  );
  if (!opts.template) {
    rows.push(
      optionsSelectRow(ctx, {
        template: true,
        level: opts.level,
        viewSelectable: opts.viewSelectable,
        snippet: opts.snippet,
      }),
    );
  }
  return `<div class='${opts.template ? "_template " : ""}_options-select'>\n${rows.join("\n\n")}\n\n</div>`;
}

function sizeSelectOptions(selected = "medium"): string {
  return railsSelectTag(
    "size",
    ["icon", "small", "medium", "large", "original"],
    [],
    selected,
  );
}

function templatesBlock(): string {
  const out: string[] = [];
  out.push(`<div class='_templates d-none'>`);
  out.push(
    `<input type="text" name="value" class="_nest-option-template-default _nest-option-value form-control" />`,
  );
  out.push(
    railsTag(
      "div",
      [["class", "_nest-option-template-size"]],
      railsSelectTag("size", ["icon", "small", "medium", "large", "original"], [
        ["class", "_no-select2 _nest-option-value form-control"],
      ], "medium"),
    ),
  );
  out.push(
    railsTag(
      "div",
      [["class", "_nest-option-template-view"]],
      railsSelectTag("size", [...NEST_VIEW_LIST], [
        ["class", "_no-select2 _nest-option-value form-control"],
      ]),
    ),
  );
  out.push(
    railsTag(
      "div",
      [["class", "_nest-option-template-show _nest-option-template-hide"]],
      railsSelectTag("size", [...NEST_ALL_VIEWS], [
        ["class", "_no-select2 _nest-option-value form-control"],
      ]),
    ),
  );
  out.push(`</div>`);
  return out.join("\n");
}

function optionsPartial(ctx: ChromeContext, snippet: NestParser): string {
  const out: string[] = [];
  out.push(`<div class='_nest-options'>`);
  out.push(`<div class='options-container'>`);
  out.push(`<label>Options</label>`);
  out.push(
    optionsSelect(ctx, {
      template: false,
      level: 0,
      data: snippet.options,
      viewSelectable: false,
      snippet,
    }),
  );
  out.push("");
  out.push(`</div>`);
  snippet.itemOptions.forEach((options, i) => {
    out.push(`<div class='options-container _configure-items'>`);
    out.push(`<label>`);
    out.push(cap(`${"sub".repeat(i)} item options`));
    out.push(`</label>`);
    out.push(
      optionsSelect(ctx, {
        template: false,
        level: i + 1,
        data: options,
        viewSelectable: true,
        snippet,
      }),
    );
    out.push("");
    out.push(`</div>`);
  });
  out.push(`<div class='options-container _configure-items'>`);
  out.push(
    `<button name="button" type="submit" class="_configure-items-button btn-sm btn btn-secondary">Add ${"sub".repeat(snippet.itemOptions.length)}item options</button>`,
  );
  out.push(
    optionsSelect(ctx, {
      template: true,
      level: snippet.itemOptions.length + 1,
      data: [],
      viewSelectable: true,
      snippet,
    }),
  );
  out.push("");
  out.push(`</div>`);
  out.push(templatesBlock());
  out.push(`</div>`);
  return out.join("\n") + "\n";
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function imageFindPartial(): string {
  const out: string[] = [];
  out.push(`<div class='form-group'>`);
  out.push(`<label for='nest_name'>Name</label>`);
  out.push(helpLink("Hello", "World"));
  out.push("");
  out.push(
    `<select name="image-name-select" id="image-name-select" class="_image-card-select _image-name _no-select2-init" data-dropdown-parent="true"></select>`,
  );
  out.push(`</div>`);
  return out.join("\n") + "\n";
}

function imageViewSelect(selected: string | undefined): string {
  return railsSelectTag(
    "view",
    [undefined, ...NEST_VIEW_LIST],
    [["class", "tags _image-view-select"], ["data-placeholder", "Select view"]],
    selected,
  );
}

function imageSizeSelect(): string {
  return railsSelectTag(
    "size",
    ["icon", "small", "medium", "large", "original"],
    [["class", "_image-size-select"]],
    "medium",
  );
}

function imageOptionsPartial(snippet: NestParser): string {
  const out: string[] = [];
  out.push(`<div class='form-group'>`);
  out.push(`<label>View</label>`);
  out.push(helpLink("World", "Hello"));
  out.push(imageViewSelect(snippet.view));
  out.push(`</div>`);
  out.push(`<div class='form-group'>`);
  out.push(`<label>Size</label>`);
  out.push(imageSizeSelect());
  out.push(`</div>`);
  return out.join("\n") + "\n";
}

function tabSafeKey(name: string): string {
  const table: Record<string, string> = { options: "option", rules: "rule" };
  return table[name] ?? name;
}

function tabsPanel(
  ctx: ChromeContext,
  tabHash: ReadonlyArray<readonly [string, string]>,
  activeName: string | undefined,
  args: { tabType: string; panelClass?: string; navClasses?: string },
): string {
  const entries = tabHash.map(([name, content]) => ({
    name,
    content,
    id: `tab-${ctx.cardKey}-${(ctx.idCounter.n += 1)}-${tabSafeKey(name)}`,
  }));
  const active = entries.some((e) => e.name === activeName)
    ? (activeName as string)
    : entries[0].name;
  const buttons = entries
    .map((e) =>
      railsTag(
        "li",
        [
          ["role", "presentation"],
          ["class", `nav-item tab-li-${tabSafeKey(e.name)}`],
        ],
        `<a class="${e.name === active ? "active " : ""}nav-link" role="tab" data-bs-toggle="tab" data-tab-name="${e.name}" href="#${e.id}">${e.name}</a>`,
      ),
    )
    .join("\n");
  const panes = entries
    .map((e) =>
      railsTag(
        "div",
        [
          ["role", "tabpanel"],
          ["id", e.id],
          ["class", `tab-pane tab-pane-${e.name}${e.name === active ? " active" : ""}`],
        ],
        e.content,
      ),
    )
    .join("\n");
  const panelAttrs = args.panelClass
    ? ` class='tabbable tab-panel ${args.panelClass}' role='tabpanel'`
    : ` class='tabbable tab-panel' role='tabpanel'`;
  return (
    `<div${panelAttrs}>\n` +
    `<ul class='${args.navClasses ?? "nav"} nav-${args.tabType}' role='tablist'>\n` +
    `${buttons}\n</ul>\n` +
    `<div class='tab-content'>\n` +
    `${panes}\n</div>\n` +
    `</div>`
  );
}

function nestEditorTabs(ctx: ChromeContext, snippet: NestParser): string {
  const rulesTab =
    snippet.name === ""
      ? `<div class="mb-0 _empty-nest-name-alert  alert alert-warning" role="alert">nest name required</div>\n<div class="card-slot"></div>`
      : `<div class="mb-0 _empty-nest-name-alert d-none alert alert-warning" role="alert">nest name required</div>\n${ctx.nest(`${ctx.leftType}+${snippet.name}+type_plus_right`, "nest_rules")}`;
  const tabHash: ReadonlyArray<readonly [string, string]> = [
    ["view", basicsPartial(ctx, snippet)],
    ["options", optionsPartial(ctx, snippet)],
    ["rules", rulesTab],
  ];
  return tabsPanel(ctx, tabHash, "basics", {
    tabType: "tabs",
    panelClass: "nest-options",
  });
}

function nestViewSelect(selected: string | undefined): string {
  return railsSelectTag(
    "view",
    [undefined, ...NEST_VIEW_LIST],
    [
      ["class", "tags _view-select _nest-option-value"],
      ["data-placeholder", "Select view"],
    ],
    selected,
  );
}

function basicsPartial(_ctx: ChromeContext, snippet: NestParser): string {
  const out: string[] = [];
  out.push(`<div class='form-group'>`);
  out.push(`<label>View</label>`);
  out.push(helpLink("World", "Hello"));
  out.push(nestViewSelect(snippet.view));
  out.push(`</div>`);
  return out.join("\n") + "\n";
}

function nestEditorPartial(ctx: ChromeContext, snippet: NestParser): string {
  const prefixClass = snippet.field ? "show-prefix" : "hide-prefix";
  const out: string[] = [];
  out.push(`<div class='form-group'>`);
  out.push(`<label for='nest_name'>Card</label>`);
  out.push(helpLink("Hello", "Title"));
  out.push(`<div class='${prefixClass} input-group'>`);
  out.push(`<div class='input-group-text text-muted _field-indicator'>`);
  out.push(`+`);
  out.push(`</div>`);
  out.push(
    railsTextFieldTag("nest_name", snippet.name ?? "", [
      ["class", "form-control _nest-name _autocomplete "],
      ["data-left-name", ctx.cardName],
      ["data-left-type", ctx.leftType],
      ["data-options-card", "*all+by name"],
    ]),
  );
  out.push(`<div class='input-group-text btn btn-secondary _nest-field-toggle'>`);
  out.push(`+`);
  out.push(`</div>`);
  out.push(`</div>`);
  out.push(`</div>`);
  out.push(`<div class='mt-4'>`);
  out.push(nestEditorTabs(ctx, snippet));
  out.push("");
  out.push(`</div>`);
  out.push("");
  out.push(`</div>`);
  return out.join("\n");
}

function tmApplyOpts(
  params: Record<string, string | undefined>,
  snippet: NestParser,
): Array<[string, string | undefined]> {
  const opts: Array<[string, string | undefined]> = [
    ["data-tinymce-id", params.tinymce_id],
  ];
  if (params.tm_snippet_start !== undefined) {
    opts.push(["data-tm-snippet-start", params.tm_snippet_start]);
  }
  if (params.tm_snippet_raw !== undefined) {
    opts.push(["data-tm-snippet-size", String(snippet.raw.length)]);
  }
  return opts;
}

function snippetFromParams(
  params: Record<string, string | undefined>,
): NestParser {
  const raw = params.tm_snippet_raw;
  return typeof raw === "string"
    ? NestParser.parse(raw)
    : NestParser.defaultSnippet();
}

export function nestEditorChrome(
  ctx: ChromeContext,
  editorMode: "overlay" | "modal",
  params: Record<string, string | undefined> = {},
): string {
  const snippet = snippetFromParams(params);
  const partial = nestEditorPartial(ctx, snippet);
  const applyOpts = tmApplyOpts(params, snippet);
  const body = referenceEditorChrome({
    title: "Nest",
    editorMode,
    refType: "nest",
    partial,
    applyOpts,
    snippetRaw: snippet.raw,
    closesAfterPartial: 1,
  });
  return editorMode === "modal" ? `<modal>${body}</modal>` : body;
}

export function nestImageChrome(
  ctx: ChromeContext,
  editorMode: "overlay" | "modal",
  autoname: string,
  tinymceId?: string,
): string {
  const snippet = NestParser.newImage(autoname);
  ctx.forceShowContentTab();
  const partial =
    tabsPanel(
      ctx,
      [
        ["upload", ctx.nest(snippet.name ?? "", "new_image", { type: "image", hide: "guide", extra: { type: "image" } })],
        ["select", imageFindPartial()],
        ["options", imageOptionsPartial(snippet)],
        ["preview", ctx.wrap()],
      ],
      "content",
      { tabType: "tabs", panelClass: "nest-options", navClasses: "nav nav-fill" },
    ) + "\n\n";
  const applyOpts = tmApplyOpts({ tinymce_id: tinymceId }, snippet);
  const body = referenceEditorChrome({
    title: "Image",
    editorMode,
    refType: "nest",
    partial,
    applyOpts,
    snippetRaw: snippet.raw,
    closesAfterPartial: 2,
  });
  return body;
}

function engineChromeContext(ctx: ViewContext, imageMark: string, wrapView = "nest_image"): ChromeContext {
  const { fmt } = ctx;
  return {
    cardName: fmt.card.name.s,
    cardKey: fmt.card.name.safeKey,
    leftType: fmt.card.typeName ?? "",
    idCounter: { n: 0 },
    nest: (target, view, opts) => {
      const mark = target.replace(/\+type_plus_right$/, "+*type plus right");
      return fmt.nest({
        syntax: `{{${mark}|${view}}}`,
        name: mark,
        options: { view, extra: {}, ...(opts ?? {}) },
        comment: undefined,
      });
    },
    forceShowContentTab: () => ctx.voo.setViz("content_tab", "show"),
    wrap: () =>
      modSlotWrap(
        ctx,
        wrapView,
        fmt.nest({
          syntax: `{{${imageMark}|core}}`,
          name: imageMark,
          options: { view: "core", hide: "guide", extra: { type: "image" } },
          comment: undefined,
        }),
      ),
  };
}

const nestEditorView: ViewFn = (ctx) =>
  modViewSlotWrap(
    ctx,
    "nest_editor",
    "_overlay d0-card-overlay card nodblclick",
    nestEditorChrome(engineChromeContext(ctx, "image01"), "overlay", ctx.fmt.engine.requestEditorParams),
  );

const modalNestEditorView: ViewFn = (ctx) =>
  modViewSlotWrap(
    ctx,
    "modal_nest_editor",
    "nodblclick",
    nestEditorChrome(engineChromeContext(ctx, "image01"), "modal", ctx.fmt.engine.requestEditorParams),
  );

const nestImageView: ViewFn = (ctx) =>
  modViewSlotWrap(
    ctx,
    "nest_image",
    "_overlay d0-card-overlay card nodblclick",
    nestImageChrome(engineChromeContext(ctx, "image01", "nest_image"), "overlay", "image01", ctx.fmt.engine.requestEditorParams?.tinymce_id),
  );

const modalNestImageView: ViewFn = (ctx) =>
  modViewSlotWrap(
    ctx,
    "modal_nest_image",
    "nodblclick",
    nestImageChrome(engineChromeContext(ctx, "image01", "modal_nest_image"), "modal", "image01", ctx.fmt.engine.requestEditorParams?.tinymce_id),
  );

const nestContentView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const inner = fmt.card.unknown
    ? (() => {
        voo.hide("guide");
        voo.showViz("new_type_formgroup");
        voo.opts["buttons_view"] = "new_image_buttons";
        return createFormDataShell(ctx, { success: { tinymce_id: null } });
      })()
    : (() => {
        voo.hide("cancel_button");
        return fmt.withNestMode("edit", () =>
          modSlotWrap(ctx, "nest_content", str(fmt.renderView("edit_inline"))),
        );
      })();
  return modSlotWrap(ctx, "nest_content", inner);
};

const newImageView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.showViz("help");
  voo.hide("name_formgroup");
  const slotOpen = modSlotWrap(ctx, "new_image", NEW_FIELDS_SENTINEL);
  voo.opts["buttons_view"] = "new_image_buttons";
  const autoname = fmt.card.name.succ().s;
  const form =
    fmt.card.id !== undefined
      ? updateFormDataShell(ctx, {
          success: {
            tinymce_id: null,
            view: "new_image",
            type: "image",
            slot: { hide: "guide", type: "image", show: "preview_redirect" },
            id: autoname,
          },
        })
      : createFormDataShell(ctx, {
          success: {
            tinymce_id: null,
            view: "new_image",
            type: "image",
            slot: { hide: "guide", type: "image", show: "preview_redirect" },
            id: autoname,
          },
        });
  return slotOpen.split(NEW_FIELDS_SENTINEL).join(form);
};

export const tinymceProbeSurface = {
  nestViewList: NEST_VIEW_LIST,
  allViews: NEST_ALL_VIEWS,
  nestEditorChrome,
  nestImageChrome,
};


const passiveSetModule = (setPath: string): { setPath: string; formats: { html: { views: [] } } } => ({
  setPath,
  formats: { html: { views: [] } },
});

const cardModTinymceEditor: DeckoModManifest = {
  name: "tinymce_editor",
  gemName: "card-mod-tinymce_editor",
  group: "gem-defaults",
  setModules: [
    passiveSetModule("all/tinymce_editor"),
    passiveSetModule("all/reference_editor"),
    {
      setPath: "all/reference_editor/link_editor",
      formats: {
        html: {
          views: [
            {
              view: "link_editor",
              viewFn: linkEditorView,
              config: { cache: "never", unknown: true },
            },
            {
              view: "modal_link_editor",
              viewFn: modalLinkEditorView,
              config: { cache: "never", unknown: true },
            },
          ],
        },
      },
    },
    {
      setPath: "all/reference_editor/nest_editor",
      formats: {
        html: {
          views: [
            {
              view: "nest_editor",
              viewFn: nestEditorView,
              config: { cache: "never", unknown: true },
            },
            {
              view: "modal_nest_editor",
              viewFn: modalNestEditorView,
              config: { cache: "never", unknown: true },
            },
            {
              view: "nest_content",
              viewFn: nestContentView,
              config: { perms: "create", cache: "never", unknown: true },
            },
          ],
        },
      },
    },
    passiveSetModule("all/reference_editor/nest_editor/nest_editor_options"),
    passiveSetModule("all/reference_editor/nest_editor/nest_editor_tabs"),
    {
      setPath: "all/reference_editor/nest_image",
      formats: {
        html: {
          views: [
            { view: "new_image_buttons", viewFn: newImageButtonsView },
            {
              view: "nest_image",
              viewFn: nestImageView,
              config: { cache: "never", unknown: true },
            },
            {
              view: "modal_nest_image",
              viewFn: modalNestImageView,
              config: { cache: "never", unknown: true },
            },
            {
              view: "new_image",
              viewFn: newImageView,
              config: { perms: "create", cache: "never", unknown: true },
            },
          ],
        },
        js: {
          views: [
            {
              view: "change_create_to_update",
              viewFn: changeCreateToUpdateView,
              config: { unknown: true },
            },
            {
              view: "open_nest_editor",
              viewFn: openNestEditorView,
              config: { unknown: true },
            },
          ],
        },
      },
    },
    {
      setPath: "self/tiny_mce",
      settingOpts: {
        group: "other",
        helpText: TINYMCE_HELP_TEXT,
      },
    },
  ],
};

export default cardModTinymceEditor;
