import { str, type ViewResult } from "../render/format.js";

import type { RenderCard, RenderEngineLike } from "./format.js";
import { DeckoName } from "../name.js";
import { selfSetInheritText, whoCanItemCount } from "../permissions/who-can.js";
import { CodenameNotFoundError, NameNotFoundError, UnsupportedIdentifierError } from "../name/errors.js";
import { h } from "./slot-html.js";
import { stripHtmlTags as stripTags } from "./html-text.js";
import { truncateHtmlSafeText } from "./text-helpers.js";
import { isPermissionRightSetting, isPointerOrListCard, rawItemStrings } from "./pointer-list.js";
import { ONE_LINE_CHARACTER_LIMIT, truncate } from "./text-helpers.js";
import { listItemContentOverride } from "./content-overrides.js";

function typeText(card: RenderCard): string {
  return h(card.typeName ?? "");
}

function typeLink(card: RenderCard): string {
  const typeName = card.typeName ?? "";
  if (typeName === "") return "";
  return `<a class="cardtype known-card" href="/${h(DeckoName.parse(typeName).urlKey)}">${h(typeName)}</a>`;
}

function pointerListOneLineContent(
  card: RenderCard,
  engine?: RenderEngineLike,
): string {
  const items = rawItemStrings(card.dbContent).filter((s) => s.length > 0);
  const inner = items.map((name) => pointerListOneLineItem(name, engine)).join("\n");
  return `<div class="pointer-list">${inner}</div>`;
}

function pointerListOneLineItem(name: string, engine?: RenderEngineLike): string {
  const resolved = engine?.fetchRenderCard?.(name);
  const known = resolved !== undefined;
  const display = known ? resolved.name : DeckoName.parse(name);
  const titleAttr = h(display.s);
  const inner = titleAttr.split("+").join("<span>+</span>");
  const cls = known ? "known-card" : "wanted-card";
  return (
    `<div class="pointer-item item-link">` +
    `<a class="${cls}" href="/${h(display.urlKey)}">` +
    `<span class="card-title" title="${titleAttr}">${inner}</span>` +
    `</a>` +
    `</div>`
  );
}

function ruleOneLineContent(
  card: RenderCard,
  rightSetting: string | undefined,
  engine?: RenderEngineLike,
  renderCoreText?: (card: RenderCard) => ViewResult,
  setContext?: DeckoName,
): string {
  if (rightSetting === "*default") {
    const raw = card.dbContent;
    return `${typeText(card)} : ${raw === "" ? "<em>empty</em>" : raw}`;
  }
  if (rightSetting === "*structure") {
    return `${typeLink(card)} : ${card.dbContent}`;
  }
  if (rightSetting === "*head") {
    const stripped = stripTags(card.dbContent);
    const truncated = truncate(stripped, ONE_LINE_CHARACTER_LIMIT);
    return truncated === stripped ? truncated : h(truncated);
  }
  if (rightSetting === "*following") {
    return "";
  }
  if (isPermissionRightSetting(rightSetting)) {
    if (card.dbContent === "_left") {
      return permissionInheritContentHtml(setContext, engine, permissionRuleTask(card));
    }
    return pointerListOneLineContent(card, engine);
  }
  if (card.typeCode === "toggle") {
    const normalized = (card.dbContent ?? "").trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "" || normalized === "no") {
      return "no";
    }
    return "yes";
  }
  if (isPointerOrListCard(card)) {
    const items = rawItemStrings(listItemContentOverride(card) ?? card.dbContent).filter(
      (s) => s.length > 0,
    );
    if (items.length !== 1) {
      return `${items.length} items`;
    }
    let firstName: string;
    try {
      firstName = DeckoName.parse(card.dbContent ?? "")
        .absoluteName(card.name)
        .s;
    } catch (err) {
      if (
        err instanceof CodenameNotFoundError ||
        err instanceof NameNotFoundError ||
        err instanceof UnsupportedIdentifierError
      ) {
        firstName = card.dbContent ?? "";
      } else {
        throw err;
      }
    }
    return truncate(firstName, ONE_LINE_CHARACTER_LIMIT);
  }
  if (card.typeName === "Markdown") {
    const coreText = renderCoreText !== undefined ? renderCoreText(card) : card.dbContent;
    return oneLineFromStripped(stripTags(str(coreText)));
  }
  if (card.typeName === "Search") {
    return oneLineFromStripped(stripTags(card.dbContent ?? ""));
  }
  return oneLineFromStripped(stripTags(referencesOnlyCoreText(card.dbContent ?? "")));
}

