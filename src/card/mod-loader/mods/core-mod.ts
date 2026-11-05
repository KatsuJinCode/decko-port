import type { DeckoModManifest, ModEngineHost, ModEventCard, ModEventContext, ModEventFn, ModEventRegistration } from "../mod-manifest.js";
import { serializerFollowsLive } from "../../render/deployment-follow-live-config.js";
import { UnsupportedViewError } from "../../render/format.js";
import { str, type ViewResult } from "../../render/format.js";
import type { ViewContext, ViewFn } from "../../render/format.js";
import {
  ANONYMOUS_ACTOR_NAME,
  CardActionError,
  ModEventAbortSuccess,
} from "../../actions/types.js";
import {
  emitAttrs,
  h,
  newSlotId,
  slotOptionsJson,
} from "../../render/slot-html.js";
import { modAssetGroupsCoreHtml } from "../../render/haml-file-views.js";
import { DeckoName } from "../../name.js";
import {
  clearReferencesOnDelete,
  refreshReferencesOut,
} from "../../actions/refresh-references-out.js";
import { refreshReferencesIn } from "../../actions/refresh-references-in.js";
import {
  updateRefererContent,
  updateRefererReferencesOut,
} from "../../actions/update-referer-content.js";
import { findRule } from "../../rules/index.js";
import { MAX_NAME_LENGTH, rubyStringLength } from "../../actions/name-validation.js";import { ruleWalkPatternInput } from "../../actions/rule-content-walk.js";
import { findPattern } from "../../set-patterns/registry.js";
import {
  ADMIN_CONFIG,
  CORE_ADMIN_LOCALE,
  CORE_TASK_BASKET,
  CORE_WARNING_BASKET,
  MOD_SPECS,
  MOD_SPEC_SHARED,  adminItemTitle,
  adminRuntimeConfig,
  adminRuntimeState,
  modBarRightSections,
  modDescription,
  modAssetGroups,
  prepareAdminRuntime,
  type AdminConfig,
  type AdminTaskConfig,
} from "./core-admin-runtime.js";
import { getDefaultModLoader } from "../../mod-loader.js";
import {
  recaptchaConfigIssuesMessage,
  recaptchaSettingValue,
  usingDefaults,
} from "./card-mod-recaptcha.js";

function output(parts: Array<string | undefined>): string {
  return parts
    .filter((p) => p !== undefined && p !== null)
    .join("\n");
}

function contentTag(
  tag: string,
  attrs: Record<string, string | number | undefined>,
  content: string,
): string {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${typeof v === "string" ? h(v) : v}"`)
    .join("");
  return `<${tag}${attrStr}>${content}</${tag}>`;
}

function wrapWithTag(
  tag: string,
  content: string,
  attrs: Record<string, string | number | undefined> = {},
): string {
  return contentTag(tag, attrs, content);
}

function taskTableHtml(ctx: ViewContext, tasks: Record<string, AdminTaskConfig>): string {
  const rows = Object.entries(tasks).map(([task, config]) =>
    taskRowHtml(ctx, task, config),
  );
  const header =
    wrapWithTag(
      "thead",
      wrapWithTag(
        "tr",
        ["Task", "Description"].map((th) => wrapWithTag("th", th)).join("\n"),
      ),
    );
  const body = wrapWithTag(
    "tbody",
    rows.join("\n"),
  );
  return wrapWithTag("table", output([header, body]), { class: "table" });
}

function taskRowHtml(ctx: ViewContext, task: string, config: AdminTaskConfig): string {
  const base = `${config.mod}_task_${task}`;
  const linkText = config.linkText ?? localeTaskText(`${base}_link_text`);
  const description = config.description ?? localeTaskText(`${base}_description`);
  return (
    wrapWithTag(
      "tr",
      [
        wrapWithTag("td", adminLinkHtml(ctx, linkText, task)),
        wrapWithTag("td", description),
      ].join("\n"),
    )
  );
}

function localeTaskText(key: string): string {
  const value = (CORE_ADMIN_LOCALE as Record<string, string>)[key];
  return value ?? `Translation missing: en.${key}`;
}

function adminLinkHtml(ctx: ViewContext, linkText: string, task: string): string {
  const adminName = adminNameFor(ctx);
  const known = ctx.fmt.engine.fetchRenderCard(adminName) !== undefined;
  const urlKey = DeckoName.parse(adminName).urlKey;
  return (
    `<a class="${known ? "known" : "wanted"}-card" ` +
    `href="/update/${urlKey}?task=${task}">${linkText}</a>`
  );
}

