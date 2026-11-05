import { stripHtmlTags as stripTags } from "../../render/html-text.js";
import { str } from "../../render/format.js";

import {
  ONE_LINE_CHARACTER_LIMIT,
  timeAgoInWords as sharedTimeAgoInWords,
  truncate,
  truncateHtmlSafeText,
} from "../../render/text-helpers.js";
import { cardWallClockNow } from "../../wall-clock.js";
import { modBarRightSections } from "./core-admin-runtime.js";
import { debugServerErrorView, serverErrorHtmlView } from "../../render/debug-server-error.js";
import {
  faviconTagBytes,
  HEAD_VIEWS,
  pageTitleBytes,
  pageTitleTagBytes,
  stylesheetTagsBytes,
  type HeadReadSet,
} from "../../render/head-views.js";
import { RenderFormat, vooJoint, wrappedTitleInner } from "../../render/format.js";
import type { ViewContext, ViewFn, ViewRawArray, ViewResult } from "../../render/format.js";
import { RubyRuntimeError, UnsupportedViewError } from "../../render/format.js";
import { h } from "../../render/slot-html.js";
import { DeckoName } from "../../name.js";
import {
  HTML_VIEWS,
  contentView as baseContentView,
  coreView as baseCoreView,
  toText,
  linkView,
  navLinkView,
  unknownView as htmlErrorUnknownView,
  miniUnknownView as htmlErrorMiniUnknownView,
} from "../../render/views.js";import { popoverLink } from "./card-mod-bootstrap.js";
import type {
  DeckoModManifest,
  ModSetModuleFile,
} from "../mod-manifest.js";
import { modSlotWrap, viewWrapInherited, superView } from "../mod-view-helpers.js";
import { cardFormShell } from "../mod-form-substrate.js";
import { allAdminConfigCodenamesOfCategory } from "./core-mod.js";
import { CardActionError } from "../../actions/types.js";
import { jsonValidationMessage, numberValidationMessage } from "./format-validations.js";
import { RSS_DISABLED_BYTES } from "../../render/format-families.js";
import { envOriginForSurface } from "../../render/deck-origin.js";

function dateView(ctx: ViewContext, sqlDate: string | undefined): string {
  if (sqlDate === undefined || sqlDate === "") return "";
  const date = parseSqlDate(sqlDate);
  if (date === null) return "";
  const variant = ctx.voo.opts["variant"];
  if (typeof variant === "string") {
    return formatStrftime(date, variant);
  }
  return sharedTimeAgoInWords(date, cardWallClockNow());
}

function parseSqlDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (m !== null) {
    return new Date(
      Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!),
    );
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatStrftime(date: Date, fmt: string): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return fmt
    .replace(/%Y/g, String(date.getUTCFullYear()))
    .replace(/%m/g, pad(date.getUTCMonth() + 1))
    .replace(/%d/g, pad(date.getUTCDate()))
    .replace(/%H/g, pad(date.getUTCHours()))
    .replace(/%M/g, pad(date.getUTCMinutes()))
    .replace(/%S/g, pad(date.getUTCSeconds()));
}

const nameView: ViewFn = ({ fmt, voo }) => {
  const variant = voo.opts["variant"];
  return typeof variant === "string" ? fmt.card.name.vary(variant).s : fmt.card.name.s;
};

const keyView: ViewFn = ({ fmt }) => fmt.card.key;

const linknameView: ViewFn = ({ fmt }) => fmt.urlKey();

const urlView: ViewFn = ({ fmt }) => fmt.cardUrl(fmt.urlKey());

const idUrlView: ViewFn = ({ fmt }) =>
  fmt.card.id === undefined ? "" : fmt.cardUrl(`~${fmt.card.id}`);

const urlLinkView: ViewFn = ({ fmt }) => {
  const href = uriCleanResource(fmt.cardUrl(fmt.urlKey()));
  const rt = uriResourceTypeOf(href);
  const target = rt === "external-link" ? ` target="_blank"` : "";
  const cls = rt === undefined ? "" : ` class="${rt}"`;
  return `<a${target}${cls} href="${h(href)}">${href}</a>`;
};

