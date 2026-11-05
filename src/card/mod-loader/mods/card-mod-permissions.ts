import { viewWrapInherited } from "../mod-view-helpers.js";
import { str, UnsupportedViewError, type RenderCard, type ViewContext, type ViewFn, type PermissionEditorOptions } from "../../render/format.js";
import { DeckoName } from "../../name.js";
import { PATTERN_TABLE } from "../../set-patterns/registry.js";
import { permissionInheritContentHtml, permissionRuleTask } from "../../render/rule-bar-right.js";
import { rawItemStrings } from "../../render/pointer-list.js";
import { h } from "../../render/slot-html.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
} from "../mod-manifest.js";
import type { ModEventContext } from "../mod-event-dispatch.js";
import {
  isStandardRuleName,
  isPreferenceName,
} from "../../actions/rule-content-walk.js";

const PERMISSION_TAG_KEYS = new Set(["*create", "*read", "*update", "*delete"]);

export function isPermissionRuleCard(card: ViewContext["fmt"]["card"]): boolean {
  return card.name.isCompound && PERMISSION_TAG_KEYS.has(card.name.tagName.key);
}

function assertPermissionRule(ctx: ViewContext, view: string): void {
  if (!isPermissionRuleCard(ctx.fmt.card)) {
    throw new UnsupportedViewError(view, ctx.fmt.card.name.s);
  }
}

function inheritable(ctx: ViewContext): boolean {
  const setCard = ctx.fmt.engine.fetchRenderCard(ctx.fmt.card.name.trunkName.s);
  if (setCard === undefined || setCard.typeCode !== "set") return false;
  return setInheritable(setCard.name);
}

function setInheritable(setName: DeckoName): boolean {
  const code = setName.tagName.s.replace(/^\*/, "").replace(/\s+/g, "_");
  const spec = PATTERN_TABLE.find((candidate) => candidate.code === code);
  const compoundOnly = spec?.compoundOnly ?? false;
  const selfSet = code === "self";
  return compoundOnly || (setName.trunkName.isCompound && selfSet);
}

function inheriting(ctx: ViewContext): boolean {
  return inheritable(ctx) && ctx.fmt.card.dbContent === "_left";
}

function coreInheritContent(ctx: ViewContext): string {
  const setContextOpt = ctx.voo.opts["set_context"];
  const setContext = typeof setContextOpt === "string" ? DeckoName.parse(setContextOpt) : undefined;
  return permissionInheritContentHtml(setContext, ctx.fmt.engine, permissionRuleTask(ctx.fmt.card));
}

function checkBoxTag(
  name: string,
  value: string,
  checked: boolean,
  extraClass: string | undefined,
): string {
  const id = name;
  const classAttr = extraClass === undefined ? "" : ` class="${extraClass}"`;
  const checkedAttr = checked ? ` checked="checked"` : "";
  return (
    `<input type="checkbox" name="${h(name)}" id="${h(id)}" value="${h(value)}"${classAttr}${checkedAttr} />`
  );
}

function iconTag(materialName: string, extraClass?: string): string {
  const cls = extraClass === undefined
    ? "notranslate material-icons"
    : `${extraClass} notranslate material-icons`;
  return `<i class="${cls}">${materialName}</i>`;
}

function pointerCoreBody(ctx: ViewContext): string {
  const items = rawItemStrings(ctx.fmt.card.dbContent).filter((s) => s.length > 0);
  const itemsOpt = ctx.voo.items;
  const itemView =
    typeof itemsOpt === "object" && itemsOpt !== null && "view" in itemsOpt
      ? String((itemsOpt as { view: unknown }).view)
      : "bar";
  const rendered = items
    .map((name) =>
      `<div class="pointer-item item-${itemView}">${ctx.fmt.nest({ name, syntax: "", options: { view: itemView, extra: {} }, comment: undefined })}</div>`)
    .join("\n");
  return `<div class="pointer-list">${rendered}</div>`;
}

const pointerCoreView: ViewFn = (ctx) => {
  assertPermissionRule(ctx, "pointer_core");
  return pointerCoreBody(ctx);
};

