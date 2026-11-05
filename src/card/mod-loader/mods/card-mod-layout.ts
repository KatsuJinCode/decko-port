import { stripHtmlTags as stripTags } from "../../render/html-text.js";
import { truncateHtmlSafeText } from "../../render/text-helpers.js";
import type { ContentFn } from "../../render/content-overrides.js";

import { str, type ViewResult } from "../../render/format.js";
import { DeckoName } from "../../name.js";
import { NameNotFoundError, CodenameNotFoundError } from "../../name/errors.js";
import { emitAttrs, h } from "../../render/slot-html.js";
import { scanNests, interpretEscapedLiteral } from "../../render/nest-syntax.js";
import { highlight } from "../../render/code-highlighting/index.js";
import { HTML_VIEWS } from "../../render/views.js";
import {
  ONE_LINE_CHARACTER_LIMIT,
  truncate,
} from "../../render/text-helpers.js";
import {
  UnsupportedViewError,
  escapeLiteralForCard,
  vooJoint,
  wrappedTitleInner,
  type RenderCard,
  type RenderFormat,
  type ViewContext,
  type ViewFn,
} from "../../render/format.js";
import {
  abstractItemsNavItemView,
  dropdownDividerView,
  fillUniqueIds,
  myCardDropdownInnerHtml,
  navbarItemsOverridden,
  navbarLinksForMethodOverride,
} from "../../render/navbar-views.js";
import { rawItemStrings } from "../../render/pointer-list.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import type { DeckoModManifest } from "../mod-manifest.js";
import type { ModEngineHost, ModEventFn, ModEventRegistration } from "../mod-manifest.js";
import { warmRuleCards } from "./rule-card-warm.js";
import { viewWrapInherited } from "../mod-view-helpers.js";
import { CardActionError } from "../../actions/types.js";
import { readPermissionStatements, readPermissionStateFromViewerResults, anonymousIdFromResults } from "../../permissions/read-rules.js";
import { toSentence } from "../mod-form-substrate.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

const validateRoleEnabling: ModEventFn = async (card, _host, ctx) => {
  if (card.authCurrentId === undefined || ctx.fetch === undefined) {
    throw new Error("validate_role_enabling requires the save's actor and fetch context");
  }
  const actorId = card.authCurrentId;
  const held = new Set<string>();
  if (actorId !== null) {
    const viewer = { signedIn: true, actorId };
    const results = await ctx.driver.batch(readPermissionStatements(viewer));
    if (actorId !== anonymousIdFromResults(results)) {
      const anyoneId = (results[0].rows as Array<{ id: number; codename: string }>).find(row => row.codename === "anyone")?.id;
      const state = readPermissionStateFromViewerResults(results, viewer);
      for (const id of state.parties) {
        if (id === actorId || id === anyoneId) continue;
        const role = await ctx.fetch.fetchById(id);
        if (role?.name === undefined || role.name === null) throw new Error(`current role ${id} has no name`);
        held.add(role.name.s);
      }
    }
  }
  const content = (card.dbContent ?? "").replace(/\n+$/, "");
  const names = content === "" ? [] : rawItemStrings(content).flatMap(item => {
    try {
      return [DeckoName.parse(item).absoluteName(card.name).s];
    } catch (error) {
      if (error instanceof NameNotFoundError || error instanceof CodenameNotFoundError) return [];
      throw error;
    }
  });
  const illegal = names.filter(name => !held.has(name));
  if (illegal.length === 0) return;
  const message = `illegal roles: ${toSentence(illegal)}`;
  throw new CardActionError("validation-failed", `Validation failed: ${message}`, `CONTENT: ${message}`, { content: message }, card.name);
};

const baseCore: ViewFn = HTML_VIEWS["core"];
const baseBarBottom: ViewFn = HTML_VIEWS["bar_bottom"];

const MATERIAL_ICONS: Readonly<Record<string, string>> = {
  close: "close",
  help: "help",
  modal: "fullscreen",
  new_window: "close_fullscreen",
};

function icon(name: string): string {
  return `<i class="notranslate material-icons">${MATERIAL_ICONS[name] ?? name}</i>`;
}

