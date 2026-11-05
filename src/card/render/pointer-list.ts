import type { PhantomItemType, RenderCard } from "./format.js";
import { serializerFollowsLive } from "./deployment-follow-live-config.js";
import { DeckoName } from "../name.js";
import { isNewCard, type CardRecord } from "../fetch/card-record.js";
import { newSlotId, emitAttrs, emitHamlAttrs, h } from "./slot-html.js";
import { hamlSlotInHash } from "./haml-slot-style.js";

const POINTER_LIST_ITEM_VIEW = "bar";
const POINTER_LIST_ITEM_SLOT_VIEW = "mini_bar";

export function isPointerOrListCard(card: RenderCard): boolean {
  const code = (card as { typeCode?: string }).typeCode;
  return code === "pointer" || code === "list" || code === "skin";
}

export function rawItemStrings(content: string): string[] {
  return content
    .toString()
    .split(/\n+/)
    .map((i) => stripItem(i));
}

function stripItem(item: string): string {
  return item.replace(/\[\[|\]\]/g, "").trim();
}

export function resolvePointerItemName(item: string, hostName: DeckoName): string {
  try {
    const parsed = DeckoName.parse(item);
    const parts = parsed.parts;
    const blankExtreme = parts.length > 1 && (parts[0] === "" || parts[parts.length - 1] === "");
    if (parsed.isAbsolute && !blankExtreme) return item;
    return parsed.absoluteName(hostName).s;
  } catch {
    return item;
  }
}

const PERMISSION_RIGHT_NAMES: ReadonlySet<string> = new Set([
  "create",
  "read",
  "update",
  "delete",
]);

export function isPermissionRightSetting(rightSetting: string | undefined): boolean {
  return rightSetting !== undefined && rightSetting.startsWith("*") &&
    PERMISSION_RIGHT_NAMES.has(rightSetting.slice(1));
}

export function isRuleCardWithPermissionRight(card: RenderCard): boolean {
  const right = card.name?.rightName?.key;
  if (right === undefined) return false;
  if (!right.startsWith("*")) return false;
  const bare = right.slice(1);
  return PERMISSION_RIGHT_NAMES.has(bare);
}

const INPUT_TYPE_RIGHT_KEY = "*input_type";

export function isInputTypeRuleCard(card: RenderCard): boolean {
  return card.name?.rightName?.key === INPUT_TYPE_RIGHT_KEY;
}

export function pointerListCoreHtml(
  parent: RenderCard,
  items: string[],
  renderItem: (name: string) => string,
  itemView: string = POINTER_LIST_ITEM_VIEW,
  countOverride?: number,
  separator = "\n",
): string {
  const filtered = items.filter((s) => s.length > 0);
  const count = countOverride ?? filtered.length;
  const paged =
    parent.name !== undefined && count > POINTER_PAGING_LIMIT;
  const listed = paged ? filtered.slice(0, POINTER_PAGING_LIMIT) : filtered;
  const inner = listed
    .map((name) => itemWrap(name, renderItem(name), itemView))
    .join(separator);
  const ruleShape = isRuleCardWithPermissionRight(parent);
  const wrapper = ruleShape
    ? `<div class="pointer-list">${inner}</div>`
    : `<div class="card-list card-list-${itemView} pointer-list">${inner}</div>`;
  if (!paged) {
    return ruleShape ? wrapper : `${wrapper}\n`;
  }
  return `${wrapper}\n${pointerPagingNav(parent, count)}\n`;
}

const POINTER_PAGING_LIMIT = 20;
const POINTER_PAGING_WINDOW = 5;
const POINTER_PAGING_MAX_PAGES = 100;

function pointerPagingNav(parent: RenderCard, count: number): string {
  const limit = POINTER_PAGING_LIMIT;
  const total = Math.floor((count - 1) / limit);
  const base = `/${parent.name.urlKey}`;
  const href = (page: number) => `${base}?limit=${limit}&amp;offset=${page * limit}`;
  const lis: string[] = [];
  lis.push(
    '<li class="page-item"><div class="page-link">' +
      '<span aria-hidden="true">&laquo;</span></div></li>',
  );
  const windowEnd = Math.min(POINTER_PAGING_WINDOW, total);
  for (let page = 0; page <= windowEnd; page++) {
    lis.push(
      `<li class="page-item${page === 0 ? " active" : ""}">` +
        `<a class="card-paging-link slotter page-link" href="${href(page)}"` +
        ` data-remote="true">${page + 1}</a></li>`,
    );
  }
  if (total > windowEnd + 1) {
    lis.push(
      '<li class="page-item disabled"><div class="page-link"><span>...</span></div></li>',
    );
  }
  if (total <= POINTER_PAGING_MAX_PAGES && total > windowEnd) {
    lis.push(
      `<li class="page-item"><a class="card-paging-link slotter page-link"` +
        ` href="${href(total)}" data-remote="true">${total + 1}</a></li>`,
    );
  }
  lis.push(
    `<li class="page-item"><a aria-label="Next"` +
      ` class="card-paging-link slotter page-link" href="${href(1)}"` +
      ` data-remote="true"><span aria-hidden="true">&raquo;</span></a></li>`,
  );
  const lastItem = Math.min(count, limit);
  return (
    `<nav class='nav justify-content-between align-items-center'>\n` +
    `<ul class='pagination paging'>\n${lis.join("")}\n</ul>\n` +
    `<div class='paging-context'>\n1\n-\n${lastItem}\nof\n${count}\n</div>\n</nav>`
  );
}

