import { str } from "../../render/format.js";

import {
  RenderFormat,
  Voo,
  virtualSearchKnownName,
  type RenderCard,
  type ViewContext,
  type ViewFn,
} from "../../render/format.js";
import { modSlotWrap, viewWrapInherited } from "../mod-view-helpers.js";
import { toPointerContent, type ContentFn } from "../../render/content-overrides.js";
import { HTML_VIEWS, lastActionVerbNotifyView } from "../../render/views.js";
import { DeckoName } from "../../name.js";
import { safeSetKeys } from "../../render/set-keys.js";
import { h } from "../../render/slot-html.js";
import { actionTypeFromCode } from "../../history/action.js";
import type { HistoryRenderReader } from "../../history/render-seam.js";
import type { HistoryActionRow } from "./card-mod-history.js";
import type {
  CardRecord,
} from "../../fetch/card-record.js";
import { followRuleNameFor, followSetCardName } from "../../follow/follow-rule-walk.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import type { PatternCardInput } from "../../set-patterns/types.js";import {
  engineOwnedEvent,
  type DeckoModManifest,
  type ModEventCard,
  type ModEventFn,
  type ModEventRegistration,
  type ModSetModuleFile,
} from "../mod-manifest.js";
import { parseSetName } from "../../set-patterns/set-name.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}
import {
  cardFormOpen,
  CARD_FORM_CLOSE,
  followPath,
  hiddenTags,
  linkTo,
  output,
} from "../../follow/follow-form-shapes.js";
import type {
  FollowRenderBundle,
  FollowTabRow,
} from "../../follow/follow-render-seam.js";
import { errorsBaseView as formatErrorsView } from "./card-mod-format.js";
import { tabsPanel } from "./card-mod-tabs.js";
import { editModalWrapper, followButton } from "./card-mod-edit.js";

const BASE_CORE: ViewFn | undefined = HTML_VIEWS["core"];

const followersCoreView: ViewFn = (ctx) => {
  if (BASE_CORE === undefined) return "";
  return BASE_CORE(ctx);
};

const followersContentFn: ContentFn = (fmt) => {
  const names = fmt.engine.followRenderBundle?.()?.followerNames;
  if (names === undefined || names.length === 0) return "";
  return toPointerContent(names);
};

const userFollowContentFn: ContentFn = (fmt) =>
  toPointerContent(fmt.engine.followRenderBundle?.()?.followPreferenceNames ?? []);

const followingStatusView: ViewFn = () => "No following preference";

const followingOneLineContentView: ViewFn = (ctx) => viewWrapInherited(ctx, "one_line_content", "");

const followingCoreView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const leftName = fmt.card.name.leftName?.s;
  const signedIn =
    fmt.engine.viewer?.signedIn === true || fmt.engine.pageSession?.signedIn === true;
  const left = leftName !== undefined ? fmt.engine.fetchRenderCard(leftName) : undefined;
  if (left !== undefined && left.unknown !== true && signedIn) {
    return str(fmt.renderView("rule_editor"));
  }
  if (leftName === undefined) {
    return "";
  }
  const followersCard = newCardRenderCard(
    `${leftName}+*followers`,
    followersTemplateType(fmt),
    undefined,
    false,
  );
  const sub = new RenderFormat(followersCard, fmt.engine, { parent: fmt });
  return str(sub.renderView("titled", { items: { view: "link" } }));
};

function followersTemplateType(fmt: ViewContext["fmt"]): {
  typeId?: number;
  typeName: string;
  typeCode?: string;
} {
  const rich = fmt.engine.fetchRenderCard("RichText");
  if (rich !== undefined && rich.id !== undefined && rich.unknown !== true) {
    return { typeId: rich.id, typeName: rich.typeName ?? "RichText", typeCode: rich.typeCode };
  }
  return { typeName: "RichText" };
}

const userFollowOneLineContentView: ViewFn = (ctx) => viewWrapInherited(ctx, "one_line_content", "");

const userFollowEditView: ViewFn = ({ fmt }) => editModalWrapper(fmt, str(fmt.renderView("open")));

const confirmUpdateAllView: ViewFn = (ctx) => {
  const alert =
    `<div class="alert alert-info" role="alert">` +
    `\n          <h1>Are you sure you want to change the default follow rules?</h1>` +
    `\n          <p>You may choose to update all existing users.` +
    `\n             This may take a while. </p>\n        ` +
    `</div>`;
  return modSlotWrap(ctx, "confirm_update_all", alert);
};

