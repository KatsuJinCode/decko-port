import { htmlToText } from "./html-text.js";
import { str, type ViewResult } from "./format.js";

import { DeckoName } from "../name.js";
import { CodenameNotFoundError, NameNotFoundError } from "../name/errors.js";
import { actionTypeFromCode } from "../history/action.js";
import { getNameEnvironment } from "../name/environment.js";
import { timeAgoInWords } from "./text-helpers.js";
import { cardWallClockNow } from "../wall-clock.js";
import { searchPagingNav } from "./search-paging.js";
import { footerDeckoVersion, serializerFollowsLive } from "./deployment-follow-live-config.js";
import { deploymentReferenceAttachmentSource } from "./deployment-reference-storage.js";
import type { UpdaterCardInfo } from "../history/updater-seam.js";
import { isNewCard } from "../fetch/card-record.js";
import { recentChangesCoreBytes } from "../mod-loader/mods/card-mod-history.js";
import { cgiEscape, emitAttrs, emitHamlAttrs, h, newSlotId, slotOptionsJson, slotOptionsWithNameContext } from "./slot-html.js";
import { hamlSlotInHash } from "./haml-slot-style.js";
import {
  registerAllGemTypeAssignments,
  registerSetTypeAssignment,
} from "../set-patterns/set-type-assignment.js";
import { safeSetKeys } from "./set-keys.js";
import { anchoredModuleCandidates, rubySelfToken } from "./set-keys-to-modules.js";
import { SET_INCLUDES } from "../mod-loader/concrete-set-includes.js";
import { pluralize } from "../name/inflect.js";

import {
  UnsupportedViewError,
  RenderFormat,
  escapeLiteralForCard,
  expandContentLinks,
  rubyChunkListForCardType,
  COMMON_SETTINGS,
  FIELD_SETTINGS,
} from "./format.js";
import { wrappedTitleInner, vooJoint } from "./format.js";
import { quietRenderError } from "./format.js";
import { virtualSearchCodenameResolverFor } from "./format.js";
import { virtualSearchCqlFor } from "../fetch/virtual-search-cards.js";
import { wantedHrefQuerySuffix } from "./format.js";
import type { RenderCard, RenderEngineLike, SettingClassWithRules, ViewContext, ViewFn, Voo } from "./format.js";
import {
  isInputTypeRuleCard,
  isPointerOrListCard,
  isRuleCardWithPermissionRight,
  pointerListCoreHtml,
  pointerListItemSlot,
  pointerListItemBodyForUnknown,
  rawItemStrings,
  resolvePointerItemName,
  phantomPointerListItem,
} from "./pointer-list.js";
import { readMiniBarCols, readBarCols, readFullBarCols } from "./bar-cols.js";
import { permissionInheritContentHtml, ruleBarRightHtml } from "./rule-bar-right.js";
import { modBarRightSections, modChildAssetGroups } from "../mod-loader/mods/core-admin-runtime.js";
import { modAssetGroupsCoreHtml } from "./haml-file-views.js";
import { signinCoreHtml } from "./signin-core-form-view.js";
import { processHelpContent } from "./help-popover.js";
import { registeredSettingHelpText } from "./setting-help-text.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { highlight, langForTypeCode } from "./code-highlighting/index.js";
import { codedSvgFileBytes } from "./coded-attachment-files.js";
import { dateError, parseRubyDateContent } from "./errors.js";
import { buildVirtualRuleCard, ruleTypeIdForSetting } from "./virtual-rule-card.js";
import { NAVBAR_VIEWS, accountLinksCoreHtml } from "./navbar-views.js";
import { DEFAULT_TOKEN_EXPIRY_SECONDS } from "../auth/token.js";
import { scanNests, interpretEscapedLiteral } from "./nest-syntax.js";
import { kramdownToStashedHtml } from "./kramdown.js";
import { cardBelongsToSet, registerBuiltInContentOverride, resolveContentOverride, resolveContentOverrideEntry } from "./content-overrides.js";
import { whenCreatedContentFn, whenLastEditedContentFn } from "../mod-loader/mods/card-mod-date.js";
import { signupCoreHtml } from "../mod-loader/mods/card-mod-account.js";
import { bootswatchSkinCoreHtml } from "../mod-loader/mods/card-mod-bootstrap.js";
import { cardFormRecaptcha, templateNestView } from "../mod-loader/mods/card-mod-edit.js";
import {
  boardView,
  cardboardView,
  conflictTrackerView,
  contentFormgroupView,
  contentFormgroupsView,
  editButtonsView,
  editFormView,
  editNameRowView,
  editTypeRowView,
  editView,
  engageTabView,
  followSectionView,
  guideTabView,
  historyTabView,
  inputView,
  nameFormgroupView,
  newButtonsView,
  newFieldsView,
  newTypeFormgroupView,
  newView,
  relatedTabView,
  rulesTabView,
} from "../mod-loader/mods/card-mod-edit.js";
import { guideView, helpTextView, helpView } from "../mod-loader/mods/card-mod-help.js";
import { leadView as helpLeadView } from "../mod-loader/mods/card-mod-help.js";
import { roleConfigsView, modCardCoreHtml } from "../mod-loader/mods/core-mod.js";
import { demoView } from "./demo-view.js";

registerBuiltInContentOverride({
  setPath: "right/*when_created",
  modName: "date",
  fn: whenCreatedContentFn,
});
registerBuiltInContentOverride({
  setPath: "right/*when_last_edited",
  modName: "date",
  fn: whenLastEditedContentFn,
});

const CARD_GEM_VERSION = "0.20.0";

function slotId(card: RenderCard, view: string): string {
  return `${card.name.safeKey}-${view}-view`;
}

function slotCardname(card: RenderCard): string {
  const name = card.name;
  return isNewCard(card.record) && name.isCompound ? name.urlKey : name.s;
}

export { slotOptionsWithNameContext } from "./slot-html.js";

export function modViewSlotWrap(
  ctx: ViewContext,
  view: string,
  wrapClasses: string,
  inner: string,
): string {
  const { fmt, voo } = ctx;
  const card = fmt.card;
  const classes = `${voo.classy(["card-slot", `${view}-view`, card.setKeys])} ${wrapClasses}`;
  const attrs = emitAttrs({
    id: slotId(card, view),
    class: classes,
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": slotCardname(card),
    "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
    "data-card-type-name": card.typeName,
    "data-card-link-name": fmt.urlKey(),
    "data-slot-id": newSlotId(),
    "data-slot": slotOptionsWithNameContext(fmt, voo),
  });
  return `<div${attrs}>${inner}</div>`;
}

function slotWrap(
  ctx: ViewContext,
  view: string,
  inner: string,
  extraAttrs?: Record<string, string | undefined>,
): string {
  const { fmt, voo } = ctx;
  const card = fmt.card;
  const classes = voo.classy(["card-slot", `${view}-view`, card.setKeys]);
  const attrs = emitAttrs({
    id: slotId(card, view),
    class: classes,
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": slotCardname(card),
    "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
    "data-card-type-name": card.typeName,
    "data-card-link-name": fmt.urlKey(),
    "data-slot-id": newSlotId(),
    "data-slot": slotOptionsWithNameContext(fmt, voo),
    ...extraAttrs,
  });
  return `<div${attrs}>${inner}</div>`;
}

const titleNoLinkView: ViewFn = ({ fmt, voo }) => {
  const rawTitle = voo.opts["title"];
  const explicit = typeof rawTitle === "string" && rawTitle !== "" ? rawTitle : undefined;
  const override =
    explicit ?? fmt.selfSetTitleOverride()
  const title =
    explicit !== undefined
      ? fmt.standardTitle()
      : (override ?? fmt.standardTitle());
  const attr = title.replace(/"/g, "&quot;");
  const parts = wrappedTitleInner(title, vooJoint(voo));
  return `<span class="card-title" title="${attr}">${parts}</span>`;

};

const titleView: ViewFn = titleNoLinkView;

const titleLinkView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const klass = fmt.card.unknown === true ? "wanted-card" : "known-card";
  return `<a class="${klass}" href="/${h(fmt.urlKey())}">${fmt.renderView("title_no_link")}</a>`;
};

const openContentView: ViewFn = (ctx) =>
  ctx.fmt.renderDelegated("core", { skip_perms: true });

function icon(name: string): string {
  return `<i class="notranslate material-icons">${name}</i>`;
}

function linkToCard(href: string, text: string, attrs: Record<string, string | number | undefined>): string {
  return `<a${emitAttrs(attrs)}>${text}</a>`;
}

function helpTitle(ctx: ViewContext): string {
  const { fmt } = ctx;
  const parts = fmt.card.name.parts
    .map((part) => `<a class="known-card" href="/${h(DeckoName.parse(part).urlKey)}">${part}</a>`)
    .join("+");
  const type = fmt.card.typeName ?? "";
  const typeLink = `<a class="cardtype known-card" href="/${h(DeckoName.parse(type).urlKey)}">${type}</a>`;
  let title = `${parts} (${typeLink}) `;
  if (!fmt.card.name.isSimple) {
    title += `<a class="full-page-link known-card" href="/${h(fmt.urlKey())}">${icon("open_in_full")} </a>`;
  }
  return title;
}

function menuHelpAnchor(ctx: ViewContext): string {
  const { fmt } = ctx;
  const rawHelp = fmt.menuHelpContentBytes();
  const helpContent = /^\s*$/.test(rawHelp) ? "&nbsp;" : rawHelp;
  return (
    `<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus" data-bs-content="${h(helpContent)}"` +
    ` data-bs-placement="left" class="help-link ps-1 _popover_link _card-menu-popover"` +
    ` data-bs-title="${h(helpTitle(ctx))}" href="#">${icon("help")}</a>`
  );
}

function menuEditAnchor(fmt: RenderFormat): string {
  const url = fmt.urlKey();
  return (
    `<a rel="nofollow" class="edit-link slotter" title="Edit" data-bs-toggle="tooltip" data-bs-placement="bottom"` +
    ` data-slotter-mode="modal" data-modal-class="modal-lg" href="/${h(url)}/edit" data-remote="true">${icon("edit")} </a>`
  );
}

function menuBoardAnchor(fmt: RenderFormat, opts: { inModal: boolean }): string {
  const url = fmt.urlKey();
  const unknownQuery =
    fmt.card.unknown === true ? wantedHrefQuerySuffix(fmt.card.name.s) : "";
  const slotterMode = opts.inModal ? ` data-slotter-mode="modal-replace"` : "";
  return (
    `<a rel="nofollow" class="board-link slotter" title="Advanced" data-bs-toggle="tooltip" data-bs-placement="bottom"${slotterMode}` +
    ` href="/${h(url)}/board${unknownQuery}" data-remote="true">${icon("space_dashboard")} </a>`
  );
}

const menuView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  if (fmt.card.unknown === true) return "";
  const help = menuHelpAnchor(ctx);
  const edit = menuEditAnchor(fmt);
  const board = menuBoardAnchor(fmt, { inModal: false });
  const menuClasses = `card-menu nodblclick${voo.show("hover_link") ? " _show-on-hover" : ""}`;
  return `<div class="${menuClasses}">${help}\n${edit}\n${board}</div>`;
};

const menuBlockView: ViewFn = (ctx) => {
  const menu = ctx.fmt.renderView("menu");
  return `<div class="menu-block position-relative py-2">${menu}
&nbsp;</div>`;
};

const editLinkView: ViewFn = ({ fmt }) => menuEditAnchor(fmt);

const editButtonView: ViewFn = ({ fmt, voo }) => {
  const view = voo.opts["edit"] === "inline" ? "edit_inline" : "edit";
  const suffix = view === "edit" ? "/edit" : "/edit_inline";
  return (
    '<a rel="nofollow" class="btn btn-sm btn-outline-primary me-2 slotter"' +
    ` href="/${h(fmt.urlKey())}${suffix}" data-remote="true">Edit</a>`
  );
};

const fullPageLinkView: ViewFn = ({ fmt }) => {
  const klass =
    (fmt.card.unknown === true ? "wanted-card" : "known-card");
  return (
    `<a class="full-page-link ${klass}" href="/${h(fmt.urlKey())}">` +
    `${icon("open_in_full")} </a>`
  );
};

const boardLinkView: ViewFn = ({ fmt }) => menuBoardAnchor(fmt, { inModal: true });

const helpLinkView: ViewFn = (ctx) => menuHelpAnchor(ctx);

export const contentView: ViewFn = ({ fmt, voo }) => {
  const parts = [
    voo.explicitShow("menu") ? fmt.renderView("menu") : undefined,
    fmt.renderDelegated("core"),
    voo.explicitShow("edit_button") ? fmt.renderView("edit_button", { edit: "inline" }) : undefined,
  ].filter((p) => p !== undefined);
  return slotWrapCommon(fmt, "content", parts.join("\n"));
};

function slotWrapCommon(fmt: ViewContext["fmt"], view: string, inner: string): string {
  const voo = fmt.voo;
  if (voo === undefined) throw new Error("slotWrapCommon outside a render");
  return slotWrap({ fmt, voo }, view, inner);
}

const contentPanelView: ViewFn = ({ fmt }) => {
  const inner = `<div class="card-body">${fmt.renderView("menu")}
${fmt.renderDelegated("core")}</div>`;
  return slotWrapCommon(fmt, "content_panel", inner);
};

