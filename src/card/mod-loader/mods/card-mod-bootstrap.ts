import { str } from "../../render/format.js";

import { DeckoName } from "../../name.js";
import type { CardRecord } from "../../fetch/card-record.js";
import { safeSetKeys } from "../../render/set-keys.js";
import type { RenderCard } from "../../render/format.js";
import { RenderFormat, UnsupportedViewError } from "../../render/format.js";
import type { ViewContext, ViewFn } from "../../render/format.js";
import { rawItemStrings } from "../../render/pointer-list.js";
import { baseTableView } from "../../render/views.js";
import {
  COLOR_VARIABLE_NAMES,
  THEME_VARIABLE_NAMES,
  renderColorsCore,
  renderColorsInput,
  variableGroupWithValues,
} from "../../render/bootswatch-colors.js";
import { superView, viewWrapInherited } from "../mod-view-helpers.js";
import type { ModEventContext } from "../mod-event-dispatch.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
  ModSetModuleFile,
} from "../mod-manifest.js";

export const BOOTSWATCH_VARIABLE_NAMES = {
  colors: [
    "blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green",
    "teal", "cyan", "black", "white", "gray-100", "gray-200", "gray-300",
    "gray-400", "gray-500", "gray-600", "gray-700", "gray-800", "gray-900",
  ],
  themeColors: [
    "primary", "secondary", "success", "info", "warning", "danger", "light",
    "dark", "body-bg", "body-color",
  ],
} as const;

function definitionRegex(name: string): RegExp {
  return new RegExp(`^(?<before>\\s*\\$${name}:\\s*)(?<value>.+?)(?<after> !default;)$`, "m");
}

function replaceValues(
  group: readonly string[],
  params: Readonly<Record<string, string>> | undefined,
  content: string,
): string {
  if (params === undefined) return content;
  let result = content;
  for (const [name, val] of Object.entries(params)) {
    if (!group.includes(name)) continue;
    const regex = definitionRegex(name);
    if (regex.test(result)) {
      result = result.replace(
        new RegExp(regex.source, "gm"),
        (_match, before: string, _value: string, after: string) => `${before}${val}${after}`,
      );
    } else {
      result += `$${name}: ${val} !default;\n`;
    }
  }
  return result;
}

export async function translateVariablesToScssEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const save = ctx.saveInput;
  if (save === undefined) return;
  const original = save.pendingContent ?? card.dbContent ?? "";
  let content = replaceValues(BOOTSWATCH_VARIABLE_NAMES.colors, save.colorsParams, original);
  content = replaceValues(BOOTSWATCH_VARIABLE_NAMES.themeColors, save.themeColorsParams, content);
  if (content !== original) save.setContent(content);
}

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

function popoverIcon(name: string): string {
  return `<i class="notranslate material-icons">${name}</i>`;
}

function emitAttrs(attrs: Readonly<Record<string, string | number | undefined>>): string {
  let out = "";
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    out += ` ${key}="${String(value)}"`;
  }
  return out;
}

export interface PopoverOpts {
  title?: string;
  linkText?: string;
  class?: string;
  extraData?: Record<string, string>;
}

export function popoverLink(
  text: string,
  titleOrOpts?: string | PopoverOpts,
  linkTextArg?: string,
  rawOpts?: Record<string, unknown>,
): string {
  let title = "";
  let linkText = "";
  let opts: PopoverOpts = {};
  if (
    typeof titleOrOpts === "string" ||
    titleOrOpts === undefined ||
    titleOrOpts === null
  ) {
    if (typeof titleOrOpts === "string") title = titleOrOpts;
    if (typeof linkTextArg === "string") linkText = linkTextArg;
    opts = (rawOpts ?? {}) as PopoverOpts;
  } else {
    opts = titleOrOpts;
  }

  if (linkText === "") linkText = popoverIcon("help");

  const body = text === "" ? "&nbsp;" : text;

  const classList = ["ps-1", "_popover_link", opts.class ?? ""]
    .filter((c) => c !== "")
    .join(" ");

  const attrs: Record<string, string | number | undefined> = {
    tabindex: 0,
    "data-bs-toggle": "popover",
    "data-bs-trigger": "hover focus",
    "data-bs-content": body,
    class: classList,
    href: "#",
    ...(title !== "" ? { "data-bs-title": title } : {}),
  };
  if (opts.extraData) {
    for (const [k, v] of Object.entries(opts.extraData)) {
      attrs[`data-${k}`] = v;
    }
  }

  return `<a${emitAttrs(attrs)}>${linkText}</a>`;
}