function setFollowLabel(ruleSetName: string): string {
  const parsed = parseSetName(ruleSetName);
  return parsed.spec ? parsed.spec.shortLabel(parsed.anchorName?.s) : "";
}

function setPrototypeKey(ruleSetName: string): string {
  const parsed = parseSetName(ruleSetName);
  const anchor = parsed.anchorName?.s ?? "";
  const tag = DeckoName.parse(anchor).tagName?.s ?? anchor;
  const prototypeName: Record<string, string | undefined> = {
    all: undefined,
    all_plus: "+",
    type: undefined,
    star: "*dummy",
    rstar: "*dummy+*dummy",
    rule: "*all+*create",
    right: `*dummy+${anchor}`,
    type_plus_right: `+${tag}`,
    self: anchor,
  };
  const name = prototypeName[parsed.patternCode ?? ""];
  return name === undefined ? "" : DeckoName.parse(name).key;
}

function followItemLinkTarget(ruleSetName: string): string {
  const name = DeckoName.parse(ruleSetName);
  const tag = name.tagName;
  if (tag !== undefined && tag.s === "*self" && !name.isSimple) {
    return name.leftName?.s ?? ruleSetName;
  }
  return `${ruleSetName}+by name`;
}

function ruleSetNameOf(ruleCardName: string): string {
  const name = DeckoName.parse(ruleCardName);
  const parts = name.partNames;
  if (parts.length >= 3) {
    return parts.slice(0, parts.length - 2).map((p) => p.s).join("+");
  }
  return name.leftName?.s ?? ruleCardName;
}

function followRuleItems(card: RenderCard): string[] {
  return card.dbContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function followItemHiddenTags(card: RenderCard, condition: string): string {
  const addFollowItem =
    card.id === undefined || !followRuleItems(card).includes(condition);
  const condkey = addFollowItem ? "add_item" : "drop_item";
  return hiddenTags({ condition, [condkey]: condition });
}

function followItemButton(card: RenderCard, condition: string): string {
  const add =
    card.id === undefined || !followRuleItems(card).includes(condition);
  const cls = add ? "btn-item-add" : "btn-item-delete btn-primary";
  const icon = add ? "add" : "check";
  return (
    `<button name="button" type="submit" aria-label="Left Align"` +
    ` class="btn-sm btn-item ${cls} btn btn-primary">` +
    `<i class="notranslate material-icons">${icon}</i></button>`
  );
}

function followItemLink(fmt: RenderFormat, ruleSetName: string): string {
  const target = followItemLinkTarget(ruleSetName);
  const targetName = DeckoName.parse(target);
  const targetCard = fmt.engine.fetchRenderCard(targetName.key);
  const known =
    (targetCard !== undefined && targetCard.unknown !== true) ||
    virtualSearchKnownName(target, fmt.engine) !== undefined;
  return linkTo(setFollowLabel(ruleSetName), followPath(targetName.urlKey), {
    class: known ? "known-card" : "wanted-card",
  });
}

function followItemFormBytes(
  fmt: RenderFormat,
  condition: string,
  button: boolean,
): string {
  const card = fmt.card;
  return (
    cardFormOpen({
      formId: card.id !== undefined ? `edit_card_${card.id}` : "new_card",
      action: followPath(card.name.urlKey, {
        action: "update",
        query: { "success[view]": "follow_item" },
      }),
      classes: "card-form slotter",
    }) +
    output([
      followItemHiddenTags(card, condition),
      button ? followItemButton(card, condition) : undefined,
      followItemLink(fmt, ruleSetNameOf(card.name.s)),
    ]) +
    CARD_FORM_CLOSE
  );
}

function followItemHtml(
  ctx: ViewContext,
  condition: string,
  button: boolean,
  wrapView: string,
): string {
  return modSlotWrap(ctx, wrapView, followItemFormBytes(ctx.fmt, condition, button));
}

function followBundle(ctx: ViewContext): FollowRenderBundle | undefined {
  return ctx.fmt.engine.followRenderBundle?.();
}

const followStatusView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const card = fmt.card;
  const rows = followRuleItems(card)
    .map(
      (option) =>
        `<li class='list-group-item'>\n${followItemHtml(
          ctx,
          option === "*never" ? "*always" : option,
          true,
          "follow_status",
        )}\n</li>`
    )
    .join("\n");
  const setName = ruleSetNameOf(card.name.s);
  const moreOptions =
    `<a rel="nofollow" class="btn update-follow-link slotter slotter"` +
    ` data-card_key="${h(setPrototypeKey(setName))}"` +
    ` href="${followPath(card.name.urlKey, { view: "rule_form" })}"` +
    ` data-remote="true">more options</a>`;
  const body =
    `<h4>\nGet notified about changes\n</h4>\n` +
    `<ul class='delete-list list-group'>${rows === "" ? "" : `\n${rows}`}\n</ul>\n` +
    `${moreOptions}\n`;
  return modSlotWrap(ctx, "follow_status", body);
};