function uriResourceTypeOf(resource: string): string | undefined {
  if (/^https?:/.test(resource)) return "external-link";
  if (/^\//.test(resource)) return "internal-link";
  if (/^mailto:/.test(resource)) return "email-link";
  const m = /^([a-zA-Z][\-+.a-zA-Z\d]*):/.exec(resource);
  return m === null ? undefined : `${m[1]}-link`;
}

function uriCleanResource(resource: string): string {
  if (uriResourceTypeOf(resource) === "internal-link") {
    const stripped = resource.replace(/^\//, "");
    return /^(https?:)?\//.test(stripped) ? stripped : `/${stripped}`;
  }
  return resource;
}

const uriUrlLinkView: ViewFn = ({ fmt }) => {
  const resource = uriCleanResource(fmt.renderRaw());
  const rt = uriResourceTypeOf(resource);
  const target = rt === "external-link" ? ` target="_blank"` : "";
  const cls = rt === undefined ? "" : ` class="${rt}"`;
  return `<a${target}${cls} href="${h(resource)}">${resource}</a>`;
};

const uriTitleLinkView: ViewFn = ({ fmt }) => {
  const resource = uriCleanResource(fmt.renderRaw());
  const rt = uriResourceTypeOf(resource);
  const target = rt === "external-link" ? ` target="_blank"` : "";
  const cls = rt === undefined ? "" : ` class="${rt}"`;
  return `<a${target}${cls} href="${h(resource)}">${fmt.renderView("title_no_link")}</a>`;
};

const uriCoreView: ViewFn = ({ fmt }) => fmt.renderView("title_link");

const typeHtmlOneLineContentView: ViewFn = ({ fmt, voo }) => {
  const sizeOpt = voo.opts["size"];
  const length = typeof sizeOpt === "number" ? sizeOpt : ONE_LINE_CHARACTER_LIMIT;
  return truncateHtmlSafeText(stripTags(fmt.renderRaw()), length, "...");
};


const codenameView: ViewFn = ({ fmt }) => {
  const rec = fmt.card.record as unknown as Record<string, unknown>;
  const c = rec["codename"];
  return typeof c === "string" ? c : "";
};

const idView: ViewFn = ({ fmt }) => fmt.card.id ?? null;

const typeView: ViewFn = ({ fmt }) => fmt.card.typeName ?? "";

function readCardDate(fmt: RenderCardField, field: "createdAt" | "updatedAt"): string | undefined {
  const rec = fmt.card.record as unknown as Record<string, unknown>;
  const v = rec[field];
  return typeof v === "string" ? v : undefined;
}

interface RenderCardField {
  card: { record: unknown };
}
const createdAtView: ViewFn = (ctx) =>
  dateView(ctx, readCardDate(ctx.fmt as unknown as RenderCardField, "createdAt"));
const updatedAtView: ViewFn = (ctx) =>
  dateView(ctx, readCardDate(ctx.fmt as unknown as RenderCardField, "updatedAt"));
const actedAtView: ViewFn = (ctx) =>
  dateView(ctx, readCardDate(ctx.fmt as unknown as RenderCardField, "updatedAt"));

const rawView: ViewFn = ({ fmt }) => fmt.renderRaw();

const csvHeaderView: ViewFn = () => [["Name", "Type"]];

const csvRowView: ViewFn = ({ fmt }) => [fmt.renderView("name"), fmt.renderView("type")] as ViewResult;

const csvTitledView: ViewFn = ({ fmt }) => {
  const header = csvHeaderView({ fmt } as ViewContext) as ViewRawArray;
  const body = csvBodyRows(fmt);
  const rows = [...header, ...body];
  const lines: string[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) {
      throw new RubyRuntimeError("NoMethodError", "undefined method 'each' for an instance of String");
    }
    lines.push(row.map((cell) => csvCell(cell)).join(",") + "\n");
  }
  return lines.join("");
};

function csvCell(cell: unknown): string {
  const text = cell === null || cell === undefined ? "" : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvBodyRows(_fmt: ViewContext["fmt"]): ViewRawArray {
  throw new UnsupportedViewError("body", _fmt.card.name.s);
}

const csvUnknownView: ViewFn = () => "";

const fileCoreView: ViewFn = () => "File rendering of this card not yet supported";

const fileStyleView: ViewFn = () => null;

const jsSourceView: ViewFn = ({ fmt }) => fmt.cardUrl(`${fmt.urlKey()}.js`);

function jsonStatusView(ctx: ViewContext): ViewResult {
  const card = ctx.fmt.card;
  const status = card.unknown === true ? "unknown" : card.id !== undefined ? "real" : "virtual";
  const out: Record<string, unknown> = {
    key: card.key,
    url_key: card.name.urlKey,
    status,
  };
  if (status === "real") out["id"] = card.id;
  return out as ViewResult;
}

function jsonItemCards(fmt: ViewContext["fmt"]): unknown[] {
  if (fmt.card.dbContent.includes("{{")) throw new UnsupportedViewError("items", fmt.card.name.s);
  return [];
}

const jsonItemsView: ViewFn = ({ fmt }) => jsonItemCards(fmt) as ViewResult;

const jsonMoleculeView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const card = fmt.card;
  const molecule: Record<string, unknown> = { ...dataAtomView(ctx) as Record<string, unknown> };
  molecule["items"] = jsonItemCards(fmt);
  molecule["links"] = dataLinksView(ctx);
  molecule["ancestors"] = dataAncestorsView(ctx);
  molecule["html_url"] = fmt.cardUrl(fmt.urlKey());
  molecule["type"] = typeNucleus(fmt);
  molecule["created_at"] = utcTime(card.record.createdAt);
  molecule["updated_at"] = utcTime(card.record.updatedAt);
  return molecule as ViewResult;
};

const jsonPageView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const now = cardWallClockNow();
  const requestedAt = `${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;
  return {
    card: dataAtomView(ctx),
    url: fmt.cardUrl(fmt.urlKey()),
    requested_at: requestedAt,
  } as ViewResult;
};

function typeNucleus(fmt: ViewContext["fmt"]): Record<string, unknown> {
  const typeCard = fmt.card.typeName === undefined ? undefined : fmt.engine.fetchRenderCard(fmt.card.typeName);
  const name = fmt.card.typeName ?? "";
  const out: Record<string, unknown> = {
    id: fmt.card.typeId,
    name,
    type: typeCard?.typeName,
    url: fmt.cardUrl(`${DeckoName.parse(name).urlKey}.json`),
  };
  const code = typeCard?.record.codename;
  if (code) out["codename"] = code;
  return out;
}

function utcTime(sql: string | undefined): string | undefined {
  return sql === undefined ? undefined : `${sql} UTC`;
}

const dataPodView: ViewFn = ({ fmt }) => podHash(fmt);

const dataCoreView: ViewFn = ({ fmt }) => (fmt.card.id === undefined ? null : fmt.card.dbContent);

const dataContentView: ViewFn = ({ fmt }) => fmt.card.dbContent;

function dataNucleus(fmt: ViewContext["fmt"]): Record<string, unknown> {
  const card = fmt.card;
  const nucleus: Record<string, unknown> = {
    id: card.id,
    name: card.name.s,
    type: card.typeName,
    url: fmt.cardUrl(`${fmt.urlKey()}.json`),
  };
  if (card.record.codename) nucleus["codename"] = card.record.codename;
  return nucleus;
}
const dataNucleusView: ViewFn = ({ fmt }) => dataNucleus(fmt) as ViewResult;

const dataAtomView: ViewFn = ({ fmt }) => {
  const atom = dataNucleus(fmt);
  if (fmt.card.id !== undefined) atom["content"] = fmt.card.dbContent;
  return atom as ViewResult;
};

const dataMoleculeView: ViewFn = ({ fmt }) => {
  throw new RubyRuntimeError("NoMethodError", "undefined method 'item_cards' for the data format");
};

const dataAncestorsView: ViewFn = ({ fmt }) => {
  if (fmt.card.name.isSimple) return [];
  throw new UnsupportedViewError("ancestors", fmt.card.name.s);
};

const dataCastView: ViewFn = ({ fmt }) =>
  fmt.card.id !== undefined
    ? { id: fmt.card.id }
    : { name: fmt.card.name.s, type_id: fmt.card.typeId ?? null, content: fmt.card.dbContent };

const dataItemsView: ViewFn = () => {
  throw new RubyRuntimeError("NoMethodError", "undefined method 'item_cards' for the data format");
};

const dataLinksView: ViewFn = ({ fmt }) => {
  if (!fmt.card.dbContent.includes("[[")) return [];
  throw new UnsupportedViewError("links", fmt.card.name.s);
};

function podHash(fmt: ViewContext["fmt"]): Record<string, unknown> {
  const card = fmt.card;
  const name = card.name.isSimple
    ? card.name.s
    : card.name.partNames.map((part) => part.codename ?? part.s);
  const pod: Record<string, unknown> = {
    name,
    type: card.typeCode === "basic" ? undefined : card.typeCode ?? card.typeName,
    codename: card.record.codename ?? undefined,
    content: card.dbContent,
    fields: {},
  };
  for (const key of Object.keys(pod)) {
    const value = pod[key];
    const blank =
      value === undefined ||
      value === null ||
      value === "" ||
      (typeof value === "object" && Object.keys(value as object).length === 0);
    if (blank) delete pod[key];
  }
  return pod;
}

const yamlCoreView: ViewFn = ({ fmt }) => podHash(fmt);

const labeledContentView: ViewFn = ({ fmt }) => fmt.renderDelegated("core");

const titledContentView: ViewFn = ({ fmt }) => fmt.renderDelegated("core");

const blankView: ViewFn = () => "";

const labeledView: ViewFn = ({ fmt }) =>
  `${fmt.card.name.s}: ${fmt.renderDelegated("labeled_content")}`;

const htmlTypeView: ViewFn = ({ fmt }) => {
  const type = fmt.card.typeName ?? "";
  return `<a class="cardtype known-card" href="/${h(DeckoName.parse(type).urlKey)}">${type}</a>`;
};

const ENGINE_LABELED: ViewFn | undefined = HTML_VIEWS["labeled"];
const htmlLabeledView: ViewFn = (ctx) => (ENGINE_LABELED === undefined ? "" : ENGINE_LABELED(ctx));

const compactMissingView: ViewFn = ({ fmt }) =>
  `<span class="text-muted">${h(fmt.card.name.from(...fmt.contextNames))}</span>`;

const unknownView: ViewFn = htmlErrorUnknownView;

const miniUnknownView: ViewFn = htmlErrorMiniUnknownView;
const serverErrorView: ViewFn = () => "format.server_error";

const denialView: ViewFn = ({fmt}) => fmt.basePermissionDenial();

const denialHtmlView: ViewFn = ({ fmt, voo }) =>
  fmt.permissionDenialHtml(voo);

const notFoundView: ViewFn = ({ fmt }) => {
  const named = fmt.card.name.s !== "";
  return `Could not find ${named ? h(fmt.card.name.s) : "the card requested"}.`;
};

const badAddressView: ViewFn = ({ fmt }) => {
  fmt.setRootErrorStatus(404);
  return "404: Bad Address";
};

const badAddressHtmlView: ViewFn = ({ fmt }) => {
  fmt.setRootErrorStatus(404);
  return "404: Bad Address";
};

function cardtypeUrlKey(fmt: RenderFormatBase): string {
  return fmt.card.key ?? "";
}
function cardtypeAddPathSegment(fmt: RenderFormatBase): string {
  return (fmt.card.name?.s ?? "").replace(/ /g, "_");
}
function cardtypeAddLinkView({ fmt, voo }: ViewContext): string {
  const base = fmt as unknown as RenderFormatBase;
  const segment = cardtypeAddPathSegment(base);
  const label = `Add ${base.card.name?.s ?? ""}`;
  const safeLabel = h(label);
  return (
    `<a data-slotter-mode="modal" data-modal-class="modal-dialog modal-dialog-centered" ` +
    `class="slotter" href="/type/${h(segment)}?view=new_in_modal" ` +
    `data-remote="true"><span class="card-title" title="${safeLabel}">` +
    `${wrappedTitleInner(safeLabel, vooJoint(voo))}</span></a>`
  );
}
function cardtypeAddButtonView({ fmt, voo }: ViewContext): string {
  const base = fmt as unknown as RenderFormatBase;
  const segment = cardtypeAddPathSegment(base);
  const label = `Add ${base.card.name?.s ?? ""}`;
  const safeLabel = h(label);
  return (
    `<a data-slotter-mode="modal" data-modal-class="modal-dialog modal-dialog-centered" ` +
    `class="btn btn-secondary slotter" href="/type/${h(segment)}?view=new_in_modal" ` +
    `data-remote="true"><span class="card-title" title="${safeLabel}">` +
    `${wrappedTitleInner(safeLabel, vooJoint(voo))}</span></a>`
  );
}
function cardtypeAddUrlView({ fmt }: ViewContext): string {
  const delegating = fmt as unknown as RenderFormatBase & {
    renderDelegated(view: string): string;
  };
  return `${envOriginForSurface(false)}/${delegating.renderDelegated("add_path")}`;
}
interface RenderFormatBase {
  card: { key?: string; name?: { s: string } };
}

function cardtypeConfigureButtonView({ fmt }: ViewContext): string {
  return cardtypeConfigureAnchor(fmt as unknown as RenderFormatBase, "btn btn-secondary");
}

function cardtypeConfigureLinkView({ fmt }: ViewContext): string {
  return cardtypeConfigureAnchor(fmt as unknown as RenderFormatBase, undefined);
}

function cardtypeConfigureAnchor(fmt: RenderFormatBase, cssClass: string | undefined): string {
  const card = fmt.card as unknown as { typeName?: string; name: { s: string }; unknown?: boolean };
  if (card.typeName !== "Cardtype") {
    throw new UnsupportedViewError("configure_link", card.name.s);
  }
  const safeName = card.name.s;
  const plural = safeName.replace(/(\S+)$/, (w) =>
    /[^aeiouAEIOU]y$/.test(w)
      ? `${w.slice(0, -1)}ies`
      : /(s|x|z|ch|sh)$/i.test(w)
        ? `${w}es`
        : `${w}s`,
  );
  const titleText = `Configure ${plural}`;
  const escapedTitle = titleText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const href =
    `/${(fmt as unknown as { urlKey: () => string }).urlKey()}/board` +
    `?board%5Btab%5D=rules_tab` +
    `&amp;set=${encodeURIComponent(`${safeName}+*type`)
      .replace(/%20/g, "+")
      .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  const classes = `configure-type-link ms-3${cssClass ? ` ${cssClass}` : ""} ${
    card.unknown === true ? "wanted-card" : "known-card"
  }`;
  return (
    `<a class="${classes}"` +
    ` href="${href}">` +
    `<span class="card-title" title="${escapedTitle}">${escapedTitle}</span></a>`
  );
}

export const errorsBaseView: ViewFn = () => "Problem:\n\n";

export const errorsView: ViewFn = ({ fmt }) => {
  const errors = fmt.engine.attachedErrorsByKey?.get(fmt.card.key);
  if (errors === undefined || errors.length === 0) return null;
  const heading =
    fmt.card.name.s === "" ? "Problems" : `Problems with ${fmt.card.name.s}`;
  const messages = errors
    .map((entry) =>
      entry.attribute === "abort"
        ? h(entry.message)
        : `<p><strong>${h(entry.attribute.toUpperCase())}:</strong> ${h(entry.message)}</p>`,
    )
    .join("<hr>");
  return (
    `<div class="alert alert-warning alert-dismissible  card-error-msg" role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>\n` +
    `<h4 class="alert-heading error">${heading}</h4>\n` +
    `${messages}</div>`
  );
};

const labelView: ViewFn = ({ fmt }) => fmt.card.name.s.toString();

const closedContentView: ViewFn = ({ fmt, voo }) => {
  const sizeOpt = voo.opts["size"];
  const length = typeof sizeOpt === "number" ? sizeOpt : ONE_LINE_CHARACTER_LIMIT;
  return fmt.withNestMode("compact", () =>
    truncateHtmlSafeText(stripTags(str(fmt.renderView("core"))), length, "..."),
  );
};

const allHtmlViewsRawOneLineContentView: ViewFn = ({ fmt, voo }) => {
  const sizeOpt = voo.opts["size"];
  const length = typeof sizeOpt === "number" ? sizeOpt : ONE_LINE_CHARACTER_LIMIT;
  return `<div class="text-muted">${truncateHtmlSafeText(stripTags(fmt.renderRaw()), length, "...")}</div>`;
};

const hiddenContentFieldView: ViewFn = (ctx) => {
  const prefix =
    typeof ctx.voo.opts["form_name_prefix"] === "string"
      ? (ctx.voo.opts["form_name_prefix"] as string)
      : "card";
  const idPrefix = prefix === "card" ? "card" : prefix.replace(/\]/g, "").replace(/[\[+]/g, "_");
  return (
    `<input class="d0-card-content form-control" autocomplete="off" type="hidden" ` +
    `value="${h(ctx.fmt.card.dbContent)}" name="${prefix}[content]" id="${idPrefix}_content" />`
  );
};

const smartLabelView: ViewFn = ({ fmt }) => {
  const label = fmt.renderView("label");
  const desc = fmt.engine.fetchRenderCard(`${fmt.card.name.s}+description`);
  if (desc === undefined || desc.unknown === true) return label;
  const description = new RenderFormat(desc, fmt.engine, {
    parent: fmt,
    maxDepth: fmt.maxDepth,
    nestQuietErrors: fmt.nestQuietErrors,
  }).renderView("core");
  return `${label} ${popoverLink(str(description))}`;
};

function cssMajorComment(comment: string): string {
  const edge = `/* ${"-".repeat(Array.from(comment).length + 4)} */`;
  return `${edge}\n/* - ${comment} - */\n${edge}\n\n`;
}
const cssCoreView: ViewFn = ({ fmt }) => fmt.renderView("core");
const cssTitledView: ViewFn = ({ fmt }) =>
  cssMajorComment(` Style Card: \\"${fmt.card.name.s}\\" `) + str(fmt.renderView("core"));
const cssUnknownView: ViewFn = ({ fmt }) =>
  cssMajorComment(`MISSING Style Card: ${fmt.card.name.s}`);
const cssUrlView: ViewFn = ({ fmt }) => `/${fmt.urlKey()}.css`;

const rssContentView: ViewFn = ({ fmt }) => fmt.processContent(str(fmt.renderView("raw")));
const rssOpenView: ViewFn = ({ fmt }) => `${fmt.card.name.s}\n\n${str(fmt.renderView("core"))}`;
const rssItemDescriptionView: ViewFn = ({ fmt }) => fmt.renderView("open_content");
const rssEmptyView: ViewFn = () => "";
const rssTitleView: ViewFn = (ctx) =>
  `${headReadSetFromMap(ctx).titleSetting ?? ""} : ${ctx.fmt.card.name.s.replace(/^\*/, "")}`;

const rssFeedView: ViewFn = () => RSS_DISABLED_BYTES;

const RSS_PUB_DATE_ARGUMENT_ERROR = "wrong number of arguments (given 1, expected 0)";
const rssFeedBodyView: ViewFn = () => {
  throw new RubyRuntimeError("ArgumentError", RSS_PUB_DATE_ARGUMENT_ERROR);
};
const rssFeedItemView: ViewFn = () => {
  throw new RubyRuntimeError("ArgumentError", RSS_PUB_DATE_ARGUMENT_ERROR);
};

const flashView: ViewFn = () => "";

const shortContentView: ViewFn = ({ fmt }) => {
  let body: string;
  if (fmt.card.typeName === "Toggle") {
    body = str(fmt.renderView("core"));
  } else {
    const content = str(fmt.renderView("core"));
    const newlines = content.match(/\n/g)?.length ?? 0;
    if (content.length === 0) body = "empty";
    else if (content.length <= 5) body = content;
    else if (newlines < 2) body = `${content.length} characters`;
    else body = `${newlines + 1} lines`;
  }
  return `<div class="text-muted">${body}</div>`;
};

export const allHtmlViewsOneLineContentView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const sizeOpt = voo.opts["size"];
  const length = typeof sizeOpt === "number" ? sizeOpt : ONE_LINE_CHARACTER_LIMIT;
  return viewWrapInherited(
    ctx,
    "one_line_content",
    truncateHtmlSafeText(stripTags(str(fmt.renderView("core"))), length, "..."),
  );
};