const oneLineContentView: ViewFn = (ctx) => {
  assertPermissionRule(ctx, "one_line_content");
  return viewWrapInherited(ctx, "one_line_content", str(ctx.fmt.renderView("core", { items: { view: "link" } })));
};

export const permissionCoreView: ViewFn = (ctx) => {
  assertPermissionRule(ctx, "core");
  if (ctx.fmt.card.dbContent === "_left") {
    return coreInheritContent(ctx);
  }
  return ctx.fmt.renderView("pointer_core", { items: ctx.voo.opts["items"] });
};

interface RoleOption {
  name: string;
  key: string;
}
const roleRegistry: RoleOption[] = [];
let cardsWithAccountUrlKey: string | undefined;

export function resetPermissionRolesForTests(): void {
  roleRegistry.length = 0;
  cardsWithAccountUrlKey = undefined;
}

function groupRowsAndRemainingItems(
  itemNames: string[],
  roles: readonly RoleOption[],
): { rows: string; remainingItems: string[] } {
  const remaining = [...itemNames];
  const rows = roles.map((option) => {
    const checked = remaining.indexOf(option.name);
    if (checked !== -1) remaining.splice(checked, 1);
    const icon = iconTag("close_fullscreen", "text-muted");
    const optionLink =
      `<a target="decko_role" class="known-card" href="/${h(DeckoName.parse(option.name).urlKey)}">${icon}</a>`;
    const box = checkBoxTag(
      `${option.key}-perm-checkbox`,
      option.name,
      checked !== -1,
      "perm-checkbox-button",
    );
    return (
      `        <div class="form-check checkbox">\n` +
      `          <label class="form-check-label">\n` +
      `            ${box} ${h(option.name)} ${optionLink}\n` +
      `          </label>\n` +
      `        </div>\n`
    );
  });
  return { rows: rows.join("\n"), remainingItems: remaining };
}

function listInput(itemNames: string[], optionsCardUrlKey: string | undefined): string {
  const items = itemNames.length === 0 ? [""] : itemNames;
  const rows = items
    .map(
      (item) =>
        `<li class='pointer-li mb-1'>\n` +
        `<span class='input-group'>\n` +
        `<span class='input-group-text handle'>\n${iconTag("reorder")}\n</span>\n` +
        `<input type="text" name="pointer_item" id="pointer_item" value="${h(item)}" class="pointer-item-text form-control"` +
        (optionsCardUrlKey === undefined ? "" : ` data-options-card="${h(optionsCardUrlKey)}"`) +
        ` placeholder="" />\n` +
        `<button class='pointer-item-delete btn btn-secondary' type='button'>\n${iconTag("close")}\n</button>\n` +
        `</span>\n` +
        `</li>`,
    )
    .join("\n");
  return (
    `<ul class='pointer-list-editor pointer-list-ul'>\n${rows}\n</ul>\n` +
    `<span class='input-group'>\n` +
    `<button class='_pointer-item-add btn btn-secondary' type='submit'>\n` +
    `${iconTag("add")}\n` +
    `add another\n` +
    `</button>\n` +
    `</span>\n`
  );
}

function inheritanceCheckbox(ctx: ViewContext): string {
  if (!inheritable(ctx)) return "";
  const box = checkBoxTag("inherit", "inherit", inheriting(ctx), undefined);
  const title = `use left's ${ctx.fmt.card.name.tagName.s} rule`;
  return (
    `<div class="perm-inheritance perm-section">` +
    box +
    `<label>${coreInheritContent(ctx)}` +
    `<a title="${h(title)}">?</a>` +
    `</label></div>`
  );
}