function textFormatCoreFor(fmt: RenderFormat, depth: number): string {
  const card = fmt.card;
  const listFamily = card.typeCode === "pointer" || card.typeCode === "list" || card.typeCode === "list_mod";
  if (listFamily) {
    return rawItemStrings(card.dbContent ?? "").join(", ");
  }
  const structure =
    fmt.engine.structureRuleForSync?.({
      name: card.name.s,
      id: card.id,
      typeId: card.typeId,
      typeName: card.typeName,
      isNew: card.record.isNew === true,
    });
  const content = structure !== undefined ? structure.content : (card.dbContent ?? "");
  if (depth <= 0) return content;
  let out = "";
  let cursor = 0;
  for (const piece of scanNests(content)) {
    if (piece.kind !== "nest" || piece.nest === undefined) continue;
    const nest = piece.nest;
    if (nest.comment !== undefined) continue;
    const openText = `{{${nest.syntax}}}`;
    const at = content.indexOf(openText, cursor);
    if (at === -1) continue;
    out += content.slice(cursor, at);
    cursor = at + openText.length;
    const target = DeckoName.parse(nest.name).absoluteName(card.name);
    const view = typeof nest.options.view === "string" && nest.options.view !== "" ? nest.options.view : "name";
    out += baseFormatNestRender(fmt, target.s, view, depth - 1);
  }
  if (cursor === 0) return content;
  out += content.slice(cursor);
  return out;
}

function baseFormatNestRender(
  fmt: RenderFormat,
  targetName: string,
  view: string,
  depth: number,
): string {
  const target = fmt.engine.fetchRenderCard(targetName) ?? fmt.newCardFor(targetName);
  switch (view) {
    case "name":
      return target.name.s;
    case "link": {
      const text = target.name.s;
      const url = fmt.cardUrl(DeckoName.parse(target.name.s).urlKey);
      return text !== url ? `${text}[${url}]` : url;
    }
    case "closed":
    case "labeled":
      return `${target.name.s}: ${textFormatCoreFor(
        new RenderFormat(target, fmt.engine, { parent: fmt, maxDepth: fmt.maxDepth }),
        depth,
      )}`;
    default:
      return textFormatCoreFor(
        new RenderFormat(target, fmt.engine, { parent: fmt, maxDepth: fmt.maxDepth }),
        depth,
      );
  }
}

const contentWithTitleView: ViewFn = ({ fmt }) => {
  const core = fmt.renderDelegated("core");
  const title = toText(textFormatCoreFor(fmt, 3));
  const inner = `${fmt.renderView("menu")}
${core}`;
  const voo = fmt.voo;
  if (voo === undefined) throw new Error("content_with_title outside a render");
  return slotWrap({ fmt, voo }, "content_with_title", inner, { title });
};

export function toText(html: string): string {
  return htmlToText(html);
}

const textWithoutNestsView: ViewFn = ({ fmt }) => {
  const pieces = scanNests(fmt.renderRaw());
  let nestless = "";
  for (const piece of pieces) {
    if (piece.kind === "nest") continue;
    if (piece.kind === "escaped") {
      nestless += interpretEscapedLiteral(piece.text, (literal) =>
        escapeLiteralForCard(fmt.card, literal),
      );
      continue;
    }
    nestless += expandContentLinks(piece.text, fmt.engine);
  }
  return toText(nestless);
};

const conflictView: ViewFn = ({ fmt }) => {
  const reader = fmt.engine.historyRenderReader?.();
  if (reader === undefined) {
    throw new Error(
      "conflict rendered without the render-time history seam (RenderEngine#prepareHistoryRender)",
    );
  }
  const last = reader.cardLastAction;
  const act = last === undefined ? undefined : reader.actById(Number(last.card_act_id));
  const actor = act?.actor_id === undefined || act?.actor_id === null
    ? undefined
    : reader.cardInfo(Number(act.actor_id));
  const actorLink =
    actor === undefined
      ? ""
      : `<a class="${actor.renderCard?.unknown === true ? "wanted-card" : "known-card"}" href="/${h(DeckoName.parse(actor.name).urlKey)}">${h(actor.name)}</a>`;
  const lastActionId = last === undefined ? "" : String(last.id);
  const actBytes = fmt.renderView("act");
  const alertBody =
    "\n          <strong>Conflict!</strong>\n" +
    `          <span class="new-current-revision-id">${h(lastActionId)}</span>\n` +
    `          <div>${actorLink} has also been making changes.</div>\n` +
    "          <div>Please examine below, resolve above, and re-submit.</div>\n" +
    `          ${actBytes}\n        `;
  const inner = `<div class="alert alert-warning" role="alert">${alertBody}</div>`;
  return slotWrapCommon(fmt, "conflict", inner);
};

function accountFieldNest(ctx: ViewContext, field: string, title: string): string {
  const fullName = `${ctx.fmt.card.name.s}+*${field}`;
  return ctx.fmt.nest({
    name: fullName,
    syntax: `{{${fullName} | view: labeled}}`,
    options: { title, view: "labeled", extra: {} },
    comment: undefined,
  });
}

const accountCoreHtml: ViewFn = (ctx) =>
  [accountFieldNest(ctx, "email", "email"), accountFieldNest(ctx, "password", "password")].join(
    "\n",
  );

function isFollowersJunctionCard(card: RenderCard): boolean {
  return cardBelongsToSet(card, "right/followers");
}

const coreViewBase: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.record.codename === "version") {
    return footerDeckoVersion() ?? CARD_GEM_VERSION;
  }
  if (fmt.card.key === "*account_link") {
    return accountLinksCoreHtml(ctx);
  }
  {
    const overrideEntry = resolveContentOverrideEntry(fmt);
    if (overrideEntry !== undefined && overrideEntry.supersedesType !== false) {
      return overrideEntry.fn(fmt);
    }
  }
  if (fmt.card.setKeys.split(" ").includes("SELF-Xhead")) {
    let rootFormat: RenderFormat = fmt;
    while (rootFormat.parent !== undefined) rootFormat = rootFormat.parent;
    const head = fmt.engine.pageHeadBytesFor?.(rootFormat.card.key);
    if (head === undefined) return "";
    return fmt.isMain ? h(head) : head;
  }
  if (fmt.card.setKeys.split(" ").includes("RIGHT-Xhead")) {
    return fmt.processContent(highlight(fmt.renderRaw(), "html"));
  }
  if (fmt.card.typeCode === "signup" || fmt.card.typeName === "Sign up") {
    return signupCoreHtml(ctx);
  }
  if (fmt.card.name.isCompound && fmt.card.name.rightName?.key === "*account") {
    return accountCoreHtml(ctx);
  }
  if (fmt.card.typeCode === "toggle" || fmt.card.typeName === "Toggle") {
    return formatToggleCore(fmt.card.dbContent);
  }
  if (fmt.card.typeCode === "plain_text" || fmt.card.typeName === "PlainText") {
    return fmt.processContent(h(fmt.renderRaw()));
  }
  if (fmt.card.setKeys.split(" ").includes("SELF-Xrecent")) {
    const reader = fmt.engine.historyRenderReader?.();
    if (reader === undefined) {
      throw new Error(
        "*recent :core reached without the render-time history seat - " +
          "the render path must seat RenderEngine#prepareHistoryRender('recent') " +
          "before dispatching (render.ts ROOT gate + nested-closure scan)",
      );
    }
    return recentChangesCoreBytes(fmt, reader);
  }
  if (fmt.card.typeCode === "search_type" || fmt.card.typeName === "Search") {
    if (
      (fmt.engine.cardIsRule?.(fmt.card) ?? false) ||
      (fmt.engine.cardMatchesRuleSet?.(fmt.card) ?? false)
    ) {
      return fmt.renderRaw();
    }
    if (fmt.card.record.codename === "search") return `\n${fmt.renderView("card_list")}`;
    const count = fmt.engine.searchResultCount?.(fmt);
    if (count !== undefined) return String(count);
    return fmt.renderView("card_list");
  }
  if (isModAssetsChildCard(ctx)) {
    return modAssetsChildCoreHtml(ctx);
  }
  if (isRuleCardWithPermissionRight(fmt.card) && fmt.card.dbContent === '_left') {
    return permissionInheritContentHtml(undefined);
  }
  if (isPointerOrListCard(fmt.card) || isFollowersJunctionCard(fmt.card)) {
    const items = rawItemStrings(resolveContentOverride(fmt) ?? fmt.card.dbContent)
      .filter((s) => s.length > 0)
      .map((s) => resolvePointerItemName(s, fmt.card.name));
    const itemsOpt: unknown = fmt.voo?.liveItems ?? fmt.voo?.opts["items"];
    const itemView =
      itemsOpt !== null && typeof itemsOpt === "object" &&
      typeof (itemsOpt as { view?: unknown }).view === "string"
        ? (itemsOpt as { view: string }).view
        : isInputTypeRuleCard(fmt.card) ? "name" : "bar";
    return pointerListCoreHtml(
      fmt.card,
      items,
      (name) => renderPointerListItem(fmt, name, itemView),
      itemView,
      undefined,
      typeof fmt.voo?.opts["separator"] === "string"
        ? (fmt.voo?.opts["separator"] as string)
        : undefined,
    );
  }
  if (fmt.card.typeCode === "set") {
    return setRulesCoreHtml(ctx);
  }
  if (fmt.card.typeCode === "setting" || fmt.card.typeName === "Setting") {
    return settingCoreHtml(ctx);
  }
  if (fmt.card.typeCode === "date" || fmt.card.typeName === "Date") {
    return formatDateCore(fmt.card.dbContent);
  }
  if (fmt.card.typeCode === "image" || fmt.card.typeName === "Image") {
    return formatImageCore(
      fmt.card.dbContent,
      fmt.card.id,
      fmt.card.name.s,
      fmt.voo?.opts.size ?? (fmt.isMain ? "large" : "medium"),
      fmt.engine.imageCdnHost,
    );
  }
  if (fmt.card.typeCode === "file" || fmt.card.typeName === "File") {
    return formatFileCore(fmt.card.dbContent, {
      cardName: fmt.card.name.s,
      contextNames: fmt.contextNames,
      cardId: fmt.card.id,
    });
  }
  if (fmt.card.typeCode === "markdown" || fmt.card.typeName === "Markdown") {
    return fmt.processContent(kramdownToStashedHtml(fmt.renderRaw()));
  }
  if (fmt.card.typeCode === "mod" || fmt.card.typeName === "Mod") {
    return modCardCoreHtml(ctx);
  }
  if (fmt.card.typeCode === "bootswatch_skin" || fmt.card.typeName === "Bootswatch skin") {
    return bootswatchSkinCoreHtml(ctx);
  }
  const codeLang = langForTypeCode(fmt.card.typeCode);
  if (codeLang !== undefined) {
    const body = highlight(fmt.renderRaw(), codeLang);
    const chunkList = rubyChunkListForCardType(fmt.card.typeCode, fmt.card.typeName);
    if (fmt.card.typeCode === "layout_type") {
      return fmt.withNestMode("template", () => fmt.processContent(body, chunkList));
    }
    return fmt.processContent(body, chunkList);
  }
  if (fmt.card.name.key === "mod") {
    const searchKey = DeckoName.parse("+*type+by name")
      .absoluteName(DeckoName.parse(fmt.card.name.s)).key;
    const stubFmt = { card: { key: searchKey } } as unknown as RenderFormat;
    const items = fmt.engine.executeSearch(stubFmt);
    const paging = fmt.engine.searchResultPaging?.(stubFmt);
    const itemView = "bar";
    return pointerListCoreHtml(
      fmt.card,
      items.map((item) => item.name.s),
      (name) => renderPointerListItem(fmt, name, itemView),
      itemView,
      paging?.count,
      typeof fmt.voo?.opts["separator"] === "string"
        ? (fmt.voo?.opts["separator"] as string)
        : undefined,
    );
  }
    return fmt.processContent(fmt.renderRaw());
};

const TEMPLATED_NESTS_RIGHT_TAGS: ReadonlySet<string> = new Set([
  "*default",
  "*structure",
  "*help",
]);

function isTemplatedNestsCard(card: RenderCard): boolean {
  const rightKey = card.name.rightName?.key;
  return rightKey !== undefined && TEMPLATED_NESTS_RIGHT_TAGS.has(rightKey);
}

export function isTemplatedNestsName(name: DeckoName): boolean {
  const rightKey = name.rightName?.key;
  return rightKey !== undefined && TEMPLATED_NESTS_RIGHT_TAGS.has(rightKey);
}

export function templateLinkSetNameFromParts(
  base: DeckoName | undefined,
  nestName: DeckoName,
): DeckoName {
  const name = nestName.fullyStripped;
  if (base !== undefined) {
    return DeckoName.compose([base, name]).fieldName({ codename: "type_plus_right" });
  }
  return name.fieldName({ codename: "right" });
}

function commentAuthorLabelHtml(
  fmt: RenderFormat,
  anonymousLabelHtml: string,
): string {
  const signedIn =
    fmt.engine.viewer?.signedIn === true || fmt.engine.pageSession?.signedIn === true;
  if (signedIn) return "";
  return anonymousLabelHtml;
}