const viewListView: ViewFn = ({ fmt }) => {
  const views = ["content", "titled", "labeled", "bar", "box", "open", "closed"];
  const parts: string[] = [];
  for (const v of views) {
    parts.push(`<p><h3>${v}</h3>\n${fmt.renderView(v, { show: ["menu"] })}</p>`);
  }
  return parts.join("");
};

export { demoViewSelect } from "../../render/demo-view.js";
import { demoView } from "../../render/demo-view.js";

const adminView: ViewFn = ({ fmt }) => fmt.renderView("core");

const typeModBarRightView: ViewFn = (ctx) =>
  modBarRightSections((ctx.fmt.card.record.codename ?? "").replace(/^mod_/, ""));

function sanitizeToId(name: string): string {
  return name.replace(/\]/g, "").replace(/[^-a-zA-Z0-9:.]/g, "_");
}

function toggleFormName(ctx: ViewContext): { name: string; id: string } {
  const prefix =
    typeof ctx.voo.opts["form_name_prefix"] === "string"
      ? (ctx.voo.opts["form_name_prefix"] as string)
      : "card";
  const name = `${prefix}[content]`;
  return { name, id: sanitizeToId(name) };
}

function toggleCheckBytes(ctx: ViewContext): string {
  const { name, id } = toggleFormName(ctx);
  const checked = ctx.fmt.card.dbContent === "1";
  return (
    `<input name="${h(name)}" type="hidden" value="0" autocomplete="off" />` +
    `<input type="checkbox" value="1"${checked ? ' checked="checked"' : ""} name="${h(name)}" id="${h(id)}" />`
  );
}