function oneLineFromStripped(stripped: string): string {
  return truncateHtmlSafeText(stripped, ONE_LINE_CHARACTER_LIMIT);
}

function linkTargetAndLabel(rawSyntax: string): { target: string; label?: string } {
  let divider = -1;
  if (rawSyntax.includes("|")) {
    let masked = rawSyntax;
    for (const incl of rawSyntax.match(/\{\{[^}]*\}\}/g) ?? []) {
      masked = masked.split(incl).join("x".repeat(incl.length));
    }
    divider = masked.indexOf("|");
  }
  const target = (divider === -1 ? rawSyntax : rawSyntax.slice(0, divider)).trim();
  const label = divider === -1 ? undefined : rawSyntax.slice(divider + 1).trim() || undefined;
  return { target, label };
}

function referencesOnlyCoreText(raw: string): string {
  return raw.replace(/\[\[([^\]]+)\]\]/g, (_match, syntax: string) => {
    const { target, label } = linkTargetAndLabel(syntax);
    if (target === "") return "";
    if (label !== undefined) return label;
    if (/^(\/|https?:|mailto:)/.test(target)) return target;
    return DeckoName.parse(target).fullyStripped?.s ?? target;
  });
}

export function permissionInheritContentHtml(
  setContext: DeckoName | undefined,
  engine?: RenderEngineLike,
  task?: string,
): string {
  if (setContext === undefined) {
    return `<span class="inherit-perm">Inherit from left card</span>`;
  }
  const tagKey = setContext.tagName?.key;
  if (tagKey !== "*self" && tagKey !== "self") {
    return `<span class="inherit-perm">Inherit from left card</span>`;
  }
  const ancestorName = setContext.trunkName?.trunkName;
  const outcome =
    ancestorName === undefined || task === undefined
      ? { kind: "absent" as const }
      : whoCanItemCount(engine, ancestorName, task);
  return `<span class="inherit-perm">${selfSetInheritText(outcome)}</span>`;
}

export function permissionRuleTask(card: RenderCard): string | undefined {
  const tag = card.name.isCompound ? card.name.tagName.s : undefined;
  if (tag === undefined || !tag.startsWith("*") || tag.length < 2) return undefined;
  return tag.slice(1).replace(/\s+/g, "_");
}

export function ruleBarRightHtml(
  card: RenderCard,
  engine?: RenderEngineLike,
  renderCoreText?: (card: RenderCard) => ViewResult,
): string {
  const setKeyTokens = card.setKeys.split(" ");
  if (!setKeyTokens.includes("RULE")) return "";
  let oneLineCard = card;
  if (card.id === undefined && engine?.hasExistingRuleFor?.(card.key) === false) {
    return "";
  }
  const existing = card.id === undefined ? engine?.existingRuleFor?.(card.key) : undefined;
  if (existing !== undefined) oneLineCard = existing;
  const rightSetting = oneLineCard.name.rightName?.s;
  const setContext = card.name.trunkName;
  const inner = ruleOneLineContent(
    oneLineCard,
    rightSetting,
    engine,
    renderCoreText,
    setContext,
  );
  if (engine?.isDenied(oneLineCard) === true) {
    return `<span class="denied"><!-- Sorry, you don't have permission (read) --></span>`;
  }
  return `<div class="text-muted one-line">${inner}</div>`;
}
