import { NoMethodError, type ViewContext, type ViewFn } from "../../render/format.js";
import { recaptchaSiteKey, serializerFollowsLive } from "../../render/deployment-follow-live-config.js";
import { DeckoName } from "../../name.js";
import { emitAttrs, h, newSlotId, slotOptionsJson } from "../../render/slot-html.js";
import { RenderFormat, str, type ViewResult } from "../../render/format.js";
import { modSlotWrap } from "../mod-view-helpers.js";
import { cardFormShell, createFormShell, successTags } from "../mod-form-substrate.js";
import { readFormgroupBody, templateLinkSetNameFromParts } from "../../render/views.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import { parseNestOptions, scanNests } from "../../render/nest-syntax.js";
import { virtualSearchCqlFor } from "../../fetch/virtual-search-cards.js";
import { safeSetKeys } from "../../render/set-keys.js";
import { getNameEnvironment } from "../../name/environment.js";
import { modRuleSeedContentForCandidate } from "../mod-rule-seeds.js";
import { renderRecaptchaConfig } from "../../render/render-recaptcha-config.js";
import { recaptchaFormOn, recaptchaHiddenFormTags } from "./card-mod-recaptcha.js";
import { timeAgoInWords, actSummaryBadge } from "./card-mod-history.js";
import { ruleSidesStatement, warmRuleCards } from "./rule-card-warm.js";
import { cardWallClockNow } from "../../wall-clock.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModSetModuleFile,
} from "../mod-manifest.js";

function output(parts: (ViewResult | undefined)[]): string {
  return parts
    .filter((part): part is Exclude<ViewResult, null> => part !== undefined && part !== null)
    .map(str)
    .join("\n");
}

function icon(name: string): string {
  return `<i class="notranslate material-icons">${name}</i>`;
}

function onTypeSet(ctx: ViewContext): DeckoName | undefined {
  const parent = ctx.fmt.parent;
  if (parent === undefined) return undefined;
  const tmplSetName = parent.card.name.trunkName;
  const tmplSetClassCard = ctx.fmt.engine.fetchRenderCard(tmplSetName.tagName.s);
  if (tmplSetClassCard === undefined || tmplSetClassCard.record.codename !== "type") return undefined;
  return tmplSetName.leftName;
}

export function templateLinkSetNameForRelativeName(ctx: ViewContext, nestName: DeckoName): DeckoName {
  return templateLinkSetNameFromParts(onTypeSet(ctx), nestName);
}

function templateLinkSetName(ctx: ViewContext, nestName: DeckoName): DeckoName {
  if (nestName.isAbsolute) return nestName.fieldName({ codename: "self" });
  return templateLinkSetNameForRelativeName(ctx, nestName);
}

export const templateNestView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const nestName = voo.opts["nest_name"];
  if (nestName === undefined || nestName === null) return "";
  const name = DeckoName.parse(String(nestName));
  if (name.fieldOnly) {
    const setName = templateLinkSetName(ctx, name);
    return fmt.withNestMode("normal", () =>
      fmt.nest({
        syntax: "",
        name: setName.s,
        options: { view: "template_link", extra: {} },
        comment: undefined,
      }),
    );
  }
  const syntax = voo.opts["nest_syntax"];
  return `{{${typeof syntax === "string" ? syntax : ""}}}`;
};

const justDeletedView: ViewFn = ({ fmt, voo }) => {
  const title = fmt.renderView("title");
  return modSlotWrap({ fmt, voo }, "just_deleted", `${title} deleted`);
};

function standardSaveButton(voo: ViewContext["voo"]): string | undefined {
  if (!voo.show("save_button")) return undefined;
  return `<button name="button" type="submit" data-disable-with="Submitting" class="submit-button me-3 _update-history-pills btn btn-primary" data-cy="save">Save</button>`;
}

function standardSaveAndCloseButton(text = "Save and Close"): string {
  return `<button name="button" type="submit" data-disable-with="Submitting" data-cy="submit-modal" class="submit-button me-3 _close-on-success _update-origin btn btn-primary">${text}</button>`;
}

function modalCancelButton(): string {
  return `<button name="button" type="button" data-bs-dismiss="modal" data-cy="close-modal" class="cancel-button btn btn-secondary">Cancel</button>`;
}

const structureRuleFetchInstances = new WeakSet<object>();

function deleteButton(fmt: ViewContext["fmt"]): string | undefined {
  if (fmt.card.id === undefined) return undefined;
  if (
    structureRuleFetchInstances.has(fmt.card) &&
    (fmt.engine.cardMatchesRuleSet?.(fmt.card) ?? false)
  ) {
    throw new NoMethodError("undefined method `rule_setting_name' for an instance of Card");
  }
  const name = h(fmt.card.name.s);
  const successQuery = fmt.isMain
    ? "success%5Bmark%5D=%2Aprevious&success%5Bredirect%5D=true"
    : "success%5Bview%5D=just_deleted";
  return `<a class="slotter btn btn-outline-danger ms-auto" data-confirm="Are you sure you want to delete ${name}?" href="/delete/${fmt.urlKey()}?${successQuery}" data-remote="true">Delete</a>`;
}

function buttonFormGroup(ctx: ViewContext, inner: string): string {
  return `<div class="form-group ${ctx.voo.classy("button-form-group")}">${inner}</div>`;
}

export const editButtonsView: ViewFn = ({ fmt, voo }) =>
  buttonFormGroup(
    { fmt, voo },
    output([
      standardSaveButton(voo),
      standardSaveAndCloseButton(),
      modalCancelButton(),
      deleteButton(fmt),
    ]),
  );

export const editTypeRowView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  if (!voo.viz.has("type_form")) voo.hide("type_form");
  if (voo.explicitShow("type_form")) {
    return boardTypeFormgroupView(ctx);
  }
  const typeName = fmt.card.typeName ?? "";
  const typeUrl = DeckoName.parse(typeName).urlKey;
  const content = `<a class="known-card" href="/${typeUrl}">${h(typeName)}</a>`;
  const editLink =
    `<a rel="nofollow" class="ms-2 edit-link slotter" data-cy="edit-link"` +
    ` href="/${fmt.urlKey()}/board_type_formgroup" data-remote="true">${icon("edit")}</a>`;
  const inner =
    `<div class='col-2 text-start'>\n<label>\nType\n</label>\n</div>\n` +
    `<div class='col-8'>\n${content}\n</div>\n` +
    `<div class='col-2 text-end'>\n${editLink}\n</div>\n`;
  voo.classUp("card-slot", "d-flex form-group");
  return modSlotWrap({ fmt, voo }, "edit_type_row", inner, "row");
};

export const conflictTrackerView: ViewFn = ({ fmt, voo }) => {
  if (fmt.card.id === undefined) return "";
  const value = fmt.card.record.currentRevisionId;
  const prefix =
    typeof voo.opts["form_name_prefix"] === "string" && voo.opts["form_name_prefix"] !== ""
      ? (voo.opts["form_name_prefix"] as string)
      : "card";
  const name = `${prefix}[last_action_id_before_edit]`;
  const id = name.replace(/\]/g, "").replace(/[^-a-zA-Z0-9:.]/g, "_");
  const valueAttr = value === undefined || value === null
    ? ""
    : ` value="${h(String(value))}"`;
  return `<input class="current_revision_id form-control" autocomplete="off" type="hidden"${valueAttr} name="${h(name)}" id="${h(id)}" />`;
};

const TYPE_FORMAT_INPUT_TYPE: Readonly<
  Record<string, { method: string; aceMode?: string }>
> = {
  html: { method: "ace_editor", aceMode: "html" },
  markdown: { method: "ace_editor", aceMode: "markdown" },
  json: { method: "ace_editor", aceMode: "json" },
  number: { method: "text_field" },
  phrase: { method: "text_field" },
  uri: { method: "text_field" },
  plain_text: { method: "text_area" },
  pointer: { method: "list" },
  list: { method: "list" },
  date: { method: "calendar" },
  search_type: { method: "ace_editor", aceMode: "json" },
};

export function inputTypeFromRule(
  ruleContent: string | undefined,
): string | undefined {
  return ruleContent === undefined
    ? undefined
    : ruleContent.replace(/[[\]]/g, "").replace(/ /g, "_");
}

function inputTypeRuleContent(ctx: ViewContext): string | undefined {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
    isNew: card.record.isNew === true,
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*input type")) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined || record.unknown === true) continue;
    return record.dbContent;
  }
  return undefined;
}

function inputDefinedByCard(
  ctx: ViewContext,
  inputType: string | undefined,
): string | undefined {
  if (inputType === undefined) return undefined;
  const record = ctx.fmt.engine.fetchRenderCard(inputType);
  if (record === undefined) return undefined;
  return ctx.fmt.nest({
    syntax: `{{${record.name.s}|view:core}}`,
    name: record.name.s,
    options: parseNestOptions("view:core"),
    comment: undefined,
  });
}

export const inputView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const content = h(fmt.card.dbContent ?? "");
  const namePrefix = typeof voo.opts["form_name_prefix"] === "string"
    ? (voo.opts["form_name_prefix"] as string)
    : "card";
  const idPrefix = namePrefix === "card" ? "card" : namePrefix.replace(/\]/g, "").replace(/[^-a-zA-Z0-9:.]/g, "_");
  const vooInputType = voo.opts["input_type"];
  const typeArm =
    vooInputType !== undefined && typeof vooInputType === "string"
      ? { method: vooInputType }
      : (fmt.card.typeCode !== undefined
          ? TYPE_FORMAT_INPUT_TYPE[fmt.card.typeCode]
          : undefined);
  const inputType =
    typeArm?.method ?? inputTypeFromRule(inputTypeRuleContent(ctx));
  const method = inputType ?? "rich_text";
  if (method === "pointer" || method === "list") {
    const items = content === "" ? [""] : content.split("\n").filter((s) => s !== "");
    const itemRows = (items.length > 0 ? items : [""])
      .map(
        (item) =>
          `<li class="pointer-li mb-1">\n` +
          `  <span class="input-group">\n` +
          `    <span class="input-group-text handle"><i class="material-icons notranslate">reorder</i></span>\n` +
          `    <input class="pointer-item-text form-control" data-options-card="" placeholder="" type="text" value="${h(item)}" name="pointer_item" id="pointer_item" />\n` +
          `    <button class="pointer-item-delete btn btn-secondary" type="button"><i class="material-icons notranslate">remove</i></button>\n` +
          `  </span>\n` +
          `</li>`,
      )
      .join("\n");
    return (
      `<input class="d0-card-content form-control" autocomplete="off" type="hidden" value="${content}" name="${namePrefix}[content]" id="${idPrefix}_content" />\n` +
      `<ul class="pointer-list-editor pointer-list-ul">\n${itemRows}\n</ul>\n` +
      `<span class="input-group">\n` +
      `  <button class="_pointer-item-add btn btn-secondary" type="submit"><i class="material-icons notranslate">add</i>add another</button>\n` +
      `</span>`
    );
  }
  if (method === "ace_editor") {
    const mode = typeArm?.aceMode ?? "html";
    return `<textarea rows="5" class="d0-card-content ace-editor-textarea form-control" data-ace-mode="${mode}" name="${namePrefix}[content]" id="${idPrefix}_content">\n${content}</textarea>`;
  }
  if (method === "rich_text" || method === "tinymce_editor") {
    const id = fmt.uniqueId();
    return `<textarea rows="3" class="tinymce-textarea d0-card-content form-control" id="${id}" name="${namePrefix}[content]">\n${content}</textarea>`;
  }
  if (method === "calendar") {
    return `<input class="date-editor form-control" type="date" value="${content}" name="${namePrefix}[content]" id="${idPrefix}_content" />`;
  }
  if (method === "text_field") {
    return `<input class="d0-card-content form-control" placeholder="" type="text" value="${content}" name="${namePrefix}[content]" id="${idPrefix}_content" />`;
  }
  if (method === "text_area") {
    return `<textarea rows="5" class="d0-card-content form-control" data-card-type-code="${fmt.card.typeCode ?? ""}" name="${namePrefix}[content]" id="${idPrefix}_content">\n${content}</textarea>`;
  }
  if (method === "hidden") {
    return `<input class="d0-card-content form-control" autocomplete="off" type="hidden" value="${content}" name="${namePrefix}[content]" id="${idPrefix}_content" />`;
  }
  const definedByCard = inputDefinedByCard(ctx, inputType);
  if (definedByCard !== undefined) return definedByCard;
  const id = fmt.uniqueId();
  return `<textarea rows="3" class="tinymce-textarea d0-card-content form-control" id="${id}" name="${namePrefix}[content]">\n${content}</textarea>`;
};