const toggleInputView: ViewFn = (ctx) => toggleCheckBytes(ctx);

const toggleLabeledEditorView: ViewFn = (ctx) => {
  const { id } = toggleFormName(ctx);
  return (
    toggleCheckBytes(ctx) +
    `<label for="${h(id)}">${h(ctx.fmt.card.name.tag)}</label>`
  );
};

function headReadSetFromMap(ctx: ViewContext): HeadReadSet {
  const engine = ctx.fmt.engine;
  return {
    titleSetting: engine.fetchRenderCard("*title")?.dbContent,
    faviconSource: engine.fetchRenderCard("*favicon")?.dbContent,
    styleAssetOutput: engine.fetchRenderCard("*all+*style+*asset output")?.dbContent,
  };
}

const pageTitleView: ViewFn = (ctx) => pageTitleBytes(headReadSetFromMap(ctx), ctx.fmt.card.name.s);

const pageTitleTagView: ViewFn = (ctx) =>
  pageTitleTagBytes(headReadSetFromMap(ctx), ctx.fmt.card.name.s);

const faviconTagView: ViewFn = (ctx) => faviconTagBytes(headReadSetFromMap(ctx));

const stylesheetTagsView: ViewFn = (ctx) => stylesheetTagsBytes(headReadSetFromMap(ctx));