function contentTag(
  tag: string,
  attrs: Record<string, string | number | undefined>,
  content: string,
): string {
  return `<${tag}${emitAttrs(attrs)}>${content}</${tag}>`;
}

function output(parts: (ViewResult | undefined)[]): string {
  return parts.filter((p) => p !== undefined).map(str).join("\n");
}

function rubyBlank(s: string): boolean {
  return /^\s*$/.test(s);
}

function cardPath(urlKey: string): string {
  return `/${urlKey}`;
}

const MODAL_SIZE: Readonly<Record<string, string>> = {
  small: "sm",
  medium: "",
  large: "lg",
  full: "full",
  xl: "xl",
};

function modalDialogClasses(size: unknown): string {
  const classes = ["modal-dialog", "modal-dialog-centered"];
  if (size === undefined || size === null || size === "") return classes.join(" ");
  classes.push(`modal-${MODAL_SIZE[String(size)] ?? ""}`);
  return classes.join(" ");
}

const closeModalLinkView: ViewFn = () =>
  `<a class="_close-modal btn-close" data-bs-dismiss="modal" href="">${icon("close")}</a>`;

const popOutModalLinkView: ViewFn = ({ fmt }) =>
  `<a class="pop-out-modal btn-close" href="${cardPath(fmt.urlKey())}">${icon("modal")}</a>`;

const modalTitleView: ViewFn = () => "";

const modalFooterView: ViewFn = () =>
  `<button name="button" type="submit" class="btn-xs _close-modal float-end btn btn-primary" data-bs-dismiss="modal">Close</button>`;

const modalMenuView: ViewFn = (ctx) =>
  contentTag(
    "div",
    { class: "modal-menu _modal-menu ms-auto" },
    output([
      ctx.fmt.renderView("close_modal_link"),
      ctx.fmt.renderView("pop_out_modal_link", {}, "show"),
    ]),
  );

const modalLinkView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const size = voo.opts["size"];
  return contentTag(
    "a",
    {
      "data-slotter-mode": "modal",
      "data-modal-class": modalDialogClasses(size),
      size: typeof size === "string" && size !== "" ? size : undefined,
      class: "slotter",
      href: `${cardPath(fmt.urlKey())}?layout=modal`,
      "data-remote": "true",
    },
    str(ctx.fmt.renderView("title")),
  );
};

const modalView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const title = str(fmt.renderView("modal_title"));
  const menu = str(fmt.renderView("modal_menu"));
  const footer = str(fmt.renderView("modal_footer"));
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += `<div class='${modalDialogClasses(voo.opts["size"])}'>\n`;
  out += "<div class='modal-content'>\n";
  if (voo.show("modal_header")) {
    out += "<div class='modal-header'>\n";
    out += `${title}\n`;
    if (voo.show("modal_menu")) out += `${menu}\n`;
    out += "</div>\n";
  }
  out += "<div class='modal-body'>\n\n</div>\n";
  if (!rubyBlank(footer)) out += `<div class='modal-footer'>\n${footer}\n</div>\n`;
  out += "</div>\n</div>\n</div>\n";
  return out;
};

function overlayHelpLinkAttrs(fmt: ViewContext["fmt"]): Record<string, string | number | undefined> {
  const rawHelp = fmt.menuHelpContentBytes();
  const helpContent = rubyBlank(rawHelp) ? "&nbsp;" : rawHelp;
  return {
    tabindex: 0,
    "data-bs-toggle": "popover",
    "data-bs-trigger": "hover focus",
    "data-bs-content": helpContent,
    "data-bs-placement": "left",
    class: "help-link ps-1 _popover_link",
  };
}

function overlayHelpLinkGuideAttrs(fmt: ViewContext["fmt"]): Record<string, string | number | undefined> {
  return {
    path: "#",
    ...overlayHelpLinkAttrs(fmt),
    class: "help-link ps-1 _popover_link slotter text-muted p-1 ms-1",
    href: `${cardPath(fmt.urlKey())}/overlay_guide`,
    "data-slot-selector": ".board-sidebar > ._overlay-container-placeholder > .card-slot",
    "data-slotter-mode": "overlay",
    "data-remote": "true",
  };
}