function contentField(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  const conflict = voo.show("conflict_tracker") && fmt.card.id !== undefined
    ? fmt.renderView("conflict_tracker")
    : undefined;
  return output([conflict, fmt.renderView("input")]);
}

export const contentFormgroupView: ViewFn = ({ fmt, voo }) => {
  const card = fmt.card;
  const attrs = emitAttrs({
    class: "form-group card-editor",
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": card.name.s === "" ? undefined : card.name.s,
    "data-card-link-name": h(fmt.urlKey()),
  });
  return (
    `<div${attrs}>` +
    `<label for="card_content">Content</label>\n` +
    `<div class="editor content-editor">${contentField({ fmt, voo })}</div>` +
    `</div>`
  );
};

function editSlot(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  if (multiCardEditor(ctx)) return multiCardEdit(ctx, true);
  if (voo.show("type_formgroup") || voo.show("name_formgroup"))
    return str(fmt.renderView("content_formgroup"));
  return `<div class="editor content-editor">${contentField({ fmt, voo })}</div>`;
}

function multiCardEditor(ctx: ViewContext): boolean {
  const { voo } = ctx;
  return (
    voo.opts["structure"] !== undefined ||
    voo.liveEditStructure !== undefined ||
    cardStructure(ctx) !== undefined
  );
}

function cardStructure(
  ctx: ViewContext,
): { ruleName: string; content: string } | undefined {
  const card = ctx.fmt.card;
  const typeName =
    card.typeName ??
    (card.typeId !== undefined
      ? ctx.fmt.engine.peekNameForId?.(card.typeId)
      : undefined);
  return ctx.fmt.engine.structureRuleForSync?.({
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName,
    isNew: card.record.isNew === true,
  });
}

function multiCardEdit(ctx: ViewContext, fieldsOnly: boolean): string {
  const { fmt, voo } = ctx;
  const editStructure = voo.liveEditStructure as
    | Array<[string, Record<string, unknown>]>
    | undefined;
  let fieldConfigs: Array<[string, Record<string, unknown>]>;
  if (editStructure !== undefined) {
    fieldConfigs = editStructure.map(([cardish, options]) => {
      const opts = { ...(options ?? {}) };
      const fieldMark = normalizedEditFieldMark(fmt, cardish, opts);
      if (opts["title"] === undefined) opts["title"] = fieldMark;
      return [fieldMark, opts] as [string, Record<string, unknown>];
    });
  } else {
    const structure = cardStructure(ctx);
    const sourceContent =
      structure !== undefined ? structure.content : (fmt.card.dbContent ?? "");
    fieldConfigs = implicitFieldConfigs(fmt, sourceContent, fieldsOnly);
  }
  if (fieldConfigs.length === 0) return structureLink();
  if (fmt.nestMode === "edit") {
    return fieldConfigs
      .map(([name, options]) => fieldEditorInMultiCard(ctx, name, options))
      .join("\n");
  }
  const explicit = editStructure !== undefined;
  return fieldConfigs
    .map(([name, options]) => {
      const opts = { ...(options ?? {}) };
      const view = typeof opts["view"] === "string" ? opts["view"] : "";
      const title = typeof opts["title"] === "string" ? opts["title"] : undefined;
      const optList = view !== "" ? `|${view}` : "";
      return str(
        fmt.nest({
          syntax: `{{${name}${optList}}}`,
          name,
          options: { view: view !== "" ? view : undefined, title, extra: {} },
          comment: undefined,
          ...(explicit ? {} : { chunkNestSyntax: `${name}${optList}` }),
        }),
      );
    })
    .join("\n");
}

function implicitFieldConfigs(
  fmt: ViewContext["fmt"],
  structureContent: string,
  fieldsOnly: boolean,
): Array<[string, Record<string, unknown>]> {
  const configs: Array<[string, Record<string, unknown>]> = [];
  const seen = new Set<string>([fmt.card.key]);
  for (const piece of scanNests(structureContent)) {
    if (piece.kind !== "nest" || piece.nest === undefined) continue;
    const nest = piece.nest;
    if (nest.comment !== undefined) continue;
    const target = DeckoName.parse(nest.name).absoluteName(fmt.card.name);
    if (fieldsOnly && !target.fieldOf(fmt.card.name.s)) continue;
    if (seen.has(target.key)) continue;
    seen.add(target.key);
    if (virtualSearchCqlFor(target) !== undefined) continue;
    configs.push([nest.name, { ...nest.options } as Record<string, unknown>]);
  }
  return configs;
}

const EDIT_HIDDEN_VIEWS = new Set(["link"]);

function fieldEditorInMultiCard(
  ctx: ViewContext,
  name: string,
  options: Record<string, unknown>,
): string {
  const { fmt } = ctx;
  const requestedView = options["view"];
  if (typeof requestedView === "string" && EDIT_HIDDEN_VIEWS.has(requestedView)) {
    return "";
  }
  const fieldName = DeckoName.parse(name).absoluteName(fmt.card.name);
  const known =
    fmt.engine.fetchRenderCard(fieldName.key) ??
    fmt.engine.fetchRenderCard(fieldName.s);
  const tagCard = known ?? fmt.engine.fetchRenderCard(fieldName.tag ?? fieldName.s);
  const env = getNameEnvironment();
  const leftName = fieldName.leftName;
  const leftTypeName =
    (leftName !== undefined ? fmt.engine.fetchRenderCard(leftName.s)?.typeName : undefined) ??
    fmt.card.typeName;
  const defaulted = fmt.engine.newCardDefaultType?.(fieldName, leftTypeName);
  const fieldTypeId = defaulted?.typeId ?? tagCard?.typeId;
  const fieldTypeName = defaulted?.typeName ?? tagCard?.typeName;
  const fieldCard = known ??
    ({
      ...(tagCard ?? {}),
      name: fieldName,
      key: fieldName.key,
      unknown: true,
      record: {
        id: undefined,
        codename: undefined,
        leftId: undefined,
        rightId: tagCard?.id,
        typeId: fieldTypeId,
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
        name: fieldName,
        key: fieldName.key,
        isNew: true,
        fromTrash: false,
        uncacheable: false,
      },
      id: undefined,
      dbContent: "",
      typeName: fieldTypeName,
      typeId: fieldTypeId,
      typeCode:
        fieldTypeId !== undefined
          ? (env?.codename?.nameForId(fieldTypeId) ?? tagCard?.typeCode)
          : tagCard?.typeCode,
      setKeys: safeSetKeys({
        name: fieldName,
        typeId: fieldTypeId,
        typeName: fieldTypeName,
        leftTypeName: undefined,
        isNew: true,
      }),
    } as ViewContext["fmt"]["card"]);
  const parentPrefix =
    typeof ctx.voo.opts["form_name_prefix"] === "string"
      ? (ctx.voo.opts["form_name_prefix"] as string)
      : undefined;
  const relative = fieldName.from(fmt.card.name);
  const isDirectField = fieldName.fieldOf(fmt.card.name.s);
  const prefix =
    parentPrefix !== undefined && isDirectField
      ? `${parentPrefix}[subcards][${relative}]`
      : isDirectField
        ? `card[subcards][${relative}]`
        : (parentPrefix ?? "card");
  const explicitTitle = options["title"] !== undefined ? String(options["title"]) : undefined;
  const contentFieldHtml = fmt.nestRecord(fieldCard, "input", {
    form_name_prefix: prefix,
    skip_perms: true,
  });
  const conflictHtml = fmt.nestRecord(fieldCard, "conflict_tracker", {
    form_name_prefix: prefix,
  });
  const authoredView = typeof options["view"] === "string" ? options["view"] : undefined;
  const fieldHomeView =
    authoredView === "closed" || authoredView === "edit"
      ? "open"
      : (authoredView ?? fmt.defaultNestView());
  const fieldSub = new RenderFormat(fieldCard, fmt.engine, {
    parent: fmt,
    maxDepth: fmt.maxDepth,
    nestQuietErrors: fmt.nestQuietErrors,
  });
  const helpHtml = str(
    fieldSub.renderView(
      "help",
      explicitTitle !== undefined
        ?
          { form_name_prefix: prefix, show: "edit_in_form", home_view: fieldHomeView, title: explicitTitle }
        : { form_name_prefix: prefix, show: "edit_in_form", home_view: fieldHomeView },
    ),
  );
  const hiddenTypeId =
    fieldCard.id === undefined
      ? `<input autocomplete="off" type="hidden"${fieldTypeId !== undefined ? ` value="${fieldTypeId}"` : ""} name="${prefix}[type_id]" id="${prefix.replace(/\]/g, "").replace(/[^-a-zA-Z0-9:.]/g, "_")}_type_id" />`
      : "";
  const tagSafe = DeckoName.parse(fieldName.tag ?? fieldName.s).safeKey;
  const junctionClass = fieldName.isCompound ? ` RIGHT-${tagSafe}` : "";
  const attrs = emitAttrs({
    class: `form-group card-editor${junctionClass}`,
    "data-card-id": fieldCard.id === undefined ? undefined : String(fieldCard.id),
    "data-card-name": h(fieldName.s),
    "data-card-link-name": h(DeckoName.parse(fieldName.s).urlKey),
  });
  const labelForId = `${prefix}_content`
    .replace(/\]/g, "")
    .replace(/[^-a-zA-Z0-9:.]/g, "_");
  const titleSpan = str(
    fieldSub.renderView(
      "title",
      explicitTitle !== undefined
        ? { title: explicitTitle, form_name_prefix: prefix }
        : { form_name_prefix: prefix },
    ),
  );
  const label =
    `<label for="${labelForId}">` +
    output([titleSpan, helpHtml]) +
    `</label>`;
  const editor =
    `<div class="editor content-editor">` +
    output([conflictHtml || undefined, contentFieldHtml, hiddenTypeId || undefined]) +
    `</div>`;
  return `<div${attrs}>${label}\n${editor}</div>`;
}