const commentBoxBaseView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const card = fmt.card;
  if (card.id === undefined) {
    if (fmt.engine.taskAllowed?.(card, "create") !== true) return "";
    return (
      `<div class="comment-box nodblclick">` +
      `<form class="card-form slotter" id="new_card" action="/card/create"` +
      ` accept-charset="UTF-8" data-remote="true" method="post">` +
      `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
      `<input type="hidden" name="card[name]" id="card_name" value="${h(card.name.s)}" autocomplete="off" />` +
      `\n` +
      `<textarea rows="3" class=" form-control" name="card[comment]" id="card_comment">
</textarea>` +
      `\n` +
      `<div class="comment-buttons">` +
      commentAuthorLabelHtml(fmt, `<label>My Name is:</label> <input type="text" name="comment_author">`) +
      `<button name="button" type="submit" data-disable-with="Commenting" class="btn btn-outline-primary">Comment</button></div>` +
      `</form></div>`
    );
  }
  if (fmt.engine.taskAllowed?.(card, "update") !== true) return "";
  const { on: recaptchaOnForm, siteKey } = cardFormRecaptcha(ctx);
  const recaptchaAttr = recaptchaOnForm ? ` data-recaptcha="on"` : "";
  const recaptchaHidden = !recaptchaOnForm
    ? ""
    : `<script src="https://www.google.com/recaptcha/api.js?render=${siteKey}"></` + `script>
` +
      `<input type="hidden" name="recaptcha_token" id="recaptcha_token" value=""` +
      ` data-site-key="${siteKey}" data-action="update" class="_recaptcha-token" autocomplete="off" />`;
  const form =
    `<form class="card-form slotter autosave" id="edit_card_${card.id}"${recaptchaAttr}` +
    ` action="/update/${h(fmt.urlKey())}" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    recaptchaHidden +
    `<textarea rows="3" class=" form-control" name="card[comment]" id="card_comment">
</textarea>
` +
    `<div class="comment-buttons">` +
    commentAuthorLabelHtml(
      fmt,
      `<label>My Name is:</label>` +
        ` <input class=" form-control" type="text" value="Anonymous" name="card[comment_author]" id="card_comment_author" />
`,
    ) +
    `<button name="button" type="submit" data-disable-with="Commenting" class="btn btn-outline-primary">Comment</button></div>`;
  return `<div class="comment-box nodblclick">${form}</form></div>`;
};

export const coreView: ViewFn = (ctx) => {
  if (ctx.fmt.card.record.codename === "signin") {
    return signinCoreHtml(ctx);
  }
  if (ctx.fmt.card.name.rightName?.key === "*password") {
    return "<em>encrypted</em>";
  }
  const base = isTemplatedNestsCard(ctx.fmt.card)
    ? ctx.fmt.withNestMode("template", () => coreViewBase(ctx))
    : coreViewBase(ctx);
  if (ctx.fmt.card.name.rightName?.key !== "discussion") return base;
  if (!ctx.voo.explicitShow("comment_box")) return base;
  let box: string;
  try {
    box = str(ctx.fmt.renderView("comment_box", {}, "hide"));
  } catch {
    return base;
  }
  return [base, box].join("\n");
};

export const templateLinkView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  if (fmt.card.typeCode !== "set" && fmt.card.typeName !== "Set") {
    throw new UnsupportedViewError("template_link", fmt.card.name.s);
  }
  const parent = fmt.parent;
  const parentVoo = parent?.voo;
  if (parentVoo !== undefined) {
    const syntax = parentVoo.opts["nest_syntax"];
    if (typeof syntax === "string") voo.liveTitle = syntax;
  }
  const title = voo.liveTitle ?? voo.opts["title"];
  const text = typeof title === "string" && title !== "" ? title : "modal_nest_rules";
  const href = `/${fmt.urlKey()}/modal_nest_rules`;
  const anchor =
    `<a rel="nofollow" class="slotter" href="${h(href)}" data-remote="true">${text}</a>`;
  return slotWrap(ctx, "template_link", `{{${anchor}}}`);
};

function testContextCardFor(ctx: ViewContext): ViewContext["fmt"]["card"] | undefined {
  const card = ctx.fmt.card;
  if (!card.name.isCompound) return undefined;
  const left = card.name.leftName;
  if (left === undefined) return undefined;
  const engine = ctx.fmt.engine;
  if (engine.peekIdByCodename !== undefined && engine.peekIdByCodename("test_context") === undefined) {
    throw new CodenameNotFoundError("unknown codename: test_context");
  }
  const junction = ctx.fmt.engine.fetchRenderCard(`${left.s}+*test context`);
  if (junction === undefined || junction.unknown === true) return undefined;
  const firstItem = (junction.dbContent ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (firstItem === undefined) return undefined;
  return ctx.fmt.engine.fetchRenderCard(firstItem) ?? ctx.fmt.newCardFor(firstItem);
}

function contextualizingTestContext(ctx: ViewContext, run: () => ViewResult): ViewResult {
  if (ctx.fmt.contextCard !== undefined) return run();
  if (ctx.voo.viz.get("test_context") === "hide") return run();
  const target = testContextCardFor(ctx);
  if (target === undefined) return run();
  const previous = ctx.fmt.contextCard;
  ctx.fmt.contextCard = target;
  try {
    return run();
  } finally {
    ctx.fmt.contextCard = previous;
  }
}

export function htmlMessageCoreBody(ctx: ViewContext): ViewResult {
  return contextualizingTestContext(ctx, () => coreView(ctx));
}

export function subjectCoreBody(ctx: ViewContext): ViewResult {
  return contextualizingTestContext(ctx, () => coreView(ctx));
}

export function contentWithLinkBody(ctx: ViewContext): string {
  const simpleCore = contentView(ctx);
  const href = `/${ctx.fmt.urlKey()}/email_page?layout=none`;
  return (
    `<div class='simple-core'>\n` +
    `${simpleCore}\n` +
    `</div>\n` +
    `<div class='email-html-link py-2 text-end'>\n` +
    `<a href='${href}'>\n` +
    `<em>sample email page</em>\n` +
    `</a>\n` +
    `</div>\n`
  );
}

export function textMessageCoreBody(ctx: ViewContext): ViewResult {
  return contextualizingTestContext(ctx, () =>
    toText(str(ctx.fmt.withFormatName("email_text").renderView("core"))),
  );
}

const EMAIL_TEMPLATE_FIELD_CODENAMES = [
  "to",
  "from",
  "cc",
  "bcc",
  "attach",
  "subject",
  "text_message",
  "html_message",
  "test_context",
] as const;

export function emailTemplateCoreBody(ctx: ViewContext): string {
  const base = ctx.fmt.card.name.s;
  const fieldMarks = EMAIL_TEMPLATE_FIELD_CODENAMES.map((code) => {
    const tag = getNameEnvironment()?.codename?.name(code);
    if (tag === undefined) throw new CodenameNotFoundError(`unknown codename: ${code}`);
    return `${base}+${tag}`;
  });
  return fieldMarks
    .map((fieldMark) =>
      ctx.fmt.nest({
        name: fieldMark,
        syntax: "",
        options: { view: "read_formgroup", title: fieldMark, extra: {} },
        comment: undefined,
      }),
    )
    .join("\n");
}

const emailScopedCoreView: ViewFn = (ctx) => {
  if (ctx.fmt.formatName === "email_html") return ctx.fmt.processContent(ctx.fmt.renderRaw());
  if (ctx.fmt.formatName !== "html") return coreView(ctx);
  const card = ctx.fmt.card;
  const tagCodename = card.name.isCompound
    ? DeckoName.parse(card.name.tag).codename
    : undefined;
  if (tagCodename === "text_message") return textMessageCoreBody(ctx);
  if (tagCodename === "html_message") return htmlMessageCoreBody(ctx);
  if (tagCodename === "subject") return subjectCoreBody(ctx);
  if (card.typeCode === "email_template") return emailTemplateCoreBody(ctx);
  return coreView(ctx);
};

const emailScopedContentView: ViewFn = (ctx) => {
  if (ctx.fmt.formatName !== "html") return contentView(ctx);
  const card = ctx.fmt.card;
  const tagCodename = card.name.isCompound
    ? DeckoName.parse(card.name.tag).codename
    : undefined;
  if (tagCodename === "html_message") return contentWithLinkBody(ctx);
  return contentView(ctx);
};


export function formatToggleCore(content: string | null | undefined): string {
  const normalized = (content ?? "").trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "" || normalized === "no") {
    return "no";
  }
  return "yes";
}

export function formatDateCore(content: string): string {
  const date = parseRubyDateContent(content);
  if (date === null) {
    throw dateError();
  }
  const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

export function formatImageCore(
  content: string | null | undefined,
  cardId?: number,
  cardName?: string,
  sizeOpt?: unknown,
  cdnAssetHost?: string,
): string {
  if (content === null || content === undefined || content === "") return "";
  const svgBytes = codedSvgFileBytes(content);
  if (svgBytes !== undefined) return svgBytes;
  const trimmed = content.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("mailto:")
  ) {
    return `<img alt="${h(cardName ?? "")}" src="${h(trimmed)}" />`;
  }
  if (trimmed.startsWith("(")) {
    const src = cloudImageUrl(trimmed, sizeOpt, cdnAssetHost);
    if (src === "") return "";
    return `<img alt="${h(cardName ?? "")}" src="${h(src)}" />`;
  }
  if (trimmed.startsWith("~") || trimmed.startsWith(":")) {
    const svg = rubyExtnameFromPath(trimmed).toLowerCase() === ".svg";
    const src = localStorageUrl(trimmed, svg ? undefined : imageSizeVariant(sizeOpt), cardId);
    if (src === "") return "";
    return `<img alt="${h(cardName ?? "")}" src="${h(src)}" />`;
  }
  return "";
}

export function imageSizeVariant(sizeOpt: unknown): string {
  if (sizeOpt === undefined || sizeOpt === null || sizeOpt === "") return "medium";
  const size = String(sizeOpt);
  return size === "full" ? "original" : size;
}

export const FOG_CLOUD_URL_HOST = "http://s3.amazonaws.com/";

let deploymentCloudAssetHost: string | undefined;

export function setDeploymentCloudAssetHost(host: string | undefined): void {
  deploymentCloudAssetHost = host;
}

export function getDeploymentCloudAssetHost(): string | undefined {
  return deploymentCloudAssetHost;
}

export function cloudImageUrl(
  content: string,
  sizeOpt: unknown,
  cdnAssetHost?: string,
): string {
  const variant = imageSizeVariant(sizeOpt);
  return derivedCloudAttachmentSource(content, cdnAssetHost, variant);
}

const RUBY_FLOAT_SEGMENT = /^\s*[+-]?\d+(_\d+)*([eE][+-]?\d+(_\d+)*)?\s*$/;

export function lastContentActionIdFromDbContent(
  dbContent: string | null | undefined,
): number | null {
  if (dbContent === null || dbContent === undefined) return null;
  const parts = dbContent.split(/[\/.]/);
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  const aid = parts[parts.length - 2];
  if (aid === undefined || !RUBY_FLOAT_SEGMENT.test(aid)) return null;
  return parseInt(aid, 10);
}

function rubyExtnameFromPath(content: string): string {
  const base = content.slice(content.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

function storedBaseName(content: string): string {
  const base = content.slice(content.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function derivedCloudAttachmentSource(
  content: string,
  cdnAssetHost?: string,
  sizeVariant?: string,
): string {
  const trimmed = content.trim();
  const withoutBucket = trimmed.replace(/^\([^)]*\)\//, "");
  if (withoutBucket === trimmed) return "";
  const slash = withoutBucket.indexOf("/");
  if (slash === -1) return "";
  const idSeg = withoutBucket.slice(0, slash);
  const ext = rubyExtnameFromPath(trimmed).toLowerCase();
  if (ext === "") return "";
  const actionId = lastContentActionIdFromDbContent(trimmed);
  const basename = actionId === null ? storedBaseName(trimmed) : String(actionId);
  const unencodedLeaf = sizeVariant === undefined
    ? `${basename}${ext}`
    : appendVariantLowercasingExt(`${basename}${ext}`, sizeVariant);
  const leaf = unencodedLeaf.replace(/[^A-Za-z0-9\-_.~]/g, (c) =>
    `%${c.codePointAt(0)!.toString(16).toUpperCase().padStart(2, "0")}`,
  );
  const host = cdnAssetHost ?? deploymentCloudAssetHost ?? FOG_CLOUD_URL_HOST;
  const referenceSource = deploymentReferenceAttachmentSource(trimmed, cdnAssetHost ?? deploymentCloudAssetHost, sizeVariant);
  if (referenceSource !== undefined) return referenceSource;
  return `${host}/files/${idSeg}/${leaf}`;
}

function appendSizeVariant(path: string, sizeOpt: unknown): string {
  if (sizeOpt === undefined || sizeOpt === null || sizeOpt === "") return path;
  const suffix = imageSizeVariant(sizeOpt);
  return appendVariantLowercasingExt(path, suffix);
}

function appendVariantLowercasingExt(path: string, variant: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return `${path}-${variant}`;
  return `${path.slice(0, dot)}-${variant}${path.slice(dot).toLowerCase()}`;
}

export function formatFileCore(
  content: string | null | undefined,
  nameContext?: { cardName: string; contextNames?: readonly string[]; cardId?: number },
): string {
  const trimmed = (content ?? "").trim();
  if (trimmed === "") return "";
  const source = fileSourceFromContent(trimmed, nameContext?.cardId);
  if (source === "") return "";
  const title = nameContext === undefined
    ? ""
    : DeckoName.parse(nameContext.cardName).from(...(nameContext.contextNames ?? []));
  return `<a href='${h(source)}'>Download ${h(title)}</a>\n`;
}

function fileSourceFromContent(trimmed: string, cardId?: number): string {
  if (/^\(/.test(trimmed)) return derivedCloudAttachmentSource(trimmed);
  if (/^https?:/.test(trimmed)) return trimmed;
  return localStorageUrl(trimmed, undefined, cardId);
}

export function localStorageUrl(
  content: string,
  sizeVariant?: string,
  cardId?: number,
): string {
  const trimmed = content.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0) return "";
  const ext = rubyExtnameFromPath(trimmed).toLowerCase();
  if (ext === "") return "";
  let dir: string;
  let base: string;
  if (trimmed.startsWith("~")) {
    const idSeg = trimmed.slice(1, trimmed.indexOf("/"));
    dir = `~${cardId ?? idSeg}`;
    const actionId = lastContentActionIdFromDbContent(trimmed);
    base = actionId === null ? storedBaseName(trimmed) : String(actionId);
  } else if (trimmed.startsWith(":")) {
    dir = trimmed.slice(0, slash);
    const mod = trimmed.match(/^:[:\w/+]+\/([^./]+)\./);
    if (mod === null) return "";
    base = mod[1];
  } else {
    return "";
  }
  const leaf = `${base}${ext}`;
  if (sizeVariant === undefined) return `/files/${dir}/${leaf}`;
  const dot = leaf.indexOf(".");
  return `/files/${dir}/${leaf.slice(0, dot)}-${sizeVariant}${leaf.slice(dot)}`;
}

export function attachmentUrl(
  content: string,
  sizeVariant?: string,
  cardId?: number,
  cdnAssetHost?: string,
): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("(")) return derivedCloudAttachmentSource(trimmed, cdnAssetHost, sizeVariant);
  if (/^https?:/.test(trimmed)) return trimmed;
  return localStorageUrl(trimmed, sizeVariant, cardId);
}

function setRulesCoreHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const card = fmt.card;
  const url = fmt.urlKey();
  const settingsFilter = renderSettingsFilter(url);
  const rules = collectSetRules(fmt);
  const accordion = renderCategoryAccordion(fmt, card, rules);
  return `<h4 class="mt-3">Rules</h4>\n${settingsFilter}\n${accordion}`;
}

function settingCoreHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const card = fmt.card;
  const settingName = card.name.s.replace(/\*/g, "");
  let body = "";
  const ruleHelp = settingRuleHelpHtml(ctx);
  if (ruleHelp !== "") {
    body += `${ruleHelp}\n`;
  }
  body += `<h3>All ${settingName} rules that apply to</h3>\n`;
  const classes = fmt.engine.setClassesWithRules?.(card) ?? [];
  for (const cls of classes) {
    const heading = cls.klass.genericLabel();
    body += `<p>\n<h5>\n${heading.toLowerCase()}\n</h5>\n`;
    if (cls.anchorless) {
      const rule = cls.rules[0];
      if (rule !== undefined) {
        body += fmt.nestRecord(rule, "bar", {
          nest_name: rule.name.s,
          show: ["full_name", "bar"],
          home_view: "bar",
        });
        body += `\n`;
      }
    } else {
      for (const rule of cls.rules) {
        body += fmt.nestRecord(rule, "bar", {
          nest_name: rule.name.s,
          show: ["bar"],
          home_view: "bar",
        });
        body += `\n`;
      }
    }
    body += `</p>\n`;
  }
  return body;
}

function settingRuleHelpHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const ruleCard =
    fmt.engine.fetchRenderCard(`*all+${fmt.card.name.s}`) ??
    virtualAllRuleCard(fmt, fmt.card);
  if (ruleCard === undefined) return "";
  const sub = new RenderFormat(ruleCard, fmt.engine, {
    parent: fmt,
    maxDepth: fmt.maxDepth,
  });
  const help = ruleHelpAlertBody(fmt.engine, sub, ruleCard);
  return `<div class="alert alert-info rule-instruction">${help}</div>`;
}

function virtualAllRuleCard(
  fmt: RenderFormat,
  settingCard: RenderCard,
): RenderCard | undefined {
  const setCard = fmt.engine.fetchRenderCard("*all");
  if (setCard === undefined) return undefined;
  return buildVirtualRuleCard({
    setCard,
    settingCard,
    settingCodename:
      settingCard.record.codename ?? settingCard.name.s.slice(1),
    engine: fmt.engine,
  });
}

function ruleHelpAlertBody(
  engine: RenderEngineLike,
  fmt: RenderFormat,
  ruleCard: RenderCard,
): string {
  const resolver = engine.helpRules;
  if (resolver !== undefined) return resolver.ruleBasedHelpForCard(fmt, ruleCard);
  const rightKey = ruleCard.name.rightName?.key;
  const raw =
    registeredSettingHelpText(
      ruleCard.record.codename,
      rightKey === undefined
        ? undefined
        : engine.fetchRenderCard(rightKey)?.record.codename,
    ) ?? helpRuleCardContent(engine, ruleCard);
  return raw === undefined ? "" : processHelpContent(fmt, raw);
}

function helpRuleCardContent(
  engine: RenderEngineLike,
  card: RenderCard,
): string | undefined {
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
      leftKey !== undefined ? engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*help")) {
    const record = engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (engine.isDenied(record)) continue;
    return record.dbContent;
  }
  return undefined;
}

function isModAssetsChildCard(ctx: ViewContext): boolean {
  const card = ctx.fmt.card;
  if (!card.name.isCompound) return false;
  const leftKey = card.name.leftName?.key;
  const rightKey = card.name.rightName?.key;
  if (leftKey === undefined || rightKey === undefined) return false;
  const left = ctx.fmt.engine.fetchRenderCard(leftKey);
  const right = ctx.fmt.engine.fetchRenderCard(rightKey);
  const rightCodename = right?.record.codename;
  return (
    left?.typeCode === "mod" &&
    (rightCodename === "style" || rightCodename === "script")
  );
}

function modAssetsChildCoreHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const card = fmt.card;
  const left = fmt.engine.fetchRenderCard(card.name.leftName!.key);
  const right = fmt.engine.fetchRenderCard(card.name.rightName!.key);
  const stem = (left?.record.codename ?? "").replace(/^mod_/, "");
  const subpath = right?.record.codename === "script" ? "script" : "style";
  const groups = modChildAssetGroups(stem, subpath) ?? [];
  return modAssetGroupsCoreHtml(groups);
}

function renderSettingsFilter(url: string): string {
  const radioAllChecked = false;
  const radioCommonChecked = true;
  const radioFieldChecked = false;
  const radioRecentChecked = false;
  return (
    `<form role="filter" data-slot-selector=".card-slot._setting-list"` +
    ` class="nodblclick slotter" action="/${h(url)}/accordion_bar_list"` +
    ` accept-charset="UTF-8" data-remote="true" method="get">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<div class="my-4 mx-2 _setting-filter">` +
    `<label>Settings</label>\n` +
    radioHtml("all", "All", radioAllChecked) +
    `\n\n` + radioHtml("common", "Common", radioCommonChecked) +
    `\n\n` + radioHtml("field", "Field", radioFieldChecked) +
    `\n\n` + radioHtml("recent", "Recent", radioRecentChecked) +
    `\n` +
    `</div></form>`
  );
}

function radioHtml(id: string, label: string, checked: boolean): string {
  const checkedAttr = checked ? " checked" : " ";
  return (
    `<input type="radio" class="btn-check _setting-category" name="options" id="${id}"` +
    ` autocomplete="off"${checkedAttr}>\n` +
    `<label class="btn btn-outline-primary" for="${id}">${label}</label>`
  );
}

function collectSetRules(fmt: RenderFormat): RenderCard[] {
  if (fmt.engine.collectRules === undefined) return [];
  return fmt.engine.collectRules(fmt.card);
}


function renderCategoryAccordion(fmt: RenderFormat, card: RenderCard, rules: RenderCard[]): string {
  const ruleByCodename = new Map<string, RenderCard>();
  for (const rule of rules) {
    const codename = settingCodenameForRule(fmt, rule);
    if (codename !== undefined) ruleByCodename.set(codename, rule);
  }
  const safeKey = card.name.safeKey;
  let body = `<div class="_setting-list"><div class="accordion bar-accordion">`;
  const groupBlocks: string[] = [];
  for (const groupName of SETTING_GROUPS) {
    const settings = visibleSettingsForGroup(fmt.engine, card, groupName);
    const collapseId = `card-${safeKey}-${groupName.toLowerCase()}-collapse-id`;
    let block = `<div class='accordion-item _setting-group'>\n`;
    block += `<h2 class='accordion-header nodblclick w-100'>\n`;
    const groupButtonClass = serializerFollowsLive()
      ? "accordion-button collapsed"
      : "collapsed accordion-button";
    block += `<button class='${groupButtonClass}' data-bs-target='#${collapseId}' data-bs-toggle='collapse' type='button'>\n`;
    block += `${groupName} <span class="_count badge bg-secondary ms-3">${settings.length}</span>\n`;
    block += `</button>\n`;
    block += `</h2>\n`;
    block += `<div class='accordion-collapse collapse' id='${collapseId}'>\n`;
    block += `<div class='${serializerFollowsLive() ? "d0-card-body accordion-body" : "accordion-body d0-card-body"}'>\n`;
    block += `${renderSettingListItems(fmt, settings, ruleByCodename, card)}\n`;
    block += `</div>\n`;
    block += `</div>\n`;
    block += `</div>\n`;
    groupBlocks.push(block);
  }
  body += groupBlocks.join("\n");
  body += `</div></div>`;
  return body;
}

function renderSettingListItems(
  fmt: RenderFormat,
  settings: ReadonlyArray<string>,
  ruleByCodename: Map<string, RenderCard>,
  setCard: RenderCard,
): string {
  const items = settings.map((settingCodename) => {
    const stored = ruleByCodename.get(settingCodename);
    if (stored !== undefined) {
      const slotHtml = fmt.nestRecord(stored, "bar", {
        nest_name: stored.name.s,
        show: ["bar"],
        home_view: "bar",
      });
      return `<li class="nav-item">${slotHtml}</li>`;
    }
    const settingCard = fmt.engine.findSettingCard?.(settingCodename);
    if (settingCard !== undefined) {
      const ruleTypeId = ruleTypeIdForSetting(settingCodename);
      const deckTypeCard =
        ruleTypeId !== undefined ? fmt.engine.findRenderCardById?.(ruleTypeId) : undefined;
      const virtual = buildVirtualRuleCard({
        setCard,
        settingCard,
        settingCodename,
        deckTypeCard,
        engine: fmt.engine,
      });
      const slotHtml = fmt.nestRecord(virtual, "bar", {
        nest_name: virtual.name.s,
        show: ["bar"],
        home_view: "bar",
      });
      return `<li class="nav-item">${slotHtml}</li>`;
    }
    return `<li class="nav-item">${quietDenial("read")}</li>`;
  });
  return `<ul class="nav flex-column">${items.join("\n")}</ul>`;
}

function quietDenial(task: string): string {
  return `<span class="denied"><!-- Sorry, you don't have permission (${task}) --></span>`;
}

export function readFormgroupBody(ctx: ViewContext): string {
  const inner =
    `<div class='form-group read-form-group'>\n<label>\n${ctx.fmt.renderView("title")}\n</label>\n` +
    `<div class='read-formgroup-content'>\n${ctx.fmt.renderView("content")}\n</div>\n</div>\n`;
  return slotWrap(ctx, "read_formgroup", inner);
}

function recentSettingsCodenamesFlat(ctx: ViewContext): Set<string> {
  const list = ctx.fmt.engine.fetchRenderCard("*recent_settings");
  if (list === undefined || list.unknown === true) return new Set();
  const codenames = new Set<string>();
  for (const line of (list.dbContent ?? "").split("\n")) {
    const item = line.trim();
    if (item === "") continue;
    const itemCard = ctx.fmt.engine.fetchRenderCard(item);
    const codename = itemCard?.record.codename;
    if (codename !== undefined) codenames.add(codename);
  }
  return codenames;
}

function categoryAllSettingsSortedFlat(
  ctx: ViewContext,
  category: string,
  visible: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (category === "all") return [...visible].sort();
  if (category === "common") return visible.filter((s) => COMMON_SETTINGS.has(s));
  if (category === "field") return visible.filter((s) => FIELD_SETTINGS.has(s));
  if (category === "recent") {
    const recent = recentSettingsCodenamesFlat(ctx);
    return visible.filter((s) => recent.has(s));
  }
  return visibleGroupSettings(category);
}

function barSettingListItem(
  ctx: ViewContext,
  setting: string,
  setCard: ViewContext["fmt"]["card"],
): string {
  const settingCard = ctx.fmt.engine.findSettingCard?.(setting);
  if (settingCard === undefined) return "";
  if (ctx.fmt.engine.isDenied(settingCard)) return "";
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
  return ctx.fmt.nestRecord(ruleCard, "bar", {
    nest_name: ruleCard.name.s,
    show: ["bar"],
    home_view: "bar",
    hide: ["full_name"],
  });
}

export function barSettingListBody(ctx: ViewContext): string {
  const group =
    typeof ctx.voo.opts["filter"] === "string" && ctx.voo.opts["filter"] !== ""
      ? (ctx.voo.opts["filter"] as string)
      : "all";
  const visible = SETTING_GROUPS.flatMap((g) => [...visibleGroupSettings(g)]);
  const settings = categoryAllSettingsSortedFlat(ctx, group, visible);
  return settings
    .map((setting) => barSettingListItem(ctx, setting, ctx.fmt.card))
    .filter((item) => item !== "")
    .join("\n");
}

const barSettingListScopedView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode !== "set") {
    throw new UnsupportedViewError("bar_setting_list", ctx.fmt.card.name.s);
  }
  return barSettingListBody(ctx);
};

registerSetTypeAssignment("Right::To", "list");
registerSetTypeAssignment("Right::From", "list");
registerSetTypeAssignment("Right::Cc", "list");
registerSetTypeAssignment("Right::Bcc", "list");
registerSetTypeAssignment("Right::Subject", "phrase");
registerSetTypeAssignment("Right::TextMessage", "plain_text");
registerSetTypeAssignment("Right::Email", "phrase");
registerSetTypeAssignment("Right::Password", "phrase");
registerSetTypeAssignment("Right::Salt", "phrase");
registerSetTypeAssignment("Right::Status", "phrase");
registerSetTypeAssignment("Right::Right", "set");
registerSetTypeAssignment("Right::Self", "set");
registerSetTypeAssignment("Right::Type", "set");
registerSetTypeAssignment("Right::TypePlusRight", "set");
registerAllGemTypeAssignments();
registerSetTypeAssignment("TypePlusRight::Role::Members", "list");
registerSetTypeAssignment("TypePlusRight::BootswatchSkin::Stylesheets", "skin");

export function visibleSettingsForGroup(
  engine: RenderEngineLike,
  setCard: RenderCard,
  groupName: string,
): ReadonlyArray<string> {
  const settings = GROUP_TO_SETTINGS[groupName];
  if (engine.peekCodenameById === undefined) return settings;
  const { code: prototypeCode } = setPrototypeTypeInfo(engine, setCard);
  return settings.filter((codename) => {
    const restricted = SETTING_RESTRICTED_TO_TYPE.get(codename);
    if (restricted === undefined) return true;
    return prototypeCode !== undefined && restricted.includes(prototypeCode);
  });
}

