import { str } from "./format.js";

import { DeckoName } from "../name.js";
import { UnsupportedViewError, vooJoint, wrappedTitleInner } from "./format.js";
import type { RenderFormat, ViewContext, ViewFn } from "./format.js";
import { h, newSlotId } from "./slot-html.js";

function isListType(fmt: RenderFormat): boolean {
  return fmt.card.typeCode === "pointer" || fmt.card.typeCode === "list";
}

function isItemsType(fmt: RenderFormat): boolean {
  return isListType(fmt) || fmt.card.typeCode === "link_list";
}

function wrapNavItem(inner: string): string {
  return `<li class="nav-item">${inner}</li>`;
}

function linkTitleSpan(ctx: ViewContext): string {
  const label = ctx.voo.opts["title"];
  if (typeof label === "string") {
    return `<span class="card-title" title="${h(label)}">${wrappedTitleInner(h(label), vooJoint(ctx.voo))}</span>`;
  }
  return str(ctx.fmt.renderView("title"));
}

function linkToCardWithClass(
  fmt: RenderFormat,
  klass: string,
  titleSpan: string,
): string {
  const known = fmt.card.unknown !== true;
  const cls = known ? `${klass} known-card` : `${klass} wanted-card`;
  return `<a class="${cls}" href="/${h(fmt.urlKey())}">${titleSpan}</a>`;
}

const navbarLinksView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.key === "*account_link") {
    const prepared = ctx.fmt.engine.pageSessionAccountLinksHtml;
    if (prepared !== undefined) {
      ctx.fmt.engine.markSessionRolesContentFilled?.();
      return `<ul class="navbar-nav">${fillUniqueIds(prepared, fmt)}</ul>`;
    }
    const links = [
      `<a class="nav-link signup-link known-card" href="/new/Sign_up">Sign up</a>`,
      `<a class="nav-link signin-link known-card" href="/*signin">Sign in</a>`,
    ].map(wrapNavItem);
    return `<ul class="navbar-nav">${links.join("\n")}</ul>`;
  }
  if (isListType(fmt)) {
    const items = listItemsOf(fmt)
      .map((name) => nestItemName(ctx, name, "nav_item"))
      .filter((s): s is string => s !== undefined);
    return `<ul class="navbar-nav">${items.join("")}</ul>`;
  }
  return `<ul class="navbar-nav">${chunkNavbarItems(ctx, "nav_item", "nav-link")}</ul>`;
};

function chunkNavbarItems(ctx: ViewContext, view: string, linkClass: string): string {
  const content = ctx.fmt.card.dbContent;
  const out: string[] = [];
  let lastIndex = 0;
  for (const m of content.matchAll(/\[\[([^\][\n]+?)\]\]/g)) {
    out.push(content.slice(lastIndex, m.index));
    const spec = m[1] ?? "";
    const split = spec.indexOf("|");
    const target = (split === -1 ? spec : spec.slice(0, split)).trim();
    const label = split === -1 ? undefined : spec.slice(split + 1).trim();
    if (/^(\/|https?:|mailto:)/.test(target)) {
      const text = label ?? target;
      let link: string;
      if (/^https?:/.test(target)) {
        link = `<a class="${linkClass} external-link" target="_blank" href="${h(target)}">${text}</a>`;
      } else if (/^mailto:/.test(target)) {
        link = `<a class="${linkClass} email-link" href="${h(target)}">${text}</a>`;
      } else {
        link = `<a class="${linkClass} internal-link" href="${h(`/${target.replace(/^\/+/, "")}`)}">${text}</a>`;
      }
      out.push(view === "nav_item" ? wrapNavItem(link) : link);
    } else if (target !== "") {
      const link = nestResolvedName(ctx, target, view, label);
      if (link !== undefined) out.push(link);
    }
    lastIndex = (m.index ?? 0) + m[0].length;
  }
  out.push(content.slice(lastIndex));
  return out.join("");
}

const navItemView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.key === "*dropdown_divider") {
    return `<div class="dropdown-divider"></div>`;
  }
  if (isItemsType(fmt)) {
    return wrapNavItem(navDropdown(ctx));
  }
  return wrapNavItem(linkToCardWithClass(fmt, "nav-link", linkTitleSpan(ctx)));
};

const navLinkInDropdownView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  if (fmt.card.key === "*dropdown_divider") {
    return `<div class="dropdown-divider"></div>`;
  }
  return linkToCardWithClass(fmt, "dropdown-item", linkTitleSpan(ctx));
};

function navDropdown(ctx: ViewContext): string {
  const toggle =
    `<a href="#" class="nav-link dropdown-toggle" data-bs-toggle="dropdown">` +
    `${linkTitleSpan(ctx)}</a>`;
  const menu = `<div class="dropdown-menu">${dropdownMenuItems(ctx)}</div>`;
  return `<li class="nav-item dropdown">${toggle}\n${menu}</li>`;
}