function adminNameFor(ctx: ViewContext): string {
  const state = adminRuntimeStateFor(ctx);
  return state?.codenameToName.get("admin") ?? "*admin";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sectionHtml(title: string, content: string): string {
  return `<p>${sectionTitleHtml(title)}${content}</p>`;
}

function sectionTitleHtml(title: string): string {
  return `<h3>${title}</h3>`;
}

function listSectionHtml(
  title: string,
  items: string[] | undefined,
  ctx: ViewContext,
  itemView = "bar",
  symbolItems = true,
): string | undefined {
  if (items === undefined || items.length === 0) return undefined;
  return sectionHtml(title, listSectionContentHtml(items, ctx, itemView, symbolItems));
}

function listSectionContentHtml(
  items: string[],
  ctx: ViewContext,
  itemView = "bar",
  symbolItems = true,
): string {
  return items.map((item) => nestItemHtml(ctx, item, itemView, symbolItems)).join(" ");
}

function nestedListSectionHtml(
  title: string,
  groupedItems: Array<[string, string[]]>,
  ctx: ViewContext,
): string {
  return output([
    sectionTitleHtml(title),
    wrapWithTag("div", accordionSectionsHtml(groupedItems, ctx), {
      class: "accordion",
    }),
  ]);
}

function accordionSectionsHtml(
  groupedItems: Array<[string, string[]]>,
  ctx: ViewContext,
): string {
  return groupedItems
    .map(([title, codenames]) =>
      accordionItemHtml({
        title,
        subheader: undefined,
        body: listSectionContentHtml(codenames, ctx),
        open: false,
        collapseId: `card-${ctx.fmt.card.name.safeKey}-${stringHash(title)}-collapse-id`,
      }),
    )
    .join(" ");
}

function accordionItemHtml(args: {
  title: string;
  subheader: string | undefined;
  body: string;
  open: boolean;
  collapseId: string;
  data?: string;
}): string {
  const buttonClasses = (
    serializerFollowsLive()
      ? ["accordion-button", args.open ? undefined : "collapsed"]
      : [args.open ? undefined : "collapsed", "accordion-button"]
  )
    .filter((s) => s !== undefined)
    .join(" ");
  const collapseClasses = (
    serializerFollowsLive()
      ? ["accordion-collapse", "collapse", args.open ? "show" : undefined]
      : [args.open ? "show" : undefined, "accordion-collapse", "collapse"]
  )
    .filter((s) => s !== undefined)
    .join(" ");
  const subheaderLines =
    args.subheader !== undefined
      ? `<div class='accordion-subheader bg-light p-2 text-end'>\n${args.subheader}\n</div>\n`
      : "";
  return (
    `<div class='accordion-item'>\n` +
    `<h2 class='accordion-header nodblclick w-100'>\n` +
    `<button class='${buttonClasses}' data-bs-target='#${args.collapseId}' data-bs-toggle='collapse' type='button'>\n` +
    `${args.title}\n` +
    `</button>\n` +
    `</h2>\n` +
    `<div class='${collapseClasses}' id='${args.collapseId}'>\n` +
    subheaderLines +
    `<div class='${serializerFollowsLive() ? "d0-card-body accordion-body" : "accordion-body d0-card-body"}'>\n` +
    `${args.body}\n` +
    `</div>\n` +
    `</div>\n` +
    `</div>\n`
  );
}

function stringHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function listGroupHtml(items: string[]): string {
  return listTagHtml(items, "list-group", "list-group-item");
}

function listTagHtml(
  items: string[],
  ulClass?: string,
  liClass?: string,
): string {
  const ulAttrs = ulClass === undefined ? {} : { class: ulClass };
  const li = (content: string) =>
    liClass === undefined
      ? wrapWithTag("li", content)
      : wrapWithTag("li", content, { class: liClass });
  return wrapWithTag("ul", items.map(li).join("\n"), ulAttrs);
}

function nestItemHtml(
  ctx: ViewContext,
  item: string,
  view: string,
  symbolItems = true,
): string {
  const state = adminRuntimeStateFor(ctx);
  const resolved = state?.codenameToName.get(item);
  if (resolved === undefined) {
    if (symbolItems) return nestNotFoundCodenameHtml(ctx, item);
    return nestByNameHtml(ctx, item, view);
  }
  return nestByNameHtml(ctx, resolved, view);
}

function nestNotFoundCodenameHtml(ctx: ViewContext, codename: string): string {
  const name = DeckoName.parse(codename);
  const slotJson = slotOptionsJson({
    view: "not_found",
    nest_name: name.s,
    show: ["not_found"],
    hide: ["menu", "help"],
    home_view: "not_found",
  });
  const attrs = emitAttrs({
    id: `${name.safeKey}-not_found-view`,
    class: "card-slot not_found-view ALL TYPE-rich_text",
    "data-card-name": name.s,
    "data-card-type-id": "2",
    "data-card-type-name": "RichText",
    "data-card-link-name": name.urlKey,
    "data-slot-id": newSlotId(),
    "data-slot": slotJson,
  });
  return (
    `<div${attrs}>` +
    `<div class="d0-card-frame card">` +
    `<div class="d0-card-header card-header">` +
    `<h2 class="d0-card-header-title">` +
    `<span class="card-title" title="Not Found">Not Found</span></h2></div>\n\n` +
    `<div class="d0-card-body card-body card-text">` +
    `<div class="alert alert-warning alert-dismissible " role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>\n` +
    `<p><strong>CODENAME:</strong> unknown codename: ${h(name.s)}</p></div>\n` +
    `<div>Please <a class="signin-link known-card" href="/*signin/titled">sign in</a> or ` +
    `<a class="signup-link known-card" href="/new/Sign_up">sign up</a> to create it.</div>` +
    `</div></div></div>`
  );
}

function nestByNameHtml(ctx: ViewContext, name: string, view: string): string {
  return ctx.fmt.nest({
    syntax: name,
    name,
    options: { view, extra: {} },
    comment: undefined,
  });
}

interface AdminItem {
  mod: string;
  modname: string;
  category: string;
  subcategory: string | undefined;
  codename: string;
  roles: string[];
  title: string;
}

function viewContextState(ctx: ViewContext) {
  return adminRuntimeStateFor(ctx);
}

function modCardsWithConfig(ctx: ViewContext): Array<{
  name: string;
  modname: string;
  config: AdminConfig;
}> {
  const state = viewContextState(ctx);
  if (state === undefined) return [];
  const out: Array<{ name: string; modname: string; config: AdminConfig }> = [];
  for (const modCard of state.modCards) {
    const modname = modnameFromCodename(modCard.codename);
    const config = ADMIN_CONFIG[modname];
    if (config !== undefined) out.push({ name: modCard.name, modname, config });
  }
  return out;
}

function modnameFromCodename(codename: string): string {
  return codename.replace(/^mod_/, "");
}

function adminConfigObjects(
  modname: string,
  modCardName: string,
  config: AdminConfig,
): AdminItem[] {
  const out: AdminItem[] = [];
  for (const [category, values] of Object.entries(config)) {
    if (!Array.isArray(values)) {
      for (const [subcategory, subvalues] of Object.entries(values)) {
        for (const codename of subvalues) {
          out.push(makeAdminItem(modname, modCardName, category, subcategory, codename));
        }
      }
    } else {
      for (const codename of values) {
        out.push(makeAdminItem(modname, modCardName, category, undefined, codename));
      }
    }
  }
  return out;
}

function makeAdminItem(
  modname: string,
  modCardName: string,
  category: string,
  subcategory: string | undefined,
  codename: string,
): AdminItem {
  return {
    mod: modname,
    modname,
    category,
    subcategory,
    codename,
    roles: [],
    title: adminItemTitle(category, subcategory),
  };
}

function allConfigs(ctx: ViewContext): AdminItem[] {
  const state = viewContextState(ctx);
  const out: AdminItem[] = [];
  for (const mod of modCardsWithConfig(ctx)) {
    const items = adminConfigObjects(mod.modname, mod.name, mod.config);
    for (const item of items) {
      item.roles = state?.rolesByCardCodename.get(item.codename) ?? [];
      out.push(item);
    }
  }
  return out;
}

function groupedBy(
  configs: AdminItem[],
  prop1: "roles" | "category",
): Map<string, AdminItem[]>;
function groupedBy(
  configs: AdminItem[],
  prop1: "category",
  prop2: "mod" | "roles",
): Map<string, Map<string, AdminItem[]>>;
function groupedBy(
  configs: AdminItem[],
  prop1: "roles",
  prop2: "category",
): Map<string, Map<string, AdminItem[]>>;
function groupedBy(configs: AdminItem[], prop1: string, prop2?: string): unknown {
  if (prop2 !== undefined) {
    const outer = new Map<string, Map<string, AdminItem[]>>();
    for (const config of configs) {
      const k1raw = (config as unknown as Record<string, unknown>)[prop1];
      const k1Values = Array.isArray(k1raw) ? (k1raw as string[]) : [k1raw as string];
      const k2 = (config as unknown as Record<string, string>)[prop2];
      for (const k1 of k1Values) {
        let inner = outer.get(k1);
        if (inner === undefined) {
          inner = new Map<string, AdminItem[]>();
          outer.set(k1, inner);
        }
        const list = inner.get(k2) ?? [];
        list.push(config);
        inner.set(k2, list);
      }
    }
    return outer;
  }
  const map = new Map<string, AdminItem[]>();
  for (const config of configs) {
    const raw = (config as unknown as Record<string, unknown>)[prop1];
    const values = Array.isArray(raw) ? (raw as string[]) : [raw as string];
    for (const value of values) {
      const list = map.get(value) ?? [];
      list.push(config);
      map.set(value, list);
    }
  }
  return map;
}

export function allAdminConfigCodenamesOfCategory(
  ctx: ViewContext,
  category: string,
): string[] {
  const grouped = groupedBy(allConfigs(ctx), "category") as Map<string, AdminItem[]>;
  return (grouped.get(category) ?? []).map((item) => item.codename);
}

function configCodenamesGroupedByTitle(
  configs: AdminItem[] | undefined,
): Array<[string, string[]]> {
  if (configs === undefined) return [];
  const byTitle = new Map<string, string[]>();
  for (const config of configs) {
    const list = byTitle.get(config.title) ?? [];
    list.push(config.codename);
    byTitle.set(config.title, list);
  }
  return [...byTitle.entries()];
}

let moduleAdminHost: ModEngineHost | undefined;

function adminRuntimeStateFor(_ctx: ViewContext) {
  return moduleAdminHost !== undefined
    ? adminRuntimeState(moduleAdminHost)
    : undefined;
}

export function bindModuleAdminHost(host: ModEngineHost): void {
  moduleAdminHost = host;
}

export const roleConfigsView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  if (card.typeCode !== "role") {
    throw new UnsupportedViewError("configs", card.name.s);
  }
  const items = allConfigs(ctx);
  const byCat = groupedBy(items, "roles", "category").get(
    card.record.codename ?? "",
  );
  if (byCat === undefined) return "";
  const sections: string[] = [];
  for (const [cat, configs] of byCat) {
    if (cat === "cardtypes") {
      sections.push(nestedListSectionHtml(capitalize(cat), configCodenamesGroupedByTitle(configs), ctx));
    } else if (cat === "views") {
      continue;
    } else {
      const section = listSectionHtml(
        capitalize(cat),
        configs.map((c) => c.codename),
        ctx,
        "closed_bar",
      );
      if (section !== undefined) sections.push(section);
    }
  }
  return sections.join("\n");
};