function normalizedEditFieldMark(
  fmt: ViewContext["fmt"],
  cardish: string,
  options: Record<string, unknown>,
): string {
  if (options["absolute"] === true || cardish.startsWith("+")) {
    delete options["absolute"];
    return cardish.startsWith("+") ? fmt.card.name.s + cardish : cardish;
  }
  return fmt.card.name.field(cardish);
}

export const contentFormgroupsView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  return `<fieldset class="card-editor editor">${editSlot(ctx)}</fieldset>`;
};

function editSuccess(ctx: ViewContext): Record<string, string> | undefined {
  return ctx.fmt.card.record.codename === "signin" ? { view: "reset_password_success" } : undefined;
}
function editViewHidden(ctx: ViewContext): string | undefined {
  return ctx.fmt.card.record.codename === "signin"
    ? hiddenFieldTag("card[trigger]", "send_reset_password_token") : undefined;
}

export const editFormView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.showViz("edit_type_row");
  voo.hide("edit_type_row");
  const form =
    `<form class="card-form slotter autosave" id="edit_card_${fmt.card.id}"` +
    ` data-slot-selector="modal-origin" data-slot-error-selector=".card-slot"` +
    ` action="/update/${fmt.urlKey()}" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    successTags(editSuccess(ctx)) +
    fmt.withNestMode("edit", () =>
      output([
        editViewHidden(ctx),
      fmt.renderView("edit_type_row", { home_view: "edit_type_row", skip_perms: true }),
      fmt.renderView("content_formgroups", { skip_perms: true }),
      fmt.renderDelegated(
        voo.opts["buttons_view"] === undefined ? "edit_buttons" : String(voo.opts["buttons_view"]),
        { skip_perms: true },
      ),
      ])
    ) +
    `</form>`;
  return modSlotWrap({ fmt, voo }, "edit_form", form);
};

function closeModalLink(): string {
  return `<a class="_close-modal btn-close" data-bs-dismiss="modal" href="">${icon("close")}</a>`;
}

function boardLink(fmt: ViewContext["fmt"], confirm = true): string {
  return (
    `<a rel="nofollow" class="board-link${confirm ? " _confirm" : ""} slotter" title="Advanced"` +
    ` data-bs-toggle="tooltip" data-bs-placement="bottom"` +
    ` data-slotter-mode="modal-replace"` +
    (confirm
      ? ` data-confirm-msg="Unsaved changes will be lost. Do you want to proceed?"`
      : ``) +
    ` href="/${fmt.urlKey()}/board" data-remote="true">${icon("space_dashboard")} </a>`
  );
}

function editModalMenu(fmt: ViewContext["fmt"]): string {
  return `<div class="modal-menu _modal-menu ms-auto">${[closeModalLink(), boardLink(fmt)].join("\n")}</div>`;
}

export const editView: ViewFn = ({ fmt, voo }) => {
  fmt.addNameContext();
  voo.showViz("help");
  voo.hide("save_button");
  voo.classUp("help-text", "alert alert-info");
  const body = modSlotWrap(
    { fmt, voo },
    "edit",
    fmt.withNestMode("edit", () =>
      [fmt.renderView("help", { skip_perms: true }), fmt.renderView("edit_form", { skip_perms: true })].join("\n"),
    ),
  );
  return editModalWrapper(fmt, body);
};

export function editModalWrapper(fmt: ViewContext["fmt"], body: string): string {
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += "<div class='modal-dialog modal-dialog-centered modal-lg'>\n";
  out += "<div class='modal-content'>\n";
  out += "<div class='modal-header'>\n";
  out += `${fmt.renderView("title")}\n`;
  out += `${editModalMenu(fmt)}\n`;
  out += "</div>\n";
  out += `<div class='modal-body'>\n${body}\n</div>\n`;
  out += "</div>\n</div>\n</div>\n";
  return out;
}

export function framedView(
  ctx: ViewContext,
  view: string,
  bodyFn: () => string,
  opts: { showHelp?: boolean } = {},
): string {
  const { fmt, voo } = ctx;
  if (opts.showHelp !== true) voo.hide("help");
  fmt.addNameContext();
  voo.classUp("d0-card-header", "card-header");
  voo.classUp("d0-card-body", "card-body card-text");
  voo.classUp("d0-card-frame", "card");
  const body = bodyFn();
  const tag = fmt.isMain ? "h1" : "h2";
  const titleTag = `<${tag} class="${voo.classy("d0-card-header-title")}">${fmt.renderView("title")}</${tag}>`;
  const menuRendered = voo.show("menu") ? fmt.renderView("menu") : null;
  const header =
    `<div class="${voo.classy("d0-card-header")}">` +
    (menuRendered === null ? titleTag : `${titleTag}\n${str(menuRendered)}`) +
    `</div>`;
  let frameHelp: ViewResult | undefined;
  if (voo.show("help")) {
    const prevAlert = voo.classUps.get("help-text");
    voo.classUp("help-text", "alert alert-info");
    frameHelp = fmt.renderView("help");
    if (prevAlert === undefined) voo.classUps.delete("help-text");
    else voo.classUps.set("help-text", prevAlert);
  }
  const panel =
    `<div class="${voo.classy("d0-card-frame")}">` +
    output([
      header,
      frameHelp,
      "",
      `<div class="${voo.classy("d0-card-body")}">${body}</div>`,
    ]) +
    `</div>`;
  return modSlotWrap({ fmt, voo }, view, panel);
}

function nameForm(ctx: ViewContext, successView: string | undefined): string {
  const { fmt } = ctx;
  const success: Array<[string, string]> = [
    ["name", "_self"],
    ["redirect", ""],
  ];
  if (successView !== undefined) success.push(["view", successView]);
  const successTags = success
    .map(
      ([key, value]) =>
        `<input type="hidden" name="success[${key}]" id="success_${key}" value="${value}" autocomplete="off" />`,
    )
    .join("");
  return (
    `<form class="_rename-form card-form slotter" id="edit_card_${fmt.card.id}"` +
    ` data-main-success="{&quot;redirect&quot;:true,&quot;view&quot;:&quot;&quot;}"` +
    ` data-slotter-mode="update-origin"` +
    ` action="/update/${fmt.urlKey()}?id=${fmt.card.id}"` +
    ` accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    successTags +
    output([
      fmt.renderView("name_formgroup"),
      skipReferers(),
      editNameButtons(ctx),
    ]) +
    `</form>`
  );
}

function skipReferers(): string {
  return (
    `<div class='skip-referers pb-2'>\n` +
    `<input type="checkbox" name="card[skip]" id="card_skip" value="update_referer_content" />\n` +
    `<label class='ps-1'>\ndo not update references to this name\n</label>\n</div>\n`
  );
}

function editNameButtons(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  voo.classUp("button-form-group", "rename-button-form-group");
  return buttonFormGroup(
    ctx,
    output([
      `<button name="button" type="submit" class="renamer btn btn-primary" data-disable-with="Renaming" data-confirm="Are you sure you want to rename?">Rename</button>`,
      `<a class="cancel-button ms-4 btn btn-secondary slotter" href="/${fmt.urlKey()}" data-cy="cancel" data-remote="true">Cancel</a>`,
    ]),
  );
}

const editNameView: ViewFn = (ctx) =>
  framedView(ctx, "edit_name", () => nameForm(ctx, undefined));

const nameFormView: ViewFn = ({ fmt, voo }) =>
  modSlotWrap({ fmt, voo }, "name_form", nameForm({ fmt, voo }, "edit_name_row"));

export const nameFormgroupView: ViewFn = ({ fmt }) => {
  const card = fmt.card;
  const attrs = emitAttrs({
    class: "form-group",
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": card.name.s === "" ? undefined : card.name.s,
    "data-card-link-name": h(fmt.urlKey()),
  });
  return (
    `<div${attrs}>` +
    `<label for="card_name">Name</label>\n` +
    `<div class="editor name-editor">` +
    `<input value="${h(card.name.s)}" autocomplete="off" class=" form-control" type="text" name="card[name]" id="card_name" />` +
    `</div></div>`
  );
};

export const editNameRowView: ViewFn = ({ fmt, voo }) => {
  const editLink =
    `<a rel="nofollow" class="ms-2 edit-link slotter" data-cy="edit-link"` +
    ` href="/${fmt.urlKey()}/name_form" data-remote="true">${icon("edit")}</a>`;
  const inner =
    `<div class='col-2 text-start'>\n<label>\nName\n</label>\n</div>\n` +
    `<div class='col-8'>\n${h(fmt.card.name.s)}\n</div>\n` +
    `<div class='col-2 text-end'>\n${editLink}\n</div>\n`;
  voo.classUp("card-slot", "d-flex form-group");
  return modSlotWrap({ fmt, voo }, "edit_name_row", inner, "row");
};

const CARDTYPE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  Text: ["RichText", "PlainText", "Markdown", "Phrase", "HTML"],
  Data: ["Number", "Toggle", "Date", "URI"],
  Upload: ["File", "Image"],
  Custom: [],
  Organize: ["List", "Pointer", "Search", "Link list", "Nest list"],
  Template: ["Notification template", "Email template", "Twitter template"],
  Admin: ["Cardtype", "User", "Role", "Sign up", "Session", "Set", "Setting"],
  Styling: ["Layout", "Skin", "Bootswatch skin", "CSS", "SCSS"],
  Scripting: ["JSON", "JavaScript", "CoffeeScript"],
};
const CARDTYPE_GROUP_MAP: ReadonlySet<string> = new Set(
  Object.values(CARDTYPE_GROUPS).flat(),
);

export function typeField(
  ctx: ViewContext,
  opts: {
    href?: string;
    cls?: string;
    groups?: Readonly<Record<string, readonly string[]>>;
    hrefFirst?: boolean;
  },
): string {
  const { fmt } = ctx;
  const createable = fmt.createableTypes();
  const current = fmt.card.typeName ?? "";
  const createableSet = new Set(createable);
  if (fmt.card.id !== undefined && !createableSet.has(current)) {
    createableSet.add(current);
  }
  const select2Id = `${fmt.uniqueId()}-${Math.floor(cardWallClockNow().getTime() / 1000)}`;
  const groups = opts.groups ?? CARDTYPE_GROUPS;
  const materialized: Array<[string, readonly string[]]> = [];
  for (const [group, types] of Object.entries(groups)) {
    const items =
      group === "Custom"
        ? createable.filter((t) => !CARDTYPE_GROUP_MAP.has(t))
        : types.filter((t) => createableSet.has(t));
    if (group === "Custom" || items.length > 0) materialized.push([group, items]);
  }
  const optionHtml = (t: string): string =>
    `<option${t === current ? ` selected="selected"` : ""} value="${t}">${t}</option>`;
  let out: string;
  if (materialized.length === 1) {
    out = materialized[0]![1].map(optionHtml).join("\n");
  } else {
    out = materialized
      .map(([group, items]) => `<optgroup label="${group}">${items.map(optionHtml).join("\n")}</optgroup>`)
      .join("");
  }
  const href = opts.href === undefined ? "" : ` href="${h(opts.href)}"`;
  const live = opts.href === undefined ? "" : ` data-remote="true"`;
  const classBase =
    opts.cls !== undefined
      ? opts.cls
      : opts.href !== undefined
        ? `_live-type-field type-field`
        : `type-field`;
  const head =
    opts.hrefFirst === true
      ? `<select name="card[type]" id="card_type"${href} class="${classBase} form-control"`
      : opts.cls !== undefined
        ? `<select name="card[type]" id="card_type" class="${classBase} form-control"${href}`
        : `<select name="card[type]" id="card_type"${href} class="${classBase} form-control"`;
  return (
    head +
    live +
    ` data-select2-id="${select2Id}">` +
    out +
    `</select>`
  );
}