function dropdownMenuItems(ctx: ViewContext): string {
  if (!isListType(ctx.fmt)) return chunkNavbarItems(ctx, "nav_link_in_dropdown", "dropdown-item");
  const items = listItemsOf(ctx.fmt)
    .map((name) => nestItemName(ctx, name, "nav_link_in_dropdown"))
    .filter((s): s is string => s !== undefined && s !== "");
  return items.join("\n");
}

function listItemsOf(fmt: RenderFormat): string[] {
  return fmt.card.dbContent
    .split(/\n+/)
    .map((s) => s.replace(/\[\[|\]\]/g, "").trim())
    .filter((s) => s !== "");
}

function nestItemName(ctx: ViewContext, name: string, view: string): string | undefined {
  return nestResolvedName(ctx, name, view, undefined);
}

function nestResolvedName(
  ctx: ViewContext,
  rawName: string,
  view: string,
  title: string | undefined,
): string | undefined {
  const fmt = ctx.fmt;
  let resolved: string;
  try {
    const parsed = DeckoName.parse(rawName);
    resolved = parsed.isAbsolute ? parsed.s : parsed.absoluteName(fmt.card.name).s;
  } catch {
    return undefined;
  }
  const nest = {
    name: resolved,
    syntax: resolved,
    options: { view, ...(title !== undefined ? { title } : {}), extra: {} },
    comment: undefined,
  };
  return fmt.nest(nest);
}

const searchBoxView: ViewFn = ({ fmt }) => {
  if (fmt.card.key !== "*search") {
    throw new UnsupportedViewError("search_box", fmt.card.name.s);
  }
  return (
    `<div class='d0-search-box'>\n` +
    `<form role="search" class="search-box-form" action="/*search" accept-charset="UTF-8" method="get">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="text" name="query[keyword]" id="query_keyword" class="_search-box search-box form-control w-100" autocomplete="off" data-completepath="/*search/search_box_complete.json" placeholder="Search" /></form>\n` +
    `</div>\n`
  );
};

export function navbarItemsOverridden(fmt: RenderFormat): boolean {
  return fmt.card.key === "*account_link" || isListType(fmt);
}
export const navbarLinksForMethodOverride: ViewFn = (ctx) => navbarLinksView(ctx);
export const abstractItemsNavItemView: ViewFn = (ctx) => wrapNavItem(navDropdown(ctx));
export const dropdownDividerView: ViewFn = () => `<div class="dropdown-divider"></div>`;

export const NAVBAR_VIEWS: Record<string, ViewFn> = {
  navbar_links: navbarLinksView,
  nav_item: navItemView,
  nav_link_in_dropdown: navLinkInDropdownView,
  search_box: searchBoxView,
};

export function accountLinksCoreHtml(ctx: ViewContext): string {
  const prepared = ctx.fmt.engine.pageSessionAccountLinksHtml;
  if (prepared !== undefined) {
    ctx.fmt.engine.markSessionRolesContentFilled?.();
    return `<div id="logging" class="logged-in">${fillUniqueIds(prepared, ctx.fmt)}</div>`;
  }
  const links = [
    `<li class="nav-item"><a class="nav-link signup-link known-card" href="/new/Sign_up">Sign up</a></li>`,
    `<li class="nav-item"><a class="nav-link signin-link known-card" href="/*signin">Sign in</a></li>`,
  ].join("\n");
  return `<div id="logging" class="logged-out">${links}</div>`;
}

export function signedInAccountLinksInnerHtml(
  actorName: string,
  known: { actor: boolean; accountSettings: boolean; signin: boolean },
  myCardHtml?: string,
): string {
  const knownClass = (isKnown: boolean): string => (isKnown ? "known-card" : "wanted-card");
  const myCardLi =
    `<li class="nav-item">` +
    (myCardHtml ?? myCardDropdownInnerHtml(actorName, known, [])) +
    `</li>`;
  const signOutLi =
    `<li class="nav-item"><a class="nav-link signout-link ${knownClass(known.signin)}" href="/delete/*signin">Sign out</a></li>`;
  return `${myCardLi}\n${signOutLi}`;
}