export function visibleSettingCodenames(
  engine: RenderEngineLike,
  setCard: RenderCard,
): ReadonlyArray<string> | undefined {
  const typeId = setCard.record.typeId;
  if (typeId === undefined || typeId === null) return undefined;
  if (engine.peekCodenameById?.(typeId) !== "set") return undefined;
  return Object.keys(GROUP_TO_SETTINGS).flatMap((group) => visibleSettingsForGroup(engine, setCard, group));
}

const SETTING_RESTRICTED_TO_TYPE: ReadonlyMap<string, readonly string[]> = new Map([
  ["content_options", ["list", "pointer", "session"]],
  ["content_option_view", ["list", "pointer", "session"]],
]);

function setPrototypeTypeInfo(
  engine: RenderEngineLike,
  setCard: RenderCard,
): { code: string | undefined; templateDerived: boolean } {
  const codenameOf = (card: RenderCard | undefined): string | undefined =>
    card?.id !== undefined ? engine.peekCodenameById?.(card.id) : undefined;
  const defaultRuleTypeCode = (): string | undefined => {
    const rule = engine.collectRules?.(setCard).find((candidate) => {
      const rightKey = candidate.name.rightName?.key;
      return rightKey === "default" || rightKey === "*default";
    });
    if (rule !== undefined && rule.typeId !== undefined) {
      return engine.peekCodenameById?.(rule.typeId);
    }
    const coldTypeId = engine.defaultRuleTypeIdForSetName?.(setCard.name.s);
    if (coldTypeId === undefined) return undefined;
    return engine.peekCodenameById?.(coldTypeId);
  };
  const templateTypeCode = (protoName: string, leftTypeName?: string): string | undefined => {
    let parsed: DeckoName;
    try {
      parsed = DeckoName.parse(protoName);
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        return defaultRuleTypeCode();
      }
      throw err;
    }
    const typed = engine.newCardDefaultType?.(parsed, leftTypeName);
    if (typed !== undefined) return engine.peekCodenameById?.(typed.typeId);
    return defaultRuleTypeCode();
  };
  const rightName = setCard.name.rightName;
  const patternCode =
    rightName !== undefined
      ? codenameOf(engine.fetchRenderCard?.(rightName.s))
      : codenameOf(setCard);
  switch (patternCode) {
    case "all":
    case "rstar":
    case "all_plus":
      return { code: undefined, templateDerived: false };
    case "self": {
      const anchorName = setCard.name.leftName?.s ?? setCard.name.s;
      const real = engine.fetchRenderCard?.(anchorName);
      if (real !== undefined && real.typeId !== undefined) {
        return { code: engine.peekCodenameById?.(real.typeId), templateDerived: false };
      }
      return { code: templateTypeCode(anchorName), templateDerived: true };
    }
    case "type": {
      const anchorName = setCard.name.leftName?.s;
      if (anchorName === undefined) return { code: undefined, templateDerived: false };
      const typeCard = engine.fetchRenderCard?.(anchorName);
      if (typeCard?.id === undefined) return { code: undefined, templateDerived: false };
      return { code: engine.peekCodenameById?.(typeCard.id), templateDerived: false };
    }
    case "right": {
      const anchorName = setCard.name.leftName?.s;
      const anchorCard =
        anchorName !== undefined ? engine.fetchRenderCard?.(anchorName) : undefined;
      const anchorCodename = codenameOf(anchorCard);
      if (anchorCodename !== undefined) {
        const assigned = RIGHT_SETTING_TYPE_ASSIGNMENT[anchorCodename];
        if (assigned !== undefined) return { code: assigned, templateDerived: false };
      }
      return {
        code: anchorName !== undefined ? templateTypeCode(`*dummy+${anchorName}`) : defaultRuleTypeCode(),
        templateDerived: true,
      };
    }
    case "type_plus_right": {
      const leftName = setCard.name.leftName;
      const typeName = leftName?.leftName?.s;
      const anchorRightName = leftName?.rightName?.s;
      if (typeName !== undefined && anchorRightName !== undefined) {
        const typeCodename = codenameOf(engine.fetchRenderCard?.(typeName));
        const rightCodename = codenameOf(engine.fetchRenderCard?.(anchorRightName));
        if (typeCodename !== undefined && rightCodename !== undefined) {
          const assigned = TYPE_PLUS_RIGHT_TYPE_ASSIGNMENT[`${typeCodename}::${rightCodename}`];
          if (assigned !== undefined) return { code: assigned, templateDerived: false };
          const rightAssigned = RIGHT_SETTING_TYPE_ASSIGNMENT[rightCodename];
          if (rightAssigned !== undefined) return { code: rightAssigned, templateDerived: false };
        }
      }
      return {
        code:
          typeName !== undefined && anchorRightName !== undefined
            ? templateTypeCode(`*dummy+${anchorRightName}`, typeName)
            : defaultRuleTypeCode(),
        templateDerived: true,
      };
    }
    case "rule": {
      const real = engine.fetchRenderCard?.("*all+*create");
      if (real !== undefined && real.typeId !== undefined) {
        return { code: engine.peekCodenameById?.(real.typeId), templateDerived: false };
      }
      return { code: templateTypeCode("*all+*create"), templateDerived: true };
    }
    case "star":
      return { code: templateTypeCode("*dummy"), templateDerived: true };
    default:
      return { code: undefined, templateDerived: false };
  }
}

export function setPrototypeTypeCode(
  engine: RenderEngineLike,
  setCard: RenderCard,
): string | undefined {
  return setPrototypeTypeInfo(engine, setCard).code;
}

const RIGHT_SETTING_TYPE_ASSIGNMENT: Readonly<Record<string, string>> = {
  autoname: "phrase",
  email: "phrase",
  password: "phrase",
  roles: "search_type",
  salt: "phrase",
  status: "phrase",
  when_created: "phrase",
  when_last_edited: "phrase",
  input_type: "pointer",
  thanks: "phrase",
  bcc: "list",
  cc: "list",
  from: "list",
  subject: "phrase",
  text_message: "plain_text",
  to: "list",
  contextual_class: "list",
  disappear: "toggle",
  follow: "list",
  follow_fields: "list",
  following: "list",
  message: "phrase",
  head: "html",
  on_create: "list",
  on_delete: "list",
  on_update: "list",
  enabled_roles: "session",
  layout: "pointer",
  content_option_view: "phrase",
  content_options: "list",
  create: "list",
  delete: "list",
  read: "list",
  update: "list",
  captcha: "toggle",
  right: "set",
  self: "set",
  type: "set",
  type_plus_right: "set",
  count: "search_type",
};

const TYPE_PLUS_RIGHT_TYPE_ASSIGNMENT: Readonly<Record<string, string>> = {
  "role::members": "list",
  "set::setting": "list",
  "set::style": "pointer",
};

export const SETTING_GROUPS: ReadonlyArray<string> = [
  "templating",
  "permission",
  "webpage",
  "editing",
  "event",
  "other",
];

const SETTING_TO_GROUP: ReadonlyMap<string, string> = new Map<string, string>([
  ["autoname", "templating"], ["default", "templating"], ["structure", "templating"],
  ["create", "permission"], ["read", "permission"], ["update", "permission"], ["delete", "permission"], ["captcha", "permission"],
  ["head", "webpage"], ["layout", "webpage"], ["style", "webpage"], ["script", "webpage"],
  ["help", "editing"], ["input_type", "editing"], ["guide", "editing"],
  ["content_options", "editing"], ["content_option_view", "editing"],
  ["on_create", "event"], ["on_update", "event"], ["on_delete", "event"],
  ["thanks", "other"], ["follow_fields", "other"], ["follow", "other"],
]);

export const GROUP_TO_SETTINGS: Readonly<Record<string, ReadonlyArray<string>>> = {
  templating: ["structure", "default", "autoname"],
  permission: ["create", "read", "update", "delete", "captcha"],
  webpage: ["head", "layout", "style", "script"],
  editing: ["help", "input_type", "guide", "content_options", "content_option_view"],
  event: ["on_create", "on_update", "on_delete"],
  other: ["thanks", "follow_fields", "follow"],
};

const SETTING_NEVER_VISIBLE: ReadonlySet<string> = new Set([
  "content_options",
  "content_option_view",
]);

export function visibleGroupSettings(groupName: string): ReadonlyArray<string> {
  return GROUP_TO_SETTINGS[groupName].filter(
    (codename) => !SETTING_NEVER_VISIBLE.has(codename),
  );
}

function inferSettingCodename(rule: RenderCard): string | undefined {
  const rightKey = rule.name.rightName?.key;
  if (rightKey === undefined) return undefined;
  return rightKey.startsWith("*") ? rightKey.slice(1) : rightKey;
}

function settingCodenameForRule(fmt: RenderFormat, rule: RenderCard): string | undefined {
  const rightKey = rule.name.rightName?.key;
  if (rightKey === undefined) return undefined;
  const settingCard = fmt.engine.fetchRenderCard?.(rightKey);
  const codename = settingCard?.record.codename;
  if (codename !== undefined) return codename;
  return inferSettingCodename(rule);
}

function renderPointerListItem(fmt: RenderFormat, name: string, itemView: string): string {
  if (itemView === "name") {
    let named: ReturnType<RenderFormat["engine"]["fetchRenderCard"]>;
    try {
      named = fmt.engine.fetchRenderCard(name);
    } catch {
      named = undefined;
    }
    return named?.name.s ?? name;
  }

  const hostItemType = fmt.engine.hostItemTypeName?.(fmt.card);
  const slotTypeName = hostItemType?.typeName;
  let target: ReturnType<RenderFormat["engine"]["fetchRenderCard"]>;
  try {
    target = fmt.engine.fetchRenderCard(name);
  } catch (err) {
    if (
      err instanceof CodenameNotFoundError ||
      err instanceof NameNotFoundError
    ) {
      return renderUnknownPointerListItem(fmt, name, itemView, slotTypeName, hostItemType);
    }
    throw err;
  }
  if (target === undefined) {
    return renderUnknownPointerListItem(fmt, name, itemView, slotTypeName, hostItemType);
  }
  try {
    if (itemView !== "bar") {
      return fmt.nestRecord(
        target,
        itemView,
        {
          nest_name: target.name.s,
          show: [itemView],
          ...(itemView === "closed" ? { hide: ["bar_middle"] } : {}),
          home_view: itemView === "closed" ? "open" : itemView,
          ...(slotTypeName !== undefined ? { type: slotTypeName } : {}),
        },
        { pointerListItem: true },
      );
    }
    return fmt.nestRecord(
      target,
      "bar",
      {
        nest_name: target.name.s,
        show: ["bar"],
        home_view: "bar",
        ...(slotTypeName !== undefined ? { type: slotTypeName } : {}),
      },
      { pointerListItem: true },
    );
  } catch (error) {
    return quietRenderError(error, target, itemView, fmt);
  }
}

function phantomCascadeLeftTypeName(
  engine: RenderEngineLike,
  name: DeckoName,
): string | undefined {
  if (!name.isCompound) return undefined;
  const leftName = name.leftName;
  if (leftName === undefined) return undefined;
  return engine.newCardDefaultType?.(leftName)?.typeName;
}

function renderUnknownPointerListItem(
  fmt: RenderFormat,
  name: string,
  itemView: string,
  slotTypeName: string | undefined,
  hostItemType: { typeName: string; typeId: number } | undefined,
): string {
  const identity = phantomIdentity(fmt, name, hostItemType);
  const phantom = phantomPointerListItem(name, identity, fmt.engine.phantomItemType);
  if (hostItemType === undefined && identity !== undefined) {
    phantom.setKeys = safeSetKeys({
      name: phantom.name,
      typeId: identity.typeId,
      typeName: identity.typeName,
      leftTypeName: phantomCascadeLeftTypeName(fmt.engine, phantom.name),
      isNew: true,
    });
  }
  const verdict = fmt.engine.pointerItemVerdict?.(fmt.card.key, phantom.key);
  const readable = verdict?.read === true;
  if (verdict !== undefined) {
    fmt.engine.seatPhantomReadVerdict?.(phantom.key, !readable);
  }
  if ((itemView === "bar" || itemView === "closed") && !readable) {
    const phantomTypeName = hostItemType?.typeName ?? phantom.typeName;
    const phantomTypeId = hostItemType?.typeId ?? phantom.typeId;
    if (
      phantom.name.isCompound &&
      fmt.engine.phantomVirtualStructure?.(phantom.name, phantomTypeName, phantomTypeId) !== undefined
    ) {
      return quietDenial("read");
    }

    const body = identity !== undefined
      ? pointerListItemBodyForUnknown(slotCardname(phantom), {
          typeName: phantom.typeName,
          typeId: phantom.typeId,
          setKeys: phantom.setKeys,
        })
      : pointerListItemBodyForUnknown(
          slotCardname(phantom),
          undefined,
          fmt.engine.phantomItemType,
        );
    return pointerListItemSlot(phantom, body, slotTypeName);
  }
  if (
    hostItemType !== undefined &&
    phantom.name.isCompound &&
    fmt.engine.phantomVirtualStructure?.(phantom.name, hostItemType.typeName, hostItemType.typeId) !== undefined
  ) {
    phantom.unknown = false;
    phantom.hostTyped = true;
  }
  phantom.pointerItemReadVerdict = true;
  return fmt.nestRecord(
    phantom,
    itemView,
    {
      nest_name: phantom.name.s,
      show: [itemView],
      home_view: itemView === "closed" ? "open" : itemView,
      ...(slotTypeName !== undefined ? { type: slotTypeName } : {}),
    },
    { pointerListItem: true },
  );
}