export function typeFormgroup(
  ctx: ViewContext,
  opts: {
    href?: string;
    cls?: string;
    groups?: Readonly<Record<string, readonly string[]>>;
    hrefFirst?: boolean;
  },
): string {
  const { fmt } = ctx;
  const card = fmt.card;
  const attrs = emitAttrs({
    class: "form-group type-formgroup",
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": card.name.s === "" ? undefined : card.name.s,
    "data-card-link-name": h(fmt.urlKey()),
  });
  return (
    `<div${attrs}><label for="card_type">Type</label>\n` +
    `<div class="editor type-editor">` +
    [
      typeField(ctx, opts),
      `<input type="hidden" name="assign" id="assign" value="true" autocomplete="off" />`,
    ].join("\n") +
    `</div></div>`
  );
}

const typeFormgroupView: ViewFn = (ctx) => typeFormgroup(ctx, {});

const boardTypeFormgroupView: ViewFn = (ctx) => {
  const href = `/${ctx.fmt.urlKey()}/edit_form?assign=true&slot%5Bshow%5D%5B%5D=type_form`;
  return modSlotWrap(
    ctx,
    "board_type_formgroup",
    typeFormgroup(ctx, { href }),
  );
};

const editTypeFormView: ViewFn = ({ fmt, voo }) => {
  const form =
    `<form class="card-form slotter autosave" id="edit_card_${fmt.card.id}"` +
    ` action="/update/${fmt.urlKey()}" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    `<input type="hidden" name="success[view]" id="success_view" value="core" autocomplete="off" />` +
    output([fmt.renderView("type_formgroup"), fmt.renderView("new_buttons")]) +
    `</form>`;
  return modSlotWrap({ fmt, voo }, "edit_type_form", form);
};

const editTypeView: ViewFn = (ctx) =>
  framedView(ctx, "edit_type", () => str(ctx.fmt.renderView("edit_type_form")));

export const newButtonsView: ViewFn = ({ fmt, voo }) => {
  const href = fmt.isMain
    ? "/*previous"
    : `/${fmt.urlKey()}/${String(voo.opts["home_view"] ?? "unknown")}`;
  return buttonFormGroup(
    { fmt, voo },
    output([
      `<button name="button" type="submit" data-disable-with="Submitting" class="submit-button create-submit-button btn btn-primary">Submit</button>`,
      `<a class="cancel-button ms-4 btn btn-secondary slotter" href="${href}" data-cy="cancel" data-remote="true">Cancel</a>`,
    ]),
  );
};

function visibleWrite(voo: ViewContext["voo"], view: string, result: boolean): boolean {
  if (!voo.viz.has(view)) voo.viz.set(view, result ? "show" : "hide");
  return voo.show(view);
}

function hiddenFieldTag(name: string, value: string): string {
  const id = name.replace(/[[\]]+/g, "_").replace(/_+$/, "");
  return `<input type="hidden" name="${name}" id="${id}" value="${h(value)}" autocomplete="off" />`;
}

function guideRuleCard(ctx: ViewContext): ReturnType<ViewContext["fmt"]["engine"]["fetchRenderCard"]> {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
    ...(card.id === undefined ? { isNew: true } : {}),
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*guide")) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (ctx.fmt.engine.isDenied(record)) continue;
    return record;
  }
  return undefined;
}

function guideText(ctx: ViewContext): string {
  const guideCard = guideRuleCard(ctx);
  if (guideCard === undefined) return "";
  return ctx.fmt.nest({
    syntax: `{{${guideCard.name.s}|view:core}}`,
    name: guideCard.name.s,
    options: parseNestOptions("view:core"),
    comment: undefined,
  });
}

function prependGuideEditLink(ctx: ViewContext, text: string): string {
  const guideCard = guideRuleCard(ctx);
  if (guideCard === undefined) return text;
  const taskAllowed = ctx.fmt.engine.taskAllowed?.(guideCard, "update");
  if (taskAllowed !== true) return text;
  const editLink =
    `<a rel="nofollow" class="edit-link slotter" title="Edit" data-bs-toggle="tooltip"` +
    ` data-bs-placement="bottom" data-slotter-mode="modal" data-modal-class="modal-lg"` +
    ` href="/${guideCard.name.urlKey}/rule_edit" data-remote="true"><i class="notranslate material-icons">edit</i> </a>`;
  return `<span class='d-none'>${editLink}</span>${text}`;
}

function guideHelper(ctx: ViewContext): string {
  const text = guideText(ctx);
  if (text === "") return "";
  return `<div class="guide-text">${prependGuideEditLink(ctx, text)}</div>`;
}

function alertGuide(ctx: ViewContext): string {
  const rendered = guideHelper(ctx);
  if (rendered === "") return "";
  return (
    `<div class="guide alert alert-secondary alert-dismissible " role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>\n` +
    `${rendered}</div>`
  );
}

function withCreateContext(ctx: ViewContext): void {
  if (newNamePrompt(ctx) && ctx.voo.liveTitle === undefined && ctx.voo.opts["title"] === undefined) {
    ctx.voo.opts["title"] = newViewTitle(ctx);
  }
  ctx.voo.showViz("help");
}

function newNamePrompt(ctx: ViewContext): boolean {
  return visibleWrite(ctx.voo, "name_formgroup", needsName(ctx));
}

function newAutonameRule(ctx: ViewContext): ReturnType<ViewContext["fmt"]["engine"]["fetchRenderCard"]> {
  const {card,engine}=ctx.fmt;
  if(card.name.s!=="")return undefined;
  const setting=engine.findSettingCard?.("autoname");
  const settingName=setting?.name.s??"*autoname";
  for(const candidate of ruleNamesForCard({name:card.name.s,isNew:true,typeId:card.typeId,typeName:card.typeName},settingName)){
    const rule=engine.fetchRenderCard(candidate);
    if(rule===undefined||rule.unknown===true)continue;
    return typeof rule.dbContent==="string"&&rule.dbContent.trim()!==""?rule:undefined;
  }
  return undefined;
}

function needsName(ctx: ViewContext): boolean {
  return ctx.fmt.card.name.s === "" && newAutonameRule(ctx) === undefined;
}

function newTypePrompt(ctx: ViewContext): boolean {
  const { fmt, voo } = ctx;
  const request = fmt.engine.requestNewCard;
  const preset = voo.opts["type"] !== undefined || (request?.typePreset ?? (request?.typeId !== undefined));
  const context = fmt.isMain || isSimpleCard(fmt) || isTemplateCard(fmt);
  const permitted = newTypePermitted(ctx);
  return visibleWrite(voo, "new_type_formgroup", !preset && context && permitted);
}

function isSimpleCard(fmt: ViewContext["fmt"]): boolean {
  return !fmt.card.name.isCompound;
}

function isTemplateCard(fmt: ViewContext["fmt"]): boolean {
  const right = fmt.card.name.rightName;
  if (right === undefined) return false;
  return right.key === "*structure" || right.key === "*default";
}

function newTypePermitted(ctx: ViewContext): boolean {
  const { fmt } = ctx;
  const own = fmt.card.typeId === undefined ? undefined : fmt.engine.currentTypeCreatable?.(fmt.card.typeId);
  if (own !== undefined) return own;
  const typeName = fmt.card.typeName;
  return typeName !== undefined && fmt.createableTypes().includes(typeName);
}

function newViewName(ctx: ViewContext): string | undefined {
  if (newNamePrompt(ctx)) {
    return output([
      ctx.fmt.renderView("name_formgroup", { skip_perms: true }),
      hiddenFieldTag("name_prompt", "true"),
    ]);
  }
  if(newAutonameRule(ctx)!==undefined)return undefined;
  return hiddenFieldTag("card[name]", ctx.fmt.card.name.s);
}

function newViewType(ctx: ViewContext): string {
  if (newTypePrompt(ctx)) return str(ctx.fmt.renderView("new_type_formgroup", { skip_perms: true }));
  return hiddenFieldTag("card[type_id]", String(ctx.fmt.card.typeId ?? ""));
}

function newViewTitle(ctx: ViewContext): string {
  const typeName = ctx.fmt.card.typeName;
  return typeName === undefined || typeName === "Basic"
    ? "New"
    : output(["New", typeName]);
}

function newInModalTitle(ctx: ViewContext): string {
  return newNamePrompt(ctx) ? newViewTitle(ctx) : str(ctx.fmt.renderView("title"));
}

function newSuccessMark(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
    ...(card.id === undefined ? { isNew: true } : {}),
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*thanks")) {
    const rule = ctx.fmt.engine.fetchRenderCard(candidate);
    if (rule === undefined) continue;
    return rule.dbContent ?? "_self";
  }
  return "_self";
}

function createCardForm(
  ctx: ViewContext,
  formAttrs: string,
  successTags: string,
  body: string,
): string {
  const persisted = ctx.fmt.card.id !== undefined;
  const recaptchaConfig = renderRecaptchaConfig();
  const recaptchaOnForm =
    recaptchaConfig !== undefined &&
    recaptchaFormOn(
      {
        siteKey: recaptchaConfig.siteKey,
        secretKey: recaptchaConfig.secretKey,
        envController: true,
        signedIn: ctx.fmt.engine.viewer?.signedIn === true,
        alwaysOk: false,
        needsSetup: false,
        captchaRuleContent: captchaRuleSeedFor(ctx),
      },
      undefined,
    );
  const effectiveSuccessTags = recaptchaHiddenFormTags(
    successTags,
    recaptchaOnForm,
    "create",
    recaptchaConfig?.siteKey ?? "",
  );
  const effectiveFormAttrs =
    formAttrs + (recaptchaOnForm ? ` data-recaptcha="on"` : "");
  return (
    `<form class="card-form slotter" id="${persisted ? `edit_card_${ctx.fmt.card.id}` : "new_card"}"${effectiveFormAttrs}` +
    ` action="/card/create" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    (persisted ? `<input type="hidden" name="_method" value="patch" autocomplete="off" />` : "") +
    effectiveSuccessTags +
    body +
    `</form>`
  );
}

function captchaRuleSeedFor(ctx: ViewContext): string | undefined {
  const card = ctx.fmt.card;
  const candidates = ruleNamesForCard(
    {
      name: card.name?.s ?? "",
      isNew: card.id === undefined,
      typeId: card.typeId,
      typeName: card.typeName,
    },
    "*captcha",
  );
  for (const candidate of candidates) {
    const seeded = modRuleSeedContentForCandidate(candidate);
    if (seeded !== undefined) return seeded;
  }
  return undefined;
}

export function cardFormRecaptcha(
  ctx: ViewContext,
  recaptchaOpt?: unknown,
): { on: boolean; siteKey: string } {
  const renderConfig = renderRecaptchaConfig();
  const siteKey = recaptchaSiteKey() ?? renderConfig?.siteKey;
  const on = recaptchaFormOn(
    {
      siteKey,
      secretKey: renderConfig?.secretKey,
      envController: true,
      signedIn:
        ctx.fmt.engine?.viewer?.signedIn === true || ctx.fmt.engine?.pageSession?.signedIn === true,
      alwaysOk: false,
      needsSetup: false,
      captchaRuleContent: captchaRuleSeedFor(ctx),
    },
    recaptchaOpt,
  );
  return { on, siteKey: siteKey ?? "" };
}