const followItemView: ViewFn = (ctx) => {
  const condition =
    typeof ctx.voo.opts["condition"] === "string"
      ? (ctx.voo.opts["condition"] as string)
      : "*always";
  const button = ctx.voo.opts["follow_button"] !== false;
  return followItemHtml(ctx, condition, button, "follow_item");
};

const followButtonView: ViewFn = (ctx) => {
  const bundle = followBundle(ctx);
  return followButton(
    {
      session: { actorName: bundle?.session?.actorName ?? "Anonymous" },
      followed: bundle?.followed === true,
      followLabel: bundle?.followLabel ?? ctx.fmt.card.name.s,
    },
    ctx.fmt.card.name.s,
  );
};

function followEditorBody(
  ctx: ViewContext,
  rows: readonly FollowTabRow[],
): string {
  const { fmt } = ctx;
  const bundle = followBundle(ctx);
  const showButton =
    bundle?.session !== undefined &&
    (bundle.session.actorName === fmt.card.name.leftName?.s ||
      bundle.session.actorId === 1);
  const lis = rows.map((row) => {
    const ruleCard = ctx.fmt.engine.fetchRenderCard(row.ruleCardName);
    if (ruleCard === undefined) {
      return `<li class='list-group-item'>\nno entries\n</li>`;
    }
    const sub = new RenderFormat(ruleCard, ctx.fmt.engine, { parent: fmt });
    return `<li class='list-group-item'>\n${followItemHtml(
      { fmt: sub, voo: new Voo(undefined, "follow_item", {}) },
      row.option,
      showButton,
      "follow_item",
    )}\n</li>`;
  });
  const list =
    lis.length > 0
      ? `<ul class='delete-list list-group'>\n${lis.join("\n")}\n</ul>`
      : `<ul class='delete-list list-group'>\n<li class='list-group-item'>\nno entries\n</li>\n</ul>`;
  return `<div class='pointer-list-editor'>\n${list}\n</div>\n`;
}

const followTabView: ViewFn = (ctx) =>
  followEditorBody(ctx, followBundle(ctx)?.followTabRows ?? []);

const ignoreTabView: ViewFn = (ctx) =>
  followEditorBody(ctx, followBundle(ctx)?.ignoreTabRows ?? []);

const FOLLOW_TABS: ReadonlyArray<{ name: string; view: string }> = [
  { name: "Follow", view: "follow_tab" },
  { name: "Ignore", view: "ignore_tab" },
];

const userFollowCoreView: ViewFn = (ctx) => {
  const urlKey = ctx.fmt.card.name.urlKey;
  const hash = new Map(
    FOLLOW_TABS.map((e) => [e.name, { title: e.name, path: `/${urlKey}/${e.view}` }]),
  );
  return tabsPanel(ctx, hash, "Follow", "tabs", str(ctx.fmt.renderView("follow_tab")));
};

const followDefaultsEditButtonsView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const confirm = fmt.renderView("confirm_update_all");
  const submitAndUpdate = orderedButton("Submit and update all users", [
    ["name", "card[trigger]"],
    ["type", "submit"],
    ["data-disable-with", "Updating"],
    ["value", "update_follow_rules"],
    ["class", "follow-updater btn btn-primary"],
  ]);
  const simple = orderedButton("Submit", [
    ["name", "button"],
    ["type", "submit"],
    ["class", "follow btn btn-primary"],
  ]);
  const cancelHref = followPath(fmt.card.name.urlKey, {
    view: "edit",
    query: { id: String(fmt.card.id) },
  });
  const cancel = `<a href="${cancelHref}" class="btn btn-secondary slotter" data-remote="true">Cancel</a>`;
  return (
    confirm +
    `<div class="form-group button-form-group">` +
    output([submitAndUpdate, simple, cancel]) +
    `</div>`
  );
};