function renderCarouselItemInner(
  ctx: ViewContext,
  itemCard: NonNullable<ReturnType<typeof ctx.fmt.engine.fetchRenderCard>>,
): string {
  const sub = new RenderFormat(itemCard, ctx.fmt.engine, {
    parent: ctx.fmt,
    maxDepth: ctx.fmt.maxDepth,
  });
  return str(sub.renderView("core"));
}

const carouselView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  const itemNames = rawItemStrings(card.dbContent).filter((s) => s !== "");
  const id = `${card.name.safeKey}-1`;
  let out = `<div class="carousel slide" id="${id}" data-bs-ride="true">`;
  let indicators = `<div class="carousel-indicators">`;
  itemNames.forEach((_name, index) => {
    const activeAttr = index === 0 ? ` class="active"` : "";
    indicators += `<button data-bs-slide-to="${index}" data-bs-target="#${id}" type="button" aria-label="Slide ${index + 1}"${activeAttr}/>`;
  });
  indicators += `</div>`;
  let items = `<div class="carousel-inner">`;
  itemNames.forEach((name, index) => {
    const itemCard = ctx.fmt.engine.fetchRenderCard(name);
    const inner = itemCard === undefined ? "" : renderCarouselItemInner(ctx, itemCard);
    const activeClass = index === 0 ? ` class="carousel-item active"` : ` class="carousel-item"`;
    items += `<div${activeClass}>${inner}</div>`;
  });
  items += `</div>`;
  out += indicators + items;
  out += `<button class="carousel-control-prev" data-bs-target="#${id}" type="button"><span class="carousel-control-prev-icon" aria-hidden="true"></span><span class="visually-hidden">Previous</span></button>`;
  out += `<button class="carousel-control-next" data-bs-target="#${id}" type="button"><span class="carousel-control-next-icon" aria-hidden="true"></span><span class="visually-hidden">Next</span></button>`;
  out += `</div>`;
  return out;
};

function buildCustomizeButtonHref(args: {
  newName: string;
  parentName: string;
}): string {
  const encodeKey = (s: string) => encodeURIComponent(s);
  const encodeValue = (s: string) =>
    encodeURIComponent(s).replace(/%20/g, "+");
  const sep = "&amp;";
  const query =
    `${encodeKey("card[fields][parent]")}=${encodeValue(args.parentName)}` +
    `${sep}${encodeKey("card[name]")}=${encodeValue(args.newName)}` +
    `${sep}${encodeKey("card[type]")}=bootswatch_skin` +
    `${sep}mark=${encodeValue(args.newName)}`;
  return `/card/create?${query}`;
}

function newCustomizedName(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const engine = ctx.fmt.engine;
  const warmed = engine.peekCustomizedName?.(card.name.s);
  if (warmed !== undefined) return warmed;
  const base = `${card.name.s} customized`;
  const exists = (name: string) => engine.fetchRenderCard(name) !== undefined;
  if (!exists(base)) return base;
  let candidate = `${base} 1`;
  let n = 1;
  while (exists(candidate)) {
    n += 1;
    candidate = `${base} ${n}`;
  }
  return candidate;
}

const customizeButtonView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode !== "bootswatch_skin") {
    throw new UnsupportedViewError("customize_button", ctx.fmt.card.name.s);
  }
  const name = ctx.fmt.card.name.s;
  const hasParent =
    ctx.fmt.engine.fetchRenderCard(`${name}+parent`) !== undefined;
  if (hasParent) return "";
  const newName = newCustomizedName(ctx);
  const href = buildCustomizeButtonHref({
    newName,
    parentName: name,
  });
  return `<a class="btn btn-sm btn-outline-primary me-2 wanted-card" href="${href}">Customize</a>`;
};

