import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import type { CardsRow, SQLBoolean } from "../../server/schema.js";
import { sqlDateTime } from "./act.js";
import { actionTypeCode, identifyAction } from "./action.js";
import {
  changeValueForField,
  diffTrackedFields,
  trackedFieldIndex,
  type CardFieldState,
  type TrackedField,
} from "./change.js";
import type { ReadRuleRecord } from "../permissions/set-read-rule.js";

export type { CardFieldState };

export interface ActWriterOptions {
  driver: SQLDatabaseDriver;
  actorId: number;
  actActorId?: number;
  rootStamperId?: number;
  ipAddress?: string | null;
  now?: () => Date;
  actCardId?: number;
}

export interface CreateCardInput {
  name: string | null;
  key: string | null;
  type_id: number;
  db_content?: string | null;
  left_id?: number | null;
  right_id?: number | null;
  codename?: string | null;
  readRule?: ReadRuleRecord;
  superActionId?: number | null;
  history?: boolean;
  isActCard?: boolean;
  comment?: string | null;
  reservedActionId?: number;
}

export interface UpdateCardInput {
  cardId: number;
  before: CardFieldState;
  after: CardFieldState;
  key?: string | null;
  history?: boolean;
  superActionId?: number | null;
  comment?: string | null;
  ancestorCardIds?: number[];
  readRule?: ReadRuleRecord;
  isActCard?: boolean;
  dirtyFields?: readonly TrackedField[];
  changedFields?: readonly TrackedField[];
  reservedActionId?: number;
}

export interface SavedAction {
  actId: number;
  actionId: number;
  actPreexisted?: boolean;
}

export interface CreatedCard extends SavedAction {
  cardId: number;
}

const NEW_CARD_ID_SQL = `(
  SELECT CASE WHEN history_max >= next_id THEN history_max + 1 END
  FROM (
    SELECT
      MAX(COALESCE((SELECT MAX(card_id) FROM card_acts), 0),
          COALESCE((SELECT MAX(card_id) FROM card_actions), 0)) AS history_max,
      MAX(COALESCE((SELECT MAX(id) FROM cards), 0),
          COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'cards'), 0)) + 1 AS next_id
  ) AS id_source
)`;

const ALL_TRACKED_WRITE_ORDER: (keyof CardFieldState)[] = [
  "name",
  "type_id",
  "db_content",
  "trash",
  "left_id",
  "right_id",
];

export class ActWriter {
  private readonly driver: SQLDatabaseDriver;
  private readonly actorId: number;
  private readonly actActorId: number;
  private readonly rootStamperId: number | undefined;
  private readonly ipAddress: string | null;
  private readonly clock: () => Date;
  private actCardId: number | undefined;
  private actId: number | null = null;

  private opActPreexisted = false;
  private reserveOpActPreexisted = false;

  constructor(options: ActWriterOptions) {
    this.driver = options.driver;
    this.actorId = options.actorId;
    this.actActorId = options.actActorId ?? options.actorId;
    this.rootStamperId = options.rootStamperId;
    this.ipAddress = options.ipAddress ?? null;
    this.clock = options.now ?? (() => new Date());
    this.actCardId = options.actCardId;
  }