const overlayHelpLinkView: ViewFn = ({ fmt }) =>
  contentTag("a", guideCard(fmt) === undefined
    ? { ...overlayHelpLinkAttrs(fmt), class: `${overlayHelpLinkAttrs(fmt)["class"]} text-muted p-1 ms-1`, href: "#" }
    : overlayHelpLinkGuideAttrs(fmt), icon("help"));

function overlayNewWindowLink(fmt: ViewContext["fmt"]): string {
  return contentTag(
    "a",
    { class: "text-muted p-1 ms-1 known-card", href: cardPath(fmt.urlKey()) },
    icon("new_window"),
  );
}

function overlayCloseLink(): string {
  return contentTag(
    "a",
    { "data-bs-dismiss": "overlay", class: "text-muted p-1 ms-1", href: "#" },
    icon("close"),
  );
}

const overlayMenuView: ViewFn = ({ fmt }) =>
  contentTag(
    "div",
    { class: "overlay-menu" },
    output([
      fmt.renderView("overlay_help_link"),
      overlayNewWindowLink(fmt),
      overlayCloseLink(),
    ]),
  );

const overlayTitleView: ViewFn = (ctx) => ctx.fmt.renderView("title");

const overlayHeaderView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.classUp("d0-card-header", "bg-body");
  voo.classUp("d0-card-header-title", "d-flex");
  const title = fmt.renderView("overlay_title");
  const menu = fmt.renderView("overlay_menu");
  return contentTag("div", { class: voo.classy("d0-card-header") }, output([title, menu]));
};

function guideCard(fmt: ViewContext["fmt"]): ReturnType<ViewContext["fmt"]["engine"]["fetchRenderCard"]> {
  const card = fmt.card;
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
      leftKey !== undefined ? fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*guide")) {
    const record = fmt.engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (fmt.engine.isDenied(record)) continue;
    if (record.typeCode === "pointer") {
      const firstItem = firstPointerItem(record.dbContent);
      return firstItem === undefined ? undefined : fmt.engine.fetchRenderCard(firstItem);
    }
    return record;
  }
  return undefined;
}

function firstPointerItem(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

async function prepareGuideRules(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const setTypeId = host.codenames.peekId("set");
  const settingTypeId = host.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return;
  await warmRuleCards(host, setTypeId, settingTypeId, ["guide"]);
}

function titleBytes(ctx: ViewContext): string {
  const label = ctx.voo.opts["title"];
  if (typeof label === "string" && label !== "") {
    return `<span class="card-title" title="${h(label)}">${wrappedTitleInner(h(label), vooJoint(ctx.voo))}</span>`;
  }
  return str(ctx.fmt.renderView("title"));
}

function navItem(content: string): string {
  return `<li class="nav-item">${content}</li>`;
}

const navItemView: ViewFn = ({ fmt, voo }) => {
  const known = fmt.card.unknown !== true;
  const cls = known ? "nav-link known-card" : "nav-link wanted-card";
  return navItem(
    contentTag("a", { class: cls, href: cardPath(fmt.urlKey()) }, titleBytes({ fmt, voo })),
  );
};

const navLinkInDropdownView: ViewFn = ({ fmt, voo }) => {
  const known = fmt.card.unknown !== true;
  const cls = known ? "dropdown-item known-card" : "dropdown-item wanted-card";
  return contentTag("a", { class: cls, href: cardPath(fmt.urlKey()) }, titleBytes({ fmt, voo }));
};

function navbarLinkChunk(
  ctx: ViewContext,
  target: string,
  label: string | undefined,
  view: string,
  linkClass: string,
): string {
  if (/^(\/|https?:|mailto:)/.test(target)) {
    const type = /^https?:/.test(target)
      ? "external-link"
      : /^\//.test(target)
        ? "internal-link"
        : "email-link";
    const href = target;
    const text = label ?? href;
    const link = contentTag(
      "a",
      {
        class: `${linkClass} ${type}`,
        target: type === "external-link" ? "_blank" : undefined,
        href,
      },
      h(text),
    );
    return view === "nav_item" ? navItem(link) : link;
  }
  return ctx.fmt.nest({
    syntax: target,
    name: target,
    options: {
      view,
      title: label ?? DeckoName.parse(target).fullyStripped.s,
      extra: {},
    },
    comment: undefined,
  });
}

function dividerIndex(rawSyntax: string): number {
  if (!rawSyntax.includes("|")) return -1;
  let masked = rawSyntax;
  for (const incl of rawSyntax.match(/\{\{[^}]*\}\}/g) ?? []) {
    masked = masked.split(incl).join("x".repeat(incl.length));
  }
  return masked.indexOf("|");
}