function readNumericValue(ctx: ViewContext): number {
  const raw = ctx.fmt.card.dbContent;
  if (typeof raw !== "string") return Number.NaN;
  const trimmed = raw.trim();
  if (trimmed === "") return Number.NaN;
  const asNumber = Number(trimmed);
  if (Number.isNaN(asNumber)) return Number.NaN;
  return asNumber;
}

function progressBar(value: number): string {
  const label = `${Math.round(value)}%`;
  const span = `<span class="progress-value">${label}</span>`;
  const attrs =
    ` role="progressbar"` +
    ` style="width: ${value}%"` +
    ` aria-valuenow="${value}"` +
    ` aria-valuemin="0"` +
    ` aria-valuemax="100"`;
  return `<div class="progress-bar"${attrs}>${span}</div>`;
}

const progressBarView: ViewFn = (ctx) => {
  const value = readNumericValue(ctx);
  if (Number.isNaN(value)) {
    return "Only card with numeric content can be shown as progress bar.";
  }
  return `<div class="progress">${progressBar(value)}</div>`;
};

const ICON_BASKET: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  material: {
    plus: "add", pencil: "edit", trash: "delete", full_page: "open_in_full",
    new_window: "close_fullscreen", history: "history", collapse: "expand_less",
    expand: "expand_more", flag: "flag", remove: "close", close: "close",
    board: "space_dashboard", warning: "warning", unknown: "add_box", help: "help",
    modal: "fullscreen", reorder: "reorder", create_action: "add_circle",
    update_action: "edit", delete_action: "remove_circle", draft: "build",
    next: "arrow_forward_ios", previous: "arrow_back_ios", forward: "arrow_forward",
    back: "arrow_back", list: "list", search: "search", filter: "filter_alt",
    quick_filter: "bolt", reset: "restart_alt", more: "more_horiz",
    menu: "more_vert", bar_menu: "more_horiz", show_password: "visibility",
    hide_password: "visibility_off",
  },
  font_awesome: {
    plus: "plus", pencil: "pencil", trash: "trash",
    new_window: "external-link-square-alt", close: "times", remove: "times",
    board: "table-columns", reorder: "align-justify", history: "clock",
    warning: "exclamation-circle", unknown: "plus-square", help: "question-circle",
    modal: "expand", next: "arrow-right", previous: "arrow-left",
    create_action: "circle-plus", update_action: "edit",
    delete_action: "circle-minus", flag: "flag", collapse: "chevron-up",
    expand: "chevron-down", list: "list", search: "magnifying-glass",
    draft: "wrench", filter: "filter", reset: "sync-alt", quick_filter: "bolt",
    show_password: "eye", hide_password: "eye-slash",
  },
  bootstrap: {
    plus: "plus-lg", pencil: "pencil-fill", trash: "trash-fill",
    new_window: "box-arrow-up-right", history: "clock", collapse: "chevron-up",
    expand: "chevron-down", flag: "flag-fill", reorder: "grip-horizontal",
  },
};