function createFormWithAlertGuide(ctx: ViewContext): string {
  const fields = ctx.fmt.withNestMode("edit", () =>
    ctx.fmt.renderView("new_fields", {
      buttons_view: ctx.voo.opts["buttons_view"],
      type: ctx.voo.opts["type"],
    }),
  );
  return (
    `<div class="d-flex justify-content-between">` +
    output([fields, ctx.voo.show("guide") ? alertGuide(ctx) : undefined]) +
    `</div>`
  );
}

export const NEW_FIELDS_SENTINEL = "\u0000new_fields-body\u0000";
export const newFieldsView: ViewFn = (ctx) => {
  const open = modSlotWrap(ctx, "new_fields", NEW_FIELDS_SENTINEL, "w-100");
  const body = output([
    undefined,
    newViewName(ctx),
    newViewType(ctx),
    ctx.fmt.renderView("content_formgroups", { skip_perms: true }),
    ctx.fmt.renderView(
      ctx.voo.opts["buttons_view"] === undefined
        ? "new_buttons"
        : String(ctx.voo.opts["buttons_view"]),
      { skip_perms: true },
    ),
  ]);
  return open.split(NEW_FIELDS_SENTINEL).join(body);
};

export const newTypeFormgroupView: ViewFn = (ctx) =>
  typeFormgroup(ctx, {
    href: `/${ctx.fmt.urlKey()}/new_fields`,
    cls: "type-field _live-type-field slotter",
  });

const newInModalButtonsView: ViewFn = ({ fmt, voo }) => {
  voo.classUp("button-form-group", "d-flex");
  return buttonFormGroup(
    { fmt, voo },
    output([standardSaveAndCloseButton("Submit"), modalCancelButton()]),
  );
};

const simpleNewView: ViewFn = (ctx) => {
  withCreateContext(ctx);
  const form = createCardForm(ctx, "", "", createFormWithAlertGuide(ctx));
  return modSlotWrap(ctx, "simple_new", form);
};

export function createFormDataShell(
  ctx: ViewContext,
  formOpts: { success?: Record<string, unknown> },
): string {
  withCreateContext(ctx);
  return createFormShell(ctx, {
    htmlAttrs: [],
    success: formOpts.success,
    body: createFormWithAlertGuide(ctx),
  });
}

export function updateFormDataShell(
  ctx: ViewContext,
  formOpts: { success?: Record<string, unknown> },
): string {
  withCreateContext(ctx);
  return createCardForm(ctx, "", successTags(formOpts.success), createFormWithAlertGuide(ctx));
}
export function createCardBodyShell(
  ctx: ViewContext,
  formOpts: { success?: Record<string, unknown>; body: string },
): string {
  const id = ctx.fmt.card.id;
  if (id === undefined) {
    return createFormShell(ctx, {
      htmlAttrs: [],
      success: formOpts.success,
      body: formOpts.body,
    });
  }
  return cardFormShell(ctx, {
    formClass: "card-form slotter",
    id: `edit_card_${id}`,
    htmlAttrs: [],
    action: "/card/create",
    methodSpoof: "patch",
    success: formOpts.success,
    body: formOpts.body,
  });
}

export const newView: ViewFn = (ctx) => {
  withCreateContext(ctx);
  return framedView(
    ctx,
    "new",
    () =>
      createCardForm(
        ctx,
        ` data-main-success="{&quot;redirect&quot;:true}"`,
        hiddenFieldTag("success[mark]", newSuccessMark(ctx)),
        createFormWithAlertGuide(ctx),
      ),
    { showHelp: true },
  );
};

const newInModalView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const slotOpen = modSlotWrap(ctx, "new_in_modal", NEW_FIELDS_SENTINEL);
  voo.opts["buttons_view"] = "new_in_modal_buttons";
  withCreateContext(ctx);
  const form = createCardForm(
    ctx,
    ` data-slot-selector="modal-origin" data-slot-error-selector=".card-slot"`,
    "",
    createFormWithAlertGuide(ctx),
  );
  const slotDiv = slotOpen.split(NEW_FIELDS_SENTINEL).join(form);
  const menu =
    `<div class="modal-menu _modal-menu ms-auto">` +
    [closeModalLink(), boardLink(fmt, false)].join("\n") +
    `</div>`;
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += "<div class='modal-dialog modal-dialog-centered modal-lg'>\n";
  out += "<div class='modal-content'>\n";
  out += "<div class='modal-header'>\n";
  out += `${newInModalTitle(ctx)}\n`;
  out += `${menu}\n`;
  out += "</div>\n";
  out += `<div class='modal-body'>\n${slotDiv}\n</div>\n`;
  out += "</div>\n</div>\n</div>\n";
  return out;
};

function cancelInPlaceButton(fmt: ViewContext["fmt"]): string {
  return `<a class="cancel-button btn-sm btn btn-secondary slotter" href="/${fmt.urlKey()}" data-remote="true">Cancel</a>`;
}

const editInlineButtonsView: ViewFn = ({ fmt, voo }) =>
  buttonFormGroup(
    { fmt, voo },
    output([
      standardSaveButton(voo),
      voo.show("cancel_button") ? cancelInPlaceButton(fmt) : undefined,
      deleteButton(fmt),
    ]),
  );

const editInlineView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  fmt.addNameContext();
  voo.hide("name_formgroup");
  voo.hide("type_formgroup");
  const form =
    `<form class="card-form slotter autosave" id="edit_card_${fmt.card.id}"` +
    ` action="/update/${fmt.urlKey()}" accept-charset="UTF-8" data-remote="true" method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />` +
    successTags(editSuccess(ctx)) +
    output([
      editViewHidden(ctx),
      fmt.renderView("content_formgroups"),
      fmt.renderView(
        voo.opts["buttons_view"] === undefined
          ? "edit_inline_buttons"
          : String(voo.opts["buttons_view"]),
      ),
    ]) +
    `</form>`;
  return modSlotWrap({ fmt, voo }, "edit_inline", form);
};

const editRowView: ViewFn = ({ fmt, voo }) => {
  const editLink =
    `<a rel="nofollow" class="ms-2 edit-link slotter" data-cy="edit-link"` +
    ` href="/${fmt.urlKey()}/edit_inline" data-remote="true">${icon("edit")}</a>`;
  const inner =
    `<div class='col-2 text-start'>\n<label>\n${fmt.renderView("title")}\n</label>\n</div>\n` +
    `<div class='col-8'>\n${fmt.renderView("core")}\n</div>\n` +
    `<div class='col-2 text-end'>\n${editLink}\n</div>\n`;
  voo.classUp("card-slot", "d-flex form-group");
  return modSlotWrap({ fmt, voo }, "edit_row", inner, "row");
};

const editInFormView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  if (multiCardEditor(ctx)) return multiCardEdit(ctx, true);
  if (fmt.card.name.isCompound) {
    voo.classUp("card-editor", `RIGHT-${fmt.card.name.rightName?.safeKey ?? ""}`);
  }
  const attrs = emitAttrs({
    class: "form-group card-editor",
    "data-card-id": fmt.card.id === undefined ? undefined : String(fmt.card.id),
    "data-card-name": fmt.card.name.s === "" ? undefined : h(fmt.card.name.s),
    "data-card-link-name": h(fmt.urlKey()),
  });
  const label = output([
    voo.show("title") ? fmt.renderView("title") : undefined,
    fmt.renderView("help"),
  ]);
  return (
    `<div${attrs}>` +
    `<label for="card_content">${label}</label>\n` +
    `<div class="editor content-editor">${contentField({ fmt, voo })}</div>` +
    `</div>`
  );
};