function linkChunksInText(
  ctx: ViewContext,
  text: string,
  view: string,
  linkClass: string,
): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const start = rest.indexOf("[[");
    if (start === -1) {
      out.push(rest);
      break;
    }
    out.push(rest.slice(0, start));
    const match = /^\[\[([^\]]+)\]\]/.exec(rest.slice(start));
    if (match === null) {
      out.push(rest.slice(start, start + 2));
      rest = rest.slice(start + 2);
      continue;
    }
    const syntax = match[1] ?? "";
    const divider = dividerIndex(syntax);
    const target = (divider === -1 ? syntax : syntax.slice(0, divider)).trim();
    const label =
      divider === -1 ? undefined : (syntax.slice(divider + 1).trim() || undefined);
    if (target !== "") out.push(navbarLinkChunk(ctx, target, label, view, linkClass));
    rest = rest.slice(start + match[0].length);
  }
  return out;
}

function navbarItems(ctx: ViewContext, view: string, linkClass: string): string {
  const pieces = scanNests(ctx.fmt.card.dbContent);
  let out = "";
  for (const piece of pieces) {
    if (piece.kind === "escaped") {
      out += interpretEscapedLiteral(piece.text, (literal) =>
        escapeLiteralForCard(ctx.fmt.card, literal),
      );
      continue;
    }
    if (piece.kind === "text" || piece.nest === undefined) {
      out += linkChunksInText(ctx, piece.text, view, linkClass).join("");
      continue;
    }
    if (piece.nest.comment !== undefined) {
      out += ctx.fmt.nest(piece.nest);
      continue;
    }
    out += ctx.fmt.nest({ ...piece.nest, options: { ...piece.nest.options, view } });
  }
  return out;
}

const navbarLinksView: ViewFn = (ctx) =>
  navbarItemsOverridden(ctx.fmt)
    ? navbarLinksForMethodOverride(ctx)
    : `<ul class="navbar-nav">${navbarItems(ctx, "nav_item", "nav-link")}</ul>`;

const htmlNavbarLinksView: ViewFn = (ctx) => {
  const links = rawItemStrings(ctx.fmt.card.dbContent)
    .filter((item) => item !== "")
    .map((item) => {
      const parsed = DeckoName.parse(item);
      const name = parsed.isAbsolute ? parsed.s : parsed.absoluteName(ctx.fmt.card.name).s;
      return ctx.fmt.nest({ name, syntax: name, options: { view: "link", extra: {} }, comment: undefined });
    });
  return `<ul class="navbar-nav">${links.map((link) => `<li class="nav-item">${link}</li>`).join("\n")}</ul>`;
};

function isRightHeadCard(card: RenderCard): boolean {
  return card.name.isCompound && card.name.rightName?.key === "*head";
}

function isSelfHeadCard(card: RenderCard): boolean {
  return card.name.key === "*head";
}

const layoutCoreView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (isRightHeadCard(fmt.card)) {
    return fmt.processContent(highlight(fmt.renderRaw(), "html"));
  }
  return baseCore(ctx);
};

const headContentView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!isRightHeadCard(fmt.card)) {
    throw new UnsupportedViewError("head_content", fmt.card.name.s);
  }
  return fmt.processContent(fmt.renderRaw());
};

const rightHeadOneLineContentView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  if (!isRightHeadCard(fmt.card)) {
    throw new UnsupportedViewError("one_line_content", fmt.card.name.s);
  }
  const sizeOpt = voo.opts["size"];
  const length = typeof sizeOpt === "number" ? sizeOpt : ONE_LINE_CHARACTER_LIMIT;
  return viewWrapInherited(ctx, "one_line_content", truncateHtmlSafeText(stripTags(fmt.renderRaw()), length, "..."));
};