const headView: ViewFn = ({ fmt }) => {
  const parts: string[] = [];
  for (const viewName of HEAD_VIEWS) {
    let bytes: string;
    try {
      const answer = fmt.renderView(viewName);
      if (answer === null) continue;
      bytes = str(answer);
    } catch (error) {
      if (error instanceof UnsupportedViewError) continue;
      throw error;
    }
    parts.push(bytes);
  }
  return parts.join("\n");
};

const setModules: ModSetModuleFile[] = [
  {
    setPath: "abstract/jsonld_support",
  },
  {
    setPath: "all/base",
    formats: {
      base: {
        views: [
          { view: "core", viewFn: baseCoreView, config: {} },
          { view: "content", viewFn: baseContentView, config: {} },
          { view: "name", viewFn: nameView, config: { perms: "none" } },
          { view: "key", viewFn: keyView, config: { perms: "none" } },
          { view: "linkname", viewFn: linknameView, config: { perms: "none" } },
          { view: "url", viewFn: urlView, config: { perms: "none" } },
          { view: "id_url", viewFn: idUrlView, config: {} },
          { view: "url_link", viewFn: urlLinkView, config: { perms: "none" } },
          { view: "link", viewFn: linkView, config: { perms: "none" } },
          { view: "nav_link", viewFn: navLinkView, config: { perms: "none" } },
          { view: "codename", viewFn: codenameView, config: {} },
          { view: "id", viewFn: idView, config: {} },
          { view: "type", viewFn: typeView, config: {} },
          { view: "created_at", viewFn: createdAtView, config: {} },
          { view: "updated_at", viewFn: updatedAtView, config: {} },
          { view: "acted_at", viewFn: actedAtView, config: {} },
          { view: "raw", viewFn: rawView },
          { view: "labeled_content", viewFn: labeledContentView, config: { unknown: "mini_unknown" } },
          { view: "titled_content", viewFn: titledContentView, config: { unknown: "blank" } },
          { view: "blank", viewFn: blankView, config: { perms: "none" } },
          { view: "labeled", viewFn: labeledView },
        ],
      },
    },
  },
  {
    setPath: "all/content",
    formats: {
      base: {
        views: [
          { view: "label", viewFn: labelView, config: { perms: "none" } },
          { view: "closed_content", viewFn: closedContentView, config: { perms: "none" } },
          { view: "smart_label", viewFn: smartLabelView, config: { cache: "never", unknown: true } },
        ],
      },
      html: {
        views: [
          { view: "hidden_content_field", viewFn: hiddenContentFieldView, config: { unknown: true, cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "all/css",
    formats: {
      css: {
        views: [
          { view: "titled", viewFn: cssTitledView },
          { view: "content", viewFn: cssCoreView },
          { view: "unknown", viewFn: cssUnknownView },
          { view: "import", viewFn: cssCoreView },
          { view: "url", viewFn: cssUrlView, config: { perms: "none" } },
        ],
      },
    },
  },
  {
    setPath: "all/csv",
    formats: {
      csv: {
        views: [
          { view: "header", viewFn: csvHeaderView, config: {} },
          { view: "row", viewFn: csvRowView, config: {} },
          { view: "unknown", viewFn: csvUnknownView, config: {} },
          { view: "titled", viewFn: csvTitledView, config: {} },
          { view: "body", viewFn: ({ fmt }) => csvBodyRows(fmt), config: {} },
        ],
      },
    },
  },
  {
    setPath: "all/data",
    formats: {
      data: {
        views: [
          { view: "pod", viewFn: dataPodView, config: {} },
          { view: "core", viewFn: dataCoreView, config: { unknown: true } },
          { view: "content", viewFn: dataContentView, config: {} },
          { view: "nucleus", viewFn: dataNucleusView, config: {} },
          { view: "atom", viewFn: dataAtomView, config: { unknown: true } },
          { view: "molecule", viewFn: dataMoleculeView, config: {} },
          { view: "ancestors", viewFn: dataAncestorsView, config: {} },
          { view: "cast", viewFn: dataCastView, config: {} },
          { view: "items", viewFn: dataItemsView, config: { cache: "never" } },
          { view: "links", viewFn: dataLinksView, config: {} },
        ],
      },
    },
  },
  {
    setPath: "all/demo",
    formats: {
      html: {
        views: [
          { view: "view_list", viewFn: viewListView },
          { view: "demo", viewFn: demoView },
        ],
      },
    },
  },
  {
    setPath: "all/error",
    formats: {
      json: {
        views: [
          ...["errors", "server_error", "denial", "not_found"].map(view =>
            ({view, viewFn: ({fmt}: ViewContext) => fmt.jsonErrorResult(), config: {perms: "none" as const}})),
          {view: "bad_address", config: {perms: "none"}, viewFn: ctx => {
            const message = badAddressView(ctx);
            ctx.fmt.addError("address", str(message));
            return ctx.fmt.renderView("errors");
          }},
        ],
      },
      jsonld: {
        views: [
          { view: "not_found", viewFn: () => JSON.stringify({
            "@context": "https://www.w3.org/ns/hydra/core#",
            "@type": "hydra:Error", "hydra:title": "404 | Not Found",
          }), config: { perms: "none" } },
          { view: "denial", viewFn: () => JSON.stringify({
            "@context": "https://www.w3.org/ns/hydra/core#",
            "@type": "hydra:Error", "hydra:title": "403 | Permission denied",
          }), config: { perms: "none" } },
          { view: "format_unsupported", viewFn: ({fmt}) => {
            fmt.setRootErrorStatus(406);
            return JSON.stringify({
              "@context": "https://www.w3.org/ns/hydra/core#",
              "@type": "hydra:Error",
              "hydra:title": "406 | JSON-LD is not available for this resource",
            });
          }, config: { perms: "none" } },
          { view: "test", viewFn: () => { throw new Error("blah"); } },
        ],
      },
      base: {
        views: [
          {view: "compact_missing", viewFn: () => "", config: {perms: "none"}},
          {view: "unknown", viewFn: () => "", config: {perms: "none", cache: "never"}},
          {view: "denial", viewFn: denialView, config: {perms: "none"}},
          { view: "not_found", viewFn: notFoundView, config: { perms: "none" } },
          { view: "bad_address", viewFn: badAddressView, config: { perms: "none" } },
        ],
      },
      html: {
        views: [
          { view: "compact_missing", viewFn: compactMissingView, config: { perms: "none" } },
          { view: "unknown", viewFn: unknownView, config: { perms: "none", cache: "never" } },
          { view: "mini_unknown", viewFn: miniUnknownView, config: { perms: "none" } },          { view: "server_error", viewFn: serverErrorView, config: { perms: "none" } },
          { view: "denial", viewFn: denialHtmlView, config: { perms: "none" } },
          { view: "bad_address", viewFn: badAddressHtmlView, config: { perms: "none" } },
          { view: "errors", viewFn: errorsView, config: { perms: "none" } },
        ],
      },
    },
  },
  {
    setPath: "all/html/error",
    formats: {
      html: {
        views: [
          { view: "server_error", viewFn: serverErrorHtmlView, config: { perms: "none" } },
          { view: "debug_server_error", viewFn: debugServerErrorView, config: { perms: "none" } },
          { view: "conflict", viewFn: HTML_VIEWS.conflict, config: { cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "all/file",
    formats: {
      file: {
        views: [
          { view: "core", viewFn: fileCoreView, config: {} },
          { view: "style", viewFn: fileStyleView, config: {} },
        ],
      },
    },
  },
  {
    setPath: "all/haml",
  },
  {
    setPath: "all/html",
    formats: {
      html: {
        views: [
          { view: "type", viewFn: htmlTypeView, config: { unknown: true } },
          { view: "type_info", viewFn: HTML_VIEWS.type_info, config: {} },
        ],
      },
    },
  },
  {
    setPath: "all/html/frame",
    formats: {
      html: {
        views: [
          { view: "flash", viewFn: flashView, config: { perms: "none", cache: "never", unknown: true } },
        ],
      },
    },
  },
  {
    setPath: "all/html/views",
    formats: {
      html: {
        views: [
          { view: "short_content", viewFn: shortContentView },
          { view: "one_line_content", viewFn: allHtmlViewsOneLineContentView, config: { unknown: "mini_unknown", wrap: { div: { class: "text-muted" } } } },
          { view: "raw_one_line_content", viewFn: allHtmlViewsRawOneLineContentView, config: { unknown: "mini_unknown" } },
          { view: "labeled", viewFn: htmlLabeledView, config: { unknown: "labeled", cache: "yes" } },
          { view: "content_with_title", viewFn: HTML_VIEWS.content_with_title, config: {} },
          { view: "content_panel", viewFn: HTML_VIEWS.content_panel, config: {} },
        ],
      },
    },
  },
  {
    setPath: "all/js",
    formats: {
      js: {
        views: [{ view: "source", viewFn: jsSourceView, config: {} }],
      },
    },
  },
  {
    setPath: "all/html/head",
    formats: {
      base: {
        views: [
          { view: "page_title", viewFn: pageTitleView, config: { perms: "none", unknown: true } },
        ],
      },
      html: {
        views: [
          { view: "head", viewFn: headView, config: { perms: "none", cache: "always", unknown: true } },
          { view: "meta_tags", viewFn: HTML_VIEWS.meta_tags, config: { perms: "none", unknown: true, template: "haml" } },
          { view: "page_title_tag", viewFn: pageTitleTagView, config: { perms: "none", unknown: true } },
          { view: "favicon_tag", viewFn: faviconTagView, config: { perms: "none", unknown: true } },
          { view: "universal_edit_button", viewFn: HTML_VIEWS.universal_edit_button, config: { perms: "update", unknown: "blank", denial: "blank" } },
          { view: "rss_links", viewFn: HTML_VIEWS.rss_links, config: { perms: "none", unknown: true } },
          { view: "stylesheet_tags", viewFn: stylesheetTagsView, config: { perms: "none", cache: "never", unknown: true } },
        ],
      },
    },
  },
  {
    setPath: "all/html/header",
    formats: {
      html: {
        views: [
          { view: "header", viewFn: HTML_VIEWS.header, config: { perms: "none" } },
          { view: "header_title", viewFn: HTML_VIEWS.header_title, config: { perms: "none" } },
        ],
      },
    },
  },
  {
    setPath: "all/html/menu",
    formats: {
      html: {
        views: [
          { view: "menu_block", viewFn: HTML_VIEWS.menu_block, config: {} },
          { view: "menu", viewFn: HTML_VIEWS.menu, config: { denial: "blank", unknown: true } },
          { view: "edit_link", viewFn: HTML_VIEWS.edit_link, config: { unknown: true, denial: "blank" } },
          { view: "edit_button", viewFn: HTML_VIEWS.edit_button, config: {} },
          { view: "full_page_link", viewFn: HTML_VIEWS.full_page_link, config: {} },
          { view: "board_link", viewFn: HTML_VIEWS.board_link, config: { unknown: true } },
          { view: "help_link", viewFn: HTML_VIEWS.help_link, config: { cache: "never", unknown: true } },
        ],
      },
    },
  },
  {
    setPath: "all/html/show",
  },
  {
    setPath: "all/html/wrap",
  },
  {
    setPath: "all/json",
    formats: {
      json: {
        views: [
          { view: "status", viewFn: jsonStatusView, config: { unknown: true, perms: "none" } },
          { view: "items", viewFn: jsonItemsView, config: { cache: "never" } },
          { view: "molecule", viewFn: jsonMoleculeView, config: {} },
          { view: "page", viewFn: jsonPageView, config: { cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "all/jsonld",
  },
  {
    setPath: "all/links",
  },
  {
    setPath: "all/path",
  },
  {
    setPath: "all/rss",
    formats: {
      rss: {
        views: [
          { view: "feed", viewFn: rssFeedView, config: { cache: "never" } },
          { view: "feed_body", viewFn: rssFeedBodyView, config: { cache: "never" } },
          { view: "feed_title", viewFn: rssTitleView },
          { view: "feed_item", viewFn: rssFeedItemView },
          { view: "feed_item_description", viewFn: rssItemDescriptionView },
          { view: "feed_description", viewFn: rssEmptyView },
          { view: "comment_box", viewFn: rssEmptyView },
          { view: "menu", viewFn: rssEmptyView },
          { view: "open", viewFn: rssOpenView },
          { view: "content", viewFn: rssContentView },
          { view: "open_content", viewFn: rssContentView },
          { view: "closed", viewFn: linkView, config: { perms: "none" } },
        ],
      },
    },
  },
  {
    setPath: "all/text",
    formats: {
      base: {
        views: [
          { view: "text_without_nests", viewFn: HTML_VIEWS.text_without_nests, config: {} },
        ],
      },
      text: {
        views: [{view: "core", viewFn: ctx => toText(str(superView(ctx, "All::Text", "core")))}],
      },
    },
  },
  {
    setPath: "all/title",
    formats: {
      base: {
        views: [
          { view: "title", viewFn: HTML_VIEWS.title, config: { perms: "none" } },
        ],
      },
      html: {
        views: [
          { view: "title", viewFn: HTML_VIEWS.title, config: {} },
          { view: "title_no_link", viewFn: HTML_VIEWS.title_no_link, config: { perms: "none" } },
        ],
      },
    },
  },
  {
    setPath: "all/yaml",
    formats: {
      yaml: {
        views: [{ view: "core", viewFn: yamlCoreView, config: {} }],
      },
    },
  },
  {
    setPath: "right/head",
  },
  {
    setPath: "self/home",
    formats: {
      base: {
        views: [
          { view: "home_url", viewFn: HTML_VIEWS.home_url, config: { perms: "none" } },
          { view: "home_path", viewFn: HTML_VIEWS.home_path, config: { perms: "none" } },
        ],
      },
    },
  },
  {
    setPath: "type/basic",
  },
  {
    setPath: "type/cardtype",
    formats: {
      html: {
        views: [
          { view: "type", viewFn: htmlTypeView, config: { unknown: true } },
          { view: "add_link", viewFn: cardtypeAddLinkView },
          { view: "add_button", viewFn: cardtypeAddButtonView },
          { view: "add_url", viewFn: cardtypeAddUrlView },
          { view: "configure_button", viewFn: cardtypeConfigureButtonView },
          { view: "configure_link", viewFn: cardtypeConfigureLinkView, config: { cache: "never" } },
        ],
      },
    },
  },
  {
    setPath: "type/html",
    formats: {
      html: {
        views: [
          { view: "one_line_content", viewFn: typeHtmlOneLineContentView, config: {} },
        ],
      },
    },
  },
  {
    setPath: "type/json",
    events: [
      {
        event: "validate_json",
        at: "validate",
        on: ["save"],
        changed: ["content"],
        fn: (card) => {
          const message = jsonValidationMessage(card.dbContent ?? "");
          if (message !== null) {
            throw new CardActionError("user-error", message, message, {
              "invalid json": message.replace(/^INVALID JSON: /, ""),
            }, card.name);
          }
        },
      },
    ],
  },
  {
    setPath: "type/mod",
    formats: {
      html: {
        views: [
          { view: "admin", viewFn: adminView },
          { view: "bar_right", viewFn: typeModBarRightView },
        ],
      },
    },
  },
  {
    setPath: "type/number",
    events: [
      {
        event: "validate_number",
        at: "validate",
        on: ["save"],
        fn: (card) => {
          const message = numberValidationMessage(card.dbContent ?? "");
          if (message !== null) {
            const bare = message.replace(/^[A-Z0-9_*+ ]+: /, "");
            throw new CardActionError("user-error", message, message, { content: bare }, card.name);
          }
        },
      },
    ],
  },
  {
    setPath: "type/phrase",
  },
  {
    setPath: "type/plain_text",
  },
  {
    setPath: "type/toggle",
    formats: {
      html: {
        views: [
          { view: "input", viewFn: toggleInputView },
          { view: "labeled_editor", viewFn: toggleLabeledEditorView },
        ],
      },
    },
  },
  {
    setPath: "type/uri",
    formats: {
      html: {
        views: [
          { view: "title_link", viewFn: uriTitleLinkView, config: {} },
          { view: "url_link", viewFn: uriUrlLinkView, config: {} },
          { view: "core", viewFn: uriCoreView, config: {} },
        ],
      },
    },
  },
];

const cardModFormat: DeckoModManifest = {
  name: "format",
  gemName: "card-mod-format",
  group: "gem-card",
  setModules,
};

export default cardModFormat;