function contentHasRealNest(fmt: ViewContext["fmt"]): boolean {
  const content = fmt.card.dbContent ?? "";
  return content.replace(/\{\{#[^}]*\}\}/g, "").includes("{{");
}

const readFormView: ViewFn = () => "";

const readFormgroupView: ViewFn = readFormgroupBody;

function structureLink(): string {
  return (
    `<label>Content</label>` +
    `<p><em>Uneditable; content is <a class="wanted-card" href="/">structured</a> without nests</em></p>`
  );
}

const editNestsView: ViewFn = (ctx) =>
  framedView(ctx, "edit_nests", () =>
    ctx.fmt.withNestMode("edit", () => {
      const body = multiCardEdit(ctx, false);
      return body;
    }),
  );

const editStructureView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*structure")) {
    const ruleCard = ctx.fmt.engine.fetchRenderCard(candidate);
    if (ruleCard === undefined) continue;
    const content = ruleCard.dbContent;
    if (content !== undefined && content.trim() === "_self") {
      return null;
    }
    structureRuleFetchInstances.add(ruleCard);
    return ctx.fmt.nestRecord(ruleCard, "edit");
  }
  return null;
};

export const guideTabView: ViewFn = ({ fmt }) => fmt.renderView("guide");

const overlayGuideView: ViewFn = (ctx) => {
  const inner =
    `<div>\n` +
    `<div class='d-flex ms-2'>\n` +
    `<div class='ms-auto'>\n` +
    `<a data-bs-dismiss="overlay" class="text-dark p-1 ms-1" href="#"><i class="notranslate material-icons">close</i></a>\n` +
    `</div>\n</div>\n` +
    `${guideHelper(ctx)}\n</div>\n`;
  return modSlotWrap(
    ctx,
    "overlay_guide",
    inner,
    "_overlay d0-card-overlay card nodblclick",
  );
};

const BOARD_TABS: ReadonlyArray<readonly [string, string]> = [
  ["Account", "account_tab"],
  ["Guide", "guide_tab"],
  ["Engage", "engage_tab"],
  ["History", "history_tab"],
  ["Related", "related_tab"],
  ["Rules", "rules_tab"],
];

export const BOARD_PILL_UL_CLASSES = "nav nav-pills _auto-single-select board-pills flex-column";
const BOARD_PILL_LI_CLASSES = "nav-item";

export const BOARD_SLOT_SELECTOR =
  ".board-main > .overlay-container > .card-slot._bottomlay-slot," +
  ".board-main > ._overlay-container-placeholder > .card-slot";
const BOARD_SLOT_SELECTOR_ESC = h(BOARD_SLOT_SELECTOR);

function breadcrumbData(title: string, htmlClass?: string): Record<string, string> {
  return {
    "data-breadcrumb": title,
    "data-breadcrumb-class": htmlClass ?? title.toLowerCase().replace(/ /g, "_"),
  };
}

function setCardLabel(setName: string, kind: "self" | "right"): string {
  return kind === "self"
    ? `The card "${setName}"`
    : `All "+${setName}" cards`;
}

function switchToEditLink(fmt: ViewContext["fmt"]): string {
  return (
    `<a rel="nofollow" data-slotter-mode="modal-replace" data-modal-class="modal-lg"` +
    ` class="_confirm slotter"` +
    ` data-confirm-msg="Unsaved changes will be lost. Do you want to proceed?"` +
    ` href="/${fmt.urlKey()}/edit" data-remote="true">${icon("edit")}</a>`
  );
}

function boardMenu(fmt: ViewContext["fmt"]): string {
  return `<div class="modal-menu _modal-menu ms-auto">${[closeModalLink(), switchToEditLink(fmt)].join("\n")}</div>`;
}

function boardBreadcrumbs(cardName: string): string {
  return (
    `<nav aria-label="breadcrumb">\n` +
    `  <ol class="breadcrumb _board-breadcrumb">\n` +
    `    <li class="breadcrumb-item">${h(cardName)}</li>\n` +
    `    <li class="breadcrumb-item active">Edit</li>\n` +
    `  </ol>\n` +
    `</nav>`
  );
}

function boardParts(ctx: ViewContext): string {
  const { fmt, voo } = ctx;
  voo.setViz("edit_type_row", "show");
  voo.classUp("help-text", "alert alert-info");
  return output([
    fmt.renderView("help"),
    fmt.renderView("edit_name_row", { home_view: "edit_name_row", skip_perms: true }),
    fmt.renderView("edit_form", { skip_perms: true }),
  ]);
}

const BOARD_BODY_SENTINEL = "\u0000board-body\u0000";
function boardBody(ctx: ViewContext, view: "board" | "cardboard"): string {
  const { fmt, voo } = ctx;
  return fmt.withNestMode("edit", () => {
    fmt.addNameContext();
    voo.showViz("help");
    const open = modSlotWrap(ctx, view, BOARD_BODY_SENTINEL, "", {
      "data-breadcrumb": "Editing",
      "data-breadcrumb-class": "edit",
    });
    return open.split(BOARD_BODY_SENTINEL).join(boardParts(ctx));
  });
}

const boardBodyView: ViewFn = (ctx) => boardBody(ctx, "board");

function boardModal(ctx: ViewContext, interior: string, sidebar: string): string {
  const { fmt } = ctx;
  let out = "<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n";
  out += "<!-- /, \"data-backdrop\": \"static\"} -->\n";
  out += "<div class='modal-dialog no-gaps modal-dialog-centered modal-full'>\n";
  out += "<div class='modal-content'>\n";
  out += "<div class='modal-header'>\n";
  out += `${boardBreadcrumbs(fmt.card.name.s)}\n`;
  out += `\n${boardMenu(fmt)}\n`;
  out += "</div>\n";
  out += "<div class='modal-body'>\n";
  out += `<div class='board container-fluid'>\n<div class='row'>\n`;
  out += `<div class='col-8 board-main'>\n<div class='_overlay-container-placeholder'>\n`;
  out += `${interior}\n</div>\n</div>\n`;
  out += `<div class='col-4 board-sidebar nodblclick'>\n<div class='_overlay-container-placeholder'>\n`;
  out += `${sidebar}\n</div>\n</div>\n</div>\n</div>\n`;
  out += "\n</div>\n</div>\n</div>\n</div>\n";
  return out;
}

export const boardView: ViewFn = (ctx) => {
  const { voo } = ctx;
  const interior = boardBody(ctx, "board");
  voo.classUp("modal-dialog", "no-gaps");
  voo.setViz("modal_footer", "hide");
  const sidebar = boardTabsView(ctx);
  return boardModal(ctx, interior, sidebar);
};

export const cardboardView: ViewFn = (ctx) => boardBody(ctx, "cardboard");

const BOARD_TABS_SENTINEL = "\u0000board-tabs-active\u0000";

function visibleBoardTabs(ctx: ViewContext): ReadonlyArray<readonly [string, string]> {
  const { fmt } = ctx;
  const real = fmt.card.id !== undefined;
  const signedIn = fmt.engine.viewer?.signedIn === true;
  const showGuide = guideHelper(ctx) !== "";
  const showEngage = real && (signedIn || showDiscussionTab(ctx));
  return BOARD_TABS.filter(([title, view]) => {
    if (view === "guide_tab") return showGuide;
    if (view === "engage_tab") return showEngage;
    if (view === "history_tab" || view === "related_tab") return real;
    if (view === "rules_tab") return true;
    return showAccountTab(ctx);
  });
}

function showAccountTab(ctx: ViewContext): boolean {
  const { fmt } = ctx;
  if (!isAccountHolder(fmt)) return false;
  if (fmt.card.id === undefined) return false;
  const account = fmt.engine.fetchRenderCard(`${fmt.card.name.s}+*account`);
  return account !== undefined && account.id !== undefined;
}

function isAccountHolder(fmt: ViewContext["fmt"]): boolean {
  return fmt.card.typeCode === "user" || fmt.card.typeCode === "signup" ||
    fmt.card.record.codename === "decko_bot";
}

function showDiscussionTab(ctx: ViewContext): boolean {
  const { fmt } = ctx;
  if (fmt.engine.viewer?.signedIn !== true) return false;
  if (fmt.card.id === undefined) return false;
  const name = fmt.card.name;
  if (name.isCompound && name.tagKey === "discussion") return false;
  return true;
}

function boardTabsView(ctx: ViewContext): string {
  const { fmt } = ctx;
  const visible = visibleBoardTabs(ctx);
  const currentAccount =
    isAccountHolder(fmt) && fmt.card.id !== undefined && fmt.engine.viewer?.actorId === fmt.card.id;
  const activeName =
    (currentAccount ? visible.find(([, view]) => view === "account_tab")?.[0] : undefined) ??
    visible.find(([, view]) => view === "guide_tab")?.[0] ??
    visible.find(([, view]) => view === "engage_tab")?.[0] ??
    "";
  const activeView = BOARD_TABS.find(([t]) => t === activeName)?.[1] ?? "";
  const tabs = visible.map(([title, view]) => {
    const id = `tab-${fmt.uniqueId()}-${DeckoName.parse(title).safeKey}`;
    return { title, view, id, active: title === activeName };
  });
  const buttons = tabs
    .map((tab) => {
      const cls = tab.active ? "active nav-link" : "load nav-link";
      return (
        `<li role="presentation" class="nav-item tab-li-${DeckoName.parse(tab.title).key}">` +
        `<a data-url="/${fmt.urlKey()}/${tab.view}" class="${cls}" role="tab"` +
        ` data-bs-toggle="tab" data-tab-name="${tab.title}" href="#${tab.id}">${tab.title}</a></li>`
      );
    })
    .join("\n");
  const panes = tabs
    .map((tab) => {
      const content = tab.active ? BOARD_TABS_SENTINEL : "";
      return (
        `<div role="tabpanel" id="${tab.id}"` +
        ` class="tab-pane tab-pane-${tab.title}${tab.active ? " active" : ""}">${content}</div>`
      );
    })
    .join("\n");
  const tabPanel =
    `<div class='tabbable tab-panel' role='tabpanel'>\n` +
    `<ul class='nav nav-tabs' role='tablist'>\n${buttons}\n</ul>\n` +
    `<div class='tab-content'>\n${panes}\n</div>\n</div>\n`;
  const activeContent =
    activeView === "" ? "" : str(fmt.renderView(activeView));
  return modSlotWrap(ctx, "board", tabPanel.replace(BOARD_TABS_SENTINEL, activeContent));
}

export const rulesTabView: ViewFn = ({ fmt, voo }) => {
  voo.classUp("card-slot", "flex-column");
  const sets: Array<{ name: string; kind: "self" | "right" }> = [
    { name: `${fmt.card.name.s}+*self`, kind: "self" },
  ];
  if (fmt.card.id !== undefined && !fmt.card.name.isCompound) {
    sets.push({ name: `${fmt.card.name.s}+*right`, kind: "right" });
  }
  const options = [`<option value=""></option>`]
    .concat(
      sets.map(
        (set) =>
          `<option value="${DeckoName.parse(set.name).urlKey}">${h(setCardLabel(fmt.card.name.s, set.kind))}</option>`,
      ),
    )
    .join("\n");
  const select2Id = `${fmt.uniqueId()}-${Math.floor(cardWallClockNow().getTime() / 1000)}`;
  const inner =
    `<form role="filter" data-slot-selector=".card-slot._fixed-slot"` +
    ` class="nodblclick slotter" action="/?view=filtered_accordion_rule_list"` +
    ` accept-charset="UTF-8" data-remote="true" method="get">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<select name="mark" id="mark"` +
    ` class="_submit-on-select form-control _close-rule-overlay-on-select"` +
    ` data-minimum-results-for-search="Infinity" data-placeholder="Select set"` +
    ` data-select2-id="${select2Id}">${options}</select>\n` +
    `<div class="card-slot _fixed-slot"></div></form>`;
  return modSlotWrap({ fmt, voo }, "rules_tab", inner);
};

const RELATED_BY_NAME: ReadonlyArray<readonly [string, string]> = [["children", "*children"]];
const RELATED_BY_CONTENT: ReadonlyArray<readonly [string, string]> = [
  ["links out", "*links_to"],
  ["links in", "*linked_to_by"],
  ["nests", "*nests"],
  ["nested by", "*nested_by"],
  ["references out", "*refers_to"],
  ["references in", "*referred_to_by"],
];

function boardPillItem(text: string, markUrlKey: string): string {
  const cy = `${DeckoName.parse(text).key}-pill`;
  return (
    `<li class="nav-item">` +
    `<a data-slot-selector="${BOARD_SLOT_SELECTOR_ESC}" data-slotter-mode="override"` +
    ` class="slotter nav-link known-card" data-bs-toggle="pill"` +
    ` data-breadcrumb="Related" data-breadcrumb-class="related"` +
    ` data-cy="${cy}"` +
    ` href="/${markUrlKey}/content?layout=overlay&amp;slot%5Bitems%5D%5Bview%5D=closed"` +
    ` data-remote="true">${text}</a></li>`
  );
}

export const relatedTabView: ViewFn = ({ fmt }) => {
  const sections: Array<[string, string[]]> = [];
  sections.push([
    "by name",
    RELATED_BY_NAME.map(([text, right]) => {
      const mark = `${fmt.card.name.s}+${right}`;
      return boardPillItem(text, DeckoName.parse(mark).urlKey);
    }),
  ]);
  sections.push([
    "by content",
    RELATED_BY_CONTENT.map(([text, right]) => {
      const mark = `${fmt.card.name.s}+${right}`;
      return boardPillItem(text, DeckoName.parse(mark).urlKey);
    }),
  ]);
  const typeName = fmt.card.typeName ?? "";
  sections.push([
    "by type",
    [
      boardPillItem(
        `${typeName} cards`,
        DeckoName.parse(`${typeName}+*type+by_name`).urlKey,
      ),
    ],
  ]);
  return (
    `<ul class="${BOARD_PILL_UL_CLASSES}">` +
    sections
      .map(
        ([title, items]) =>
          `<h6 class="ms-1 mt-3">${title}</h6>${items.join("\n")}`,
      )
      .join("\n") +
    `</ul>`
  );
};

export const historyTabView: ViewFn = ({ fmt, voo }) => {
  voo.classUp("d0-card-body", "history-slot");
  voo.hide("act_legend");
  const reader = fmt.engine.historyRenderReader?.();
  const acts = reader?.acts ?? [];
  const total = acts.length;
  let seq = total;
  const items = acts
    .map((act) => {
      const thisSeq = seq;
      seq -= 1;
      const actorId = Number(act.actor_id);
      const actor = reader?.cardInfo(actorId);
      const actorName = actor?.name ?? String(actorId);
      const actedAt = act.acted_at;
      const agoDate =
        actedAt === null || actedAt === undefined
          ? undefined
          : new Date(
              Date.UTC(
                +actedAt.slice(0, 4),
                +actedAt.slice(5, 7) - 1,
                +actedAt.slice(8, 10),
                +actedAt.slice(11, 13),
                +actedAt.slice(14, 16),
                +actedAt.slice(17, 19),
              ),
            );
      const ago = agoDate === undefined ? "" : `${timeAgoInWords(agoDate)} ago`;
      const summary =
        reader === undefined
          ? ""
          : actSummaryBadge(reader, reader.actionsAffecting(Number(act.id), reader.rootCardId!));
      const title =
        `<div class="me-2">#${thisSeq} ${h(actorName)} <small>${ago}</small></div>` +
        `<div class="ms-auto act-summary">${summary}</div>`;
      const markUrl = fmt.urlKey();
      return (
        `<li class="nav-item">` +
        `<a data-bs-toggle="pill" data-slot-selector="${BOARD_SLOT_SELECTOR_ESC}"` +
        ` data-slotter-mode="override" class="slotter d-flex nav-link known-card"` +
        ` href="/${markUrl}/board_act?act_id=${act.id}&amp;act_seq=${thisSeq}` +
        `&amp;slot%5Bitems%5D%5Bview%5D=closed" data-remote="true">${title}</a></li>`
      );
    })
    .join("\n");
  const body = output([
    fmt.renderView("creator_credit"),
    `<ul class="${BOARD_PILL_UL_CLASSES}">${items}</ul>`,
  ]);
  return modSlotWrap({ fmt, voo }, "history_tab", body);
};

export function followButton(
  bundle: { session: { actorName: string } | undefined; followed: boolean; followLabel: string },
  cardName: string,
): string {
  const ruleName = DeckoName.parse(
    `${cardName}+*self+${bundle.session?.actorName ?? ""}+*follow`,
  ).urlKey;
  const start = !bundle.followed;
  const title = start
    ? `send emails about changes to ${bundle.followLabel}`
    : `stop sending emails about changes to ${bundle.followLabel}`;
  const cssClass = start
    ? "follow-link  slotter btn btn-sm btn-primary"
    : "follow-link btn-item-delete slotter btn btn-sm btn-primary";
  const verb = start ? "follow" : "following";
  const option = start ? "always" : "never";
  const hover = start ? "" : ` data-hover-text="unfollow"`;
  const successMark = cardName.replace(/ /g, "\u0000").replace(/\+/g, "%2B").replace(/\u0000/g, "+");
  const href =
    `/update/${ruleName}` +
    `?card%5Bcontent%5D=%5B%5B%2A${option}%5D%5D` +
    `&amp;success%5Bmark%5D=${successMark}` +
    `&amp;success%5Bview%5D=follow_section`;
  return (
    `<a title="${title}" class="${cssClass}"` +
    ` data-update-foreign-slot=".d0-card-body &gt; .card-slot.RIGHT-Xfollower.content-view"` +
    `${hover} href="${href}" data-remote="true">` +
    `<span class="follow-verb">${verb}</span></a>`
  );
}

function followAdvanced(cardName: string, actorName: string): string {
  const ruleUrl = DeckoName.parse(
    `${cardName}+*self+${actorName}+*follow`,
  ).urlKey;
  return (
    `<a class="btn btn-sm btn-primary slotter wanted-card" data-cy="follow-advanced"` +
    ` data-slot-selector="${BOARD_SLOT_SELECTOR_ESC}" data-slotter-mode="override"` +
    ` href="/${ruleUrl}/overlay_rule?slot%5Bitems%5D%5Bview%5D=closed" data-remote="true">` +
    `<i class="notranslate material-icons">more_horiz</i></a>`
  );
}

function followersBoardLink(cardName: string, count: number): string {
  const markUrl = DeckoName.parse(`${cardName}+*followers`).urlKey;
  const label = `${count} follower${count === 1 ? "" : "s"}`;
  return (
    `<a class="btn btn-sm ms-2 btn-secondary slotter slotter known-card" data-cy="followers"` +
    ` data-slot-selector="${BOARD_SLOT_SELECTOR_ESC}" data-slotter-mode="override"` +
    ` href="/${markUrl}/content?layout=overlay&amp;slot%5Bitems%5D%5Bview%5D=closed"` +
    ` data-remote="true">${label}</a>`
  );
}

function followOverviewButton(actorName: string, known: boolean): string {
  const markUrl = DeckoName.parse(`${actorName}+*follow`).urlKey;
  return (
    `<a class="btn btn-sm btn-secondary slotter ${known ? "known-card" : "wanted-card"}" data-cy="follow-overview"` +
    ` data-slot-selector="${BOARD_SLOT_SELECTOR_ESC}" data-slotter-mode="override"` +
    ` href="/${markUrl}/content?layout=overlay&amp;slot%5Bitems%5D%5Bview%5D=closed"` +
    ` data-remote="true">all followed cards</a>`
  );
}

export const followSectionView: ViewFn = ({ fmt, voo }) => {
  const signedIn = fmt.engine.viewer?.signedIn === true;
  let body = "";
  if (signedIn && fmt.card.id !== undefined) {
    const bundle = fmt.engine.followRenderBundle?.();
    if (bundle !== undefined && bundle.session !== undefined) {
      const cardName = fmt.card.name.s;
      const group =
        `<div class="btn-group btn-group-sm follow-btn-group">` +
        [
          followButton(bundle, cardName),
          followAdvanced(cardName, bundle.session.actorName),
        ].join("\n") +
        `</div>`;
      body =
        `<div class="mb-3">` +
        output([
          group,
          followersBoardLink(cardName, bundle.followerCount),
          followOverviewButton(
            bundle.session.actorName,
            fmt.engine.fetchRenderCard(`${bundle.session.actorName}+*follow`) !==
              undefined,
          ),
        ]) +
        `</div>`;
    }
  }
  return modSlotWrap({ fmt, voo }, "follow_section", body);
};

export const engageTabView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const follow = fmt.renderView("follow_section");
  const discussion = showDiscussionTab(ctx)
    ? fmt.nest({
        syntax: "",
        name: `${fmt.card.name.s}+discussion`,
        options: {
          view: "titled",
          title: "Discussion",
          show: "comment_box",
          hide: "menu",
          extra: {},
        },
        comment: undefined,
      })
    : undefined;
  return `<div class="m-3 mt-4 _engage-tab">${output([follow, discussion])}</div>`;
};