function allIconKeys(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const library of Object.keys(ICON_BASKET)) {
    for (const key of Object.keys(ICON_BASKET[library] ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

function iconLibraries(_ctx: ViewContext): string[] {
  return Object.keys(ICON_BASKET);
}

function iconTagMarkup(library: string, mapping: string): string {
  if (library === "material") return `<i class="material-icons">${mapping}</i>`;
  if (library === "font_awesome") return `<i class="fa fa-${mapping}"></i>`;
  if (library === "bootstrap") return `<i class="bi-${mapping}"></i>`;
  return `<i class="${library}-${mapping}"></i>`;
}

const iconsView: ViewFn = (ctx) => {
  const libraries = iconLibraries(ctx);
  const keys = allIconKeys();
  let out = "<table>\n<tr>\n<th>lookup key</th>\n";
  for (const library of libraries) out += `<th>\n${library}\n</th>\n`;
  out += "</tr>\n";
  for (const key of keys) {
    out += `<tr>\n<td>\n${key}\n</td>\n`;
    for (const library of libraries) {
      const mapping = ICON_BASKET[library]?.[key];
      out += mapping
        ? `<td>\n${iconTagMarkup(library, mapping)}\n${mapping}\n</td>\n`
        : "<td>\n&nbsp;\n</td>\n";
    }
    out += "</tr>\n";
  }
  out += "</table>\n";
  return out;
};

const bootswatchBarRightView: ViewFn = () => null;

const colorsBarMiddleView: ViewFn = () =>
  '      <div class="colorpicker-element">\n' +
  '        <div class="input-group-addon">\n' +
  '          <span class="bg-body border p-1">Text</span>\n' +
  '          <span class="bg-dark text-light border p-1">Nav</span>\n' +
  '            <i class="bg-primary"></i>\n' +
  '          <i class="bg-secondary"></i>\n' +
  "        </div>\n" +
  "      </div>\n";

const colorsCoreView: ViewFn = (ctx) => {
  const { card } = ctx.fmt;
  const content = card.dbContent ?? "";
  const left = card.name.isCompound
    ? ctx.fmt.engine.fetchRenderCard(`${card.name.leftName?.s ?? ""}+*variables`)
    : undefined;
  const variables = left?.dbContent;
  const colors = variableGroupWithValues(COLOR_VARIABLE_NAMES, content, variables);
  const themeColors = variableGroupWithValues(THEME_VARIABLE_NAMES, content, variables);
  return renderColorsCore(colors, themeColors);
};

const colorsInputView: ViewFn = (ctx) => {
  const { card } = ctx.fmt;
  const content = card.dbContent ?? "";
  const left = card.name.isCompound
    ? ctx.fmt.engine.fetchRenderCard(`${card.name.leftName?.s ?? ""}+*variables`)
    : undefined;
  const variables = left?.dbContent;
  const colors = variableGroupWithValues(COLOR_VARIABLE_NAMES, content, variables);
  const themeColors = variableGroupWithValues(THEME_VARIABLE_NAMES, content, variables);
  return renderColorsInput(colors, themeColors);
};

const oneLineContentView: ViewFn = (ctx) => viewWrapInherited(ctx, "one_line_content", "");


const barBottomView: ViewFn = ({ fmt }) => `<code>${fmt.renderDelegated("core")}</code>`;

export { barBottomView };

const inputView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode !== "bootswatch_skin") {
    throw new UnsupportedViewError("input", ctx.fmt.card.name.s);
  }
  const name = ctx.fmt.card.name.s;
  const hasParent =
    ctx.fmt.engine.fetchRenderCard(`${name}+parent`) !== undefined;
  if (!hasParent) return "Content is stored in file and can't be edited.";
  return superView(ctx, "Type::BootswatchSkin", "input");
};

function scssTypeIdentity(ctx: ViewContext): {
  typeId: number | undefined;
  typeName: string;
  typeCode: string;
} {
  const typeCard = ctx.fmt.engine.fetchRenderCard("SCSS");
  if (typeCard !== undefined && typeCard.id !== undefined) {
    return {
      typeId: typeCard.id,
      typeName: typeCard.name?.s ?? "SCSS",
      typeCode: "scss",
    };
  }
  return { typeId: 17436, typeName: "SCSS", typeCode: "scss" };
}

function virtualSkinFieldCard(
  ctx: ViewContext,
  field: "colors" | "variables",
): RenderCard {
  const skin = ctx.fmt.card;
  const name = DeckoName.parse(`${skin.name.s}+*${field}`);
  const scssType = scssTypeIdentity(ctx);
  const typeId = scssType.typeId;
  const typeName = scssType.typeName;
  const record: CardRecord = {
    id: undefined,
    codename: undefined,
    leftId: skin.id,
    rightId: undefined,
    typeId,
    dbContent: "",
    trash: false,
    creatorId: undefined,
    updaterId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    currentRevisionId: undefined,
    readRuleClass: undefined,
    readRuleId: undefined,
    referencesExpired: undefined,
    name,
    key: name.key,
    isNew: true,
    fromTrash: false,
    uncacheable: false,
  };
  const setKeys = safeSetKeys({
    name,
    typeId,
    typeName,
    leftTypeName: skin.typeName,
    isRule: false,
    isNew: true,
  });
  return {
    record,
    name,
    key: name.key,
    typeName,
    typeId,
    typeCode: scssType.typeCode,
    id: undefined,
    dbContent: "",
    setKeys,
  };
}

function skinFieldNest(
  ctx: ViewContext,
  field: "colors" | "variables" | "stylesheets",
  title: string,
): string {
  const { fmt } = ctx;
  const name = fmt.card.name.s;
  const opts = { show: ["accordion_bar"], hide: ["bar_middle"], title };
  const real = fmt.engine.fetchRenderCard(`${name}+*${field}`);
  if (real !== undefined) {
    return fmt.nestRecord(real, "accordion_bar", opts);
  }
  if (field === "stylesheets") {
    return fmt.nest({
      name: `${name}+*${field}`,
      syntax: `${name}+*${field}`,
      options: { view: "accordion_bar", title, extra: {} },
      comment: undefined,
    });
  }
  return fmt.nestRecord(virtualSkinFieldCard(ctx, field), "accordion_bar", opts);
}

function linkToCardName(ctx: ViewContext, target: string): string {
  const known = ctx.fmt.engine.fetchRenderCard(target) !== undefined;
  const cls = known ? "known-card" : "wanted-card";
  const urlKey = DeckoName.parse(target).urlKey;
  return `<a class="${cls}" href="/${urlKey}">${target}</a>`;
}

export function bootswatchSkinCoreHtml(ctx: ViewContext): string {
  return str(bootswatchCoreView(ctx));
}

const bootswatchCoreView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.typeCode !== "bootswatch_skin") {
    throw new UnsupportedViewError("core", fmt.card.name.s);
  }
  const name = fmt.card.name.s;
  const styleRule = fmt.engine.fetchRenderCard("*all+*style");
  const currentKeys =
    styleRule === undefined
      ? []
      : rawItemStrings(styleRule.dbContent ?? "").map(
          (s) => DeckoName.parse(s).key,
        );
  let out = "";
  if (currentKeys.includes(fmt.card.key)) {
    out += `<span class='btn btn-sm btn-outline-primary me-2 disabled'>\nCurrent skin\n</span>\n`;
  } else {
    out += `<a class="btn btn-sm btn-outline-primary me-2 known-card" href="/update/${fmt.urlKey()}?card%5Btrigger%5D=use_as_current_skin">Use as current</a>\n`;
  }
  const parentCard = fmt.engine.fetchRenderCard(`${name}+parent`);
  if (parentCard !== undefined) {
    const firstItem = rawItemStrings(parentCard.dbContent ?? "")
      .filter((s) => s.length > 0)[0];
    out += `Inherit from:\n${firstItem === undefined ? "" : linkToCardName(ctx, firstItem)}\n`;
  } else {
    out += `${customizeButtonView(ctx)}\n`;
    const imageCard =
      fmt.engine.fetchRenderCard(`${name}+Image`) ??
      fmt.unknownChildCard(`${name}+Image`);
    out += `<div class='mt-4'>\n${fmt.nestRecord(imageCard, "content", { size: "large" })}\n</div>\n`;
  }
  out += `<h5 class='mt-4'>\nSkin configuration\n</h5>\n<div class='small mb-3'>\nfrom simplest to most advanced\n</div>\n<div class='accordion'>\n`;
  out += `${skinFieldNest(ctx, "colors", "Palette and uses of colors")}\n`;
  out += `${skinFieldNest(ctx, "variables", "Additional SCSS variables")}\n`;
  out += `${skinFieldNest(ctx, "stylesheets", "SCSS and CSS stylesheets")}\n`;
  out += `</div>\n`;
  return out;
};