const adminCoreView: ViewFn = (ctx) => {

  return taskTableHtml(ctx, deckTaskBasket());
};

function deckTaskBasket(): Record<string, AdminTaskConfig> {
  const out: Record<string, AdminTaskConfig> = { ...CORE_TASK_BASKET };
  const loader = getDefaultModLoader();
  for (const entry of loader?.basketTaskContributions() ?? []) {
    out[entry.task] = {
      mod: entry.mod,
      ...(entry.irreversible === undefined ? {} : { irreversible: entry.irreversible }),
      linkText: entry.linkText,
      description: entry.description,
    };
  }
  return out;
}

const adminWarningView: ViewFn = (ctx) => {

  const warnings: string[] = [];
  for (const warning of deckWarningList()) {
    if (warning === "no_email_delivery") {
      if (noEmailDeliveryIsOn()) {
        warnings.push(noEmailDeliveryMessage());
      }
    } else if (warning === "recaptcha_config_issues") {
      if (recaptchaConfigIssuesOn(ctx)) {
        warnings.push(recaptchaConfigIssuesHtml(ctx));
      }
    }
  }
  if (warnings.length === 0) return "";
  return warningAlertHtml(warnings);
};

function deckWarningList(): string[] {
  return [...CORE_WARNING_BASKET, ...(getDefaultModLoader()?.basketWarningContributions() ?? []).map((e) => e.warning)];
}

function recaptchaConfigIssuesOn(ctx: ViewContext): boolean {
  const card = ctx.fmt.engine.fetchRenderCard("*recaptcha settings+*site key");
  const siteKey = recaptchaSettingValue(card?.dbContent, undefined, undefined, "site_key");
  return usingDefaults(siteKey);
}

function recaptchaConfigIssuesHtml(ctx: ViewContext): string {
  const captchaName = adminRuntimeStateFor(ctx)?.codenameToName.get("captcha") ?? "*captcha";
  const captchaKnown = ctx.fmt.engine.fetchRenderCard(captchaName) !== undefined;
  const captchaUrlKey = DeckoName.parse(captchaName).urlKey;
  const captchaLink =
    `<a class="${captchaKnown ? "known" : "wanted"}-card" href="/${captchaUrlKey}">*captcha</a>`;
  const settingsName =
    adminRuntimeStateFor(ctx)?.codenameToName.get("recaptcha_settings") ?? "*recaptcha settings";
  const settingsUrlKey = DeckoName.parse(settingsName).urlKey;
  const recaptchaLink =
    `<a rel="nofollow" class="edit-link slotter" title="Edit" ` +
    `data-bs-toggle="tooltip" data-bs-placement="bottom" ` +
    `data-slotter-mode="modal" data-modal-class="modal-lg" ` +
    `href="/${settingsUrlKey}/edit" data-remote="true">recaptcha keys</a>`;
  return recaptchaConfigIssuesMessage({
    localhost: false,
    recaptchaLink,
    captchaLink,
  });
}

function noEmailDeliveryIsOn(): boolean {
  return adminRuntimeConfig().performDeliveries === false;
}

function noEmailDeliveryMessage(): string {
  return CORE_ADMIN_LOCALE.core_admin_email_off.replace(
    "%{path}",
    "config/application.rb",
  );
}