  async createCard(input: CreateCardInput): Promise<CreatedCard> {
    this.assertNameKeyConvention(input.name, input.key, input.left_id, input.right_id);
    if (input.reservedActionId === undefined) {
      this.opActPreexisted = this.actId !== null;
    }
    const ts = sqlDateTime(this.clock());
    const trash: SQLBoolean = 0;

    const cardId = await this.insertReturningId(
      `INSERT INTO cards
         (id, name, key, codename, left_id, right_id, current_revision_id,
          created_at, updated_at, creator_id, updater_id,
          read_rule_class, read_rule_id, references_expired, trash, type_id, db_content)
       VALUES (${NEW_CARD_ID_SQL}, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        input.name,
        input.key,
        input.codename ?? null,
        input.left_id ?? null,
        input.right_id ?? null,
        ts,
        ts,
        this.cardStamperId(undefined, input.isActCard),
        this.cardStamperId(undefined, input.isActCard),
        input.readRule?.readRuleClass ?? null,
        input.readRule?.readRuleId ?? null,
        trash,
        input.type_id,
        input.db_content ?? null,
      ],
    );

    if (input.history === false) {
      return { cardId, actId: this.actId ?? 0, actionId: 0, actPreexisted: this.opActPreexisted };
    }
    const stmts: SQLStatement[] = [];
    const actIdSelect = this.pushClearDraftsAndAct(stmts, cardId, ts);
    const actionRow = {
      cardId,
      superActionId: input.superActionId ?? null,
      actionType: actionTypeCode("create"),
      comment: input.comment ?? null,
    };
    let actionIdSelect: number | undefined;
    if (input.reservedActionId !== undefined) {
      this.pushFillReservedAction(stmts, input.reservedActionId, actionRow);
    } else {
      actionIdSelect = this.pushInsertAction(stmts, { ...actionRow, draft: 0 });
    }
    const actionCountIndex = stmts.length;
    stmts.push(this.actionCountStmt(cardId));
    const batch = await this.runBatch(stmts, { actIdSelect, actionIdSelect });
    const actId = batch.actId;
    const actionId = input.reservedActionId ?? batch.actionId;

    const actionCount = Number((batch.results[actionCountIndex].rows[0] as { n: number }).n);
    if (actionCount !== 1) {
      throw new Error(
        `createCard: expected exactly 1 action row for card ${cardId}, found ${actionCount}`,
      );
    }

    await this.finalizeActCard(cardId, this.isActCardOp(cardId, input.isActCard));
    return {
      cardId,
      actId: this.requireActId(actId),
      actionId: requireId(actionId),
      actPreexisted: this.opActPreexisted,
    };
  }

  async reserveCreateAction(): Promise<number> {
    this.reserveOpActPreexisted = this.actId !== null;
    this.opActPreexisted = this.reserveOpActPreexisted;
    const ts = sqlDateTime(this.clock());
    const stmts: SQLStatement[] = [];
    const actIdSelect = this.actId === null ? this.pushInsertAct(stmts, null, ts) : undefined;
    const actionIdSelect = this.pushInsertAction(stmts, {
      cardId: null,
      superActionId: null,
      actionType: actionTypeCode("create"),
      draft: 0,
      comment: null,
    });
    const { actionId } = await this.runBatch(stmts, { actIdSelect, actionIdSelect });
    return requireId(actionId);
  }

  async updateCard(input: UpdateCardInput): Promise<SavedAction | null> {
    this.opActPreexisted = this.actId !== null;
    let changed =
      input.changedFields !== undefined
        ? ALL_TRACKED_WRITE_ORDER.filter((f) => input.changedFields!.includes(f))
        : diffTrackedFields(input.before, input.after);
    if (changed.length === 0 && input.dirtyFields !== undefined) {
      changed = [...input.dirtyFields];
    }
    if (changed.length === 0) {
      if (this.actId === null && this.isActCardOp(input.cardId, input.isActCard)) {
        const stmts: SQLStatement[] = [];
        const actIdSelect = this.pushInsertAct(stmts, input.cardId, sqlDateTime(this.clock()));
        await this.runBatch(stmts, { actIdSelect });
      }
      return null;
    }
    if (changed.includes("name")) {
      if (input.key === undefined) {
        throw new Error(
          "updateCard: a name change requires `key` (name= writes key=; lib/card/name/all.rb:20-23)",
        );
      }
      this.assertNameKeyConvention(
        input.after.name,
        input.key,
        input.after.left_id,
        input.after.right_id,
      );
    }

    const actionType = identifyAction({
      trashBefore: input.before.trash,
      trashAfter: input.after.trash,
      isNewCard: false,
    });
    const ts = sqlDateTime(this.clock());
    if (input.history === false) {
      const stmts: SQLStatement[] = [];
      this.pushUpdateCardsRow(stmts, input, changed, ts);
      await this.driver.batch(stmts);
      return { actId: this.actId ?? 0, actionId: 0, actPreexisted: this.opActPreexisted };
    }

    const [countResult, draftResult, firstActionResult] = await this.driver.batch([
      this.actionCountStmt(input.cardId),
      this.ownDraftCountStmt(input.cardId),
      this.firstNonDraftActionStmt(input.cardId),
    ]);
    const actionCountBefore = Number((countResult.rows[0] as { n: number }).n);
    const ownDrafts = Number((draftResult.rows[0] as { n: number }).n);
    const actionCountAtFinalize = actionCountBefore - ownDrafts + 1;
    let backfill: { createActionId: number } | null = null;
    if (actionType !== "create" && actionCountAtFinalize === 2) {
      const firstRow = firstActionResult.rows[0] as
        | { id: number; action_type: number }
        | undefined;
      const createAction =
        firstRow === undefined
          ? undefined
          : { id: Number(firstRow.id), action_type: Number(firstRow.action_type) };
      if (createAction !== undefined) {
        if ((await this.changeCount(createAction.id)) === 0) {
          backfill = { createActionId: createAction.id };
        }
      }
    }

    const stmts: SQLStatement[] = [];
    const actIdSelect = this.pushClearDraftsAndAct(stmts, input.cardId, ts);
    const updateCardsIndex = this.pushUpdateCardsRow(stmts, input, changed, ts);
    const actionRow = {
      cardId: input.cardId,
      superActionId: input.superActionId ?? null,
      actionType: actionTypeCode(actionType),
      comment: input.comment ?? null,
    };
    let actionIdSelect: number | undefined;
    if (input.reservedActionId !== undefined) {
      this.pushFillReservedAction(stmts, input.reservedActionId, actionRow);
    } else {
      actionIdSelect = this.pushInsertAction(stmts, { ...actionRow, draft: 0 });
    }
    if (backfill !== null) {
      for (const field of ALL_TRACKED_WRITE_ORDER) {
        this.pushInsertChange(stmts, { kind: "id", id: backfill.createActionId }, field, input.before[field]);
      }
    }
    for (const field of changed) {
      this.pushInsertChange(stmts, { kind: "newActionRow", cardId: input.cardId }, field, input.after[field]);
    }
    const ancestors = input.ancestorCardIds ?? [];
    if (ancestors.length > 0) {
      stmts.push({
        sql: `UPDATE cards SET updated_at = ?, updater_id = ? WHERE id IN (${ancestors
          .map(() => "?")
          .join(", ")})`,
        params: [ts, this.actorId, ...ancestors],
      });
    }

    const { actId, actionId, results } = await this.runBatch(stmts, {
      actIdSelect,
      actionIdSelect,
    });

    const saved = {
      actId: this.requireActId(actId),
      actionId: input.reservedActionId ?? requireId(actionId),
      actPreexisted: this.opActPreexisted,
    };
    const updateResult = results[updateCardsIndex];
    if (updateResult.rowsAffected !== 1) {
      throw new Error(
        `updateCard: cards row ${input.cardId} not updated (rowsAffected=${updateResult.rowsAffected})`,
      );
    }
    await this.finalizeActCard(input.cardId, this.isActCardOp(input.cardId, input.isActCard));
    return saved;
  }

  async recordUploadDraft(input: {
    cardId: number;
    actionType: "create" | "update";
    comment: string | null;
    changes: (actionId: number) => [keyof CardFieldState, string | number | null][];
  }): Promise<SavedAction> {
    const ts = sqlDateTime(this.clock());
    const stmts: SQLStatement[] = [];
    const actIdSelect = this.actId === null ? this.pushInsertAct(stmts, null, ts) : undefined;
    const actionIdSelect = this.pushInsertAction(stmts, {
      cardId: input.cardId,
      superActionId: null,
      actionType: actionTypeCode(input.actionType),
      draft: 1,
      comment: input.comment,
    });
    const { actId, actionId } = await this.runBatch(stmts, { actIdSelect, actionIdSelect });
    const saved = { actId: this.requireActId(actId), actionId: requireId(actionId) };
    const changeStmts: SQLStatement[] = [];
    for (const [field, value] of input.changes(saved.actionId)) {
      this.pushInsertChange(changeStmts, { kind: "id", id: saved.actionId }, field, value);
    }
    if (changeStmts.length > 0) await this.driver.batch(changeStmts);
    return saved;
  }

  async deleteActionRow(actionId: number): Promise<void> {
    await this.driver.batch([{ sql: "DELETE FROM card_actions WHERE id = ?", params: [actionId] }]);
  }

  async trashCard(input: {
    cardId: number;
    before: CardFieldState;
    history?: boolean;
    after?: CardFieldState;
    key?: string | null;
    superActionId?: number | null;
    ancestorCardIds?: number[];
  }): Promise<SavedAction | null> {
    const after: CardFieldState =
      input.after ?? (input.before.trash === 1 ? input.before : { ...input.before, trash: 1 });
    return this.updateCard({ ...input, after });
  }

  async saveDraft(input: { cardId: number; content: string | null }): Promise<SavedAction> {
    const ts = sqlDateTime(this.clock());
    const stmts: SQLStatement[] = [];
    this.pushClearOwnDrafts(stmts, input.cardId);
    const actIdSelect = this.pushInsertAct(stmts, input.cardId, ts);
    const actionIdSelect = this.pushInsertAction(stmts, {
      cardId: input.cardId,
      superActionId: null,
      actionType: actionTypeCode("update"),
      draft: 1,
      comment: null,
    });
    this.pushInsertChange(stmts, { kind: "newActionRow", cardId: input.cardId }, "db_content", input.content);
    const { actId, actionId } = await this.runBatch(stmts, { actIdSelect, actionIdSelect });
    return { actId: this.requireActId(actId), actionId: requireId(actionId) };
  }

  async clearOwnDrafts(cardId: number): Promise<void> {
    const stmts: SQLStatement[] = [];
    this.pushClearOwnDrafts(stmts, cardId);
    await this.driver.batch(stmts);
  }

  async reserveAction(input: {
    actionType: "create" | "update";
    superActionId?: number | null;
  }): Promise<number> {
    this.reserveOpActPreexisted = this.actId !== null;
    this.opActPreexisted = this.reserveOpActPreexisted;
    const stmts: SQLStatement[] = [];
    const actIdSelect =
      this.actId === null ? this.pushInsertAct(stmts, null, sqlDateTime(this.clock())) : undefined;
    const actionIdSelect = this.pushInsertAction(stmts, {
      cardId: null,
      superActionId: input.superActionId ?? null,
      actionType: actionTypeCode(input.actionType),
      draft: 0,
      comment: null,
    });
    const { actionId } = await this.runBatch(stmts, { actIdSelect, actionIdSelect });
    return requireId(actionId);
  }

  private pushFillReservedAction(
    stmts: SQLStatement[],
    reservedId: number,
    input: { cardId: number; superActionId: number | null; actionType: number; comment: string | null },
  ): void {
    stmts.push({
      sql: "UPDATE card_actions SET card_id = ?, super_action_id = ?, action_type = ?, comment = ? WHERE id = ?",
      params: [input.cardId, input.superActionId, input.actionType, input.comment, reservedId],
    });
  }

  currentActId(): number | null {
    return this.actId;
  }

  private pushClearDraftsAndAct(
    stmts: SQLStatement[],
    draftsCardId: number,
    ts: string,
  ): number | undefined {
    this.pushClearOwnDrafts(stmts, draftsCardId);
    if (this.actId !== null) return undefined;
    return this.pushInsertAct(stmts, null, ts);
  }

  private pushInsertAct(
    stmts: SQLStatement[],
    cardId: number | null,
    actedAt: string,
  ): number {
    stmts.push({
      sql: "INSERT INTO card_acts (card_id, actor_id, acted_at, ip_address) VALUES (?, ?, ?, ?)",
      params: [cardId, this.actActorId, actedAt, this.ipAddress],
    });
    stmts.push({ sql: "SELECT last_insert_rowid() AS id", params: [] });
    return stmts.length - 1;
  }

  private pushInsertAction(
    stmts: SQLStatement[],
    input: {
      cardId: number | null;
      superActionId: number | null;
      actionType: number;
      draft: SQLBoolean;
      comment: string | null;
    },
  ): number {
    const actIdSql = this.actId === null ? "last_insert_rowid()" : "?";
    const params =
      this.actId === null
        ? [input.cardId, input.superActionId, input.actionType, input.draft, input.comment]
        : [
            input.cardId,
            this.actId,
            input.superActionId,
            input.actionType,
            input.draft,
            input.comment,
          ];
    stmts.push({
      sql: `INSERT INTO card_actions
              (card_id, card_act_id, super_action_id, action_type, draft, comment)
            VALUES (?, ${actIdSql}, ?, ?, ?, ?)`,
      params,
    });
    stmts.push({ sql: "SELECT last_insert_rowid() AS id", params: [] });
    return stmts.length - 1;
  }

  private pushInsertChange(
    stmts: SQLStatement[],
    actionId: { kind: "id"; id: number } | { kind: "newActionRow"; cardId: number },
    field: keyof CardFieldState,
    value: string | number | SQLBoolean | null,
  ): void {
    if (actionId.kind === "newActionRow") {
      stmts.push({
        sql: `INSERT INTO card_changes (card_action_id, field, value)
              VALUES ((SELECT MAX(id) FROM card_actions WHERE card_id = ?), ?, ?)`,
        params: [actionId.cardId, trackedFieldIndex(field), changeValueForField(field, value)],
      });
      return;
    }
    stmts.push({
      sql: "INSERT INTO card_changes (card_action_id, field, value) VALUES (?, ?, ?)",
      params: [actionId.id, trackedFieldIndex(field), changeValueForField(field, value)],
    });
  }

  private pushClearOwnDrafts(stmts: SQLStatement[], cardId: number): void {
    const draftPredicate = `card_actions.card_id = ?
      AND card_actions.draft = 1
      AND card_actions.card_act_id IN (SELECT id FROM card_acts WHERE actor_id = ?)`;
    stmts.push({
      sql: `DELETE FROM card_actions WHERE ${draftPredicate}`,
      params: [cardId, this.actorId],
    });
  }

  private pushUpdateCardsRow(
    stmts: SQLStatement[],
    input: UpdateCardInput,
    changed: (keyof CardFieldState)[],
    ts: string,
  ): number {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of changed) {
      sets.push(`${field} = ?`);
      params.push(input.after[field]);
    }
    if (changed.includes("name")) {
      sets.push("key = ?");
      params.push(input.key ?? null);
    }
    if (input.readRule !== undefined) {
      sets.push("read_rule_class = ?", "read_rule_id = ?");
      params.push(input.readRule.readRuleClass, input.readRule.readRuleId);
    }
    sets.push("updated_at = ?", "updater_id = ?");
    params.push(ts, this.cardStamperId(input.cardId, input.isActCard));
    stmts.push({
      sql: `UPDATE cards SET ${sets.join(", ")} WHERE id = ?`,
      params: [...params, input.cardId],
    });
    return stmts.length - 1;
  }

  private async runBatch(
    stmts: SQLStatement[],
    reads: { actIdSelect?: number; actionIdSelect?: number },
  ): Promise<{ actId?: number; actionId?: number; results: SQLQueryResult[] }> {
    const results = await this.driver.batch(stmts);
    const out: { actId?: number; actionId?: number; results: SQLQueryResult[] } = { results };
    if (reads.actIdSelect !== undefined) {
      out.actId = selectId(results[reads.actIdSelect]);
    }
    if (reads.actionIdSelect !== undefined) {
      out.actionId = selectId(results[reads.actionIdSelect]);
    }
    if (out.actId !== undefined) this.actId = out.actId;
    return out;
  }

  private async finalizeActCard(cardId: number, isActCard: boolean): Promise<void> {
    if (!isActCard || this.actId === null) return;
    if (this.actCardId !== undefined && this.actCardId !== cardId) {
      throw new Error(
        `ActWriter: card ${cardId} claims act-card status already held by card ${this.actCardId}`,
      );
    }
    this.actCardId = cardId;
    await this.driver.query("UPDATE card_acts SET card_id = ? WHERE id = ?", [
      cardId,
      this.actId,
    ]);
  }

  private isActCardOp(cardId: number, explicit: boolean | undefined): boolean {
    if (explicit !== undefined) {
      if (explicit && this.actCardId !== undefined && this.actCardId !== cardId) {
        throw new Error(
          `ActWriter: card ${cardId} claims act-card status already held by card ${this.actCardId}`,
        );
      }
      if (explicit) this.actCardId = cardId;
      return explicit;
    }
    if (this.actCardId !== undefined) return this.actCardId === cardId;
    this.actCardId = cardId;
    return true;
  }

  private cardStamperId(cardId: number | undefined, explicit: boolean | undefined): number {
    const root = explicit ?? (this.actCardId === undefined || cardId === this.actCardId);
    return root ? this.rootStamperId ?? this.actorId : this.actorId;
  }

  private requireActId(readBack?: number): number {
    const id = this.actId ?? readBack;
    if (id === undefined || id === null) {
      throw new Error("ActWriter: no act row persisted yet");
    }
    return id;
  }

  private async insertReturningId(sql: string, params: unknown[]): Promise<number> {
    const result = await this.driver.query(sql, params);
    if (result.lastInsertRowId !== undefined) {
      return Number(result.lastInsertRowId);
    }
    const rows = await this.driver.query<{ id: number }>("SELECT last_insert_rowid() AS id", []);
    return Number(rows.rows[0].id);
  }

  private actionCountStmt(cardId: number): SQLStatement {
    return {
      sql: "SELECT COUNT(*) AS n FROM card_actions WHERE card_id = ?",
      params: [cardId],
    };
  }

  private ownDraftCountStmt(cardId: number): SQLStatement {
    return {
      sql: `SELECT COUNT(*) AS n FROM card_actions
       WHERE card_actions.card_id = ? AND card_actions.draft = 1
         AND card_actions.card_act_id IN (SELECT id FROM card_acts WHERE actor_id = ?)`,
      params: [cardId, this.actorId],
    };
  }

  private firstNonDraftActionStmt(cardId: number): SQLStatement {
    return {
      sql: `SELECT id, action_type FROM card_actions
       WHERE card_id = ? AND (draft IS NULL OR draft = 0)
       ORDER BY id LIMIT 1`,
      params: [cardId],
    };
  }

  private async actionCount(cardId: number): Promise<number> {
    const stmt = this.actionCountStmt(cardId);
    const result = await this.driver.query<{ n: number }>(stmt.sql, stmt.params);
    return Number(result.rows[0].n);
  }

  private async ownDraftCount(cardId: number): Promise<number> {
    const stmt = this.ownDraftCountStmt(cardId);
    const result = await this.driver.query<{ n: number }>(stmt.sql, stmt.params);
    return Number(result.rows[0].n);
  }

  private async firstNonDraftAction(
    cardId: number,
  ): Promise<{ id: number; action_type: number } | undefined> {
    const stmt = this.firstNonDraftActionStmt(cardId);
    const result = await this.driver.query<{ id: number; action_type: number }>(stmt.sql, stmt.params);
    return result.rows[0];
  }

  private async changeCount(actionId: number): Promise<number> {
    const result = await this.driver.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_changes WHERE card_action_id = ?",
      [actionId],
    );
    return Number(result.rows[0].n);
  }

  private assertNameKeyConvention(
    name: string | null,
    key: string | null,
    leftId: number | null | undefined,
    rightId: number | null | undefined,
  ): void {
    const compound = (leftId ?? null) !== null || (rightId ?? null) !== null;
    if (compound && (name !== null || key !== null)) {
      throw new Error(
        "ActWriter: compound cards (left_id/right_id set) must carry name = key = NULL",
      );
    }
    if (!compound && (name === null || key === null)) {
      throw new Error("ActWriter: simple cards require both name and key");
    }
  }
}

function requireId(id: number | undefined): number {
  if (id === undefined) {
    throw new Error("ActWriter: id read-back returned no row (last_insert_rowid unavailable)");
  }
  return id;
}

function selectId(result: SQLQueryResult): number | undefined {
  const row = result.rows[0] as { id: number } | undefined;
  return row === undefined ? undefined : Number(row.id);
}

export function cardFieldStateFromRow(row: CardsRow): CardFieldState {
  return {
    name: row.name,
    type_id: row.type_id,
    db_content: row.db_content,
    trash: row.trash,
    left_id: row.left_id,
    right_id: row.right_id,
  };
}