const passiveSetModule = (setPath: string): ModSetModuleFile => ({
  setPath,
  formats: { html: { views: [] } },
});

const cardModBootstrap: DeckoModManifest = {
  name: "bootstrap",
  gemName: "card-mod-bootstrap",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/progress_bar",
      formats: {
        html: {
          views: [{ view: "progress_bar", viewFn: progressBarView }],
        },
      },
    },
    {
      setPath: "abstract/bs_badge",
      formats: { html: { views: [] } },
    },
    {
      setPath: "abstract/bootstrap_code_file",
      formats: { html: { views: [] } },
    },
    {
      setPath: "abstract/skin_field",
      formats: { html: { views: [] } },
      events: [
        {
          event: "update_skin_asset_input",
          at: "finalize",
          on: ["save"],
          fn: () => undefined,
        },
      ],
    },
    {
      setPath: "all/bootstrap",
      formats: { html: { views: [] } },
    },
    {
      setPath: "all/bootstrap/icon",
      formats: {
        html: {
          views: [{ view: "icons", viewFn: iconsView }],
        },
      },
    },
    passiveSetModule("all/bootstrap/accordion"),
    {
      setPath: "all/bootstrap/carousel",
      formats: {
        html: {
          views: [{ view: "carousel", viewFn: carouselView }],
        },
      },
    },
    passiveSetModule("all/bootstrap/dropdown"),
    passiveSetModule("all/bootstrap/form"),
    {
      setPath: "all/bootstrap/helper",
      formats: { html: { views: [] } },
    },
    passiveSetModule("all/bootstrap/navbar"),
    passiveSetModule("all/bootstrap/table"),
    passiveSetModule("all/bootstrap/wrapper"),
    {
      setPath: "self/bootstrap_core",
      formats: { html: { views: [] } },
    },
    {
      setPath: "self/bootstrap_functions",
      formats: { html: { views: [] } },
    },
    {
      setPath: "type/bootswatch_skin",
      events: [
        event({ event: "use_as_current_skin", at: "finalize", on: ["save"], trigger: "required" }),
      ],
      formats: {
        html: {
          views: [{ view: "input", viewFn: inputView }],
        },
      },
    },
    {
      setPath: "type/bootswatch_skin/html_views",
      formats: {
        html: {
          views: [
            { view: "one_line_content", viewFn: oneLineContentView },
            { view: "customize_button", viewFn: customizeButtonView, config: { cache: "never" } },
            { view: "core", viewFn: baseTableView("core") },
            { view: "bar_left", viewFn: baseTableView("bar_left") },
            { view: "bar_right", viewFn: bootswatchBarRightView },
            { view: "bar_bottom", viewFn: barBottomView },
          ],
        },
      },
    },
    {
      setPath: "type/bootswatch_skin/events",
      formats: { html: { views: [] } },
      events: [
        {
          event: "initialize_because_of_type_change",
          at: "prepare_to_store",
          on: ["update"],
          changed: ["type"],
          fn: () => undefined,
        },
        {
          event: "copy_theme",
          at: "prepare_to_store",
          on: ["create"],
          fn: () => undefined,
        },
        {
          event: "validate_theme_template",
          at: "validate",
          on: ["create"],
          fn: () => undefined,
        },
      ],
    },
    {
      setPath: "type_plus_right/bootswatch_skin/colors",
      events: [
        event({
          event: "translate_variables_to_scss",
          at: "prepare_to_validate",
          on: ["update"],
          fn: translateVariablesToScssEvent,
        }),
      ],
      formats: {
        html: {
          views: [
            { view: "bar_middle", viewFn: colorsBarMiddleView },
            { view: "input", viewFn: colorsInputView },
            { view: "core", viewFn: colorsCoreView },
          ],
        },
      },
    },
    passiveSetModule("type_plus_right/bootswatch_skin/image"),
    passiveSetModule("type_plus_right/bootswatch_skin/parent"),
    passiveSetModule("type_plus_right/bootswatch_skin/stylesheets"),
    passiveSetModule("type_plus_right/bootswatch_skin/variables"),
  ],
};

export default cardModBootstrap;