function orderedButton(text: string, attrs: Array<[string, string]>): string {
  return `<button ${attrs.map(([k, v]) => `${k}="${v}"`).join(" ")}>${text}</button>`;
}

function notifyHistoryReader(ctx: ViewContext): HistoryRenderReader | undefined {
  return ctx.fmt.engine.historyRenderReader?.();
}

const RELEVANT_FIELDS_BY_ACTION: Record<
  "create" | "update" | "delete",
  readonly ("name" | "cardtype" | "content")[]
> = {
  create: ["cardtype", "content"],
  update: ["name", "cardtype", "content"],
  delete: ["content"],
};

function editInfoRow(
  reader: HistoryRenderReader,
  action: HistoryActionRow,
  field: "name" | "cardtype" | "content",
): string | undefined {
  const actionType = actionTypeFromCode(action.action_type ?? -1);
  if (actionType === undefined) return undefined;
  const tracked = field === "cardtype" ? "type_id" : field;
  const own = reader.value(action, tracked);
  if (own === undefined || own === null) return undefined;
  let value: string | number | boolean = own;
  if (actionType === "delete") {
    const previous = reader.previousValue(action, tracked);
    if (previous !== undefined && previous !== null) value = previous;
  }
  const shown =
    field === "cardtype"
      ? reader.typeNameForId(Number(value)) ?? String(value)
      : String(value);
  const label =
    actionType === "update" ? "new" : actionType === "delete" ? "deleted" : undefined;
  return `  ${label ?? ""} ${field}: ${shown}`;
}

function nameBeforeAction(
  reader: HistoryRenderReader,
  action: HistoryActionRow,
  cardName: string,
): string {
  const value = reader.value(action, "name");
  const previous =
    actionTypeFromCode(action.action_type ?? -1) === "create"
      ? undefined
      : reader.previousValue(action, "name");
  return value !== undefined && value !== null && previous !== undefined && previous !== null
    ? String(previous)
    : cardName;
}

function listOfChangesRowsFrom(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
): string {
  const actionType = actionTypeFromCode(action.action_type ?? -1);
  if (actionType === undefined) {
    throw new Error("subedit_notice: unknown action_type code");
  }
  const html = ctx.fmt.formatName === "html";
  return RELEVANT_FIELDS_BY_ACTION[actionType]
    .map((field) => editInfoRow(reader, action, field))
    .filter((row) => row !== undefined)
    .map((row) => (html ? `<li>${row}</li>\n` : `${row}\n`))
    .join("");
}

const subeditNoticeView: ViewFn = (ctx) => {
  const reader = notifyHistoryReader(ctx);
  if (reader === undefined) return "";
  const rawActionId = ctx.voo.opts["action_id"];
  const actionId =
    rawActionId !== undefined && rawActionId !== null && String(rawActionId) !== ""
      ? Number(rawActionId)
      : undefined;
  const action =
    actionId !== undefined && Number.isFinite(actionId)
      ? reader.actionById(actionId)
      : reader.cardLastAction;
  if (action === undefined) {
    throw new Error(
      `subedit_notice: no notification action for ${ctx.fmt.card.name.s}`,
    );
  }
  const actionType = actionTypeFromCode(action.action_type ?? -1);
  if (actionType === undefined) {
    throw new Error("subedit_notice: unknown action_type code");
  }
  const header = `${nameBeforeAction(reader, action, ctx.fmt.card.name.s)} ${actionType}d\n`;
  const inner = header + listOfChangesRowsFrom(ctx, reader, action);
  return ctx.fmt.formatName === "html" ? `<li>${inner}</li>\n` : `\n${inner}\n`;
};

const listOfChangesNotifyView: ViewFn = (ctx) => {
  const reader = notifyHistoryReader(ctx);
  if (reader === undefined) return "";
  const action = reader.cardLastAction;
  if (action === undefined) {
    throw new Error(
      `list_of_changes: no notification action for ${ctx.fmt.card.name.s}`,
    );
  }
  return listOfChangesRowsFrom(ctx, reader, action);
};