const headInputView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!isSelfHeadCard(fmt.card)) {
    throw new UnsupportedViewError("input", fmt.card.name.s);
  }
  return "Content can't be edited.";
};

const headBarBottomView: ViewFn = (ctx) =>
  isSelfHeadCard(ctx.fmt.card) ? "" : baseBarBottom(ctx);

const headCoreView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (!isSelfHeadCard(fmt.card)) return baseCore(ctx);
  const head = fmt.renderView("head");
  return fmt.isMain ? h(str(head)) : head;
};

function accountLinkHref(targetName: string, action?: string): string {
  const mark = DeckoName.parse(targetName).urlKey;
  return action === undefined ? `/${h(mark)}` : `/${h(action)}/${h(mark)}`;
}

function knownOrWantedClass(fmt: RenderFormat, name: string): string {
  return fmt.engine.fetchRenderCard(name) === undefined ? "wanted-card" : "known-card";
}

function accountLinkGate(ctx: ViewContext, requires: "signed_in" | "not_signed_in"): string | undefined {
  const signedIn = ctx.fmt.engine.viewer?.signedIn === true;
  if (requires === "signed_in" && !signedIn) return "";
  if (requires === "not_signed_in" && signedIn) return "";
  return undefined;
}

function accountLinkView(
  targetUrlKey: string,
  knownName: string,
  linkClass: string,
  text: string,
  action?: string,
  requires?: "signed_in" | "not_signed_in",
): ViewFn {
  return (ctx) => {
    if (requires !== undefined) {
      const denial = accountLinkGate(ctx, requires);
      if (denial !== undefined) return denial;
    }
    const cls = `nav-link ${linkClass} ${knownOrWantedClass(ctx.fmt, knownName)}`;
    return `<a class="${h(cls)}" href="${h(accountLinkHref(targetUrlKey, action))}">${h(text)}</a>`;
  };
}

const signInView = accountLinkView("*signin", "*signin", "signin-link", "Sign in", undefined, "not_signed_in");
const signUpView = accountLinkView("Sign_up", "Sign up", "signup-link", "Sign up", "new", "not_signed_in");
const signOutView = accountLinkView("*signin", "*signin", "signout-link", "Sign out", "delete", "signed_in");
const inviteView = accountLinkView("Sign_up", "Sign up", "invite-link", "Invite", "new", "signed_in");

const myCardView: ViewFn = (ctx) => {
  const prepared = ctx.fmt.engine.pageSessionMyCardHtml ?? "";
  ctx.fmt.engine.markSessionRolesContentFilled?.();
  return fillUniqueIds(prepared, ctx.fmt);
};

const enabledRolesEditInlineView: ViewFn = (ctx) => {
  const prepared = ctx.fmt.engine.pageSessionRolesDropdownHtml;
  if (prepared !== undefined) ctx.fmt.engine.markSessionRolesContentFilled?.();
  const sessionHtml =
    prepared ??
    myCardDropdownInnerHtml(
      "Anonymous",
      { actor: true, accountSettings: false, signin: true },
      [],
    );
  return `<div class="pointer-checkbox-list">${fillUniqueIds(sessionHtml, ctx.fmt)}</div>`;
};

export const alertsContentFn: ContentFn = (_fmt) =>
  "<!-- *alerts is deprecated. please remove from layout -->";

export const footContentFn: ContentFn = (_fmt) =>
  "<!-- *foot is deprecated. please remove from layout -->";