const RULE_BOARD_SETTINGS: ReadonlyArray<
  readonly [
    string,
    ReadonlyArray<readonly [string, string, string, string, string]>,
  ]
> = [
  [
    "templating",
    [
      ["structure", "structure", "structure", "all common", "control card's content / structure"],
      ["default", "default", "default", "all field common", "type/content template for new cards"],
      ["autoname", "autoname", "autoname", "all", ""],
    ],
  ],
  [
    "permission",
    [
      ["create", "create", "create", "all common", "who can create cards"],
      ["read", "read", "read", "all common", "who can view cards"],
      ["update", "update", "update", "all common", "who can update cards"],
      ["delete", "delete", "delete", "all common", "who can delete cards"],
      ["captcha", "captcha", "captcha", "all", ""],
    ],
  ],
  [
    "webpage",
    [
      ["head", "head", "head", "all", "head tag content"],
      ["layout", "layout", "layout", "all", ""],
      ["style", "style", "style", "all", ""],
      ["script", "script", "script", "all", ""],
    ],
  ],
  [
    "editing",
    [
      ["help", "help", "help", "all field", "help text people will see when editing"],
      ["input type", "input_type", "input_type", "all field", "edit interface"],
      ["guide", "guide", "guide", "all common", "appears in the full editor view to guide users"],
    ],
  ],
  [
    "event",
    [
      ["on create", "on_create", "on_create", "all", ""],
      ["on update", "on_update", "on_update", "all", ""],
      ["on delete", "on_delete", "on_delete", "all", ""],
    ],
  ],
  [
    "other",
    [
      ["thanks", "thanks", "thank", "all", "destination after card is created"],
      ["follow fields", "follow_fields", "follow_field", "all", ""],
      ["follow", "follow", "follow", "all", ""],
    ],
  ],
];

function recentCategoryNames(ctx: ViewContext): Set<string> {
  const list = ctx.fmt.engine.fetchRenderCard("*recent settings");
  const items = new Set<string>();
  if (list === undefined || list.unknown === true) return items;
  for (const line of list.dbContent.split("\n")) {
    const item = line.trim();
    if (item === "") continue;
    items.add(item.replace(/^\*/, "").toLowerCase().replace(/ +/g, "_"));
  }
  return items;
}

function ruleBoardPill(
  setNameUrlKey: string,
  settingName: string,
  ruleCodename: string,
  cyKey: string,
  categories: string,
  helpText: string,
): string {
  const ruleUrl = DeckoName.parse(`${setNameUrlKey}+*${ruleCodename}`).urlKey;
  return (
    `<li class="nav-item">` +
    `<a rel="nofollow" class="edit-rule-link nav-link _rule-item ${categories
      .split(" ")
      .map((c) => `_category-${c}`)
      .join(" ")} slotter slotter"` +
    ` data-bs-toggle="pill" data-category="${categories}"` +
    ` data-cy="${cyKey}-pill"` +
    ` data-slot-selector="${BOARD_SLOT_SELECTOR_ESC}" data-slotter-mode="override"` +
    ` href="/${ruleUrl}/overlay_rule?slot%5Bitems%5D%5Bview%5D=closed" data-remote="true">` +
    `${settingName}<div class="help-text">${helpText}</div></a></li>`
  );
}

