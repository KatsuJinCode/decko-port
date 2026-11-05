import { str } from "../../render/format.js";

import type { SQLDatabaseDriver } from "../../../server/driver.js";
import { serializerFollowsLive } from "../../render/deployment-follow-live-config.js";
import { timeAgoInWords as sharedTimeAgoInWords } from "../../render/text-helpers.js";
import { cardWallClockNow } from "../../wall-clock.js";
import { sqlDateTime } from "../../history/act.js";
import type {
  CardActsRow,
  CardActionsRow,
  CardChangesRow,
  CardsRow,
} from "../../../server/schema.js";
import {
  ACTION_TYPE_CODES,
  actionTypeFromCode,
  type ActionType,
} from "../../history/action.js";
import {
  TRACKED_FIELDS,
  trackedFieldByIndex,
  trackedFieldIndex,
  type TrackedField,
} from "../../history/change.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
} from "../mod-manifest.js";
import type { ModEventContext } from "../mod-event-dispatch.js";

export type HistoryActRow = CardActsRow;

export type HistoryActionRow = CardActionsRow;

export interface HistoryChangeRow {
  cardActionId: number;
  field: TrackedField;
  value: string | number | boolean | null;
}

export type RevisionState = Partial<Record<TrackedField, string | number | boolean | null>>;

export const HISTORY_ACTS_PER_PAGE = 10;

export const HISTORY_DIFF_ARGS = { diffFormat: "text" } as const;

async function nestingIds(
  driver: SQLDatabaseDriver,
  returnField: "referee_id" | "referer_id",
  whereField: "referee_id" | "referer_id",
  cardId: number,
): Promise<number[]> {
  const result = await driver.query<{ nid: number | null }>(
    `SELECT DISTINCT ${returnField} AS nid FROM card_references
     WHERE ref_type = 'I' AND ${whereField} = ?`,
    [cardId],
  );
  return result.rows.map((r) => r.nid).filter((id): id is number => id !== null);
}