function itemWrap(name: string, inner: string, itemView: string = POINTER_LIST_ITEM_VIEW): string {
  return `<div class="pointer-item item-${itemView}">${inner}</div>`;
}

export type { PhantomItemType } from "./format.js";

export function pointerListItemSlot(
  item: RenderCard,
  inner: string,
  slotTypeName?: string,
): string {
  const name = item.name;
  const setKeys = item.setKeys;
  const safeKey = name.safeKey;
  const classes = ["card-slot", `${POINTER_LIST_ITEM_SLOT_VIEW}-view`, setKeys]
    .filter((s) => s !== "")
    .join(" ");
  const dataSlotJson = itemDataSlotJson(name.s, slotTypeName);
  const unsaved = item.record === undefined || isNewCard(item.record);
  const cardname = unsaved && name.isCompound ? name.urlKey : name.s;
  const attrs = emitAttrs({
    id: `${safeKey}-${POINTER_LIST_ITEM_SLOT_VIEW}-view`,
    class: classes,
    "data-card-name": cardname,
    "data-card-type-id": item.typeId === undefined ? undefined : String(item.typeId),
    "data-card-type-name": item.typeName,
    "data-card-link-name": name.urlKey,
    "data-slot-id": newSlotId(),
    "data-slot": dataSlotJson,
  });
  return `<div${attrs}>${inner}</div>`;
}

function phantomSetKeys(phantomType: PhantomItemType | undefined): string {
  return phantomType === undefined ? "ALL" : `ALL TYPE-${phantomType.typeKey}`;
}

export function pointerListItemBodyForUnknown(
  name: string,
  identity?: { setKeys?: string; typeName?: string; typeId?: number },
  deckPhantomType?: PhantomItemType,
): string {
  const setKeys = identity?.setKeys ?? phantomSetKeys(deckPhantomType);
  const typeName = identity?.typeName ?? deckPhantomType?.typeName;
  const typeId = identity?.typeId ?? deckPhantomType?.typeId;
  const safeLinkName = DeckoName.parse(name).urlKey;
  const slotId = newSlotId();
  const hamlInHash = hamlSlotInHash();
  const dataAttrs = emitHamlAttrs({
    "data-card-link-name": safeLinkName,
    "data-card-name": h(name),
    "data-card-type-id": typeId,
    "data-card-type-name": typeName,
    ...(hamlInHash ? { "data-slot-id": slotId } : {}),
  });
  return (
    `<div class='${serializerFollowsLive() ? `nodblclick d-flex _card-link bar ${h(setKeys)} with-bar-menu` : `bar ${h(setKeys)} with-bar-menu nodblclick d-flex _card-link`}'${dataAttrs}${hamlInHash ? "" : ` data-slot-id="${slotId}"`}>\n` +
    `<span class="denied"><!-- Sorry, you don't have permission (read) --></span>\n` +
    `<span class="denied"><!-- Sorry, you don't have permission (read) --></span>\n` +
    `</div>\n`
  );
}

function itemDataSlotJson(nestName: string, typeName?: string): string {
  const ordered: Record<string, unknown> = {
    view: POINTER_LIST_ITEM_VIEW,
    nest_name: nestName,
    show: [POINTER_LIST_ITEM_VIEW],
    hide: ["bar_middle"],
    home_view: POINTER_LIST_ITEM_VIEW,
  };
  if (typeName !== undefined) ordered["type"] = typeName;
  return jsonEscapeAttr(JSON.stringify(ordered));
}

function jsonEscapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;");
}

export function phantomPointerListItem(
  name: string,
  typed?: { typeName: string; typeId: number },
  deckPhantomType?: PhantomItemType,
): RenderCard {
  const deckName = DeckoName.parse(name);
  const typeName = typed?.typeName ?? deckPhantomType?.typeName;
  const typeId = typed?.typeId ?? deckPhantomType?.typeId;
  const setKeys =
    typed !== undefined
      ? `ALL TYPE-${DeckoName.parse(typed.typeName).key}`
      : phantomSetKeys(deckPhantomType);
  const record: CardRecord = {
    id: undefined,
    codename: undefined,
    leftId: undefined,
    rightId: undefined,
    typeId,
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
    name: deckName,
    key: deckName.key,
    isNew: true,
    fromTrash: false,
    uncacheable: false,
  };
  return {
    record,
    name: deckName,
    key: deckName.key,
    typeName,
    typeId,
    id: undefined,
    dbContent: "",
    setKeys,
    unknown: true,
  } as RenderCard;
}