function warningAlertHtml(warnings: string[]): string {
  const close =
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>`;
  const haml =
    `<h5>\n${CORE_ADMIN_LOCALE.core_admin_warn}\n</h5>\n` +
    `${listTagHtml(warnings)}\n`;
  return wrapWithTag(
    "div",
    output([close, haml]),
    { class: "alert alert-warning alert-dismissible ", role: "alert" },
  );
}

export const modCardCoreHtml: ViewFn = (ctx) => {

  const card = ctx.fmt.card;
  const modname = modnameFromCodename(card.record.codename ?? "");
  const config = ADMIN_CONFIG[modname];
  const spec = MOD_SPECS[modname];
  const sections: Array<ViewResult | undefined> = [];
  const present: Array<() => ViewResult | undefined> = [
    () => typeModDescriptionView(ctx),
    () => (adminSettingList(config) === undefined ? undefined : typeModSettingsView(ctx)),
    () => (config?.configurations === undefined ? undefined : typeModConfigurationsView(ctx)),
    () => (configCardtypes(config) === undefined ? undefined : typeModCardtypesView(ctx)),
    () => typeModStylesView(ctx),
    () => typeModScriptsView(ctx),
    () => (modTasks(modname).length === 0 ? undefined : typeModTasksView(ctx)),
    () => (config?.views === undefined ? undefined : typeModViewsView(ctx)),
    () => (dependsOn(spec) === undefined ? undefined : typeModDependsOnView(ctx)),
  ];
  for (const render of present) {
    const body = render();
    sections.push(body === "" || body === null ? undefined : body);
  }
  return sections
    .filter((s): s is Exclude<ViewResult, undefined> => s !== undefined)
    .map((section) => str(section))
    .join("<br/>");
};

const typeModDescriptionView: ViewFn = (ctx) => {

  const modname = modnameFromCodename(ctx.fmt.card.record.codename ?? "");
  const description = modDescription(modname);
  return contentTag("p", {}, description ?? "");
};

const typeModSettingsView: ViewFn = (ctx) => {

  const config = ADMIN_CONFIG[modnameFromCodename(ctx.fmt.card.record.codename ?? "")];
  return listSectionHtml("Settings", adminSettingList(config), ctx) ?? "";
};

function adminSettingList(config: AdminConfig | undefined): string[] | undefined {
  const raw = config?.["settings"];
  return Array.isArray(raw) ? raw : undefined;
}

const typeModCardtypesView: ViewFn = (ctx) => {

  const config = ADMIN_CONFIG[modnameFromCodename(ctx.fmt.card.record.codename ?? "")];
  const grouped = configCodenamesGroupedByTitle(configCardtypes(config));
  return nestedListSectionHtml("Cardtypes", grouped, ctx);
};

function configCardtypes(config: AdminConfig | undefined): AdminItem[] | undefined {
  const raw = config?.["cardtypes"];
  if (raw === undefined || Array.isArray(raw)) return undefined;
  const items: AdminItem[] = [];
  for (const [subcategory, codenames] of Object.entries(raw)) {
    for (const codename of codenames) {
      items.push({
        mod: "",
        modname: "",
        category: "cardtypes",
        subcategory,
        codename,
        roles: [],
        title: adminItemTitle("cardtypes", subcategory),
      });
    }
  }
  return items;
}

const typeModConfigurationsView: ViewFn = (ctx) => {

  const config = ADMIN_CONFIG[modnameFromCodename(ctx.fmt.card.record.codename ?? "")];
  const configurations = config?.configurations;
  if (configurations === undefined || Array.isArray(configurations)) return null;
  return Object.entries(configurations)
    .map(([category, names]) =>
      listSectionHtml(`${capitalize(category)} Configuration`, names, ctx),
    )
    .filter((s): s is string => s !== undefined)
    .join(" ");
};

const typeModTasksView: ViewFn = (ctx) => {

  const modname = modnameFromCodename(ctx.fmt.card.record.codename ?? "");
  const tasks = modTasks(modname);
  if (tasks.length === 0) return null;
  const selected: Record<string, AdminTaskConfig> = {};
  for (const task of tasks) selected[task] = CORE_TASK_BASKET[task]!;
  return sectionHtml("Tasks", taskTableHtml(ctx, selected));
};

function modTasks(modname: string): string[] {
  return Object.entries(CORE_TASK_BASKET)
    .filter(([, config]) => config.mod === modname)
    .map(([task]) => task);
}

const typeModBarRightView: ViewFn = (ctx) =>
  modBarRightSections(modnameFromCodename(ctx.fmt.card.record.codename ?? ""));


const typeModStylesView: ViewFn = (ctx) => modAssetSection(ctx, "style", "Styles");

const typeModScriptsView: ViewFn = (ctx) => modAssetSection(ctx, "script", "Scripts");

function modAssetSection(
  ctx: ViewContext,
  tag: "style" | "script",
  title: string,
): ViewResult {
  const groups = modAssetGroups(modnameFromCodename(ctx.fmt.card.record.codename ?? ""), tag);
  if (groups === undefined || groups.length === 0) {
    return childCard(ctx, tag) !== undefined ? sectionHtml(title, "") : null;
  }
  return sectionHtml(title, modAssetGroupsCoreHtml(groups));
}


function childCard(ctx: ViewContext, tag: string): string | undefined {
  const name = `${ctx.fmt.card.name.s}+*${tag}`;
  return ctx.fmt.engine.fetchRenderCard(name) !== undefined ? name : undefined;
}

const typeModViewsView: ViewFn = (ctx) => {

  const config = ADMIN_CONFIG[modnameFromCodename(ctx.fmt.card.record.codename ?? "")];
  const views = config?.views;
  if (views === undefined || !Array.isArray(views)) return "";
  return sectionHtml("Views", listGroupHtml(views));
};

const typeModDependsOnView: ViewFn = (ctx) => {

  const spec = MOD_SPECS[modnameFromCodename(ctx.fmt.card.record.codename ?? "")];
  return listSectionHtml("Depends on", dependsOn(spec), ctx, "bar", false) ?? "";
};

function dependsOn(spec: { deps: string[] } | undefined): string[] | undefined {
  if (spec === undefined) return undefined;
  const names = [...spec.deps]
    .sort()
    .filter((name) => name.startsWith("card-mod"))
    .map((name) => `mod_${name.slice(8)}`);
  return names.length > 0 ? names : undefined;
}

const typeModGemInfoView: ViewFn = (ctx) => {

  const modname = modnameFromCodename(ctx.fmt.card.record.codename ?? "");
  const spec = MOD_SPECS[modname];
  if (spec === undefined) return "";
  const authors = rubyToS(MOD_SPEC_SHARED.authors);
  const email = rubyToS(MOD_SPEC_SHARED.email);
  const properties = [
    `name: ${spec.gem}`,
    `summary: ${spec.summary}`,
    `version: ${spec.version}`,
    `authors: ${authors}`,
    `description: ${spec.description}`,
    `email: ${email}`,
    `homepage: ${MOD_SPEC_SHARED.homepage}`,
  ];
  const filesAccordion = accordionItemHtml({
    title: "files",
    subheader: undefined,
    body: listGroupHtml(MOD_SPEC_SHARED.files),
    open: false,
    collapseId: `card-${ctx.fmt.card.name.safeKey}-files-collapse-id`,
  });
  const dependsAccordion = accordionItemHtml({
    title: "depends on ",
    subheader: undefined,
    body: listSectionContentHtml(dependsOn(spec) ?? [], ctx, "bar", false),
    open: false,
    collapseId: `card-${ctx.fmt.card.name.safeKey}-depends_on-collapse-id`,
  });
  return sectionHtml(
    "Gem info",
    listGroupHtml(properties) + filesAccordion + dependsAccordion,
  );
};

function rubyToS(items: string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

function modGlobalSectionHtml(
  viewName: string,
  ctx: ViewContext,
): string {
  const grouped = groupedBy(allConfigs(ctx), "category", "mod") as Map<
    string,
    Map<string, AdminItem[]>
  >;
  const byCategory = grouped.get(viewName);
  const sections: string[] = [];
  if (byCategory !== undefined) {
    for (const [modname, configs] of byCategory) {
      const section = listSectionHtml(
        modname,
        configs.map((c) => c.codename),
        ctx,
      );
      if (section !== undefined) sections.push(section);
    }
  }
  return output([contentTag("h1", {}, viewName), sections.join("<br/>")]);
}

const modCardtypesView: ViewFn = (ctx) => {

  return modGlobalSectionHtml("cardtypes", ctx);
};

const modSettingsView: ViewFn = (ctx) => {

  return modGlobalSectionHtml("settings", ctx);
};

const modTasksView: ViewFn = (ctx) => {

  return modGlobalSectionHtml("tasks", ctx);
};

const modConfigurationsView: ViewFn = (ctx) => {

  return modGlobalSectionHtml("configurations", ctx);
};

const modRolesView: ViewFn = (ctx) => {

  const grouped = groupedBy(allConfigs(ctx), "roles") as Map<string, AdminItem[]>;
  const groups: string[] = [];
  for (const [role, configs] of grouped) {
    const byCategory = new Map<string, AdminItem[]>();
    for (const config of configs) {
      const list = byCategory.get(config.category) ?? [];
      list.push(config);
      byCategory.set(config.category, list);
    }
    const sections: string[] = [];
    for (const [category, categoryConfigs] of byCategory) {
      const section = listSectionHtml(
        category,
        categoryConfigs.map((c) => c.codename),
        ctx,
      );
      if (section !== undefined) sections.push(section);
    }
    groups.push(
      output([
        contentTag("h2", {}, DeckoName.parse(role).s),
        sections.join(""),
      ]),
    );
  }
  return output([contentTag("h1", {}, "Roles"), groups.join("<br/>")]);
};

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function notAllowedMessage(taskLinkText: string): string {
  return (
    `The admin task '${taskLinkText}' is disabled for security reasons.<br>` +
    `You can enable it with the config option 'allow_irreversible_admin_tasks'`
  );
}

export function irreversiblesTasksAllowed(): boolean {
  return adminRuntimeConfig().allowIrreversibleAdminTasks === true;
}

export function runTaskFromTaskBasket(
  task: string | undefined,
  tasks: Record<string, AdminTaskConfig>,
  opts?: { allowIrreversibleAdminTasks?: boolean },
): void {
  if (task === undefined) return;
  const taskConfig = tasks[task];
  if (taskConfig === undefined) return;
  const allowed =
    opts?.allowIrreversibleAdminTasks ??
    adminRuntimeConfig().allowIrreversibleAdminTasks;
  if (!allowed && taskConfig.irreversible === true) {
    throw new PermissionDeniedError(
      notAllowedMessage(localeTaskText(`${taskConfig.mod}_task_${task}_link_text`)),
    );
  }
  taskConfig.executePolicy?.();
}

async function adminTasksEvent(
  card: ModEventCard,
  _host: ModEngineHost,
  _ctx: ModEventContext,
): Promise<void> {
  const rawTask = card.params?.["task"];
  const task = typeof rawTask === "string" ? rawTask : undefined;
  if (task === undefined || !deckTaskBasket()[task]) return;
  if (card.alwaysOk !== true) {
    throw new CardActionError(
      "permission-denied",
      `actor ${card.authCurrentId === null || card.authCurrentId === undefined ? ANONYMOUS_ACTOR_NAME : String(card.authCurrentId)} may not run admin task ${task}`,
      undefined,
      { permission_denied: `You don't have permission to run admin task ${task}` },
      card.name,
    );
  }
  runTaskFromTaskBasket(task, deckTaskBasket());
  throw new ModEventAbortSuccess();
}