export function myCardDropdownInnerHtml(
  actorName: string,
  known: { actor: boolean; accountSettings: boolean; signin: boolean },
  roleItems: string[],
): string {
  const namePath = actorName.replace(/ /g, "_");
  const knownClass = (isKnown: boolean): string => (isKnown ? "known-card" : "wanted-card");
  const items = [
    `<li><a class="dropdown-item ${knownClass(known.accountSettings)}" href="/${namePath}+*account_settings">Account</a></li>`,
    `<li><a class="dropdown-item ${knownClass(known.signin)}" href="/delete/*signin">Sign out</a></li>`,
    ...roleItems.map((item) => `<li>${item}</li>`),
  ];
  return (
    `<div class="btn-group">` +
    `<a id="my-card-link" class="nav-link my-card ${knownClass(known.actor)}" href="/${namePath}">${h(actorName)}</a>\n` +
    `<a href="#" class="dropdown-toggle dropdown-toggle-split nav-link" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><span class="visually-hidden">Toggle Dropdown</span></a>\n` +
    `<ul class="dropdown-menu dropdown-menu-right" role="menu">` +
    items.join("\n") +
    `</ul></div>`
  );
}

export interface SessionRolesInput {
  readonly actorName: string;
  readonly actorTypeKey: string;
  readonly sessionTypeId: number;
  readonly sessionTypeName: string;
  readonly roles: readonly string[];
  readonly enabledRoles?: readonly string[];
}

export const UNIQUE_ID_TOKEN = "\u0000unique-id\u0000";

export function fillUniqueIds(html: string, fmt: RenderFormat): string {
  if (!html.includes(UNIQUE_ID_TOKEN)) return html;
  const parts = html.split(UNIQUE_ID_TOKEN);
  let out = parts[0] ?? "";
  for (let i = 1; i < parts.length; i++) {
    const id = fmt.uniqueId();
    out += id.slice(id.lastIndexOf("-") + 1) + parts[i];
  }
  return out;
}

export function rolesAccountDropdownHtml(
  input: SessionRolesInput,
  known: { actor: boolean; accountSettings: boolean; signin: boolean },
): string {
  const safeKey = DeckoName.parse(`${input.actorName}+*enabled roles`).safeKey;
  const roleItems = [
    `<h6 class="dropdown-header">Roles</h6>`,
    ...input.roles.map((role) => {
      const roleName = DeckoName.parse(role);
      return (
        `<div class='pointer-checkbox dropdown-item'>\n` +
        `<input type="checkbox" name="pointer_checkbox-${safeKey}-${UNIQUE_ID_TOKEN}" id="pointer-checkbox-${h(roleName.key)}" ` +
        `value="${h(role)}" class="pointer-checkbox-button _submit-on-change me-2"${(input.enabledRoles ?? input.roles).includes(role) ? ' checked="checked"' : ''} />\n` +
        `<a class="known-card" href="/${h(roleName.urlKey)}">${h(role)}</a>\n` +
        `</div>\n`
      );
    }),
  ];
  return myCardDropdownInnerHtml(input.actorName, known, roleItems);
}

export function enabledRolesDropdownHtml(
  input: SessionRolesInput,
  known: { actor: boolean; accountSettings: boolean; signin: boolean },
  contentFilled = true,
): string {
  const name = DeckoName.parse(`${input.actorName}+*enabled roles`);
  const urlKey = name.urlKey;
  const safeKey = name.safeKey;
  const dropdown = rolesAccountDropdownHtml(input, known);
  const slot = JSON.stringify({
    view: "edit_inline",
    nest_name: name.s,
    show: ["edit_inline"],
    hide: ["edit_inline_buttons", "name_formgroup", "type_formgroup"],
    home_view: "edit_inline",
  });
  const rightKey = "Xenabled_role";
  return (
    `<div id="${safeKey}-edit_inline-view" class="card-slot edit_inline-view ALL ALL_PLUS TYPE-${DeckoName.parse(input.sessionTypeName).key} RSTAR RIGHT-${rightKey} TYPE_PLUS_RIGHT-${input.actorTypeKey}-${rightKey}" ` +
    `data-card-name="${h(urlKey)}" data-card-type-id="${input.sessionTypeId}" data-card-type-name="${h(input.sessionTypeName)}" ` +
    `data-card-link-name="${h(urlKey)}" data-slot-id="${newSlotId()}" data-slot="${h(slot)}">` +
    `<form class="card-form slotter autosave" id="new_card" action="/update/${h(urlKey)}" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="success[reload]" id="success_reload" value="true" autocomplete="off" /> ` +
    `<input type="hidden" name="card[type_id]" id="card_type_id" value="${input.sessionTypeId}" autocomplete="off" />` +
    `<fieldset class="card-editor editor"><div class="editor content-editor">` +
    `<input class="d0-card-content form-control" autocomplete="off" type="hidden"${contentFilled || input.enabledRoles !== undefined ? ` value="${h((input.enabledRoles ?? input.roles).join("\n"))}"` : ""} name="card[content]" id="card_content" />` +
    `<div class="pointer-checkbox-list">${dropdown}</div>` +
    `</div></fieldset></form></div>`
  );
}