function phantomIdentity(
  fmt: RenderFormat,
  name: string,
  hostItemType: { typeName: string; typeId: number } | undefined,
): { typeName: string; typeId: number } | undefined {
  if (hostItemType !== undefined) return hostItemType;
  const derived = (() => {
    try {
      return fmt.engine.newCardDefaultType?.(DeckoName.parse(name));
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        return undefined;
      }
      throw err;
    }
  })();
  if (derived !== undefined) return derived;
  const richText = (() => {
    try {
      return fmt.engine.fetchRenderCard("RichText");
    } catch {
      return undefined;
    }
  })();
  if (richText?.id !== undefined) {
    return { typeName: "RichText", typeId: richText.id };
  }
  return undefined;
}

export function swapBarSlotToMiniBar(html: string, name: string): string {
  const idFrom = `<div id="${name}-bar-view"`;
  const idTo = `<div id="${name}-mini_bar-view"`;
  const idIdx = html.indexOf(idFrom);
  if (idIdx === -1) return html;
  const closeIdx = html.indexOf(">", idIdx);
  if (closeIdx === -1) return html;
  const tagBody = html.slice(idIdx + idFrom.length, closeIdx);
  const classFrom = `class="card-slot bar-view`;
  const classIdx = tagBody.indexOf(classFrom);
  if (classIdx === -1) return html;
  const classTo = `class="card-slot mini_bar-view`;
  return (
    html.slice(0, idIdx) +
    idTo +
    tagBody.slice(0, classIdx) +
    classTo +
    tagBody.slice(classIdx + classFrom.length) +
    html.slice(closeIdx)
  );
}

const cardListView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const items = fmt.engine.executeSearch(fmt);
  if (items.length === 0) return fmt.renderView("no_search_results");
  const itemsOpt: unknown = voo?.liveItems ?? voo?.opts["items"];
  const itemView =
    itemsOpt !== null && typeof itemsOpt === "object" &&
    typeof (itemsOpt as { view?: unknown }).view === "string"
      ? (itemsOpt as { view: string }).view
      : "bar";
  const hostItemType = fmt.engine.hostItemTypeName?.(fmt.card);
  const rendered = items.map((item) => {
    const html = fmt.nestRecord(item, itemView, {
      size: null,
      ...(hostItemType !== undefined ? { type: hostItemType.typeName } : {}),
    });
    return `<div class="search-result-item item-${itemView}">${html}</div>`;
  });
  const list = `<div class="card-list card-list-${itemView} search-result-list">${rendered.join("\n")}</div>`;
  if (voo !== undefined && !voo.show("paging")) return list;
  const paging = fmt.engine.searchResultPaging?.(fmt);
  return paging === undefined ? `${list}\n` : `${list}\n${searchPagingNav(fmt.card.name, paging)}`;
};

const noSearchResultsView: ViewFn = () => `<div class="search-no-results"></div>`;

function linkAnchorBody(ctx: ViewContext, extraClass: string): string {
  const { fmt, voo } = ctx;
  const known = fmt.card.unknown !== true;
  const cls = `${extraClass}${known ? "known-card" : "wanted-card"}`;
  const label = typeof voo.opts["title"] === "string" ? (voo.opts["title"] as string) : undefined;
  const inner =
    label !== undefined
      ?
        `<span class="card-title" title="${label.replace(/"/g, "&quot;")}">${wrappedTitleInner(label, vooJoint(voo))}</span>`
      : fmt.renderView("title");
  const query = !known
    ? unknownLinkQuery(fmt)
    : fmt.card.hostTyped === true && !hostTypedNameKnown(fmt, fmt.card)
      ? wantedHrefQuerySuffix(fmt.card.name.s)
      : "";
  const href = `/${h(fmt.urlKey())}${query}`;
  return `<a class="${cls}" href="${href}">${inner}</a>`;
}

function hostTypedNameKnown(fmt: RenderFormat, card: RenderCard): boolean {
  if (!card.name.isCompound) return false;
  const nameType = phantomIdentity(fmt, card.name.s, undefined);
  return fmt.engine.phantomVirtualStructure?.(card.name, nameType?.typeName, nameType?.typeId) !== undefined;
}
const linkView: ViewFn = (ctx) => linkAnchorBody(ctx, "");
const navLinkView: ViewFn = (ctx) => linkAnchorBody(ctx, "nav-link ");
export { linkView, navLinkView };

function prepareBar(ctx: ViewContext): void {
  const { fmt, voo } = ctx;
  const isRule = fmt.engine.cardMatchesRuleSet?.(fmt.card) ?? false;
  const isRuleBar = isRule && ctx.voo.requestedView === "bar";
  const cols = readBarCols(fmt.card);
  voo.classUp("bar", fmt.card.setKeys);
  voo.classUp("bar-left", `col-${cols[0]}`);
  voo.classUp("bar-right", `col-${cols[1]}`);
  if (isRuleBar) {
    voo.classUp("bar-left", `col-md-${cols[2]}`);
    voo.classUp("bar-middle", `d-none d-md-flex col-md-${cols[3]}`);
    voo.classUp("bar-right", `col-md-${cols[4]}`);
  } else {
    voo.classUp("bar-middle", "d-none d-md-flex");
    voo.hide("bar_middle");
  }
  if (fmt.card.id === undefined && (fmt.engine.cardMatchesRuleSet?.(fmt.card) ?? false)) {
    const existing = fmt.engine.hasExistingRuleFor?.(fmt.card.key);
    const settingKey = fmt.card.name.rightName?.key;
    if (existing !== true && settingKey !== "*content_option_view") {
      voo.hide("bar_nav");
    }
  }
}

function barBodyHtml(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  let out = `<div class='${serializerFollowsLive() ? `row g-0 ${voo.classy("bar-body")}` : `${voo.classy("bar-body")} row g-0`}'>\n`;
  if (voo.show("bar_left")) {
    out += `<div class='${voo.classy("bar-left")}'>\n${str(fmt.renderView("bar_left"))}\n</div>\n`;
  }
  if (voo.show("bar_middle")) {
    out += `<div class='${voo.classy("bar-middle")}'>\n${str(fmt.renderView("bar_middle"))}\n</div>\n`;
  }
  if (voo.show("bar_right")) {
    out += `<div class='${voo.classy("bar-right")}'>\n${str(fmt.renderView("bar_right"))}\n</div>\n`;
  }
  out += `</div>\n`;
  return out;
}

function cardStub(fmt: ViewContext["fmt"], view: string): string {
  return `<div class="card-slot card-slot-stub" data-stub-url="/${h(fmt.urlKey())}/${view}"></div>`;
}

function barBottomHtml(ctx: ViewContext, open: boolean): string {
  const { fmt } = ctx;
  if (!open) return cardStub(fmt, "bar_bottom");
  return str(fmt.renderView("bar_bottom"));
}

function accordionBarHtml(ctx: ViewContext, open: boolean): string {
  const { fmt, voo } = ctx;
  prepareBar(ctx);
  voo.classUp("accordion-item", `bar ${voo.classy("bar")}`);
  const collapseId = `card-${fmt.card.name.safeKey}-closed-collapse-id`;
  const buttonClasses = (serializerFollowsLive()
    ? ["accordion-button", open ? undefined : "collapsed"]
    : [open ? undefined : "collapsed", "accordion-button"]
  )
    .filter((s) => s !== undefined)
    .join(" ");
  const collapseClasses = (serializerFollowsLive()
    ? ["accordion-collapse", "collapse", open ? "show" : undefined]
    : [open ? "show" : undefined, "accordion-collapse", "collapse"]
  )
    .filter((s) => s !== undefined)
    .join(" ");
  const body = open ? fmt.renderView("bar_bottom") : cardStub(fmt, "bar_bottom");
  return (
    `<div class='${voo.classy("accordion-item")}'>\n` +
    `<h2 class='accordion-header nodblclick w-100'>\n` +
    `<button class='${buttonClasses}' data-bs-target='#${collapseId}' data-bs-toggle='collapse' type='button'>\n` +
    barBodyHtml(ctx) +
    `\n</button>\n` +
    `</h2>\n` +
    `<div class='${collapseClasses}' id='${collapseId}'>\n` +
    `<div class='accordion-subheader bg-light p-2 text-end'>\n` +
    `${fmt.renderView("menu")}\n` +
    `</div>\n` +
    `<div class='${serializerFollowsLive() ? "d0-card-body accordion-body" : "accordion-body d0-card-body"}'>\n` +
    `${body}\n` +
    `</div>\n` +
    `</div>\n` +
    `</div>\n`
  );
}

const closedView: ViewFn = (ctx) => {
  const inner = accordionBarHtml(ctx, false);
  return slotWrapCommon(ctx.fmt, "closed", inner);
};

const openView: ViewFn = (ctx) => {
  if (ctx.fmt.card.typeCode === "set") {
    ctx.voo.hide("template_closer");
  }
  if (ctx.fmt.card.name.rightName?.key === "discussion") {
    ctx.voo.setViz("comment_box", "show");
  }
  const inner = accordionBarHtml(ctx, true);
  return slotWrapCommon(ctx.fmt, "open", inner);
};

function genericBarLeftHtml(ctx: ViewContext): string {
  return str(ctx.fmt.renderView("title"));
}

function bootswatchSkinBarLeftHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const name = fmt.card.name.s;
  const imageChild = fmt.engine.fetchRenderCard(`${name}+Image`);
  const mediaLeftInner = fmt.nestRecord(
    imageChild ?? fmt.unknownChildCard(`${name}+Image`),
    "boxed",
    { size: "medium" },
  );
  return (
    `<div class='media align-items-center'>\n` +
    `<div class='media-left'>\n` +
    `${mediaLeftInner}\n` +
    `</div>\n` +
    `<div class='media-body-medium media-body'>\n` +
    `<div class='media-text'>\n` +
    `${fmt.renderView("title")}\n` +
    `</div>\n` +
    `</div>\n` +
    `</div>\n`
  );
}

const barLeftView: ViewFn = (ctx) =>
  ctx.fmt.card.typeCode === "bootswatch_skin"
    ? bootswatchSkinBarLeftHtml(ctx)
    : genericBarLeftHtml(ctx);
const barMiddleView: ViewFn = () => "";
function modnameFromCodenameForViews(fmt: RenderFormat): string {
  return (fmt.card.record.codename ?? "").replace(/^mod_/, "");
}

const barRightView: ViewFn = ({ fmt }) =>
  fmt.card.typeCode === "mod"
    ? modBarRightSections(modnameFromCodenameForViews(fmt))
    : ruleBarRightHtml(fmt.card, fmt.engine, (card) => {
    const sub = new RenderFormat(card, fmt.engine, {
      parent: fmt,
      maxDepth: fmt.maxDepth,
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

function nameShapeRuleRefutedByTypes(
  fmt: ViewContext["fmt"],
  card: RenderCard,
): boolean {
  const fetch = (name: string): RenderCard | undefined => {
    try {
      return fmt.engine.fetchRenderCard(name);
    } catch {
      return undefined;
    }
  };
  const typedCode = (c: RenderCard | undefined): string | undefined =>
    c === undefined || c.typeId === undefined
      ? undefined
      : (fmt.engine.peekCodenameById?.(c.typeId) ?? c.typeCode);
  const leftKey =
    card.name.parts.length > 1
      ? DeckoName.parse(card.name.parts.slice(0, -1).join("+")).key
      : undefined;
  const left = leftKey === undefined || leftKey === "" ? undefined : fetch(leftKey);
  const leftCode = typedCode(left);
  if (leftCode === undefined || leftCode === "set") return false;
  const grandKey = DeckoName.parse(card.name.parts[0]).key;
  const grand = grandKey === "" ? undefined : fetch(grandKey);
  const grandCode = typedCode(grand);
  if (grandCode === undefined || grandCode === "set") return false;
  return true;
}

const barBottomView: ViewFn = (ctx) => {
  const fmt = ctx.fmt;
  const card = fmt.card;
  if (card.typeCode === "bootswatch_skin" || card.typeName === "Bootswatch skin") {
    return `<code>${fmt.renderDelegated("core")}</code>`;
  }
  const setKeysHasRule = card.setKeys.split(" ").includes("RULE");
  const nameShapeSuggestsRule =
    card.name.isCompound &&
    card.name.parts.length === 3 &&
    (card.name.rightName?.key ?? "").startsWith("*");
  const isRuleCard =
    setKeysHasRule ||
    (nameShapeSuggestsRule && !nameShapeRuleRefutedByTypes(fmt, card));
  const skipContentWrap =
    isRuleCard || isRuleCardWithPermissionRight(card);
  if (isPointerOrListCard(card)) {
    if (skipContentWrap) {
      return fmt.renderView("core", { home_view: "content" });
    }
    return fmt.renderView("content", { home_view: "content" });
  }
  const rightKey = card.name.rightName?.key;
  const isRuleCardCompositionJunction =
    card.name.isCompound &&
    card.name.parts.length === 3 &&
    (rightKey === "*type_plu_right" ||
      rightKey === "*type plus right" ||
      rightKey === "*self");
  if (isRuleCard && !isRuleCardCompositionJunction) {
    return fmt.renderView("core");
  }
  return fmt.renderView("content", { home_view: "content" });
};

const titledView: ViewFn = ({ fmt, voo }) => {
  if (fmt.card.name.rightName?.key === "discussion") {
    voo.setViz("comment_box", "show");
  }
  const header = headerHtml({ fmt, voo });
  fmt.addNameContext();
  const core = fmt.renderView("titled_content");
  const bodyClasses = ["d0-card-body", "d0-card-content", fmt.card.setKeys].join(" ");
  const inner =
    `<div class="d0-card-header">${header}</div>\n\n` +
    `<div class="${bodyClasses}">${core}</div>`;
  return slotWrapCommon(fmt, "titled", inner);
};

function headerHtml(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  const tag = headerTitleTag(fmt, voo);
  const titleTag = `<${tag} class="${voo.classy("d0-card-header-title")}">${fmt.renderView("title")}</${tag}>`;
  const menu = voo.show("menu") ? `\n${fmt.renderView("menu")}` : "";
  return `${titleTag}${menu}`;
}

const titledContentView: ViewFn = ({ fmt, voo }) => {
  if (fmt.card.name.rightName?.key === "discussion") voo.showViz("comment_box");
  return fmt.renderDelegated("core");
};

function headerTitleTag(fmt: RenderFormat, voo: Voo): string {
  const explicit = voo.opts["header"];
  return typeof explicit === "string" && explicit !== "" ? explicit : fmt.isMain ? "h1" : "h2";
}

const headerTitleView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const tag = headerTitleTag(fmt, voo);
  return `<${tag} class="${voo.classy("d0-card-header-title")}">${fmt.renderView("title")}</${tag}>`;
};

const headerView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const menu = voo.show("menu") ? `\n${fmt.renderView("menu")}` : "";
  return (
    `<div class="${voo.classy("d0-card-header")}">` +
    `${fmt.renderView("header_title")}${menu}` +
    `</div>`
  );
};

const typeInfoView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const card = fmt.card;
  if (card.typeCode === "basic") return "";
  const typeName = card.typeName ?? "";
  if (typeName === "") return "";
  const known = card.typeId !== undefined;
  return (
    `<span class="type-info float-end">` +
    `<a class="navbar-link ${known ? "known-card" : "wanted-card"}"` +
    ` href="/${h(DeckoName.parse(typeName).urlKey)}">${h(typeName)}</a>` +
    `</span>`
  );
};

const universalEditButtonView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (isNewCard(fmt.card.record)) return "";
  return (
    `<link rel="alternate" type="application/x-wiki" title="Edit this page!"` +
    ` href="/${h(fmt.urlKey())}/edit" />`
  );
};