function stubEvent(_card: unknown, _host: unknown): void {
}

async function deleteChildrenEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await ctx.deleteChildren?.();
}

async function expireOldNameEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const before = card.nameBeforeAct;
  if (before === undefined) return;
  ctx.fetch?.expireName(before);
}

async function notableExceptionRaisedEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const error = ctx.currentError;
  if (error === undefined) return;
  ctx.logger?.debug(`${error.message}\n${error.backtrace.join("\n  ")}`);
}

async function prepareLeftAndRightEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  if (ctx.simpleName === true) return;
  await ctx.prepareSide?.("left");
  await ctx.prepareSide?.("right");
}

async function rejectEmptySubcardsEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const subcards = ctx.subcardCollection;
  if (subcards === undefined) return;
  if (subcards.hasTrigger) return;
  for (const key of subcards.keys) {
    if (!subcards.isUnfilled(key)) continue;
    if (!(await subcards.isNew(key))) continue;
    subcards.drop(key);
  }
}

async function renameInTrashEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const key = card.key;
  if (key === undefined) return;
  const obstacle = await ctx.findTrashedKeyObstacle?.(key);
  if (obstacle === undefined) return;
  if (card.id !== undefined && obstacle.id === card.id) return;
  await ctx.renameAsTrashObstacle?.(obstacle);
}

async function saveDraftEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await ctx.saveContentDraft?.(card.dbContent);
  ctx.abortSuccess?.();
}

async function updateLexiconEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const lexiconAction = card.action === "create" ? "add" : card.action;
  if (lexiconAction === "add") {
    ctx.lexiconAdd?.();
    return;
  }
  if (lexiconAction === "update") {
    ctx.lexiconUpdate?.();
  }
}