const inputView: ViewFn = (ctx) => {
  assertPermissionRule(ctx, "input");
  const itemNames = inheriting(ctx) ? [] : rawItemStrings(ctx.fmt.card.dbContent);
  const hiddenField =
    `<input class="d0-card-content form-control" autocomplete="off" type="hidden" value="${h(ctx.fmt.card.dbContent)}" name="card[content]" id="card_content" />`;
  const options = ctx.fmt.engine.permissionEditorOptions?.() ?? {
    roles: roleRegistry, cardsWithAccountUrlKey,
  };
  const { rows, remainingItems } = groupRowsAndRemainingItems(itemNames, options.roles);
  return (
    `\n      ${hiddenField}\n` +
    `      <div class="perm-editor">\n` +
    `        ${inheritanceCheckbox(ctx)}\n` +
    `        <div class="perm-group perm-vals perm-section">\n` +
    `          <h5 class="text-muted">Groups</h5>\n` +
    `          ${rows}` +
    `\n        </div>\n` +
    `\n        <div class="perm-indiv perm-vals perm-section">\n` +
    `          <h5 class="text-muted">Individuals</h5>\n` +
    `          ${listInput(remainingItems, options.cardsWithAccountUrlKey)}` +
    `\n        </div>\n` +
    `      </div>\n` +
    `    `
  );
};

function rolesStatement(roleTypeId: number): { sql: string; params: unknown[] } {
  return {
    sql: "SELECT id FROM cards WHERE type_id = ? AND trash = 0 ORDER BY key ASC",
    params: [roleTypeId],
  };
}

export async function readPermissionEditorOptions(host: ModEngineHost): Promise<PermissionEditorOptions> {
  await host.codenames.ensureLoaded();
  const roleId = host.codenames.peekId("role");
  const optionsId = host.codenames.peekId("cards_with_account");
  if (roleId === undefined) return {roles: []};
  const results = await host.batch([{
    sql: "SELECT c.* FROM cards c WHERE c.trash = 0 AND (c.type_id = ? OR c.id = ?) ORDER BY c.key ASC",
    params: [roleId, optionsId ?? -1],
  }]);
  const rows = (results[0] as {rows: {id: number; type_id: number}[]}).rows;
  const roleIds = new Set(rows.filter(row => Number(row.type_id) === roleId).map(row => Number(row.id)));
  const records = await host.composeAndCacheRows(rows);
  const roles: RoleOption[] = [];
  let optionsKey: string | undefined;
  for (const record of records) {
    if (record.id === undefined || record.name === undefined) continue;
    if (roleIds.has(record.id)) roles.push({name: record.name.s, key: record.key ?? DeckoName.parse(record.name.s).key});
    if (record.id === optionsId) optionsKey = DeckoName.parse(record.name.s).urlKey;
  }
  return {roles, ...(optionsKey !== undefined ? {cardsWithAccountUrlKey: optionsKey} : {})};
}

export async function preparePermissionRoles(host: ModEngineHost): Promise<void> {
  resetPermissionRolesForTests();
  await host.codenames.ensureLoaded();
  const roleTypeId = host.codenames.peekId("role");
  if (roleTypeId === undefined) return;
  const results = await host.batch([rolesStatement(roleTypeId)]);
  const rows = (results[0] as { rows: { id: number }[] } | undefined)?.rows ?? [];
  for (const row of rows) {
    const record = await host.fetchById(row.id);
    if (record === undefined || record.name === undefined) continue;
    await host.cacheFetchedRecord(record);
    roleRegistry.push({ name: record.name.s, key: record.key ?? DeckoName.parse(record.name.s).key });
  }
  roleRegistry.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const withAccountId = host.codenames.peekId("cards_with_account");
  if (withAccountId !== undefined) {
    const record = await host.fetchById(withAccountId);
    if (record?.name !== undefined) {
      await host.cacheFetchedRecord(record);
      cardsWithAccountUrlKey = DeckoName.parse(record.name.s).urlKey;
    }
  }
}

const setReadRuleFn: ModEventFn = (_card, _host) => {
};

const setFieldReadRulesFn: ModEventFn = (_card, _host) => {
};

const updateReadRuleFn: ModEventFn = (_card, _host) => {
};

const updateRuleCacheFn: ModEventFn = (_card, _host) => {
};

const expireRelatedFn: ModEventFn = (_card, _host) => {
};

const cascadeReadRuleFn: ModEventFn = (_card, _host) => {
};

const checkPermissionsFn: ModEventFn = (_card, _host) => {
};