const rssLinksView: ViewFn = () =>
  null;

const metaTagsView: ViewFn = (ctx) => {
  const noindex = ctx.fmt.card.unknown === true;
  return (
    `<meta charset='UTF-8'>\n` +
    `<meta content='width=device-width, initial-scale=1.0' name='viewport'>\n` +
    (noindex ? `<meta content='noindex' name='robots'>\n` : "")
  );
};

function barDivHtml(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  const card = fmt.card;
  const url = fmt.urlKey();
  const slotId = newSlotId();
  const hamlInHash = hamlSlotInHash();
  const hamlAttrs = emitHamlAttrs({
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-link-name": url,
    "data-card-name": h(slotCardname(card)),
    "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
    "data-card-type-name": card.typeName,
    ...(hamlInHash ? { "data-slot-id": slotId } : {}),
  });
  const codenameKey = virtualSearchCodenameResolverFor(fmt.engine);
  const rightKey = card.name.rightName?.key;
  const virtualSetRight =
    rightKey !== undefined &&
    VIRTUAL_SET_RIGHT_CODENAMES.some((codename) =>
      (codenameKey !== undefined ? codenameKey(codename) : `*${codename}`) === rightKey,
    );
  const virtualKnown =
    card.id === undefined &&
    card.name.isCompound &&
    (card.hostTyped === true
      ? hostTypedNameKnown(fmt, card)
      : fmt.engine.phantomVirtualStructure?.(card.name, card.typeName, card.typeId) !== undefined ||
        virtualSearchCqlFor(card.name, codenameKey) !== undefined ||
        virtualSetRight);
  const menu = itemBarMenuHtml(
    url,
    card.id === undefined,
    card.name.s,
    virtualKnown,
  );
  return (
    `<div class='${serializerFollowsLive() ? `nodblclick d-flex _card-link ${voo.classy("bar")}` : `${voo.classy("bar")} nodblclick d-flex _card-link`}'${hamlAttrs}${hamlInHash ? "" : ` data-slot-id="${slotId}"`}>\n` +
    `${barBodyHtml(ctx)}\n` +
    `${menu}\n\n` +
    `</div>\n`
  );
}

const VIRTUAL_SET_RIGHT_CODENAMES = ["self", "right", "type", "type_plus_right"] as const;

function itemBarHtml(ctx: ViewContext): string {
  const { voo } = ctx;
  prepareBar(ctx);
  if (voo.show("bar_menu")) voo.classUp("bar", "with-bar-menu");
  return barDivHtml(ctx);
}

function itemBarMenuHtml(url: string, isNew = false, name = "", classRStarKnown = false): string {
  const known = isNew ? classRStarKnown : true;
  const query =
    !known && name !== "" && url !== name.replace(/ /g, "_")
      ? `?card%5Bname%5D=${cgiEscape(name)}`
      : "";
  const modalQuery = query === "" ? "?layout=modal" : `${query}&amp;layout=modal`;
  const fullPage =
    `<a class="full-page-link ${known ? "known-card" : "wanted-card"}" href="/${h(url)}${query}">${icon("open_in_full")} page</a>`;
  const modal =
    `<a data-slotter-mode="modal" data-modal-class="modal-dialog modal-dialog-centered modal-xl" size="xl"` +
    ` class="_modal-page-link slotter" href="/${h(url)}${modalQuery}" data-remote="true">${icon("fullscreen")} modal</a>`;
  const edit =
    `<a rel="nofollow" class="edit-link slotter" title="Edit" data-bs-toggle="tooltip" data-bs-placement="bottom"` +
    ` data-slotter-mode="modal" data-modal-class="modal-lg" href="/${h(url)}/edit${query}" data-remote="true">${icon("edit")} ${isNew ? "create" : "edit"}</a>`;
  const board =
    `<a rel="nofollow" class="board-link slotter" title="Advanced" data-bs-toggle="tooltip" data-bs-placement="bottom"` +
    ` data-slotter-mode="modal-replace" href="/${h(url)}/board${query}" data-remote="true">${icon("space_dashboard")} advanced</a>`;
  return (
    `<div class='bar-menu _over-card-link _card-link-clickable'>\n` +
    `<div class='bar-menu-dropdown dropdown'>\n` +
    `<div aria-expanded='false' aria-haspopup='true' class='bar-menu-button btn dropdown-toggle' data-bs-toggle='dropdown'>\n` +
    `${icon("more_horiz")}\n` +
    `</div>\n` +
    `<div aria-labelledby='.bar-menu-button' class='bar-menu-list dropdown-menu'>\n` +
    `<div class='dropdown-item'>\n${fullPage}\n</div>\n` +
    `<div class='dropdown-item'>\n${modal}\n</div>\n` +
    `<div class='dropdown-item'>\n${edit}\n</div>\n` +
    `<div class='dropdown-item'>\n${board}\n</div>\n` +
    `</div>\n</div>\n</div>`
  );
}

const itemBarView: ViewFn = (ctx) => {
  const inner = itemBarHtml(ctx);
  return slotWrapCommon(ctx.fmt, "bar", inner);
};

function unknownCardCreatable(fmt: RenderFormat): boolean {
  return (
    fmt.engine.unknownCardCreatable?.(fmt.card) ??
    fmt.engine.taskAllowed?.(fmt.card, "create") === true
  );
}

function unknownLinkQuery(fmt: RenderFormat): string {
  const params: string[] = [];
  const nameSuffix = wantedHrefQuerySuffix(fmt.card.name.s);
  if (nameSuffix !== "") params.push(nameSuffix.slice(1));
  const type = fmt.voo?.opts["type"];
  if (typeof type === "string" && type !== "") params.push(`card%5Btype%5D=${cgiEscape(type)}`);
  return params.length === 0 ? "" : `?${params.join("&amp;")}`;
}

function unknownLinkHref(fmt: RenderFormat): string {
  const url = fmt.urlKey();
  if (url === "") return "/?view=new_in_modal";
  return `/${h(url)}/new_in_modal${unknownLinkQuery(fmt)}`;
}

export const unknownView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!unknownCardCreatable(fmt)) return "";
  const link =
    `<a rel="nofollow" class="unknown-link slotter" href="${unknownLinkHref(fmt)}" data-remote="true">` +
    `${icon("add_box")} ${fmt.renderView("title")}</a>`;
  return slotWrapCommon(fmt, "unknown", link);
};

export { unknownView as htmlFormatUnknownView };

const blankView: ViewFn = () => "";

export const miniUnknownView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!unknownCardCreatable(fmt)) return "";
  return (
    `<a rel="nofollow" class="unknown-link slotter" href="${unknownLinkHref(fmt)}" data-remote="true">` +
    `${icon("add_box")}</a>`
  );
};

const labeledView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.classUp("card-slot", "row");
  const title = fmt.renderView("title");
  const content = fmt.renderView("labeled_content");
  const setKeys = fmt.card.setKeys;
  const bodyClasses = ["d0-card-body", "d0-card-content", setKeys]
    .filter((s) => s !== "")
    .join(" ");
  const labeled =
    `<div class='label col-4 text-end'>\n` +
    `${title}\n` +
    `</div>\n` +
    `<div class='labeled-content col-8'>\n` +
    `<div class="${bodyClasses}">${content}</div>\n` +
    `</div>\n`;
  const menu = fmt.card.unknown === true ? "" : fmt.renderView("menu");
  return slotWrapCommon(fmt, "labeled", `${labeled}\n${menu}`);
};

const labeledContentView: ViewFn = (ctx) => ctx.fmt.renderDelegated("core");

const miniBarView: ViewFn = (ctx) => {
  if (ctx.fmt.card.unknown === true && ctx.fmt.card.pointerItemReadVerdict !== true && ctx.fmt.engine.isDenied(ctx.fmt.card)) {
    ctx.voo.hide("bar_middle");
    return slotWrapCommon(
      ctx.fmt,
      "mini_bar",
      pointerListItemBodyForUnknown(slotCardname(ctx.fmt.card), {
        ...(ctx.fmt.card.setKeys !== undefined ? { setKeys: ctx.fmt.card.setKeys } : {}),
        ...(ctx.fmt.card.typeName !== undefined ? { typeName: ctx.fmt.card.typeName } : {}),
        ...(ctx.fmt.card.typeId !== undefined ? { typeId: ctx.fmt.card.typeId } : {}),
      }, ctx.fmt.engine.phantomItemType),
    );
  }

  const inner = itemBarHtml(ctx);
  return slotWrapCommon(ctx.fmt, "mini_bar", inner);
};

const barBodyView: ViewFn = (ctx) => barBodyHtml(ctx);

const barMenuView: ViewFn = (ctx) =>
  `${itemBarMenuHtml(ctx.fmt.urlKey(), ctx.fmt.card.id === undefined, ctx.fmt.card.name.s)}\n`;

function closedBarAliasView(name: string): ViewFn {
  return (ctx) => slotWrapCommon(ctx.fmt, name, accordionBarHtml(ctx, false));
}

function openBarAliasView(name: string): ViewFn {
  return (ctx) => slotWrapCommon(ctx.fmt, name, accordionBarHtml(ctx, true));
}

const fullBarView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const cols = readFullBarCols(fmt.card);
  voo.classUp("bar", fmt.card.setKeys);
  const three = ["bar-left", "bar-middle", "bar-right"];
  for (let i = 0; i < three.length; i++) {
    const n = cols[i];
    voo.classUp(three[i] as string, n === undefined ? "col" : `col-${n}`);
  }
  if (voo.show("bar_menu")) voo.classUp("bar", "with-bar-menu");
  return slotWrapCommon(ctx.fmt, "full_bar", barDivHtml(ctx));
};

const boxView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.hide("menu");
  const card = fmt.card;
  const slotId = newSlotId();
  const hamlInHash = hamlSlotInHash();
  const dataAttrs = emitHamlAttrs({
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": h(slotCardname(card)),
    "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
    "data-card-type-name": card.typeName,
    "data-card-link-name": card.name.urlKey,
    ...(hamlInHash ? { "data-slot-id": slotId } : {}),
  });
  let out = `<div class='${voo.classy("box", card.setKeys)} card _card-link nodblclick'${dataAttrs}>\n`;
  if (voo.show("box_top")) {
    out += `<div class='${voo.classy("box-top")} card-header text-center'>\n`;
    out += `${fmt.renderView("box_top")}\n`;
    out += voo.show("menu") ? `${fmt.renderView("menu")}\n` : "\n";
    out += `</div>\n`;
  }
  if (voo.show("box_middle")) {
    out += `<div class='${voo.classy("box-middle")} card-body'>\n`;
    out += `${fmt.renderView("box_middle")}\n`;
    out += `</div>\n`;
  }
  if (voo.show("box_bottom")) {
    out += `<div class='${voo.classy("box-bottom")} card-footer text-center'>\n`;
    out += `${fmt.renderView("box_bottom")}\n`;
    out += `</div>\n`;
  }
  out += `</div>\n`;
  return out;
};

const boxTopView: ViewFn = (ctx) => ctx.fmt.renderView("title_link");

const boxMiddleView: ViewFn = (ctx) => ctx.fmt.renderView("content");

function creditLinkHtml(name: string): string {
  const url = DeckoName.parse(name).urlKey;
  return (
    `<a class="known-card" href="/${h(url)}">` +
    `<span class="card-title" title="${h(name)}">${h(name)}</span></a>`
  );
}

function lexiconNameForId(id: number): string | undefined {
  return getNameEnvironment()?.lexicon?.name(id);
}

const creatorCreditView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const record = fmt.card.record;
  const creatorId = record.creatorId;
  const name =
    creatorId === undefined ? undefined : (fmt.engine.peekNameForId?.(creatorId) ?? lexiconNameForId(creatorId));
  const body =
    name === undefined || record.createdAt === undefined
      ? ""
      : `Created by ${creditLinkHtml(name)} ${timeAgoInWords(record.createdAt, cardWallClockNow())} ago`;
  return `<div class="text-muted creator-credit">${body}</div>`;
};