async function setDefaultContentEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const template = await ctx.defaultContent?.();
  if (template === undefined) return;
  ctx.setDbContent?.(template);
}

async function setContentEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const prepared = await ctx.prepareDbContent?.(card.dbContent ?? "");
  ctx.setContent?.(prepared ?? "");
  ctx.clearDrafts?.();
}

async function setAutonameEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const rule = await ctx.autonameRule?.();
  if (rule === undefined) return;
  const named = await ctx.autonameName?.(rule.content);
  if (named === undefined) return;
  ctx.setCardName?.(named);
  await ctx.updateAutonameRuleContent?.(named);
  ctx.expireAutonameRule?.();
}

async function validateRenamingEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  if (ctx.sameNameAsBefore?.() === true) return;
  if (ctx.contentIsChanging?.() === true) {
    ctx.refuseContentChange?.("cannot change content while changing name");
    return;
  }
  if (ctx.typeIsChanging?.() === true) {
    ctx.refuseTypeChange?.("cannot change type while changing name");
    return;
  }
  await ctx.detectIllegalCompoundNames?.();
}

async function validateUniquenessOfNameEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const key = ctx.cardKey?.() ?? "";
  const existingId = await ctx.lexiconId?.(key);
  if (existingId === undefined || existingId === ctx.cardId?.()) return;
  const existingName = await ctx.liveCardName?.(existingId);
  if (existingName === undefined) return;
  ctx.refuseNameTaken?.(existingName);
}

async function validateNameEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await ctx.validateLegality?.();
  if (ctx.errorsAny?.() === true) return;
  await ctx.validateUniqueness?.();
}

async function validateLegalityOfNameEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const length = rubyStringLength(ctx.cardName?.() ?? "");
  if (length > MAX_NAME_LENGTH) {
    const lengthAgain = rubyStringLength(ctx.cardName?.() ?? "");
    ctx.refuseName?.(
      `is too long (255 character maximum; length is ${lengthAgain})`,
      "too-long",
    );
    return;
  }
  if (ctx.nameBlank?.() === true) {
    ctx.refuseName?.("can't be blank", "blank");
    return;
  }
  if (ctx.nameIncomplete?.() === true) {
    ctx.refuseName?.("is incomplete", "incomplete");
    return;
  }
  if (ctx.nameValid?.() === false) {
    ctx.refuseName?.(
      `may not contain any of the following characters: ${ctx.bannedCharacters?.() ?? ""}`,
      "banned-characters",
    );
    return;
  }
  if ((await ctx.changingExistingTagToCompound?.()) === true) {
    ctx.refuseNameTagInUse?.(`${ctx.cardName?.() ?? ""} in use as a tag`);
  }
}

async function validateKeyEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  if ((ctx.cardKey?.() ?? "") === "") {
    ctx.refuseKey?.("cannot be blank");
    return;
  }
  if ((ctx.cardKey?.() ?? "") !== (ctx.nameKey?.() ?? "")) {
    ctx.refuseKey?.(
      `wrong key '${ctx.cardKey?.() ?? ""}' for name ${ctx.cardName?.() ?? ""}`,
    );
  }
}

async function resetCodenameCacheEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  if (card.action === "create" && card.codename === undefined) return;
  ctx.resetCodenameCache?.();
}

async function manageTrashEvent(
  _card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await ctx.pullFromTrash?.();
}

async function cardsOfTypeExist(
  ctx: ModEventContext,
  id: number | undefined,
): Promise<boolean> {
  if (id === undefined) return false;
  const row = await ctx.driver
    .query<{ id: number }>(
      "SELECT id FROM cards WHERE trash = 0 AND type_id = ? LIMIT 1",
      [id],
    )
    .then((r) => r.rows[0])
    .catch(() => undefined);
  return row !== undefined;
}

async function checkForCardsOfTypeEvent(
  card: ModEventCard,
  _host: ModEngineHost,
  ctx: ModEventContext,
): Promise<void> {
  if (!(await cardsOfTypeExist(ctx, card.id))) return;
  const message = `Sorry, this card must remain a Cardtype so long as there are ${card.name} cards.`;
  throw new CardActionError(
    "validation-failed",
    message,
    `CARDTYPE: ${message}`,
    { cardtype: message },
    card.name,
  );
}

async function checkForCardsOfTypeWhenTypeChangedEvent(
  card: ModEventCard,
  _host: ModEngineHost,
  ctx: ModEventContext,
): Promise<void> {
  if (!(await cardsOfTypeExist(ctx, card.id))) return;
  const message = `can't alter this type; ${card.nameBeforeAct ?? card.name} cards still exist`;
  throw new CardActionError(
    "validation-failed",
    message,
    `CARDTYPE: ${message}`,
    { cardtype: message },
    card.name,
  );
}

function validateCardtypeNameEvent(card: ModEventCard): void {
  if (!/[<>/]/.test(card.name)) return;
  const message = "may not contain any of the following characters: <, >, /";
  throw new CardActionError(
    "validation-failed",
    message,
    `NAME: ${message}`,
    { name: message },
    card.name,
  );
}

async function validateTypeEvent(
  card: ModEventCard,
  _host: ModEngineHost,
  ctx: ModEventContext,
): Promise<void> {
  const fail = (message: string): CardActionError =>
    new CardActionError(
      "validation-failed",
      message,
      `TYPE: ${message}`,
      { type: message },
      card.name,
    );
  if (card.typeId !== undefined && card.typeId !== null) {
    const typeCard = await ctx.driver
      .query<{ one: number }>(
        "SELECT 1 AS one FROM cards WHERE id = ? AND trash = 0",
        [card.typeId],
      )
      .then((r) => r.rows[0])
      .catch(() => undefined);
    if (typeCard === undefined) throw fail("no such type");
  }
  if (ctx.fetch === undefined) return;
  if (card.action === "create") return;
  const pattern = await ruleWalkPatternInput(ctx.fetch, {
    name: DeckoName.parse(card.name),
    id: card.id,
    isNew: false,
    typeId: card.typeId ?? undefined,
  });
  const structureRule = await findRule(ctx.fetch, pattern, "*structure");
  if (structureRule === undefined) return;
  const content = (structureRule.rule.dbContent ?? "").trim();
  if (content === "" || content === "_self") return;
  const setTag = DeckoName.parse(structureRule.setName).parts.slice(-1)[0];
  if (setTag === undefined) return;
  const tagRow = await ctx.driver
    .query<{ codename: string | null }>(
      "SELECT codename FROM cards WHERE key = ? AND trash = 0",
      [DeckoName.parse(setTag).key],
    )
    .then((r) => r.rows[0])
    .catch(() => undefined);
  const patternCode = tagRow?.codename;
  if (patternCode === undefined || patternCode === null) return;
  const spec = findPattern(patternCode);
  if (spec?.assignsType !== true) return;
  const ruleTypeId = structureRule.rule.typeId;
  if (ruleTypeId === undefined || ruleTypeId === null) return;
  if (card.typeId !== ruleTypeId) {
    const ruleType = await ctx.driver
      .query<{ name: string | null }>(
        "SELECT name FROM cards WHERE id = ? AND trash = 0",
        [ruleTypeId],
      )
      .then((r) => r.rows[0])
      .catch(() => undefined);
    throw fail(
      `${card.name} can't be changed because ${card.name} is structured as a ${ruleType?.name ?? ruleTypeId}`,
    );
  }
}