export async function historyCardIds(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<number[]> {
  return [...(await nestingIds(driver, "referee_id", "referer_id", cardId)), cardId];
}

export async function historyParentIds(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<number[]> {
  return nestingIds(driver, "referer_id", "referee_id", cardId);
}

export async function historyAncestorIds(
  driver: SQLDatabaseDriver,
  cardId: number,
  recursionLevel = 0,
): Promise<number[]> {
  if (recursionLevel > 5) return [];
  const parentIds = await historyParentIds(driver, cardId);
  const out: number[] = [...parentIds];
  for (const parentId of parentIds) {
    const row = await driver.query<{ trash: number | null }>(
      "SELECT trash FROM cards WHERE id = ?",
      [parentId],
    );
    const card = row.rows[0];
    if (card === undefined || card.trash === 1) continue;
    out.push(...(await historyAncestorIds(driver, parentId, recursionLevel + 1)));
  }
  return out;
}

export async function actionCount(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<number> {
  const result = await driver.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM card_actions WHERE card_id = ?",
    [cardId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function hasEdits(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<boolean> {
  const result = await driver.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM card_acts WHERE actor_id = ? AND card_id IS NOT NULL",
    [cardId],
  );
  return Number(result.rows[0]?.n ?? 0) > 0;
}

const NOT_DRAFT = "(draft IS NOT TRUE)";

export async function actionIds(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<number[]> {
  const result = await driver.query<{ id: number }>(
    `SELECT id FROM card_actions WHERE card_id = ? AND ${NOT_DRAFT} ORDER BY id`,
    [cardId],
  );
  return result.rows.map((r) => Number(r.id));
}

export async function allActionIds(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<number[]> {
  const result = await driver.query<{ id: number }>(
    "SELECT id FROM card_actions WHERE card_id = ? ORDER BY id",
    [cardId],
  );
  return result.rows.map((r) => Number(r.id));
}

export async function historyActions(
  driver: SQLDatabaseDriver,
  cardIds: number[],
): Promise<HistoryActionRow[]> {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => "?").join(", ");
  const result = await driver.query<CardActionsRow>(
    `SELECT * FROM card_actions WHERE card_id IN (${placeholders}) ORDER BY id`,
    cardIds,
  );
  return result.rows;
}

export async function fetchAction(
  driver: SQLDatabaseDriver,
  actionId: number,
): Promise<HistoryActionRow | undefined> {
  const result = await driver.query<CardActionsRow>(
    "SELECT * FROM card_actions WHERE id = ?",
    [actionId],
  );
  return result.rows[0];
}

export async function createAction(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<HistoryActionRow | undefined> {
  const result = await driver.query<CardActionsRow>(
    `SELECT * FROM card_actions WHERE card_id = ? AND ${NOT_DRAFT} ORDER BY id LIMIT 1`,
    [cardId],
  );
  return result.rows[0];
}

export async function nthAction(
  driver: SQLDatabaseDriver,
  cardId: number,
  index: number,
): Promise<HistoryActionRow | undefined> {
  const i = Math.trunc(index);
  if (!Number.isFinite(i) || i <= 0) return undefined;
  const result = await driver.query<CardActionsRow>(
    `SELECT * FROM card_actions WHERE ${NOT_DRAFT} AND card_id = ?
     ORDER BY id LIMIT 1 OFFSET ?`,
    [cardId, i - 1],
  );
  return result.rows[0];
}

export async function lastAction(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<HistoryActionRow | undefined> {
  const result = await driver.query<CardActionsRow>(
    `SELECT * FROM card_actions WHERE card_id = ? AND ${NOT_DRAFT}
     ORDER BY id DESC LIMIT 1`,
    [cardId],
  );
  return result.rows[0];
}

export async function lastActionId(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<number | undefined> {
  const action = await lastAction(driver, cardId);
  return action?.id;
}

export async function previousAction(
  driver: SQLDatabaseDriver,
  cardId: number,
  actionId: number,
): Promise<HistoryActionRow | undefined> {
  const result = await driver.query<CardActionsRow>(
    `SELECT * FROM card_actions WHERE card_id = ? AND ${NOT_DRAFT} ORDER BY id`,
    [cardId],
  );
  const actionIndex = result.rows.findIndex((a) => Number(a.id) === actionId);
  if (actionIndex <= 0) return undefined;
  const all = await driver.query<CardActionsRow>(
    "SELECT * FROM card_actions WHERE card_id = ? ORDER BY id",
    [cardId],
  );
  return all.rows[actionIndex - 1];
}

function extractActionId(actionArg: number | HistoryActionRow): number {
  return typeof actionArg === "number" ? actionArg : actionArg.id;
}

export interface LastChangeOptions {
  before?: number | HistoryActionRow;
  notAfter?: number | HistoryActionRow;
  includingDrafts?: boolean;
}

export async function allActionChanges(
  driver: SQLDatabaseDriver,
  actionId: number,
): Promise<HistoryChangeRow[]> {
  const result = await driver.query<CardChangesRow>(
    "SELECT * FROM card_changes WHERE card_action_id = ? ORDER BY id",
    [actionId],
  );
  const mapped: (HistoryChangeRow | undefined)[] = result.rows.map((row) => {
    const field = trackedFieldByIndex(Number(row.field));
    if (field === undefined) return undefined;
    const change: HistoryChangeRow = {
      cardActionId: Number(row.card_action_id),
      field,
      value: row.value,
    };
    return change;
  });
  return mapped.filter((r): r is HistoryChangeRow => r !== undefined);
}

export async function actionIsSole(
  driver: SQLDatabaseDriver,
  action: HistoryActionRow,
): Promise<boolean> {
  const changes = await allActionChanges(driver, action.id);
  if (changes.length > 0) return false;
  if (action.action_type === ACTION_TYPE_CODES.create) return true;
  return action.card_id === null
    ? false
    : (await actionCount(driver, action.card_id)) === 1;
}

export async function actionChange(
  driver: SQLDatabaseDriver,
  action: HistoryActionRow,
  field: TrackedField,
): Promise<HistoryChangeRow | undefined> {
  const all = await allActionChanges(driver, action.id);
  if (all.length > 0) return all.find((c) => c.field === field);
  if (!(await actionIsSole(driver, action))) return undefined;
  if (action.card_id === null) return undefined;
  const card = await fetchCardsRow(driver, action.card_id);
  if (card === undefined) return undefined;
  return {
    cardActionId: action.id,
    field,
    value: field === "trash" ? card.trash !== 0 : card[field],
  };
}

export async function actionValue(
  driver: SQLDatabaseDriver,
  action: HistoryActionRow,
  field: "name" | "type_id" | "db_content" | "content" | "trash",
): Promise<string | number | boolean | null | undefined> {
  const interpreted: TrackedField = field === "content" ? "db_content" : field;
  const change = await actionChange(driver, action, interpreted);
  if (change === undefined) return undefined;
  if (interpreted === "type_id") {
    return change.value === null ? null : Number(change.value);
  }
  return change.value;
}

export async function actionPreviousChange(
  driver: SQLDatabaseDriver,
  action: HistoryActionRow,
  field: TrackedField,
): Promise<HistoryChangeRow | undefined> {
  if (action.action_type === ACTION_TYPE_CODES.create) return undefined;
  return lastChangeOn(driver, Number(action.card_id), field, { before: action.id });
}

export async function actionPreviousValue(
  driver: SQLDatabaseDriver,
  action: HistoryActionRow,
  field: "name" | "type_id" | "db_content" | "content" | "trash",
): Promise<string | number | boolean | null | undefined> {
  if (action.action_type === ACTION_TYPE_CODES.create) return undefined;
  const interpreted: TrackedField = field === "content" ? "db_content" : field;
  const previous = await actionPreviousChange(driver, action, interpreted);
  if (previous === undefined) return undefined;
  if (interpreted === "type_id") {
    return previous.value === null ? null : Number(previous.value);
  }
  return previous.value;
}

export async function lastChangeOn(
  driver: SQLDatabaseDriver,
  cardId: number,
  field: TrackedField,
  opts: LastChangeOptions = {},
): Promise<HistoryChangeRow | undefined> {
  const actionId =
    opts.before !== undefined
      ? extractActionId(opts.before)
      : opts.notAfter !== undefined
        ? extractActionId(opts.notAfter)
        : undefined;

  const create = await createAction(driver, cardId);
  if (opts.before !== undefined) {
    if (create === undefined) {
      throw new Error(`last_change_on: card ${cardId} has no create action`);
    }
    if (actionId === create.id) return undefined;
  }

  const viaCreateAction =
    (create !== undefined && actionId === create.id) ||
    (actionId === undefined && create !== undefined && (await actionIsSole(driver, create)));
  if (viaCreateAction) {
    return create === undefined ? undefined : actionChange(driver, create, field);
  }

  const conditions: string[] = ["card_actions.card_id = ?", "card_changes.field = ?"];
  const params: unknown[] = [cardId, trackedFieldIndex(field)];
  if (opts.includingDrafts !== true) {
    conditions.push("(draft IS NOT TRUE)");
  }
  const operator = opts.before !== undefined ? "<" : opts.notAfter !== undefined ? "<=" : undefined;
  if (operator !== undefined && actionId !== undefined) {
    conditions.push(`card_changes.card_action_id ${operator} ?`);
    params.push(actionId);
  }
  const result = await driver.query<CardChangesRow>(
    `SELECT card_changes.* FROM card_changes
     JOIN card_actions ON card_actions.id = card_changes.card_action_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY card_changes.id DESC LIMIT 1`,
    params,
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const fieldName = trackedFieldByIndex(Number(row.field));
  return fieldName === undefined
    ? undefined
    : { cardActionId: Number(row.card_action_id), field: fieldName, value: row.value };
}

async function fetchCardsRow(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<CardsRow | undefined> {
  const result = await driver.query<CardsRow>("SELECT * FROM cards WHERE id = ?", [
    cardId,
  ]);
  return result.rows[0];
}

export async function lastAct(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<HistoryActRow | undefined> {
  const action = await lastAction(driver, cardId);
  if (action === undefined) return undefined;
  const lastActOnSelf = (
    await driver.query<CardActsRow>(
      "SELECT * FROM card_acts WHERE card_id = ? ORDER BY id DESC LIMIT 1",
      [cardId],
    )
  ).rows[0];
  const actOfLastAction = action.card_act_id
    ? (
        await driver.query<CardActsRow>("SELECT * FROM card_acts WHERE id = ?", [
          action.card_act_id,
        ])
      ).rows[0]
    : undefined;
  if (lastActOnSelf === undefined) return actOfLastAction;
  if (actOfLastAction === undefined) return lastActOnSelf;
  if (lastActOnSelf.id === actOfLastAction.id) return lastActOnSelf;
  if (lastActOnSelf.acted_at === null || actOfLastAction.acted_at === null) {
    throw new Error("last_act: NULL acted_at (Ruby would raise comparing nil)");
  }
  return lastActOnSelf.acted_at > actOfLastAction.acted_at
    ? lastActOnSelf
    : actOfLastAction;
}

export async function actedAt(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<string | null | undefined> {
  const act = await lastAct(driver, cardId);
  return act?.acted_at;
}

export async function revisedAt(
  driver: SQLDatabaseDriver,
  cardId: number,
  now: () => Date = () => new Date(),
): Promise<string> {
  const action = await lastAction(driver, cardId);
  const actedAtTs =
    action?.card_act_id !== undefined && action.card_act_id !== null
      ? (
          await driver.query<CardActsRow>("SELECT * FROM card_acts WHERE id = ?", [
            action.card_act_id,
          ])
        ).rows[0]?.acted_at
      : undefined;
  return actedAtTs ?? sqlDateTime(now());
}

export interface HistoryActsOptions {
  currentUserId: number;
  withDrafts: boolean;
  isActionViewable?: (actionCardId: number) => boolean;
}

export async function historyActs(
  driver: SQLDatabaseDriver,
  cardIds: number[],
  opts: HistoryActsOptions,
): Promise<HistoryActRow[]> {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => "?").join(", ");
  const draftClause = opts.withDrafts
    ? "(draft IS NOT TRUE OR card_acts.actor_id = ?)"
    : "(draft IS NOT TRUE)";
  const params: unknown[] = [...cardIds];
  if (opts.withDrafts) params.push(opts.currentUserId);
  const result = await driver.query<CardActsRow & { action_card_id: number }>(
    `SELECT card_acts.*, card_actions.card_id AS action_card_id
     FROM card_acts
     JOIN card_actions ON card_actions.card_act_id = card_acts.id
     JOIN cards ON cards.id = card_actions.card_id
     WHERE card_actions.card_id IN (${placeholders}) AND ${draftClause}
       AND card_acts.card_id IS NOT NULL
     ORDER BY card_acts.id DESC`,
    params,
  );
  const seen = new Set<number>();
  const out: HistoryActRow[] = [];
  for (const row of result.rows) {
    if (seen.has(row.id)) continue;
    if (opts.isActionViewable !== undefined && !opts.isActionViewable(Number(row.action_card_id))) {
      continue;
    }
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export async function draftActs(
  driver: SQLDatabaseDriver,
  cardId: number,
  currentUserId: number,
): Promise<HistoryActRow[]> {
  const result = await driver.query<CardActsRow>(
    `SELECT card_acts.* FROM card_acts
     JOIN card_actions ON card_actions.card_act_id = card_acts.id
     WHERE card_actions.card_id = ? AND card_actions.draft = 1
       AND card_acts.actor_id = ?
     ORDER BY card_actions.id`,
    [cardId, currentUserId],
  );
  return result.rows;
}

export async function lastDraftContent(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<string | undefined> {
  const result = await driver.query<{ value: string | null }>(
    `SELECT card_changes.value FROM card_changes
     WHERE card_changes.card_action_id = (
       SELECT id FROM card_actions WHERE card_id = ? AND draft = 1
       ORDER BY id DESC LIMIT 1
     )
     ORDER BY id DESC LIMIT 1`,
    [cardId],
  );
  return result.rows[0]?.value ?? undefined;
}

export async function revision(
  driver: SQLDatabaseDriver,
  cardId: number,
  action: number | HistoryActionRow,
  beforeAction = false,
): Promise<RevisionState | undefined> {
  const row = typeof action === "number" ? await fetchAction(driver, action) : action;
  if (row === undefined) return undefined;
  return beforeAction
    ? revisionBeforeAction(driver, cardId, row)
    : revisionAttributes(driver, cardId, row);
}

export async function revisionAttributes(
  driver: SQLDatabaseDriver,
  cardId: number,
  action: HistoryActionRow,
): Promise<RevisionState> {
  const card = await fetchCardsRow(driver, cardId);
  const out: RevisionState = {};
  for (const field of TRACKED_FIELDS) {
    const lastChange =
      (await actionChange(driver, action, field)) ??
      (await lastChangeOn(driver, cardId, field, { notAfter: action.id }));
    out[field] =
      lastChange !== undefined
        ? lastChange.value
        : card === undefined
          ? null
          : field === "trash"
            ? card.trash !== 0
            : card[field];
  }
  return out;
}

export async function revisionBeforeAction(
  driver: SQLDatabaseDriver,
  cardId: number,
  action: HistoryActionRow,
): Promise<RevisionState> {
  const previous =
    action.card_id === null
      ? undefined
      : await previousAction(driver, action.card_id, action.id);
  if (previous === undefined) return { trash: true };
  return revisionAttributes(driver, cardId, previous);
}

export async function contentAtTimeOfSelectedAction(
  driver: SQLDatabaseDriver,
  cardId: number,
  selectedActionId: number,
): Promise<string | number | boolean | null | undefined> {
  const change = await lastChangeOn(driver, cardId, "db_content", {
    notAfter: selectedActionId,
    includingDrafts: true,
  });
  return change?.value;
}

export async function selectedContent(
  driver: SQLDatabaseDriver,
  cardId: number,
  selectedActionId: number,
  dbContent: string | null,
): Promise<string | number | boolean | null> {
  const atTime = await contentAtTimeOfSelectedAction(driver, cardId, selectedActionId);
  return atTime ?? dbContent;
}

export async function actionFromId(
  driver: SQLDatabaseDriver,
  cardId: number,
  actionId: number | string,
): Promise<HistoryActionRow | undefined> {
  if (typeof actionId !== "number" && !/^\d+$/.test(actionId)) return undefined;
  const action = await fetchAction(driver, Number(actionId));
  return action !== undefined && action.card_id === cardId ? action : undefined;
}

export async function updaterOf(
  driver: SQLDatabaseDriver,
  cardId: number,
): Promise<{ id: number }[]> {
  const result = await driver.query<{ id: number }>(
    `SELECT DISTINCT c0.id FROM cards c0
     JOIN card_acts cx1 ON c0.id = cx1.actor_id
     JOIN card_actions cn2 ON cx1.id = cn2.card_act_id
     JOIN cards c3 ON cn2.card_id = c3.id AND c3.trash IS FALSE
     WHERE cn2.action_type = 1 AND c3.id = ?
       AND c0.trash IS FALSE
     ORDER BY c0.id ASC`,
    [cardId],
  );
  return result.rows;
}

export const historyModEventPredicates = {
  "actionable?": (card: ModEventCard): boolean => card.history !== false,
  "no_history?": (card: ModEventCard): boolean => card.history === false,
  "finalize_action?": (card: ModEventCard): boolean =>
    card.history !== false && card.currentAction === true,
  "rollback_request?": (card: ModEventCard): boolean =>
    card.history !== false && card.rollbackRequested === true,
  "act_card?": (card: ModEventCard): boolean => card.isActCard !== false,
  "edit_conflict?": async (card: ModEventCard, ctx?: ModEventContext): Promise<boolean> => {
    if (ctx === undefined || card.id === undefined) return false;
    return isEditConflict(
      ctx.driver,
      card.id,
      card.lastActionIdBeforeEdit,
      card.authCurrentId ?? -1,
    );
  },
} as const;

export async function isEditConflict(
  driver: SQLDatabaseDriver,
  cardId: number,
  lastActionIdBeforeEdit: number | string | null | undefined,
  currentUserId: number,
): Promise<boolean> {
  if (lastActionIdBeforeEdit === null || lastActionIdBeforeEdit === undefined) {
    return false;
  }
  const currentId = await lastActionId(driver, cardId);
  if (Number(lastActionIdBeforeEdit) === currentId) return false;
  const la = await lastAction(driver, cardId);
  if (la === undefined || la.card_act_id === null) return false;
  const act = (
    await driver.query<CardActsRow>("SELECT * FROM card_acts WHERE id = ?", [
      la.card_act_id,
    ])
  ).rows[0];
  return act !== undefined && act.actor_id !== currentUserId;
}

export const HISTORY_ACTION_ICONS: Record<ActionType | "draft", string> = {
  create: "create_action",
  update: "update_action",
  delete: "delete_action",
  draft: "draft",
};

export function actionIconHtml(actionType: ActionType | "draft"): string {
  const key = HISTORY_ACTION_ICONS[actionType];
  const material: Record<string, string> = {
    create_action: "add_circle",
    update_action: "edit",
    delete_action: "remove_circle",
    draft: "build",
  };
  return `<i class="notranslate material-icons">${material[key]}</i>`;
}

export function actionLegendHtml(showDraftLegend: boolean): string {
  const types: (ActionType | "draft")[] = ["create", "update", "delete"];
  const legend = types.map((t) => `${actionIconHtml(t)} ${t}d`);
  if (showDraftLegend) {
    legend.push(draftLegendBytes());
  }
  return `<small>Actions: ${legend.join(" | ")}</small>`;
}

export function contentLegendHtml(): string {
  const legend = [
    "<ins class='diffins diff-added'>Additions</ins>",
    "<del class='diffdel diff-deleted'>Subtractions</del>",
  ];
  return `<small>Content changes: ${legend.join(" | ")}</small>`;
}

function draftLegendBytes(): string {
  return `${actionIconHtml("draft")} unsaved draft`;
}

const draftLegendView: ViewFn = () => draftLegendBytes();

export function actionTypeSymbol(action: HistoryActionRow): string {
  if (action.draft === 1) return "draft";
  return actionTypeFromCode(Number(action.action_type)) ?? "draft";
}

export function actHash(act: HistoryActRow): Record<string, unknown> {
  return {
    act_id: act.id,
    actor_id: act.actor_id,
    acted_at: act.acted_at,
    act_card_id: act.card_id,
  };
}

export function changesHash(changes: HistoryChangeRow[]): Record<string, string | number | boolean | null> {
  const hash: Record<string, string | number | boolean | null> = {};
  for (const change of changes) {
    hash[change.field] = change.value;
  }
  return hash;
}

export function actionHash(
  action: HistoryActionRow,
  changes: HistoryChangeRow[],
): Record<string, unknown> {
  return {
    action_id: action.id,
    card_id: action.card_id,
    action_type: actionTypeSymbol(action),
    comment: action.comment,
    changes: changesHash(changes),
  };
}

export async function actionHashList(
  driver: SQLDatabaseDriver,
  actions: HistoryActionRow[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const action of actions) {
    const act =
      action.card_act_id === null
        ? undefined
        : (
            await driver.query<CardActsRow>("SELECT * FROM card_acts WHERE id = ?", [
              action.card_act_id,
            ])
          ).rows[0];
    const changes = await allActionChanges(driver, action.id);
    out.push({ ...(act !== undefined ? actHash(act) : {}), ...actionHash(action, changes) });
  }
  return out;
}

import { DeckoName } from "../../name.js";
import { h, emitAttrs, newSlotId, slotOptionsJson } from "../../render/slot-html.js";
import { RenderFormat, Voo, type RenderCard, type ViewContext, type ViewFn, type ViewResult } from "../../render/format.js";
import { ContentDiff } from "../../history/content-diff.js";
import type { HistoryRenderParams, HistoryRenderReader } from "../../history/render-seam.js";

function historyReader(ctx: ViewContext): HistoryRenderReader {
  const reader = ctx.fmt.engine.historyRenderReader?.();
  if (reader === undefined) {
    throw new Error(
      "history view rendered without the render-time history seam (RenderEngine#prepareHistoryRender)",
    );
  }
  return reader;
}

function historySlotWrap(
  ctx: ViewContext,
  view: string,
  inner: string,
  extraAttrs: Record<string, string> = {},
  rawClassSuffix = "",
): string {
  const { fmt, voo } = ctx;
  const card = fmt.card;
  const classes =
    `${voo.classy(["card-slot", `${view}-view`, card.setKeys])}${rawClassSuffix !== "" ? ` ${rawClassSuffix}` : ""}`
      .split(" ")
      .filter((t) => t !== "")
      .join(" ")
      .trim();
  const slotOptions = voo.slotOptions();
  if (card.unknown !== true) {
    const initial = fmt.initialContextNames;
    if (initial.length > 0) slotOptions["name_context"] = initial.join(",");
  }
  const attrs = emitAttrs({
    id: `${card.name.safeKey}-${view}-view`,
    class: classes,
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name":
      card.record.isNew === true && card.name.isCompound ? card.name.urlKey : card.name.s,
    "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
    "data-card-type-name": card.typeName,
    "data-card-link-name": fmt.urlKey(),
    "data-slot-id": newSlotId(),
    "data-slot": slotOptionsJson(slotOptions),
    ...extraAttrs,
  });
  return `<div${attrs}>${inner}</div>`;
}

function builderDiv(content: string, klass?: string): string {
  const attr = klass === undefined ? "" : ` class="${klass}"`;
  return `<div${attr}>${content === "" ? "" : `\n${content}`}</div>`;
}

function historyIcon(name: string): string {
  return `<i class="notranslate material-icons">${name}</i>`;
}

export function timeAgoInWords(from: Date, to: Date = cardWallClockNow()): string {
  return sharedTimeAgoInWords(from, to);
}

function parseActedAt(text: string | null): Date | undefined {
  if (text === null || text === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (m === null) return undefined;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

function actorAndAgo(ctx: ViewContext, reader: HistoryRenderReader, act: HistoryActRow): string {
  const actor = reader.cardInfo(Number(act.actor_id));
  const link =
    actor === undefined
      ? h(String(act.actor_id))
      : `<a class="known-card" href="/${h(DeckoName.parse(actor.name).urlKey)}">${h(actor.name)}</a>`;
  const ago = parseActedAt(act.acted_at);
  const editedAgo = ago === undefined ? "" : `${timeAgoInWords(ago)} ago`;
  return `<small>${link}\n${editedAgo}</small>`;
}

export function actSummaryBadge(reader: HistoryRenderReader, actions: HistoryActionRow[]): string {
  const counts = new Map<string, number>();
  for (const action of reader.approvedActions(actions)) {
    const type = actionTypeSymbol(action);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const type of ["create", "update", "delete", "draft"] as const) {
    const count = counts.get(type) ?? 0;
    if (count <= 0) continue;
    const countHtml = count > 1 ? String(count) : "";
    parts.push(`${actionIconHtml(type)}<small> ${countHtml}</small>`);
  }
  return parts.join("<small class='text-muted'> | </small>");
}

function revertActionsLink(ctx: ViewContext, actionIds: number[]): string {
  const url = ctx.fmt.urlKey();
  const revertParams = actionIds.map((id) => `revert_actions%5B%5D=${id}`).join("&amp;");
  const href =
    `/update/${h(url)}?assign=true&amp;card%5Bskip%5D=validate_renaming&amp;look_in_trash=true` +
    (revertParams === "" ? "" : `&amp;${revertParams}`);
  return (
    `<a rel="nofollow" class="_close-modal slotter" data-slotter-mode="update-modal-origin"` +
    ` href="${href}" data-remote="true" data-method="post">revert to this</a>`
  );
}

function absoluteActLinks(actCardName: string): string {
  const url = DeckoName.parse(actCardName).urlKey;
  const linkToHistory =
    `<a class="_stop_propagation known-card" rel="nofollow" href="/${h(url)}/history?look_in_trash=true">` +
    `${historyIcon("history")}</a>`;
  const linkToActCard =
    `<a class="_stop_propagation known-card" href="/${h(url)}">${historyIcon("open_in_full")}</a>`;
  return `${linkToHistory} ${linkToActCard}`;
}

function titleInContext(fmt: RenderFormat, name: string): string {
  const absolute = DeckoName.parse(name).absoluteName(fmt.card.name).s;
  const from = fmt.contextNames;
  return from.length > 0 ? DeckoName.parse(absolute).from(...from) : absolute;
}

function relativeTitle(ctx: ViewContext, actCardName: string): string {
  return DeckoName.parse(actCardName).from(ctx.fmt.card.name);
}

function rawViewBytes(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
  content: string,
): string {
  const info = reader.actionCard(action);
  if (info?.renderCard === undefined) return content;
  const card = info.renderCard;
  const structure = ctx.fmt.engine.structureRuleForSync?.({
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    ...(card.typeName !== undefined ? { typeName: card.typeName } : {}),
  });
  if (structure !== undefined) return structure.content;
  const shadow = { ...info.renderCard, dbContent: content };
  const sub = new RenderFormat(shadow, ctx.fmt.engine, { parent: ctx.fmt });
  return sub.renderRaw();
}

function contentDiffObject(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
): ContentDiff {
  const previous = reader.previousValue(action, "content");
  const current = reader.value(action, "content");
  const previousRaw =
    previous === undefined || previous === null ? "" : rawViewBytes(ctx, reader, action, String(previous));
  const currentRaw = rawViewBytes(
    ctx,
    reader,
    action,
    current === undefined || current === null ? "" : String(current),
  );
  const diffArgs = reader.actionCard(action)?.renderCard?.typeCode === "html"
    ? { diffFormat: "raw" as const }
    : HISTORY_DIFF_ARGS;
  const dobj = new ContentDiff(previousRaw, currentRaw, diffArgs);
  ctx.fmt.engine.historyDiffMemo?.set(action.id, dobj);
  return dobj;
}

function memoizedContentDiff(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
): ContentDiff {
  const hit = ctx.fmt.engine.historyDiffMemo?.get(action.id);
  if (hit !== undefined) return hit;
  return contentDiffObject(ctx, reader, action);
}

function actionContentToggleBytes(
  ctx: ViewContext,
  action: HistoryActionRow,
  viewKind: "summary" | "expanded",
): string {
  const other = viewKind === "expanded" ? "summary" : "expanded";
  const url = ctx.fmt.urlKey();
  const icon = viewKind === "expanded" ? "expand_less" : "expand_more";
  return (
    `<a rel="nofollow" class="revision-${action.card_act_id} float-end slotter"` +
    ` href="/${h(url)}/action_${other}?action_id=${action.id}&amp;look_in_trash=true"` +
    ` data-remote="true">${historyIcon(icon)}</a>`
  );
}

function actionDiffPrewrapped(card: RenderCard): boolean {
  switch (card.typeCode) {
    case "css":
    case "scss":
    case "bootswatch_skin":
    case "java_script":
    case "coffee_script":
      return true;
    default: {
      const codename = card.record.codename;
      return codename === "bootstrap_core" || codename === "bootstrap_functions";
    }
  }
}

function actionContentBytes(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow | undefined,
  viewKind: "summary" | "expanded",
): string {
  if (action === undefined) return "";
  const value = reader.value(action, "db_content");
  const hasContent = value !== undefined && value !== null;
  const dobj = memoizedContentDiff(ctx, reader, action);
  const toggleShown = viewKind === "expanded" || dobj.summaryOmitsContent;
  const toggle = toggleShown ? actionContentToggleBytes(ctx, action, viewKind) : null;
  const rawDiff =
    !hasContent ? null : viewKind === "summary" ? dobj.summary : dobj.complete;
  const diff = actionDiffPrewrapped(ctx.fmt.card)
    ? rawDiff === null
      ? "<i>empty</i>"
      : `<pre>${rawDiff}</pre>`
    : rawDiff === null || rawDiff.trim() === ""
      ? "<i>empty</i>"
      : rawDiff;
  return toggle === null ? diff : `${toggle}\n${diff}`;
}

function fieldNameDiffObject(
  reader: HistoryRenderReader,
  action: HistoryActionRow,
  field: "name" | "cardtype",
): ContentDiff {
  const toText = (raw: string | number | boolean | null | undefined): string | null => {
    if (raw === undefined || raw === null) return null;
    if (field === "cardtype") {
      return reader.typeNameForId(Number(raw)) ?? String(raw);
    }
    return String(raw);
  };
  const previous = toText(reader.previousValue(action, field === "name" ? "name" : "type_id"));
  const value = toText(reader.value(action, field === "name" ? "name" : "type_id"));
  return new ContentDiff(previous, value);
}

function nameChangesBytes(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
): string {
  const value = reader.value(action, "name");
  const previous = reader.previousValue(action, "name");
  const oldName = previous === undefined || previous === null ? null : titleInContext(ctx.fmt, String(previous));
  if (value === undefined || value === null) {
    return oldName === null ? "" : h(oldName);
  }
  const newName = titleInContext(ctx.fmt, String(value));
  return ContentDiff.complete(oldName, newName);
}

function nestedActionSummary(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
): string {
  const info = reader.actionCard(action);
  if (info?.renderCard === undefined) return "";
  const sub = new RenderFormat(info.renderCard, ctx.fmt.engine, { parent: ctx.fmt });
  return str(sub.renderView("action_summary", { action_id: action.id }));
}

function actionRendererBytes(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  action: HistoryActionRow,
  actCardName: string,
  actionListClass = "action-list",
): string {
  const cardInfo = reader.actionCard(action);
  let nameDiff: string;
  if (cardInfo !== undefined && DeckoName.parse(cardInfo.name).isCompound) {
    nameDiff = h(DeckoName.parse(cardInfo.name).from(actCardName));
  } else {
    nameDiff = nameChangesBytes(ctx, reader, action);
  }
  let typeDiff = "";
  const typeValue = reader.value(action, "type_id");
  if (typeValue !== undefined && typeValue !== null) {
    typeDiff = fieldNameDiffObject(reader, action, "cardtype").complete;
  }
  const contentDiff = nestedActionSummary(ctx, reader, action);
  const panel =
    `\n<div class="card-header">\n${builderDiv(typeDiff, "float-end")}\n${builderDiv(nameDiff)}</div>` +
    `\n${builderDiv(contentDiff, "card-body")}`;
  return (
    `\n<div class="container-fluid">\n\n<div class="row">\n` +
    `              <ul class="${actionListClass} w-100">\n` +
    `                <li class="${actionTypeSymbol(action)}">\n` +
    `                  ${panel}\n` +
    `                </li>\n` +
    `              </ul>\n</div></div>`
  );
}

function actDetailsBytes(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  actions: HistoryActionRow[],
  actCardName: string,
  actionListClass = "action-list",
): string {
  const approved = reader.approvedActions(actions).slice(0, 21);
  return approved
    .map((action) => actionRendererBytes(ctx, reader, action, actCardName, actionListClass))
    .join("");
}

function actionFromContext(
  ctx: ViewContext,
  reader: HistoryRenderReader,
): HistoryActionRow | undefined {
  const vooActionId = ctx.voo.opts["action_id"];
  const param =
    vooActionId !== undefined && vooActionId !== null ? String(vooActionId) : reader.params.actionId;
  if (param !== undefined && param !== "") {
    return /^\d+$/.test(param) ? reader.actionById(Number(param)) : undefined;
  }
  return reader.cardLastAction;
}

function actFromContext(ctx: ViewContext, reader: HistoryRenderReader): HistoryActRow {
  const actId = reader.params.actId;
  if (actId === undefined || actId === "") {
    const last = reader.cardLastAction;
    if (last === undefined || last.card_act_id === null) {
      throw new Error("act_from_context: card has no last action (Ruby nil.act NoMethodError)");
    }
    const act = reader.actById(Number(last.card_act_id));
    if (act === undefined) {
      throw new Error("act_from_context: last action's act not loaded");
    }
    return act;
  }
  const act = reader.actById(Number(actId));
  if (act === undefined) throw new Error("act not found");
  return act;
}

function accordionItemBytes(args: {
  headerInner: string;
  subheader: string | null;
  body: string;
  collapseId: string;
}): string {
  const { headerInner, subheader, body, collapseId } = args;
  let out = `<div class='accordion-item'>\n`;
  out += `<h2 class='accordion-header nodblclick w-100'>\n`;
  const accordionButtonClass = serializerFollowsLive()
    ? "accordion-button collapsed"
    : "collapsed accordion-button";
  out += `<button class='${accordionButtonClass}' data-bs-target='#${collapseId}' data-bs-toggle='collapse' type='button'>\n`;
  out += `${headerInner}\n`;
  out += `</button>\n`;
  out += `</h2>\n`;
  out += `<div class='accordion-collapse collapse' id='${collapseId}'>\n`;
  if (subheader !== null) {
    out += `<div class='accordion-subheader bg-light p-2 text-end'>\n${subheader}\n</div>\n`;
  }
  out += `<div class='${serializerFollowsLive() ? "d0-card-body accordion-body" : "accordion-body d0-card-body"}'>\n${body}
</div>\n`;
  out += `</div>\n`;
  out += `</div>\n`;
  return out;
}

function actHeaderInner(args: { title: string; badge: string; subtitle: string }): string {
  const col1 =
    `<div class="col-8">\n${args.title}` +
    (args.badge === "" ? "" : `\n<span class="text-muted ps-1 badge">\n${args.badge}</span>`) +
    `</div>`;
  const col2 = builderDiv(args.subtitle, "col-4 text-end");
  return `\n<div class="row w-100">\n${col1}\n${col2}</div>`;
}

function relativeActSubheader(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  act: HistoryActRow,
  actions: HistoryActionRow[],
): string | null {
  const isCurrentAct = reader.cardLastAct !== undefined && reader.cardLastAct.id === act.id;
  if (isCurrentAct) return null;
  if (reader.rootUpdateAllowed === false) return null;
  const revertIds = actions.filter((a) => a.draft !== 1).map((a) => a.id);
  return `<small><div class="act-link float-end"><small>${revertActionsLink(ctx, revertIds)}</small></div></small>`;
}

function relativeActItemBytes(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  act: HistoryActRow,
  actCardName: string,
  seq: number,
): string {
  const actions = reader.actionsAffecting(act.id, reader.rootCardId!);
  const title = `<span class="nr">#${seq}</span> ${actorAndAgo(ctx, reader, act)}`;
  const subtitle =
    Number(act.card_id) === reader.rootCardId
      ? ""
      : `<small>act on ${h(relativeTitle(ctx, actCardName))}</small>`;
  const headerInner = actHeaderInner({
    title,
    badge: actSummaryBadge(reader, actions),
    subtitle,
  });
  return accordionItemBytes({
    headerInner,
    subheader: relativeActSubheader(ctx, reader, act, actions),
    body: actDetailsBytes(ctx, reader, actions, ctx.fmt.card.name.s),
    collapseId: `act-id-${act.id}`,
  });
}

const historyView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const reader = historyReader(ctx);
  voo.hide("help");
  fmt.addNameContext();
  if (reader.rootCardId === undefined) return "";
  const page = Math.max(1, Number.parseInt(reader.params.page ?? "1", 10) || 1);
  const start = (page - 1) * HISTORY_ACTS_PER_PAGE;
  const pageActs = reader.acts.slice(start, start + HISTORY_ACTS_PER_PAGE);
  let seq = reader.actsTotal - start;
  const items: string[] = [];
  for (const act of pageActs) {
    const actCard = reader.cardInfo(Number(act.card_id));
    if (actCard === undefined) {
      seq -= 1;
      continue;
    }
    items.push(relativeActItemBytes(ctx, reader, act, actCard.name, seq));
    seq -= 1;
  }
  const legendRow = actLegendRowBytes();
  const actRow = `<div class="row">\n<div class="accordion">${items.join("")}</div></div>`;
  const headerHtml = `<${fmt.isMain ? "h1" : "h2"} class="${voo.classy("d0-card-header-title")}">${fmt.renderView("title")}</${fmt.isMain ? "h1" : "h2"}>\n${fmt.renderView("menu")}`;
  const frame =
    `<div class="d0-card-frame card">` +
    `<div class="d0-card-header card-header">${headerHtml}</div>` +
    `\n\n` +
    `<div class="d0-card-body card-body card-text">\n\n${legendRow}\n${actRow}</div>` +
    `</div>`;
  return historySlotWrap(ctx, "history", frame);
};

const actView: ViewFn = (ctx) => {
  const reader = historyReader(ctx);
  const act = actFromContext(ctx, reader);
  const actCard = reader.cardInfo(Number(act.card_id));
  if (actCard === undefined) return "";
  const actions = reader.actionsOfAct(act.id);
  const headerInner = actHeaderInner({
    title: h(actCard.name),
    badge: actSummaryBadge(reader, actions),
    subtitle: actorAndAgo(ctx, reader, act),
  });
  return accordionItemBytes({
    headerInner,
    subheader: absoluteActLinks(actCard.name),
    body: actDetailsBytes(ctx, reader, actions, ctx.fmt.card.name.s),
    collapseId: `act-id-${act.id}`,
  });
};

function actListingOptsFromParams(
  params: HistoryRenderParams,
  seq: string | null | undefined,
): { actSeq: string | undefined; actionView: string; hideDiff: boolean } {
  return {
    actSeq: (seq ?? params.actSeq) || undefined,
    actionView: params.actionView || "summary",
    hideDiff: (params.hideDiff ?? "").trim() === "true",
  };
}

function boardLeftTitle(
  reader: HistoryRenderReader,
  act: HistoryActRow,
  actSeq: string | undefined,
): string {
  const actor = reader.cardInfo(Number(act.actor_id));
  const actorName = actor === undefined ? String(act.actor_id) : actor.name;
  const ago = parseActedAt(act.acted_at);
  const editedAgo = ago === undefined ? "" : `${timeAgoInWords(ago)} ago`;
  return boardLeftTitleFrom(actorName, editedAgo, actSeq);
}

function boardLeftTitleFrom(actorName: string, editedAgo: string, actSeq: string | undefined): string {
  return `#${actSeq ?? ""} ${actorName} <small>${editedAgo}</small>`;
}

function actIsDraft(reader: HistoryRenderReader, act: HistoryActRow): boolean {
  const main =
    reader.actionOn(act.id, Number(act.card_id)) ?? reader.actionsOfAct(act.id)[0];
  return main?.draft === 1;
}

function boardAutosavedDraftLink(ctx: ViewContext): string {
  return `<a class="navbar-link" href="/${h(ctx.fmt.urlKey())}?edit_draft=true">continue editing</a>`;
}

function boardRollbackOrEditLink(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  act: HistoryActRow,
  actions: HistoryActionRow[],
): string | null {
  if (actIsDraft(reader, act)) return boardAutosavedDraftLink(ctx);
  const isCurrentAct = reader.cardLastAct !== undefined && reader.cardLastAct.id === act.id;
  if (!isCurrentAct && reader.rootUpdateAllowed !== false) {
    return revertActionsLink(ctx, actions.filter((a) => a.draft !== 1).map((a) => a.id));
  }
  return null;
}

function boardOverlayTitle(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  act: HistoryActRow,
  actCardName: string,
  actSeq: string | undefined,
  actions: HistoryActionRow[],
): string {
  const left = boardLeftTitle(reader, act, actSeq);
  const summary = actSummaryBadge(reader, actions);
  const onOtherCard = Number(act.card_id) !== reader.rootCardId;
  const subtitle = onOtherCard
    ? boardSubtitleFrom(actCardName, ctx.fmt.card.name.s)
    : "";
  const rollback = boardRollbackOrEditLink(ctx, reader, act, actions);
  return boardOverlayTitleFrom(left, summary, subtitle, rollback);
}

function boardSubtitleFrom(actCardName: string, rootCardName: string): string {
  return `<small>act on ${DeckoName.parse(actCardName).from(rootCardName)}</small>`;
}

function boardOverlayTitleFrom(
  left: string,
  summary: string,
  subtitle: string,
  rollback: string | null,
): string {
  const parts = [left, summary, subtitle === "" ? null : subtitle, rollback].filter(
    (part): part is string => part !== null,
  );
  return `<div>${parts.join(" | ")}</div>`;
}

const OVERLAY_MENU_LINK_CLASS = "text-muted p-1 ms-1";

function boardOverlayMenu(ctx: ViewContext): string {
  const { fmt } = ctx;
  const rawHelp = fmt.menuHelpContentBytes();
  const helpContent = /^\s*$/.test(rawHelp) ? "&nbsp;" : rawHelp;
  const helpLink =
    `<a path="#" tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus" data-bs-content="${h(helpContent)}"` +
    ` data-bs-placement="left" class="help-link ps-1 _popover_link slotter ${OVERLAY_MENU_LINK_CLASS}"` +
    ` href="/${h(fmt.urlKey())}/overlay_guide"` +
    ` data-slot-selector=".board-sidebar &gt; ._overlay-container-placeholder &gt; .card-slot"` +
    ` data-slotter-mode="overlay" data-remote="true">${historyIcon("help")}</a>`;
  const newWindowLink =
    `<a class="${OVERLAY_MENU_LINK_CLASS} known-card" href="/${h(fmt.urlKey())}">` +
    `${historyIcon("close_fullscreen")}</a>`;
  const closeLink =
    `<a data-bs-dismiss="overlay" class="${OVERLAY_MENU_LINK_CLASS}" href="#">${historyIcon("close")}</a>`;
  return `<div class="overlay-menu">${helpLink}\n${newWindowLink}\n${closeLink}</div>`;
}

const boardActView: ViewFn = (ctx) => {
  const reader = historyReader(ctx);
  const { fmt, voo } = ctx;
  const opts = actListingOptsFromParams(reader.params, null);
  const act = actFromContext(ctx, reader);
  const actCard = reader.cardInfo(Number(act.card_id));
  if (actCard === undefined) return "";
  const actions = reader.actionsAffecting(act.id, reader.rootCardId!);
  const actionListClass = "action-list my-3";
  voo.hide("menu");
  voo.hide("help");
  voo.classUp("d0-card-header", "bg-body");
  voo.classUp("d0-card-header-title", "d-flex");
  const overlayTitle = boardOverlayTitle(ctx, reader, act, actCard.name, opts.actSeq, actions);
  const menu = boardOverlayMenu(ctx);
  const header = `<div class="${voo.classy("d0-card-header")}">${overlayTitle}\n${menu}</div>`;
  const details = boardActDetails(ctx, reader, actions, ctx.fmt.card.name.s, actionListClass);
  const body = `<div class="${voo.classy(["d0-card-body", fmt.card.setKeys])}">${details}</div>`;
  const panel = `<div class="${voo.classy("d0-card-frame")}">${header}\n\n${body}</div>`;
  return historySlotWrap(ctx, "board_act", panel, {
    "data-breadcrumb": "History",
    "data-breadcrumb-class": "history",
  }, "_overlay d0-card-overlay bg-body _overlay");
};

function boardActDetails(
  ctx: ViewContext,
  reader: HistoryRenderReader,
  actions: HistoryActionRow[],
  actCardName: string,
  actionListClass: string,
): string {
  return actDetailsBytes(ctx, reader, actions, actCardName, actionListClass);
}

export const boardProbeSurface = {
  actListingOptsFromParams(
    params: { actSeq?: string; actionView?: string; hideDiff?: string },
    seq: string | null | undefined,
  ) {
    return actListingOptsFromParams(params, seq);
  },
  boardTitleForProbe(inputs: { actSeq?: string; actorName: string; editedAgo: string; summary: string }): string {
    const left = boardLeftTitleFrom(inputs.actorName, inputs.editedAgo, inputs.actSeq);
    return boardTitleFrom(left, inputs.summary);
  },
  boardOverlayTitleForProbe(inputs: {
    actSeq?: string;
    actorName: string;
    editedAgo: string;
    summary: string;
    subtitle: string;
    rollback: string | null;
  }): string {
    const left = boardLeftTitleFrom(inputs.actorName, inputs.editedAgo, inputs.actSeq);
    return boardOverlayTitleFrom(left, inputs.summary, inputs.subtitle, inputs.rollback);
  },
  boardSubtitleForProbe(actCardName: string, rootCardName: string): string {
    return boardSubtitleFrom(actCardName, rootCardName);
  },
  boardRelativeTitleForProbe(actCardName: string, rootCardName: string): string {
    return DeckoName.parse(actCardName).from(rootCardName);
  },
  boardDetailSelectionForProbe(
    approvedActions: { id: number }[],
  ): number[] {
    return approvedActions.slice(0, 21).map((a) => a.id);
  },
  breadcrumbData(title: string, htmlClass?: string): Record<string, string> {
    return {
      "data-breadcrumb": title,
      "data-breadcrumb-class": htmlClass ?? title.toLowerCase(),
    };
  },
  actionListClass(): string {
    return "action-list my-3";
  },
};

function boardTitleFrom(left: string, right: string): string {
  return `<div class="me-2">${left}</div><div class="ms-auto act-summary">${right}</div>`;
}

const actionSummaryView: ViewFn = (ctx) => {
  const reader = historyReader(ctx);
  const action = actionFromContext(ctx, reader);
  if (action === undefined) return "";
  return historySlotWrap(ctx, "action_summary", actionContentBytes(ctx, reader, action, "summary"));
};

const actionExpandedView: ViewFn = (ctx) => {
  const reader = historyReader(ctx);
  const action = actionFromContext(ctx, reader);
  if (action === undefined) return "";
  return historySlotWrap(ctx, "action_expanded", actionContentBytes(ctx, reader, action, "expanded"));
};

const lastActionVerbView: ViewFn = (ctx) => {
  const reader = historyReader(ctx);
  const act = reader.cardLastAct;
  if (act === undefined) return "";
  const action = reader
    .actionsOfAct(act.id)
    .find((a) => a.card_id === reader.rootCardId);
  if (action === undefined) return "";
  const type = actionTypeFromCode(Number(action.action_type));
  if (type === "create") return "added";
  if (type === "delete") return "deleted";
  const url = ctx.fmt.urlKey();
  return (
    `<a class="last-edited slotter" rel="nofollow" href="/${h(url)}?view=history"` +
    ` data-remote="true">edited</a>`
  );
};

function actLegendRowBytes(): string {
  return (
    `<div class="row pb-3">\n<div class="col-md-12 col-lg-7">\n${actionLegendHtml(true)}</div>` +
    `\n<div class="col-md-12 col-lg-5 text-end">\n${contentLegendHtml()}</div></div>`
  );
}

const actLegendView: ViewFn = () => `\n${actLegendRowBytes()}`;

const lastActionView: ViewFn = (ctx) => {
  const reader = historyReader(ctx);
  const act = reader.cardLastAct;
  const verb = ctx.fmt.renderView("last_action_verb");
  const ago0 = act === undefined ? undefined : parseActedAt(act.acted_at);
  const actedAt = ago0 === undefined ? "" : timeAgoInWords(ago0);
  const actor =
    act === undefined
      ? undefined
      : reader.cardInfo(Number(act.actor_id));
  const actorLink =
    actor === undefined
      ? act === undefined
        ? ""
        : h(String(act.actor_id))
      : `<a class="known-card" href="/${h(DeckoName.parse(actor.name).urlKey)}"><span class="card-title" title="${h(actor.name)}">${h(actor.name)}</span></a>`;
  return (
    `\n      <span class="last-update">\n        ${verb} ${actedAt} ago by\n        ${actorLink}\n      </span>\n    `
  );
};

const changeView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.showViz("title_link");
  voo.hide("menu");
  const title = fmt.renderView("title_link");
  const menu = voo.show("menu") ? fmt.renderView("menu") : "";
  const lastAction = fmt.renderView("last_action");
  return historySlotWrap(
    ctx,
    "change",
    [title, menu, lastAction].filter((part) => part !== "").join("\n"),
  );
};

const historyEventNotImplemented: ModEventFn = () => {};

export const RECENT_ACTS_PER_PAGE = 25;

export async function recentActs(driver: SQLDatabaseDriver): Promise<HistoryActRow[]> {
  const maxRow = await driver.query<{ m: number | null }>(
    "SELECT MAX(id) AS m FROM card_acts",
    [],
  );
  const minId = Number(maxRow.rows[0]?.m ?? 0) - 10000;
  const limitingScan = minId > 0 ? "AND card_acts.id > ?" : "";
  const result = await driver.query<HistoryActRow>(
    `SELECT DISTINCT card_acts.* FROM card_acts
     JOIN card_actions ON card_actions.card_act_id = card_acts.id
     JOIN cards ON cards.id = card_actions.card_id
     WHERE card_actions.draft IS NOT TRUE AND card_acts.card_id IS NOT NULL
       ${limitingScan}
     ORDER BY card_acts.id DESC`,
    minId > 0 ? [minId] : [],
  );
  return result.rows;
}

export function recentChangesCoreBytes(
  fmt: RenderFormat,
  reader: HistoryRenderReader,
): string {
  const ctx: ViewContext = { fmt, voo: new Voo(undefined, "core", {}) };
  const pageActs = reader.acts.slice(0, RECENT_ACTS_PER_PAGE);
  const items: string[] = [];
  for (const act of pageActs) {
    const actCard = reader.cardInfo(Number(act.card_id));
    if (actCard === undefined) continue;
    const actions = reader.actionsOfAct(act.id);
    const headerInner = actHeaderInner({
      title: h(actCard.name),
      badge: actSummaryBadge(reader, actions),
      subtitle: actorAndAgo(ctx, reader, act),
    });
    items.push(
      accordionItemBytes({
        headerInner,
        subheader: absoluteActLinks(actCard.name),
        body: actDetailsBytes(ctx, reader, actions, actCard.name),
        collapseId: `act-id-${act.id}`,
      }),
    );
  }
  const actRow = `<div class="row">\n<div class="accordion">${items.join("")}</div></div>`;
  const legendRow =
    `<div class="row pb-3">\n<div class="col-md-12 col-lg-7">\n${actionLegendHtml(false)}</div>` +
    `\n<div class="col-md-12 col-lg-5 text-end">\n${contentLegendHtml()}</div></div>`;
  return `\n\n${legendRow}\n${actRow}`;
}

const cardModHistory: DeckoModManifest = {
  name: "history",
  gemName: "card-mod-history",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/history",
    },
    {
      setPath: "all/history/actions",
    },
    {
      setPath: "all/history/acts",
    },
    {
      setPath: "all/history/act_listing",
    },
    {
      setPath: "all/history/events",
      events: [
        {
          event: "update_ancestor_timestamps",
          at: "integrate",
          fn: historyEventNotImplemented,
        },
        {
          event: "assign_action",
          at: "initialize",
          when: "actionable?",
          fn: historyEventNotImplemented,
        },
        {
          event: "detect_conflict",
          at: "validate",
          on: ["update"],
          when: "edit_conflict?",
          fn: historyEventNotImplemented,
        },
        {
          event: "finalize_action",
          at: "finalize",
          when: "finalize_action?",
          fn: historyEventNotImplemented,
        },
        {
          event: "rollback_actions",
          at: "prepare_to_validate",
          on: ["update"],
          when: "rollback_request?",
          fn: historyEventNotImplemented,
        },
        {
          event: "finalize_act",
          after: "finalize_action",
          when: "act_card?",
          fn: historyEventNotImplemented,
        },
      ],
    },
    {
      setPath: "all/history/export",
      formats: {
        json: { views: ["history", "actions"].map(view => ({
          view,
          viewFn: ({ fmt }: ViewContext) => {
            if (fmt.card.id === undefined) return [];
            const rows = fmt.engine.historyJsonExport?.(fmt.card, view);
            if (rows === undefined) throw new Error("JSON history export rendered without its card/view seat");
            return rows as ViewResult;
          },
        })) },
      },
    },
    {
      setPath: "all/history/last",
    },
    {
      setPath: "all/history/revision",
    },
    {
      setPath: "all/history/selected",
    },
    {
      setPath: "all/history/views",
      formats: {
        html: {
          views: [
            { view: "draft_legend", viewFn: draftLegendView },
            { view: "history", viewFn: historyView },
            { view: "act", viewFn: actView },
            { view: "action_summary", viewFn: actionSummaryView },
            { view: "action_expanded", viewFn: actionExpandedView },
            { view: "last_action_verb", viewFn: lastActionVerbView },
            { view: "act_legend", viewFn: actLegendView },
            { view: "last_action", viewFn: lastActionView },
            { view: "change", viewFn: changeView },
          ],
        },
      },
    },
    {
      setPath: "all/history_board",
      formats: {
        html: {
          views: [{ view: "board_act", viewFn: boardActView, config: { cache: "never" } }],
        },
      },
    },
  ],
};

export default cardModHistory;