function setModuleEntry(
  setPath: string,
  events?: readonly ModEventRegistration[],
): { setPath: string; events?: readonly ModEventRegistration[] } {
  return events === undefined ? { setPath } : { setPath, events };
}

export const permissionsModEventPredicates = {
  "rule?": async (card: ModEventCard, ctx?: ModEventContext): Promise<boolean> => {
    const fetch = ctx?.fetch;
    if (fetch === undefined || card.name === undefined) return false;
    const name = DeckoName.parse(card.name);
    if (name.s === "") return false;
    return (
      (await isStandardRuleName(fetch, name)) || (await isPreferenceName(fetch, name))
    );
  },
  "preference?": async (card: ModEventCard, ctx?: ModEventContext): Promise<boolean> => {
    const fetch = ctx?.fetch;
    if (fetch === undefined || card.name === undefined) return false;
    const name = DeckoName.parse(card.name);
    if (name.s === "") return false;
    return isPreferenceName(fetch, name);
  },
} as const;

const cardModPermissions: DeckoModManifest = {
  name: "permissions",
  gemName: "card-mod-permissions",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/permission",
      formats: {
        html: {
          views: [
            { view: "pointer_core", viewFn: pointerCoreView },
            { view: "one_line_content", viewFn: oneLineContentView, config: { cache: "never" } },
            { view: "input", viewFn: inputView },
          ],
        },
      },
    },
    {
      ...setModuleEntry("all/permissions", [
        {
          event: "set_read_rule",
          at: "store",
          on: ["save"],
          changed: ["type_id", "name"],
          fn: setReadRuleFn,
        },
        {
          event: "set_field_read_rules",
          after: "set_read_rule",
          on: ["update"],
          changed: ["type_id"],
          fn: setFieldReadRulesFn,
        },
        {
          event: "update_read_rule",
          fn: updateReadRuleFn,
        },
        {
          event: "check_permissions",
          at: "validate",
          fn: checkPermissionsFn,
        },
      ]),
    },
    {
      ...setModuleEntry("all/update_read_rules", [
        {
          event: "update_rule_cache",
          at: "finalize",
          when: "rule?",
          fn: updateRuleCacheFn,
        },
        {
          event: "expire_related",
          at: "finalize",
          fn: expireRelatedFn,
        },
      ]),
    },
    {
      ...setModuleEntry("right/create"),
      assignsType: "list",
      formats: {
        html: {
          views: [{ view: "input", viewFn: inputView }],
        },
      },
    },
    {
      ...setModuleEntry("right/delete"),
      assignsType: "list",
      formats: {
        html: {
          views: [{ view: "input", viewFn: inputView }],
        },
      },
    },
    {
      ...setModuleEntry("right/read", [
        {
          event: "cascade_read_rule",
          at: "finalize",
          after: "update_rule_cache",
          when: "rule?",
          fn: cascadeReadRuleFn,
        },
      ]),
      assignsType: "list",
      formats: {
        html: {
          views: [{ view: "input", viewFn: inputView }],
        },
      },
    },
    {
      ...setModuleEntry("right/update"),
      assignsType: "list",
      formats: {
        html: {
          views: [{ view: "input", viewFn: inputView }],
        },
      },
    },
    {
      setPath: "self/create",
      settingOpts: {
        group: "permission",
        position: 1,
        ruleTypeEditable: false,
        shortHelpText: "who can create cards",
        helpText: "Who can create new cards",
      },
    },
    {
      setPath: "self/delete",
      settingOpts: {
        group: "permission",
        position: 4,
        ruleTypeEditable: false,
        shortHelpText: "who can delete cards",
        helpText: "Who can delete cards",
      },
    },
    {
      setPath: "self/read",
      settingOpts: {
        group: "permission",
        position: 2,
        ruleTypeEditable: false,
        shortHelpText: "who can view cards",
        helpText: "Who can view cards in the [[Set]].",
      },
    },
    {
      setPath: "self/update",
      settingOpts: {
        group: "permission",
        position: 3,
        ruleTypeEditable: false,
        shortHelpText: "who can update cards",
        helpText: "Who can update cards",
      },
    },
  ],
  prepareEngine: preparePermissionRoles,
};

export default cardModPermissions;