async function validateDeleteEvent(
  card: ModEventCard,
  _host: ModEngineHost,
  ctx: ModEventContext,
): Promise<void> {
  const fail = (message: string): CardActionError =>
    new CardActionError("protected-card", message, `DELETE: ${message}`, { delete: message }, card.name);
  if (card.codename !== undefined && card.codename !== null && card.codename !== "") {
    throw fail(`${card.name} is is a system card. (${card.codename})`);
  }
  if (card.name.includes("+")) {
    const name = DeckoName.parse(card.name);
    const sideCodename = async (side: DeckoName | undefined): Promise<string | null> => {
      if (side === undefined) return null;
      const row = await ctx.driver
        .query<{ codename: string | null }>(
          "SELECT codename FROM cards WHERE key = ? AND trash = 0",
          [side.key],
        )
        .then((r) => r.rows[0])
        .catch(() => undefined);
      return row?.codename ?? null;
    };
    const leftCode = await sideCodename(name.leftName);
    const rightCode = await sideCodename(name.rightName);
    const UNDELETABLE_ALL_RULES_TAGS = ["default", "style", "layout", "create", "read", "update", "delete"];
    if (leftCode === "all" && rightCode !== null && UNDELETABLE_ALL_RULES_TAGS.includes(rightCode)) {
      throw fail(`${card.name} is an indestructible rule`);
    }
  }
  const holderTypes = await ctx.driver
    .query<{ codename: string | null }>(
      "SELECT codename FROM cards WHERE id = ? AND trash = 0",
      [card.typeId as number],
    )
    .then((r) => r.rows[0])
    .catch(() => undefined);
  const holderType = holderTypes?.codename ?? null;
  if ((holderType === "user" || holderType === "signup") && card.id !== undefined) {
    const edit = await ctx.driver
      .query<{ one: number }>(
        "SELECT 1 AS one FROM card_acts WHERE actor_id = ? AND card_id IS NOT NULL LIMIT 1",
        [card.id],
      )
      .then((r) => r.rows[0])
      .catch(() => undefined);
    if (edit !== undefined) {
      throw fail(
        `Edits have been made with ${card.name}'s user account.\nDeleting this card would mess up our history.`,
      );
    }
  }
}

async function refreshReferencesOutEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await refreshReferencesOut(
    ctx.driver,
    ctx.lexicon,
    card.id as number,
    DeckoName.parse(card.name),
    card.dbContent ?? null,
  );
}

async function updateRefererContentEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await updateRefererContent(
    {
      driver: ctx.driver,
      lexicon: ctx.lexicon,
      ...(ctx.fetchRefererCard !== undefined ? { fetchRefererCard: ctx.fetchRefererCard } : {}),
      ...(ctx.pinStaleReferer !== undefined ? { pinStaleReferer: ctx.pinStaleReferer } : {}),
    },
    card.id as number,
    DeckoName.parse(card.nameBeforeAct ?? card.name),
    DeckoName.parse(card.name),
  );
}

async function updateRefererReferencesOutEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await updateRefererReferencesOut(
    { driver: ctx.driver, lexicon: ctx.lexicon },
    card.id as number,
  );
}

async function refreshReferencesInEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const unmapExisting =
    card.action === "update" && ctx.skipEvent("update_referer_content");
  await refreshReferencesIn(ctx.driver, card.id as number, card.key ?? "", {
    unmapExisting,
  });
}

async function clearReferencesEvent(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  await clearReferencesOnDelete(ctx.driver, card.id as number);
}

const SEED_CARDTYPE_ID = 3;

export const coreModEventPredicates = {
  "skip_update_referers?": (card: ModEventCard): boolean =>
    card.act?.skip?.includes("update_referer_content") === true ||
    card.act?.forceSkip?.includes("update_referer_content") === true,
  "autoname?": (): boolean => false,
  "no_autoname?": (): boolean => true,
  "draft?": (card: ModEventCard): boolean => card.params?.["draft"] === "true",
  "use_default_content?": (card: ModEventCard): boolean =>
    !(card.changedFields ?? []).includes("db_content") &&
    card.defaultContent !== undefined &&
    card.defaultContent !== "",
  "was_cardtype?": async (card: ModEventCard, ctx?: ModEventContext): Promise<boolean> => {
    const resolved = ctx?.fetch !== undefined ? await ctx.fetch.codenames.id("cardtype") : undefined;
    return card.typeIdBeforeAct === (resolved ?? SEED_CARDTYPE_ID);
  },
} as const;

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: stubEvent as ModEventFn, ...decl };
}