const subeditsNotifyView: ViewFn = (ctx) => {
  const authored = ctx.voo.opts["authoredNestText"];
  return typeof authored === "string" ? authored : "";
};

const followerNotifyView: ViewFn = () => "follower";

function pointerTypeOf(ctx: ViewContext): {
  typeId?: number;
  typeName: string;
  typeCode: string;
} {
  const engine = ctx.fmt.engine;
  const codenameId = engine.peekIdByCodename?.("pointer");
  if (codenameId !== undefined) {
    return { typeId: codenameId, typeName: "Pointer", typeCode: "pointer" };
  }
  const pointer = engine.fetchRenderCard("Pointer");
  if (pointer !== undefined && pointer.id !== undefined && pointer.unknown !== true) {
    return { typeId: pointer.id, typeName: "Pointer", typeCode: "pointer" };
  }
  return { typeName: "Pointer", typeCode: "pointer" };
}

function quickTypeLeftTypeName(ctx: ViewContext, ruleName: string): string {
  const leftName = DeckoName.parse(ruleName).leftName;
  if (leftName === undefined) return "RichText";
  const input: PatternCardInput = { name: leftName.s, isNew: true };
  for (const candidate of ruleNamesForCard(input, "*default")) {
    const rule = ctx.fmt.engine.fetchRenderCard(candidate);
    if (rule === undefined) continue;
    if (rule.typeName !== undefined) return rule.typeName;
  }
  return "RichText";
}

function newCardRenderCard(
  mark: string,
  opts: { typeId?: number; typeName: string; typeCode?: string },
  leftTypeName: string | undefined,
  isRule: boolean,
): RenderCard {
  const name = DeckoName.parse(mark);
  const record: CardRecord = {
    id: undefined,
    codename: undefined,
    leftId: undefined,
    rightId: undefined,
    typeId: opts.typeId,
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
  return {
    record,
    name,
    key: name.key,
    typeName: opts.typeName,
    typeId: opts.typeId,
    typeCode: opts.typeCode,
    id: undefined,
    dbContent: "",
    setKeys: safeSetKeys({
      name,
      typeId: opts.typeId,
      typeName: opts.typeName,
      leftTypeName,
      isRule,
      isNew: true,
    }),
  };
}

const ruleEditorView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const bundle = followBundle(ctx);
  const leftName = fmt.card.name.leftName?.s;
  if (leftName === undefined) {
    throw new Error("rule_editor: card.left missing");
  }
  const prefName =
    bundle?.ruleEditorPreferenceName ??
    (() => {
      const leftCard = fmt.engine.fetchRenderCard(leftName);
      const setName = followSetCardName(leftName, leftCard?.typeCode);
      return followRuleNameFor(setName, "Anonymous");
    })();
  let ruleContext = fmt.engine.fetchRenderCard(prefName);
  if (ruleContext === undefined) {
    ruleContext = newCardRenderCard(
      prefName,
      pointerTypeOf(ctx),
      quickTypeLeftTypeName(ctx, prefName),
      true,
    );
  }
  const applied = bundle?.leftFollowPreference;
  const targetName = applied ?? prefName;
  let target = fmt.engine.fetchRenderCard(targetName);
  if (target === undefined) {
    target = DeckoName.parse(targetName).isSimple
      ? newCardRenderCard(
          targetName,
          { typeId: 278, typeName: "Setting", typeCode: "setting" },
          undefined,
          false,
        )
      : newCardRenderCard(targetName, pointerTypeOf(ctx), quickTypeLeftTypeName(ctx, targetName), true);
  }
  const sub = new RenderFormat(target, fmt.engine, { parent: fmt });
  return (
    `<div class="edit-rule">` +
    sub.renderView("rule_form", {
      success_view: "open",
      form_type: "modal",
      rule_context: prefName,
      data_update_foreign_slot: ".card-slot.follow_section-view",
    }) +
    `</div>`
  );
};

function userFollowErrorsPermissionArm(cardName: string): {
  title: string;
  classy: string;
  body: string;
} {
  return {
    title: `Problems with ${cardName}`,
    classy: "card card-warning card-inverse",
    body: `Please <a href="/Sign_in">sign in</a>`,
  };
}

const userFollowErrorsView: ViewFn = (ctx) => {
  void ctx;
  return null;
};