function updaterLinksHtml(ctx: ViewContext, updaters: readonly UpdaterCardInfo[]): string {
  const MAX_COUNT = 3;
  const total = updaters.length;
  const numToShow = total > MAX_COUNT ? MAX_COUNT - 1 : MAX_COUNT;
  const links: string[] = [];
  for (let i = 0; i < Math.min(numToShow, total); i++) {
    const name = updaters[i]!.name;
    if (name !== undefined) links.push(creditLinkHtml(name));
  }
  if (total > numToShow) {
    const othersName = `${ctx.fmt.card.name.s}+*editors`;
    const href = DeckoName.parse(othersName).urlKey;
    links.push(`<a class="known-card" href="/${h(href)}">${total - numToShow} others</a>`);
  }
  return toSentenceHtml(links);
}

function toSentenceHtml(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const updatedByView: ViewFn = (ctx) => {
  const reader = ctx.fmt.engine.updaterRenderReader?.();
  const updaters = reader?.updaters ?? [];
  const body = updaters.length === 0 ? "" : `Updated by ${updaterLinksHtml(ctx, updaters)}`;
  return `<div class="text-muted">${body}</div>`;
};

const boxBottomView: ViewFn = (ctx) =>
  `${ctx.fmt.renderView("creator_credit")}\n${ctx.fmt.renderView("updated_by")}`;

const IMAGE_BOX_SIZE_MAP: Record<string, string> = {
  icon: "icon",
  small: "small",
  medium: "small",
  large: "medium",
  xlarge: "medium",
};

function imageBoxCardName(ctx: ViewContext): string {
  return ctx.fmt.card.name.trunkName.s;
}

function imageBoxInner(ctx: ViewContext, inner: string): string {
  const { voo } = ctx;
  const rawSize = voo.opts["size"];
  const size = typeof rawSize === "string" && rawSize !== "" ? rawSize : "medium";
  const rawTitle = voo.opts["title"];
  const title = typeof rawTitle === "string" && rawTitle !== "" ? rawTitle : imageBoxCardName(ctx);
  const attrs = emitAttrs({ title, class: `image-box ${size}` });
  return `<div${attrs}>${inner}</div>`;
}

function imageBoxCore(ctx: ViewContext): string {
  const rawSize = ctx.voo.opts["size"];
  const size = typeof rawSize === "string" && rawSize !== "" ? rawSize : "medium";
  const renderSize = IMAGE_BOX_SIZE_MAP[size] ?? "medium";
  return str(ctx.fmt.renderView("core", { size: renderSize }));
}

const boxedView: ViewFn = (ctx) => imageBoxInner(ctx, imageBoxCore(ctx));

const boxedLinkView: ViewFn = (ctx) => {
  const core = imageBoxCore(ctx);
  const target = imageBoxCardName(ctx);
  const klass = ctx.fmt.card.unknown === true ? "wanted-card" : "known-card";
  const url = `/${h(DeckoName.parse(target).urlKey)}`;
  return imageBoxInner(ctx, `<a class="${klass}" href="${url}">${core}</a>`);
};

const flatNameView: ViewFn = ({ fmt, voo }) => {
  const variant = voo.opts["variant"];
  return typeof variant === "string" ? fmt.card.name.vary(variant).s : fmt.card.name.s;
};

const flatLinknameView: ViewFn = ({ fmt }) => fmt.urlKey();

const flatAddButtonView: ViewFn = ({ fmt }) => {
  const name = fmt.card.name.s;
  const segment = name.replace(/ /g, "_");
  const label = `Add ${name}`;
  const safeLabel = h(label);
  return (
    `<a data-slotter-mode="modal" data-modal-class="modal-dialog modal-dialog-centered" ` +
    `class="btn btn-secondary slotter" href="/type/${h(segment)}?view=new_in_modal" ` +
    `data-remote="true"><span class="card-title" title="${safeLabel}">${safeLabel}</span></a>`
  );
};

export const configureButtonView: ViewFn = ({ fmt }) => {
  if (fmt.card.typeCode !== "cardtype" && fmt.card.typeName !== "Cardtype") {
    throw new UnsupportedViewError("configure_button", fmt.card.name.s);
  }
  const safeName = h(fmt.card.name.s);
  const title = `Configure ${pluralize(safeName)}`;
  const query = `board%5Btab%5D=rules_tab&amp;set=${cgiEscape(`${safeName}+*type`)}`;
  const known = fmt.card.unknown !== true;
  return (
    `<a class="configure-type-link ms-3 btn btn-secondary ${known ? "known-card" : "wanted-card"}" ` +
    `href="/${h(fmt.urlKey())}/board?${query}">` +
    `<span class="card-title" title="${h(title)}">${wrappedTitleInner(title, vooJoint(fmt.voo))}</span></a>`
  );
};

const flatAddLinkView: ViewFn = ({ fmt }) =>
  `<a class="cardtype-add-link" href="/${fmt.card.key ?? ""}/new">add</a>`;

const flatAddUrlView: ViewFn = ({ fmt }) => `/${fmt.card.key ?? ""}/new`;

const homePathView: ViewFn = ({ fmt }) => {
  if (fmt.card.key !== "*home") {
    throw new UnsupportedViewError("home_path", fmt.card.name.s);
  }
  return "/";
};

const homeUrlView: ViewFn = ({ fmt }) => {
  if (fmt.card.key !== "*home") {
    throw new UnsupportedViewError("home_url", fmt.card.name.s);
  }
  return fmt.cardUrl("");
};

const cardUrlView: ViewFn = ({ fmt }) => fmt.cardUrl(fmt.urlKey());

export const lastActionVerbNotifyView: ViewFn = (ctx) => {
  const reader = ctx.fmt.engine.historyRenderReader?.();
  const act = reader?.cardLastAct;
  if (reader === undefined || act === undefined) return "edited";
  const actions = reader.actionsOfAct(act.id);
  const main =
    actions.find((a) => a.card_id === reader.rootCardId) ?? actions[0];
  const type = main === undefined ? undefined : actionTypeFromCode(Number(main.action_type));
  return type === undefined ? "edited" : `${type}d`;
};

const listOfChangesView: ViewFn = () => "";

const subeditsView: ViewFn = (ctx) => {
  const authored = ctx.voo.opts["authoredNestText"];
  return typeof authored === "string" ? authored : "";
};

const followedView: ViewFn = () => "*followed set of cards*";

const unfollowUrlView: ViewFn = () => "";

export const verifyUrlView: ViewFn = (ctx) => tokenUrlBody(ctx);
export const resetPasswordUrlView: ViewFn = (ctx) => tokenUrlBody(ctx);

function tokenUrlBody(ctx: ViewContext): string {
  const secret = ctx.fmt.engine.tokenConfig?.secret;
  if (typeof secret !== "string" || secret === "") {
    throw new Error("HMAC key cannot be empty");
  }
  return "";
}

const verifyDaysView: ViewFn = () => String(DEFAULT_TOKEN_EXPIRY_SECONDS / 86400);
const resetPasswordDaysView: ViewFn = verifyDaysView;

const FLAT_VIEW_RUBY_SETS: Readonly<Record<string, { sets: readonly string[]; selfGated?: boolean }>> = {
  add_button: { sets: ["Type::Cardtype"] },
  add_link: { sets: ["Type::Cardtype"] },
  add_url: { sets: ["Type::Cardtype"] },
  boxed: { sets: ["Type::Image"] },
  boxed_link: { sets: ["Type::Image"] },
  configs: { sets: ["Type::Role"] },
  card_list: { sets: ["Abstract::Search::Views"] },
  no_search_results: { sets: ["Abstract::Search::Views"] },
  home_path: { sets: ["Self::Home"], selfGated: true },
  home_url: { sets: ["Self::Home"], selfGated: true },
  search_box: { sets: ["Self::Search"], selfGated: true },
  bar_setting_list: { sets: ["Type::Set"], selfGated: true },
  template_link: { sets: ["Type::Set"], selfGated: true },
  verify_url: { sets: ["Right::Account"] },
  reset_password_url: { sets: ["Right::Account"] },
  verify_days: { sets: ["Right::Account"] },
  reset_password_days: { sets: ["Right::Account"] },
};

function cardInRubySets(setKeys: string, sets: readonly string[]): boolean {
  for (const setKeyToken of setKeys.split(/\s+/)) {
    if (setKeyToken === "") continue;
    const token = rubySelfToken(setKeyToken);
    if (token === null) continue;
    for (const candidate of anchoredModuleCandidates(token).candidates) {
      if (sets.includes(candidate)) return true;
      for (const [owner, includes] of Object.entries(SET_INCLUDES)) {
        if (owner !== candidate && !owner.startsWith(`${candidate}::`)) continue;
        if (sets.some((set) => includes.html?.includes(set) === true || includes.base?.includes(set) === true)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function flatViewDefinedFor(view: string, setKeys: string): boolean {
  const scope = Object.hasOwn(FLAT_VIEW_RUBY_SETS, view) ? FLAT_VIEW_RUBY_SETS[view] : undefined;
  return scope === undefined || cardInRubySets(setKeys, scope.sets);
}

export function flatViewRefused(view: string, setKeys: string): boolean {
  const scope = Object.hasOwn(FLAT_VIEW_RUBY_SETS, view) ? FLAT_VIEW_RUBY_SETS[view] : undefined;
  return scope !== undefined && scope.selfGated !== true && !cardInRubySets(setKeys, scope.sets);
}

export function baseTableView(view: string): ViewFn {
  return function sharedBaseView(ctx: ViewContext): ViewResult {
    const fn = baseTableEntry(view);
    if (fn === undefined) throw new UnsupportedViewError(view, ctx.fmt.card.name.s);
    return fn(ctx);
  };
}

export const HTML_VIEWS: Record<string, ViewFn> = {
  title: titleView,
  title_link: titleLinkView,
  title_no_link: titleNoLinkView,
  open_content: openContentView,
  header: headerView,
  header_title: headerTitleView,
  type_info: typeInfoView,
  universal_edit_button: universalEditButtonView,
  rss_links: rssLinksView,
  meta_tags: metaTagsView,
  content: emailScopedContentView,
  menu_block: menuBlockView,
  edit_link: editLinkView,
  edit_button: editButtonView,
  full_page_link: fullPageLinkView,
  board_link: boardLinkView,
  help_link: helpLinkView,
  content_panel: contentPanelView,
  content_with_title: contentWithTitleView,
  conflict: conflictView,
  text_without_nests: textWithoutNestsView,
  home_url: homeUrlView,
  bar_setting_list: barSettingListScopedView,
  read_formgroup: readFormgroupBody,
  lead: helpLeadView,
  configs: roleConfigsView,
  demo: demoView,
  url: cardUrlView,
  last_action_verb: lastActionVerbNotifyView,
  list_of_changes: listOfChangesView,
  subedits: subeditsView,
  followed: followedView,
  unfollow_url: unfollowUrlView,
  verify_url: verifyUrlView,
  reset_password_url: resetPasswordUrlView,
  verify_days: verifyDaysView,
  reset_password_days: resetPasswordDaysView,
  core: emailScopedCoreView,
  card_list: cardListView,
  no_search_results: noSearchResultsView,
  open: openView,
  closed: closedView,
  titled: titledView,
  titled_content: titledContentView,
  menu: menuView,
  link: linkView,
  bar: itemBarView,
  mini_bar: miniBarView,
  bar_left: barLeftView,
  bar_middle: barMiddleView,
  bar_right: barRightView,
  bar_bottom: barBottomView,
  comment_box: commentBoxBaseView,
  bar_menu: barMenuView,
  bar_body: barBodyView,
  closed_bar: closedBarAliasView("closed_bar"),
  accordion_bar: closedBarAliasView("accordion_bar"),
  open_bar: openBarAliasView("open_bar"),
  expanded_bar: openBarAliasView("expanded_bar"),
  full_bar: fullBarView,
  box: boxView,
  box_top: boxTopView,
  box_middle: boxMiddleView,
  box_bottom: boxBottomView,
  creator_credit: creatorCreditView,
  updated_by: updatedByView,
  boxed: boxedView,
  boxed_link: boxedLinkView,
  unknown: unknownView,
  blank: blankView,
  mini_unknown: miniUnknownView,
  labeled: labeledView,
  labeled_content: labeledContentView,
  name: flatNameView,
  linkname: flatLinknameView,
  add_button: flatAddButtonView,
  configure_button: configureButtonView,
  add_link: flatAddLinkView,
  add_url: flatAddUrlView,
  home_path: homePathView,
  template_nest: templateNestView,
  template_link: templateLinkView,
  board: boardView,
  cardboard: cardboardView,
  edit: editView,
  edit_form: editFormView,
  new: newView,
  new_fields: newFieldsView,
  new_type_formgroup: newTypeFormgroupView,
  new_buttons: newButtonsView,
  name_formgroup: nameFormgroupView,
  edit_name_row: editNameRowView,
  edit_type_row: editTypeRowView,
  content_formgroups: contentFormgroupsView,
  content_formgroup: contentFormgroupView,
  input: inputView,
  conflict_tracker: conflictTrackerView,
  edit_buttons: editButtonsView,
  guide_tab: guideTabView,
  engage_tab: engageTabView,
  follow_section: followSectionView,
  rules_tab: rulesTabView,
  related_tab: relatedTabView,
  history_tab: historyTabView,
  help: helpView,
  guide: guideView,
  help_text: helpTextView,
  ...NAVBAR_VIEWS,
};

const BASE_TABLE_VIEWS: Readonly<Record<string, ViewFn>> = { ...HTML_VIEWS };

export function baseTableSnapshot(): Record<string, ViewFn> {
  return { ...BASE_TABLE_VIEWS };
}

export function baseTableEntry(view: string): ViewFn | undefined {
  return Object.hasOwn(BASE_TABLE_VIEWS, view) ? BASE_TABLE_VIEWS[view] : undefined;
}