const coreMod: DeckoModManifest = {
  name: "core",
  gemName: "card",
  group: "gem-card",
  setModules: [
    {
      setPath: "abstract/task_table",
    },
    {
      setPath: "all/admin",
    },
    {
      setPath: "all/assign_attributes",
    },
    {
      setPath: "all/autoname",
      events: [
        event({
          event: "set_autoname",
          at: "prepare_to_store",
          on: ["create"],
          when: "autoname?",
          fn: setAutonameEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/codename",
      events: [
        event({
          event: "validate_codename",
          at: "validate",
          on: ["update"],
          changed: ["codename"],
        }),
        event({
          event: "reset_codename_cache",
          at: "integrate",
          changed: ["codename"],
          fn: resetCodenameCacheEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/content",
      events: [
        event({
          event: "set_content",
          at: "store",
          on: ["save"],
          fn: setContentEvent as ModEventFn,
        }),
        event({
          event: "save_draft",
          at: "store",
          on: ["update"],
          when: "draft?",
          fn: saveDraftEvent as ModEventFn,
        }),
        event({
          event: "set_default_content",
          at: "prepare_to_validate",
          on: ["create"],
          when: "use_default_content?",
          fn: setDefaultContentEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/debug",
    },
    {
      setPath: "all/initialize",
    },
    {
      setPath: "all/name_events",
      events: [
        event({
          event: "validate_name",
          at: "validate",
          on: ["save"],
          changed: ["name"],
          when: "no_autoname?",
          fn: validateNameEvent as ModEventFn,
        }),
        event({
          event: "validate_uniqueness_of_name",
          skip: "allowed",
          fn: validateUniquenessOfNameEvent as ModEventFn,
        }),
        event({
          event: "validate_legality_of_name",
          fn: validateLegalityOfNameEvent as ModEventFn,
        }),
        event({
          event: "validate_key",
          after: "validate_name",
          on: ["save"],
          when: "no_autoname?",
          fn: validateKeyEvent as ModEventFn,
        }),
        event({
          event: "validate_renaming",
          at: "validate",
          on: ["update"],
          changed: ["name"],
          skip: "allowed",
          fn: validateRenamingEvent as ModEventFn,
        }),
        event({
          event: "expire_old_name",
          at: "store",
          changed: ["name"],
          on: ["update"],
          fn: expireOldNameEvent as ModEventFn,
        }),
        event({
          event: "rename_in_trash",
          after: "expire_old_name",
          on: ["update"],
          fn: renameInTrashEvent as ModEventFn,
        }),
        event({
          event: "prepare_left_and_right",
          at: "store",
          changed: ["name"],
          on: ["save"],
          fn: prepareLeftAndRightEvent as ModEventFn,
        }),
        event({
          event: "update_lexicon",
          at: "store",
          changed: ["name"],
          fn: updateLexiconEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/reference_events",
      events: [
        event({
          event: "refresh_references_out",
          at: "finalize",
          on: ["save"],
          changed: ["content"],
          fn: refreshReferencesOutEvent as ModEventFn,
        }),
        event({
          event: "update_referer_content",
          at: "finalize",
          on: ["update"],
          changed: ["name"],
          skip: "allowed",
          fn: updateRefererContentEvent as ModEventFn,
        }),
        event({
          event: "update_referer_references_out",
          at: "finalize",
          changed: ["name"],
          on: ["update"],
          when: "skip_update_referers?",
          fn: updateRefererReferencesOutEvent as ModEventFn,
        }),
        event({
          event: "refresh_references_in",
          at: "finalize",
          changed: ["name"],
          on: ["save"],
          fn: refreshReferencesInEvent as ModEventFn,
        }),
        event({
          event: "clear_references",
          at: "finalize",
          on: ["delete"],
          fn: clearReferencesEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/result",
      events: [
        event({
          event: "notable_exception_raised",
          fn: notableExceptionRaisedEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/states",
    },
    {
      setPath: "all/subcards",
      events: [
        event({
          event: "reject_empty_subcards",
          at: "prepare_to_validate",
          fn: rejectEmptySubcardsEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/trash",
      events: [
        event({
          event: "manage_trash",
          at: "prepare_to_store",
          on: ["create"],
          fn: manageTrashEvent as ModEventFn,
        }),
        event({
          event: "validate_delete",
          at: "validate",
          on: ["delete"],
          fn: validateDeleteEvent as ModEventFn,
        }),
        event({
          event: "delete_children",
          after: "validate_delete",
          on: ["delete"],
          fn: deleteChildrenEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/type",
      events: [
        event({
          event: "validate_type_change",
          at: "validate",
          on: ["update"],
          changed: ["type_id"],
        }),
        event({
          event: "validate_type",
          at: "validate",
          changed: ["type_id"],
          on: ["save"],
          fn: validateTypeEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "all/utils",
    },
    {
      setPath: "right/autoname",
    },
    {
      setPath: "self/admin",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: adminCoreView, config: { cache: "never" } },
            { view: "warning", viewFn: adminWarningView },
          ],
        },
      },
      events: [
        event({
          event: "admin_tasks",
          at: "initialize",
          on: ["update"],
          fn: adminTasksEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "self/autoname",
      settingOpts: {
        group: "templating",
        position: 4,
        helpText:
          "Autogenerate name for new cards by incrementing this value. [[http://decko.org/autonaming|more]]",
      },
    },
    {
      setPath: "self/mod",
      formats: {
        html: {
          views: [
            { view: "cardtypes", viewFn: modCardtypesView },
            { view: "settings", viewFn: modSettingsView },
            { view: "tasks", viewFn: modTasksView },
            { view: "configurations", viewFn: modConfigurationsView },
            { view: "roles", viewFn: modRolesView },
          ],
        },
      },
    },
    {
      setPath: "self/trash",
    },
    {
      setPath: "self/version",
    },
    {
      setPath: "type/cardtype",
      events: [
        event({
          event: "check_for_cards_of_type",
          after: "validate_delete",
          fn: checkForCardsOfTypeEvent as ModEventFn,
        }),
        event({
          event: "check_for_cards_of_type_when_type_changed",
          at: "validate",
          changing: ["type"],
          when: "was_cardtype?",
          fn: checkForCardsOfTypeWhenTypeChangedEvent as ModEventFn,
        }),
        event({
          event: "validate_cardtype_name",
          at: "validate",
          on: ["save"],
          changed: ["name"],
          fn: validateCardtypeNameEvent as ModEventFn,
        }),
      ],
    },
    {
      setPath: "type/mod",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: modCardCoreHtml },
            { view: "description", viewFn: typeModDescriptionView },
            { view: "settings", viewFn: typeModSettingsView },
            { view: "cardtypes", viewFn: typeModCardtypesView },
            { view: "configurations", viewFn: typeModConfigurationsView },
            { view: "tasks", viewFn: typeModTasksView },
            { view: "styles", viewFn: typeModStylesView },
            { view: "scripts", viewFn: typeModScriptsView },
            { view: "gem_info", viewFn: typeModGemInfoView },
            { view: "depends_on", viewFn: typeModDependsOnView },
            { view: "views", viewFn: typeModViewsView },
            { view: "bar_right", viewFn: typeModBarRightView },
          ],
        },
      },
    },
  ],
  prepareEngine: async (host) => {
    moduleAdminHost = host;
    await prepareAdminRuntime(host);
  },
};

export default coreMod;

export {
  CORE_TASK_BASKET,
  CORE_WARNING_BASKET,
  adminRuntimeConfig,
  setAdminRuntimeConfig,
  resetAdminRuntimeConfig,
} from "./core-admin-runtime.js";