export const followProbeSurface = {
  followerFrom(): string {
    return str(followerNotifyView({} as ViewContext));
  },
  subeditNoticeFrom(input: {
    headerName: string;
    actionType: "create" | "update" | "delete";
    rows: readonly { field: "name" | "cardtype" | "content"; shown: string; label: string }[];
  }): string {
    const rows = input.rows
      .map((r) => `  ${r.label} ${r.field}: ${r.shown}\n`)
      .join("");
    return `\n${input.headerName} ${input.actionType}d\n${rows}\n`;
  },
  ruleEditorDispatchFrom(input: {
    targetName: string;
    ruleContextName: string;
  }): { targetName: string; ruleContextName: string; successView: string; formType: string } {
    return {
      targetName: input.targetName,
      ruleContextName: input.ruleContextName,
      successView: "open",
      formType: "modal",
    };
  },
  userFollowErrorsPermissionArm(cardName: string): {
    title: string;
    classy: string;
    body: string;
  } {
    return userFollowErrorsPermissionArm(cardName);
  },
  errorsSuperBytes(): string {
    return str(formatErrorsView({} as ViewContext));
  },
  pointerTypeFrom(engine: ViewContext["fmt"]["engine"]): { typeId?: number; typeName: string; typeCode: string } {
    return pointerTypeOf({ fmt: { engine } } as unknown as ViewContext);
  },
};

const passiveSetModule = (setPath: string): ModSetModuleFile => ({
  setPath,
  formats: { html: { views: [] } },
});

export const followModEventPredicates = {
  "silence_notifications?": (card: ModEventCard): boolean =>
    card.envController !== true && card.forceNotifications !== true,
  "notable_change?": (card: ModEventCard): boolean =>
    card.silentChange !== true &&
    card.isActCard !== false &&
    card.authCurrentId !== DECKO_BOT_ID,
  "expire_preferences?": (card: ModEventCard): boolean =>
    card.expirePreferences === true,
} as const;

const DECKO_BOT_ID = 1;