const editRulesView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const setName = `${fmt.card.name.s}+*self`;
  const setNameUrlKey = DeckoName.parse(setName).urlKey;
  const setSafeKey = `${fmt.card.name.safeKey}-Xself`;
  const radios = [
    ["all", "All", false],
    ["common", "Common", true],
    ["field", "Field", false],
    ["recent", "Recent", false],
  ] as const;
  const filterForm =
    `<form role="filter" data-slot-selector=".card-slot._setting-list"` +
    ` class="nodblclick slotter" action="/?view=accordion_rule_list"` +
    ` accept-charset="UTF-8" data-remote="true" method="get">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<div class="my-4 mx-2 _setting-filter"><label>Settings</label>\n` +
    radios
      .map(
        ([id, label, checked]) =>
          `<input type="radio" class="btn-check _setting-category" name="options" id="${id}" autocomplete="off" ${checked ? "checked" : ""}>\n` +
          `<label class="btn btn-outline-primary" for="${id}">${label}</label>\n`,
      )
      .join("\n") +
    `</div></form>`;
  const groups = RULE_BOARD_SETTINGS.map(([group, settings]) => {
    const pills = settings
      .map(([name, codename, cy, cats, help]) => {
        const parts = cats.split(" ");
        const recent = recentCategoryNames(ctx);
        const withRecent = recent.has(codename)
          ? [
              ...parts.filter((c) => c !== "common"),
              "recent",
              ...parts.filter((c) => c === "common"),
            ].join(" ")
          : cats;
        return ruleBoardPill(setNameUrlKey, name, codename, cy, withRecent, help);
      })
      .join("\n");
    const collapseId = `card-${setSafeKey}-${group}-collapse-id`;
    const accordionButtonClass = serializerFollowsLive()
      ? "accordion-button collapsed"
      : "collapsed accordion-button";
    return (
      `<div class='accordion-item _setting-group _setting-list'>\n` +
      `<h2 class='accordion-header nodblclick w-100'>\n` +
      `<button class='${accordionButtonClass}' data-bs-target='#${collapseId}' data-bs-toggle='collapse' type='button'>\n` +
      `${group} <span class="_count badge bg-secondary ms-3">${settings.length}</span>\n` +
      `</button>\n</h2>\n` +
      `<div class='accordion-collapse collapse' id='${collapseId}'>\n` +
      `<div class='${serializerFollowsLive() ? "d0-card-body accordion-body" : "accordion-body d0-card-body"}'>\n` +
      `<ul class="${BOARD_PILL_UL_CLASSES}">${pills}</ul>\n` +
      `</div>\n</div>\n</div>\n`
    );
  }).join("\n");
  const inner =
    filterForm +
    "\n" +
    `<div class="_setting-list"><div class="accordion bar-accordion">` +
    groups +
    `</div></div>`;
  const setRecord = fmt.engine.fetchRenderCard(setName);
  const leftTypeCode = DeckoName.parse(fmt.card.typeName ?? "RichText").key;
  const setKeys =
    `ALL ALL_PLUS TYPE-set RSTAR RIGHT-Xself TYPE_PLUS_RIGHT-${leftTypeCode}-Xself` +
    (setRecord !== undefined
      ? ` SELF-${setRecord.name.safeKey}`
      : "");
  const classes =
    `card-slot board_rules_tab-view ${setKeys} d-flex flex-column gap-3 mx-3 mt-2`;
  const slotData = h(slotOptionsJson({
    view: "board_rules_tab",
    nest_name: setName,
    show: ["board_rules_tab"],
    home_view: "board_rules_tab",
  } as never));
  return (
    `<div id="${setSafeKey}-board_rules_tab-view" class="${classes}"` +
    (setRecord !== undefined && setRecord.id !== undefined
      ? ` data-card-id="${setRecord.id}"`
      : "") +
    ` data-card-name="${h(
      setRecord !== undefined && setRecord.id !== undefined ? setName : DeckoName.parse(setName).urlKey,
    )}"` +
    ` data-card-type-id="5" data-card-type-name="Set"` +
    ` data-card-link-name="${h(DeckoName.parse(setName).urlKey)}"` +
    ` data-slot-id="${newSlotId()}"` +
    ` data-slot="${slotData}">${inner}</div>`
  );
};

async function prepareInputTypeRules(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const setTypeId = host.codenames.peekId("set");
  const settingTypeId = host.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return;
  const results = await host.batch([
    ruleSidesStatement(setTypeId, settingTypeId, ["input_type"]),
  ]);
  type FetchedRow = {
    id: number;
    leftId: number | null;
    rightId: number | null;
    name: string | null;
  };
  const rows = (results[0] as { rows: FetchedRow[] } | undefined)?.rows ?? [];
  if (rows.length === 0) return;

  interface PreparedRecord {
    row: FetchedRow;
    record: NonNullable<Awaited<ReturnType<ModEngineHost["fetchById"]>>>;
  }
  const byId = new Map<number, PreparedRecord>();
  for (const row of rows) {
    const record = await host.fetchById(row.id);
    if (record === undefined) continue;
    byId.set(row.id, {
      row: {
        id: row.id,
        leftId: record.leftId ?? null,
        rightId: record.rightId ?? null,
        name: record.name?.s ?? null,
      },
      record,
    });
  }

  const names = new Map<number, string>();
  let pending = [...byId.values()];
  for (let pass = 0; pass < 64 && pending.length > 0; pass++) {
    const still: PreparedRecord[] = [];
    for (const item of pending) {
      const row = item.row;
      let composed: string | undefined = row.name ?? undefined;
      if (composed === undefined && row.leftId !== null && row.rightId !== null) {
        const left = names.get(row.leftId);
        const right = names.get(row.rightId);
        if (left !== undefined && right !== undefined) composed = `${left}+${right}`;
      }
      if (composed === undefined) {
        still.push(item);
        continue;
      }
      names.set(row.id, composed);
    }
    if (still.length === pending.length) break;
    pending = still;
  }

  const markKeys = new Set<string>();
  for (const item of byId.values()) {
    const composed = names.get(item.row.id);
    if (composed === undefined) continue;
    if (item.row.name === null) {
      item.record.name = DeckoName.parse(composed);
      item.record.key = DeckoName.parse(composed).key;
    }
    const mark = inputTypeFromRule(item.record.dbContent);
    if (mark !== undefined && mark !== "") markKeys.add(mark);
    await host.cacheFetchedRecord(item.record);
  }

  if (markKeys.size === 0) return;
  const placeholders = [...markKeys].map(() => "?").join(",");
  const markResults = await host.batch([
    {
      sql: `SELECT id FROM cards WHERE key IN (${placeholders}) AND trash = 0`,
      params: [...markKeys],
    },
  ]);
  const markRows = (markResults[0] as { rows: { id: number }[] } | undefined)?.rows ?? [];
  for (const markRow of markRows) {
    const record = await host.fetchById(markRow.id);
    if (record !== undefined) await host.cacheFetchedRecord(record);
  }
}

const setModules: ModSetModuleFile[] = [
  {
    setPath: "all/board",
  },
  {
    setPath: "all/board/board_pills",
  },
  {
    setPath: "all/board/follow_section",
  },
  {
    setPath: "all/board/related_section",
  },
  {
    setPath: "all/board/tab_views",
    formats: {
      html: {
        views: [
          { view: "guide_tab", viewFn: guideTabView, config: { unknown: true } },
          { view: "rules_tab", viewFn: rulesTabView, config: { unknown: true } },
          { view: "related_tab", viewFn: relatedTabView },
          {
            view: "history_tab",
            viewFn: historyTabView,
            config: { wrap: "slot" },
          },
          {
            view: "follow_section",
            viewFn: followSectionView,
            config: { cache: "never", wrap: "slot" },
          },
          {
            view: "engage_tab",
            viewFn: engageTabView,
            config: { cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/board/tab_visibility",
  },
  {
    setPath: "all/edit_content",
    formats: {
      html: {
        views: [
          {
            view: "edit_form",
            viewFn: editFormView,
            config: { cache: "never", wrap: "slot" },
          },
          {
            view: "edit",
            viewFn: editView,
            config: { perms: "update", unknown: true, cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/edit_inline",
    formats: {
      html: {
        views: [
          { view: "edit_name_row", viewFn: editNameRowView },
          {
            view: "edit_inline",
            viewFn: editInlineView,
            config: { perms: "update", unknown: true, cache: "never", wrap: "slot" },
          },
          { view: "edit_inline_buttons", viewFn: editInlineButtonsView },
          { view: "edit_row", viewFn: editRowView },
        ],
      },
    },
  },
  {
    setPath: "all/edit_name",
    formats: {
      html: {
        views: [
          {
            view: "edit_name",
            viewFn: editNameView,
            config: { perms: "update" },
          },
          {
            view: "name_form",
            viewFn: nameFormView,
            config: { perms: "update", wrap: "slot", cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/edit_type",
    formats: {
      html: {
        views: [
          { view: "edit_type_row", viewFn: editTypeRowView },
          {
            view: "edit_type",
            viewFn: editTypeView,
            config: { perms: "update", cache: "never" },
          },
          {
            view: "edit_type_form",
            viewFn: editTypeFormView,
            config: { perms: "update", wrap: "slot", cache: "never" },
          },
          { view: "type_formgroup", viewFn: typeFormgroupView },
          {
            view: "board_type_formgroup",
            viewFn: boardTypeFormgroupView,
            config: { unknown: true, wrap: "slot" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/editing",
    formats: {
      html: {
        views: [
          {
            view: "board",
            viewFn: boardView,
            config: { perms: "update", unknown: true, cache: "never" },
          },
          {
            view: "cardboard",
            viewFn: cardboardView,
            config: { unknown: true, cache: "never" },
          },
          { view: "edit_buttons", viewFn: editButtonsView },
          { view: "just_deleted", viewFn: justDeletedView, config: { unknown: true } },
          { view: "edit_nests", viewFn: editNestsView, config: { cache: "never" } },
          { view: "edit_structure", viewFn: editStructureView, config: { cache: "never" } },
          {
            view: "edit_rules",
            viewFn: editRulesView,
            config: { cache: "never", unknown: true },
          },
        ],
      },
    },
  },
  {
    setPath: "all/editor",
    formats: {
      html: {
        views: [
          {
            view: "input",
            viewFn: inputView,
            config: { unknown: true, cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/form",
    formats: {
      html: {
        views: [
          {
            view: "content_formgroups",
            viewFn: contentFormgroupsView,
            config: { unknown: true, cache: "never" },
          },
          {
            view: "content_formgroup",
            viewFn: contentFormgroupView,
            config: { unknown: true, cache: "never" },
          },
          {
            view: "conflict_tracker",
            viewFn: conflictTrackerView,
            config: { unknown: true, cache: "never" },
          },
          { view: "name_formgroup", viewFn: nameFormgroupView },
          {
            view: "edit_in_form",
            viewFn: editInFormView,
            config: { perms: "update", unknown: true, cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/form_buttons",
  },
  {
    setPath: "all/form_elements",
  },
  {
    setPath: "all/formgroup",
    formats: {
      html: {
        views: [
          { view: "read_form", viewFn: readFormView },
          {
            view: "read_formgroup",
            viewFn: readFormgroupView,
            config: { unknown: true, wrap: "slot" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/new",
    formats: {
      html: {
        views: [
          {
            view: "new",
            viewFn: newView,
            config: { perms: "create", unknown: true, cache: "never" },
          },
          {
            view: "new_in_modal",
            viewFn: newInModalView,
            config: { perms: "create", unknown: true, cache: "never" },
          },
          {
            view: "new_fields",
            viewFn: newFieldsView,
            config: { perms: "create", unknown: true, cache: "never" },
          },
          {
            view: "new_type_formgroup",
            viewFn: newTypeFormgroupView,
          },
          { view: "new_buttons", viewFn: newButtonsView },
          { view: "new_in_modal_buttons", viewFn: newInModalButtonsView },
          {
            view: "simple_new",
            viewFn: simpleNewView,
            config: { perms: "create", unknown: true, wrap: "slot", cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/overlay_guide",
    formats: {
      html: {
        views: [
          {
            view: "overlay_guide",
            viewFn: overlayGuideView,
            config: { unknown: true, cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "all/template_nest",
    formats: {
      html: {
        views: [
          {
            view: "template_nest",
            viewFn: templateNestView,
            config: { unknown: true, cache: "never" },
          },
        ],
      },
    },
  },
  {
    setPath: "right/input_type",
  },
  {
    setPath: "right/thanks",
  },
  {
    setPath: "self/input_type",
    settingOpts: {
      group: "editing",
      position: 3,
      ruleTypeEditable: false,
      shortHelpText: "edit interface",
    },
  },
  {
    setPath: "type/list",
  },
  {
    setPath: "type/plain_text",
  },
  {
    setPath: "type/pointer",
  },
];

async function prepareEditRules(host: ModEngineHost): Promise<void> {
  await prepareInputTypeRules(host);
  await host.codenames.ensureLoaded();
  const setTypeId = host.codenames.peekId("set");
  const settingTypeId = host.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return;
  await warmRuleCards(host, setTypeId, settingTypeId, ["thanks"]);
}

const cardModEdit: DeckoModManifest = {
  name: "edit",
  gemName: "card-mod-edit",
  group: "gem",
  setModules,
  prepareEngine: prepareEditRules,
};

export default cardModEdit;