const cardModLayout: DeckoModManifest = {
  name: "layout",
  gemName: "card-mod-layout",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/modal",
      formats: {
        html: {
          views: [
            { view: "modal", viewFn: modalView, config: { wrap: "modal" } },
            { view: "modal_menu", viewFn: modalMenuView, config: { unknown: true, wrap: "modal_menu" } },
            { view: "modal_title", viewFn: modalTitleView, config: { unknown: true } },
            { view: "modal_footer", viewFn: modalFooterView, config: { unknown: true } },
            { view: "modal_link", viewFn: modalLinkView },
            { view: "close_modal_link", viewFn: closeModalLinkView, config: { unknown: true } },
            { view: "pop_out_modal_link", viewFn: popOutModalLinkView, config: { unknown: "blank" } },
          ],
        },
      },
    },
    {
      setPath: "all/navbar_links",
      formats: {
        html: {
          views: [
            { view: "navbar_links", viewFn: navbarLinksView, config: { perms: "none" } },
            { view: "nav_item", viewFn: navItemView },
            { view: "nav_link_in_dropdown", viewFn: navLinkInDropdownView },
          ],
        },
      },
    },
    {
      setPath: "abstract/items",
      formats: {
        html: {
          views: [{ view: "nav_item", viewFn: abstractItemsNavItemView }],
        },
      },
    },
    {
      setPath: "self/dropdown_divider",
      formats: {
        html: {
          views: [
            { view: "nav_item", viewFn: dropdownDividerView },
            { view: "nav_link_in_dropdown", viewFn: dropdownDividerView },
          ],
        },
      },
    },
    {
      setPath: "all/overlay",
      formats: {
        html: {
          views: [
            { view: "overlay_header", viewFn: overlayHeaderView, config: { unknown: true } },
            { view: "overlay_title", viewFn: overlayTitleView },
            { view: "overlay_menu", viewFn: overlayMenuView },
            {
              view: "overlay_help_link",
              viewFn: overlayHelpLinkView,
              config: { cache: "never", unknown: true },
            },
          ],
        },
      },
    },
    {
      setPath: "right/head",
      formats: {
        html: {
          views: [
            { view: "head_content", viewFn: headContentView, config: { cache: "yes" } },
            { view: "one_line_content", viewFn: rightHeadOneLineContentView },
            { view: "core", viewFn: layoutCoreView },
          ],
        },
      },
    },
    {
      setPath: "self/account_links",
      formats: {
        html: {
          views: [
            { view: "sign_up", viewFn: signUpView, config: { cache: "never" } },
            { view: "sign_in", viewFn: signInView, config: { cache: "never" } },
            { view: "sign_out", viewFn: signOutView, config: { cache: "never" } },
            { view: "invite", viewFn: inviteView, config: { cache: "never" } },
            {
              view: "my_card",
              viewFn: myCardView,
              config: { cache: "never", denial: "blank" },
            },
          ],
        },
      },
    },
    {
      setPath: "right/enabled_roles",
      assignsType: "session",
      events: [
        event({ event: "validate_role_enabling", at: "validate", on: ["save"], fn: validateRoleEnabling }),
        event({ event: "clear_roles_cache", before: "store_in_session" }),
      ],
      formats: {
        html: {
          views: [
            {
              view: "edit_inline",
              viewFn: enabledRolesEditInlineView,
              config: { cache: "never", unknown: true },
            },
          ],
        },
      },
    },
    {
      setPath: "right/layout",
      assignsType: "pointer",
    },
    {
      setPath: "self/alerts",
      contentOverrides: [alertsContentFn],
      formats: { html: { views: [] } },
    },
    {
      setPath: "self/foot",
      contentOverrides: [footContentFn],
      formats: { html: { views: [] } },
    },
    {
      setPath: "self/head",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: headCoreView, config: { cache: "never" } },
            { view: "input", viewFn: headInputView },
            { view: "bar_bottom", viewFn: headBarBottomView },
          ],
        },
      },
      settingOpts: {
        group: "webpage",
        position: 1,
        ruleTypeEditable: false,
        shortHelpText: "head tag content",
        helpText: "head tag content",
      },
    },
    {
      setPath: "self/layout",
      settingOpts: {
        group: "webpage",
        position: 3,
        ruleTypeEditable: false,
        helpText: "HTML structure of card's page [[http://decko.org/layouts | more]]",
      },
    },
    {
      setPath: "type/html",
      formats: {
        html: {
          views: [{ view: "navbar_links", viewFn: htmlNavbarLinksView, config: { perms: "none" } }],
        },
      },
    },
    {
      setPath: "type/layout_type",
      events: [
        event({ event: "update_layout_registry", at: "finalize", on: ["update"] }),
      ],
    },
  ],
  prepareEngine: prepareGuideRules,
};

export default cardModLayout;