const cardModFollow: DeckoModManifest = {
  name: "follow",
  gemName: "card-mod-follow",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/follow_option",
      formats: { html: { views: [] } },
    },
    {
      setPath: "all/follow",
      formats: { html: { views: [] } },
    },
    passiveSetModule("all/follow/followed_by"),
    {
      ...passiveSetModule("all/follow/follower_ids"),
      events: [
        event({ event: "cache_expired_for_type_change", at: "store", on: ["update"], changed: ["type_id", "name"] }),
        event({ event: "expire_preferences_cache", at: "finalize", when: "expire_preferences?" }),
      ],
    },
    passiveSetModule("all/follow/follow_link"),
    {
      setPath: "all/follow/follow_link_views",
      formats: {
        html: {
          views: [{ view: "follow_button", viewFn: followButtonView, config: { cache: "never" } }],
        },
      },
    },
    passiveSetModule("all/follow/start_follow_link"),
    passiveSetModule("all/follow/stop_follow_link"),
    {
      setPath: "all/notify",
      formats: { html: { views: [] } },
      events: [
        engineOwnedEvent({ event: "silence_notifications", at: "initialize", when: "silence_notifications?" }),
        engineOwnedEvent({
          event: "notify_followers_after_save",
          at: "integrate_with_delay",
          on: ["save"],
          priority: 20,
          when: "notable_change?",
        }),
        engineOwnedEvent({ event: "stash_followers", at: "store", on: ["delete"], when: "notable_change?" }),
        engineOwnedEvent({ event: "notify_followers_after_delete", at: "integrate", on: ["delete"], when: "notable_change?" }),
      ],
    },
    {
      setPath: "all/notify/base_views",
      formats: {
        base: {
          views: [
            {
              view: "last_action_verb",
              viewFn: lastActionVerbNotifyView,
              config: { cache: "never" },
            },
            {
              view: "subedit_notice",
              viewFn: subeditNoticeView,
              config: { cache: "never" },
            },
            {
              view: "list_of_changes",
              viewFn: listOfChangesNotifyView,
              config: { cache: "never", denial: "blank" },
            },
            {
              view: "subedits",
              viewFn: subeditsNotifyView,
              config: { cache: "never", perms: "none" },
            },
            {
              view: "follower",
              viewFn: followerNotifyView,
              config: { cache: "never" },
            },
          ],
        },
      },
    },
    {
      setPath: "all/notify/html_views",
      formats: {
        html: {
          views: [
            {
              view: "list_of_changes",
              viewFn: listOfChangesNotifyView,
              config: { cache: "never", denial: "blank" },
            },
            {
              view: "subedits",
              viewFn: subeditsNotifyView,
              config: { cache: "never", perms: "none" },
            },
          ],
        },
      },
    },
    {
      setPath: "right/account",
      formats: { html: { views: [] } },
    },
    passiveSetModule("right/contextual_class"),
    passiveSetModule("right/disappear"),
    {
      setPath: "right/follow",
      events: [
        event({ event: "cache_expired_for_new_preference", at: "integrate", when: "preference?" }),
      ],
      formats: {
        html: {
          views: [
            { view: "follow_status", viewFn: followStatusView, config: { cache: "never" } },
            { view: "follow_item", viewFn: followItemView, config: { cache: "never" } },
          ],
        },
      },
    },
    {
      setPath: "right/followers",
      virtual: true,
      assignsType: "list",
      contentOverrides: [{ fn: followersContentFn, supersedesType: false }],
      membership: "set-module-chain",
      formats: {
        html: {
          views: [
            {
              view: "core",
              viewFn: followersCoreView,
              config: { cache: "never" },
            },
          ],
        },
      },
    },
    {
      setPath: "right/following",
      virtual: true,
      assignsType: "list",
      formats: {
        html: {
          views: [
            {
              view: "core",
              viewFn: followingCoreView,
            },
            { view: "status", viewFn: followingStatusView, config: { unknown: true } },
            { view: "one_line_content", viewFn: followingOneLineContentView },
            {
              view: "rule_editor",
              viewFn: ruleEditorView,
              config: { cache: "never", unknown: true },
            },
          ],
        },
      },
    },
    {
      setPath: "right/follow_fields",
      events: [event({ event: "follow_fields_changed", at: "integrate" })],
      formats: { html: { views: [] } },
    },
    passiveSetModule("right/message"),
    {
      setPath: "self/always",
      formats: { html: { views: [] } },
    },
    {
      setPath: "self/created",
      formats: { html: { views: [] } },
    },
    {
      setPath: "self/edited",
      formats: { html: { views: [] } },
    },
    {
      setPath: "self/follow",
      settingOpts: {
        group: "other",
        position: 7,
        ruleTypeEditable: false,
        preference: true,
      },
    },
    {
      setPath: "self/follow_defaults",
      events: [
        event({ event: "update_follow_rules", at: "finalize", on: ["save"], trigger: "required" }),
      ],
      formats: {
        html: {
          views: [
            { view: "confirm_update_all", viewFn: confirmUpdateAllView },
            { view: "edit_buttons", viewFn: followDefaultsEditButtonsView },
          ],
        },
      },
    },
    {
      setPath: "self/follow_fields",
      settingOpts: {
        group: "other",
        position: 5,
        ruleTypeEditable: false,
      },
    },
    {
      setPath: "self/never",
      formats: { html: { views: [] } },
    },
    {
      setPath: "type/cardtype",
      formats: { html: { views: [] } },
    },
    {
      setPath: "type/notification_template",
      formats: { html: { views: [] } },
    },
    {
      setPath: "type/set",
      formats: { html: { views: [] } },
      events: [event({ event: "cache_expired_for_new_set", at: "store", on: ["create"] })],
    },
    {
      setPath: "type/user",
      formats: { html: { views: [] } },
    },
    {
      setPath: "type_plus_right/user/follow",
      assignsType: "list",
      virtual: true,
      contentOverrides: [{ fn: userFollowContentFn, supersedesType: false }],
      membership: "set-module-chain",
      formats: {
        html: {
          views: [
            { view: "one_line_content", viewFn: userFollowOneLineContentView },
            { view: "edit", viewFn: userFollowEditView },
            { view: "core", viewFn: userFollowCoreView },
            { view: "follow_tab", viewFn: followTabView, config: { cache: "never" } },
            { view: "ignore_tab", viewFn: ignoreTabView, config: { cache: "never" } },
            { view: "errors", viewFn: userFollowErrorsView, config: { perms: "none" } },
          ],
        },
      },
    },
    passiveSetModule("type_plus_right/user/follow/follow_editor_helper"),
  ],
};

export default cardModFollow;
