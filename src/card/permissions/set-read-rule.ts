import type { SQLDatabaseDriver } from "../../server/driver.js";
import { CARD_ID_BY_CODENAME_SQL, CARD_ROW_BY_ID_SQL } from "../fetch/card-read-shapes.js";
import type { CardsRow } from "../../server/schema.js";
import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import { ruleClassName, ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import {
  resolveComposedNameIdsByKeys,
  resolveRuleIdsByComposedKeys,
} from "./read-rules.js";
import { isPreferenceName, quickTypeName } from "../actions/rule-content-walk.js";

const LEFT_RULE_CONTENT = /^\[?\[?_left\]?\]?$/;

const SET_TYPE_CODENAME = "set";
const SETTING_TYPE_CODENAME = "setting";

export interface ReadRuleRecord {
  readonly readRuleId: number | null;
  readonly readRuleClass: string | null;
}

export interface ReadRuleCardInput {
  readonly name: string;
  readonly typeId: number | null;
  readonly leftId?: number | null;
  readonly rightId?: number | null;
  readonly isNew?: boolean;
}

interface DirectRuleCard {
  readonly id: number;
  readonly content: string | null;
  readonly leftId: number | null;
  readonly rightId: number | null;
}

type RuleLookupOverlay = ReadonlyMap<string, number>;

export interface ReadRuleWriteDeps {
  readonly driver: SQLDatabaseDriver;
  readonly fetch: FetchEngine;
}

export async function deriveReadRuleRecord(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
  overlay?: RuleLookupOverlay,
): Promise<ReadRuleRecord> {
  const direct = await firstApplicableReadRule(deps, card, overlay);
  if (direct === undefined) {
    return { readRuleId: null, readRuleClass: null };
  }
  const readRuleId = await permissionRuleId(deps, card, direct, overlay);
  const readRuleClass = await directRuleClassName(deps, direct);
  return { readRuleId, readRuleClass };
}

export async function effectiveReadRuleId(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
  overlay?: RuleLookupOverlay,
): Promise<number | null> {
  const direct = await firstApplicableReadRule(deps, card, overlay);
  if (direct === undefined) return null;
  return permissionRuleId(deps, card, direct, overlay);
}

async function permissionRuleId(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
  direct: DirectRuleCard,
  overlay?: RuleLookupOverlay,
): Promise<number | null> {
  const compound = DeckoName.parse(card.name).isCompound;
  if (compound && direct.content !== null && LEFT_RULE_CONTENT.test(direct.content)) {
    return leftPermissionRuleId(deps, card, overlay);
  }
  return direct.id;
}

async function leftPermissionRuleId(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
  overlay?: RuleLookupOverlay,
): Promise<number | null> {
  const leftName = DeckoName.parse(card.name).leftName;
  if (leftName === undefined) {
    throw new Error(
      `set_read_rule: compound card ${card.name} has no resolvable left name`,
    );
  }
  const leftId =
    card.leftId ?? (await deps.fetch.lexicon.id(leftName)) ?? null;
  if (leftId !== null) {
    const leftRow = await fetchCardsRow(deps.driver, leftId);
    if (leftRow !== undefined && leftRow.trash === 0) {
      return effectiveReadRuleId(
        deps,
        await rowCardInput(deps, leftRow),
        overlay,
      );
    }
  }
  const direct = await firstApplicableReadRule(deps, {
    name: leftName.s,
    typeId: null,
    isNew: true,
  }, overlay);
  return direct?.id ?? null;
}

async function leftChainRuleCandidateKeys(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
): Promise<string[]> {
  const keys: string[] = [];
  let current: ReadRuleCardInput | undefined = card;
  while (current !== undefined) {
    const parsed = DeckoName.parse(current.name);
    if (!parsed.isCompound || parsed.leftName === undefined) break;
    const leftName = parsed.leftName;
    const leftId = current.leftId ?? (await deps.fetch.lexicon.id(leftName)) ?? null;
    if (leftId !== null) {
      const leftRow = await fetchCardsRow(deps.driver, leftId);
      if (leftRow !== undefined && leftRow.trash === 0) {
        current = await rowCardInput(deps, leftRow);
        const input = await patternCardInput(deps, current);
        for (const name of ruleNamesForCard(input, "*read")) {
          keys.push(DeckoName.parse(name).key);
        }
        continue;
      }
    }
    const virtualLeft: ReadRuleCardInput = { name: leftName.s, typeId: null, isNew: true };
    const input = await patternCardInput(deps, virtualLeft);
    for (const name of ruleNamesForCard(input, "*read")) {
      keys.push(DeckoName.parse(name).key);
    }
    break;
  }
  return keys;
}

async function firstApplicableReadRule(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
  overlay?: RuleLookupOverlay,
): Promise<DirectRuleCard | undefined> {
  const patternInput = await patternCardInput(deps, card);
  const candidates = ruleNamesForCard(patternInput, "*read");
  if (candidates.length === 0) return undefined;
  const candidateKeys = candidates.map((name) => DeckoName.parse(name).key);
  const chainKeys = DeckoName.parse(card.name).isCompound
    ? await leftChainRuleCandidateKeys(deps, card)
    : [];
  const resolved = await resolveRuleIdsByComposedKeys(
    deps.driver,
    [...candidateKeys, ...chainKeys],
  );
  if (resolved.size > 0 && typeof deps.driver.batch === "function") {
    const warmIds = new Set<number>();
    for (const id of resolved.values()) warmIds.add(id);
    if (card.leftId !== undefined && card.leftId !== null) warmIds.add(card.leftId);
    if (warmIds.size > 1) {
      await deps.driver.batch(
        [...warmIds].map((id) => ({ sql: CARD_ROW_BY_ID_SQL, params: [id] })),
      );
    }
  }
  for (const name of candidates) {
    const key = DeckoName.parse(name).key;
    const id = overlay?.get(key) ?? resolved.get(key);
    if (id === undefined) continue;
    const row = await fetchCardsRow(deps.driver, id);
    if (row === undefined || row.trash !== 0) continue;
    return {
      id: row.id,
      content: row.db_content,
      leftId: row.left_id,
      rightId: row.right_id,
    };
  }
  return undefined;
}

async function directRuleClassName(
  deps: ReadRuleWriteDeps,
  direct: DirectRuleCard,
): Promise<string | null> {
  if (direct.leftId === null || direct.rightId === null) return null;
  const trunkRow = await fetchCardsRow(deps.driver, direct.leftId);
  const setTypeId = await typeIdByCodename(deps, SET_TYPE_CODENAME);
  if (trunkRow === undefined || setTypeId === undefined) return null;
  const trunkName = await composedRowName(deps, trunkRow);
  const settingName = await cardName(deps, direct.rightId);
  if (trunkName === undefined || settingName === undefined) return null;
  const trunkIsSet = trunkRow.type_id === setTypeId;
  return ruleClassName(`${trunkName}+${settingName}`, trunkIsSet);
}

export async function isStandardRuleCardRow(
  deps: ReadRuleWriteDeps,
  row: CardsRow,
): Promise<boolean> {
  if ((row.left_id ?? null) === null || (row.right_id ?? null) === null) {
    return false;
  }
  const name = await composedRowName(deps, row);
  if (name === undefined) return false;
  const parsed = DeckoName.parse(name);
  if (!parsed.isCompound) return false;
  const setTypeId = await typeIdByCodename(deps, SET_TYPE_CODENAME);
  const settingTypeId = await typeIdByCodename(deps, SETTING_TYPE_CODENAME);
  if (setTypeId === undefined || settingTypeId === undefined) return false;
  const leftRow = await partRow(deps, parsed.leftName);
  const rightRow = await partRow(deps, parsed.rightName);
  return (
    leftRow !== undefined &&
    rightRow !== undefined &&
    leftRow.type_id === setTypeId &&
    rightRow.type_id === settingTypeId
  );
}

export async function updateReadRule(
  deps: ReadRuleWriteDeps,
  cardId: number,
  changed?: Set<number>,
  overlay?: RuleLookupOverlay,
): Promise<void> {
  const row = await fetchCardsRow(deps.driver, cardId);
  if (row === undefined || row.trash !== 0) return;
  const derived = await deriveReadRuleRecord(
    deps,
    await rowCardInput(deps, row),
    overlay,
  );
  await deps.driver.query(
    "UPDATE cards SET read_rule_id = ?, read_rule_class = ? WHERE id = ?",
    [derived.readRuleId, derived.readRuleClass, cardId],
  );
  const valueChanged =
    derived.readRuleId !== (row.read_rule_id ?? null) ||
    derived.readRuleClass !== (row.read_rule_class ?? null);
  if (!valueChanged) return;
  await cascadeLeftRuleFieldReadRules(deps, cardId, changed, overlay);
}

export async function cascadeAllFieldReadRules(
  deps: ReadRuleWriteDeps,
  cardId: number,
): Promise<void> {
  for (const fieldId of await fieldCardIds(deps, cardId)) {
    await updateReadRule(deps, fieldId);
  }
}

async function cascadeLeftRuleFieldReadRules(
  deps: ReadRuleWriteDeps,
  cardId: number,
  changed?: Set<number>,
  overlay?: RuleLookupOverlay,
): Promise<void> {
  for (const fieldId of await fieldCardIds(deps, cardId)) {
    if (changed?.has(fieldId)) continue;
    const fieldRow = await fetchCardsRow(deps.driver, fieldId);
    if (fieldRow === undefined) continue;
    const direct = await firstApplicableReadRule(
      deps,
      await rowCardInput(deps, fieldRow),
      overlay,
    );
    if (direct === undefined || direct.content === null) continue;
    if (!LEFT_RULE_CONTENT.test(direct.content)) continue;
    changed?.add(fieldId);
    await updateReadRule(deps, fieldId, changed, overlay);
  }
}

async function fieldCardIds(
  deps: ReadRuleWriteDeps,
  cardId: number,
): Promise<number[]> {
  const r = await deps.driver.query<{ id: number }>(
    "SELECT id FROM cards WHERE left_id = ? AND trash = 0 ORDER BY id",
    [cardId],
  );
  return r.rows.map((row) => row.id);
}

export async function cascadeReadRuleAfterRuleSave(
  deps: ReadRuleWriteDeps,
  ruleCardRow: CardsRow,
  nameOrTrashChanging: boolean,
  overlay?: RuleLookupOverlay,
  priorRuleCardRow?: CardsRow,
): Promise<void> {
  if (!nameOrTrashChanging) return;
  const readId = await typeIdByCodename(deps, "read");
  if (readId === undefined ||
      (ruleCardRow.right_id !== readId && priorRuleCardRow?.right_id !== readId)) return;
  if (!(await isStandardRuleCardRow(deps, ruleCardRow))) return;
  const changed = new Set<number>();

  const setRow =
    ruleCardRow.left_id !== null
      ? await fetchCardsRow(deps.driver, ruleCardRow.left_id)
      : undefined;
  if (setRow !== undefined) {
    for (const memberId of await setMemberIds(deps, setRow)) {
      if (changed.has(memberId)) continue;
      changed.add(memberId);
      await updateReadRule(deps, memberId, changed, overlay);
    }
  }

  const pointing = await deps.driver.query<{ id: number }>(
    "SELECT id FROM cards WHERE read_rule_id = ? AND trash = 0 ORDER BY id",
    [ruleCardRow.id],
  );
  for (const { id } of pointing.rows) {
    if (changed.has(id)) continue;
    changed.add(id);
    await updateReadRule(deps, id, changed, overlay);
  }
}

export const STAR_PREFIXED_MEMBERS_STATEMENT =
  `WITH RECURSIVE star_prefixed(id) AS (\n` +
  `  SELECT id FROM cards WHERE trash = 0 AND "key" LIKE '*%'\n` +
  `  UNION\n` +
  `  SELECT j.id FROM star_prefixed s\n` +
  `    JOIN cards j ON j.left_id = s.id AND j.trash = 0\n` +
  `)\n` +
  `SELECT cards.id FROM cards\n` +
  `  JOIN star_prefixed sp ON sp.id = cards.right_id\n` +
  ` WHERE cards.trash = 0 AND cards.right_id IS NOT NULL`;

export async function setMemberIds(
  deps: ReadRuleWriteDeps,
  setRow: CardsRow,
): Promise<number[]> {
  const code = await setPatternCode(deps, setRow);
  switch (code) {
    case "all":
      return allCardIds(deps, "");
    case "all_plus": {
      return allCardIds(deps, "AND cards.left_id IS NOT NULL AND cards.right_id IS NOT NULL");
    }
    case "star": {
      return allCardIds(deps, "AND cards.key LIKE '*%'");
    }
    case "rstar": {
      const r = await deps.driver.query<{ id: number }>(STAR_PREFIXED_MEMBERS_STATEMENT, []);
      return r.rows.map((row) => row.id);
    }
    case "rule":
      return junctionsWithPartTypes(deps, SET_TYPE_CODENAME, SETTING_TYPE_CODENAME);
    case "type":
    case "right":
    case "type_plus_right":
    case "self":
      return anchoredPatternMemberIds(deps, setRow, code);
    default:
      throw new Error(
        `set_read_rule cascade: unsupported set pattern '${code ?? "unknown"}' ` +
          `for set card ${setRow.id} — the core registry's nine patterns are ` +
          `the supported membership universe`,
      );
  }
}

async function anchoredPatternMemberIds(
  deps: ReadRuleWriteDeps,
  setRow: CardsRow,
  code: "type" | "right" | "type_plus_right" | "self",
): Promise<number[]> {
  if (setRow.left_id === null || setRow.left_id === undefined) return [];
  if (code === "type") {
    return allCardIds(deps, `AND cards.type_id = ${Number(setRow.left_id)}`);
  }
  if (code === "right") {
    return allCardIds(deps, `AND cards.right_id = ${Number(setRow.left_id)}`);
  }
  if (code === "type_plus_right") {
    const anchor = await fetchCardsRow(deps.driver, setRow.left_id);
    if (anchor === undefined || anchor.left_id === null || anchor.right_id === null) {
      return [];
    }
    const r = await deps.driver.query<{ id: number }>(
      `SELECT cards.id FROM cards
         JOIN cards lefts ON cards.left_id = lefts.id
        WHERE cards.trash = 0 AND lefts.trash = 0
          AND lefts.type_id = ? AND cards.right_id = ?`,
      [anchor.left_id, anchor.right_id],
    );
    return r.rows.map((row) => row.id);
  }
  const anchorRow = await fetchCardsRow(deps.driver, setRow.left_id);
  if (anchorRow === undefined) return [];
  const anchorName = await composedRowName(deps, anchorRow);
  if (anchorName === undefined || anchorName === "") return [];
  const anchorKey = DeckoName.parse(anchorName).key;
  const resolved = await resolveComposedNameIdsByKeys(deps.driver, [anchorKey]);
  return resolved.get(anchorKey) ?? [];
}

async function setPatternCode(
  deps: ReadRuleWriteDeps,
  setRow: CardsRow,
): Promise<string | null> {
  if (setRow.right_id !== null && setRow.right_id !== undefined) {
    const r = await deps.driver.query<{ codename: string | null }>(
      "SELECT codename FROM cards WHERE id = ?",
      [setRow.right_id],
    );
    return r.rows[0]?.codename ?? null;
  }
  return setRow.codename ?? null;
}

async function patternCardInput(
  deps: ReadRuleWriteDeps,
  card: ReadRuleCardInput,
): Promise<PatternCardInput> {
  const parsed = DeckoName.parse(card.name);
  let leftTypeName: string | null = null;
  if (parsed.isCompound && parsed.leftName !== undefined) {
    const leftId =
      card.leftId ?? (await deps.fetch.lexicon.id(parsed.leftName)) ?? null;
    const leftRow = leftId !== null ? await fetchCardsRow(deps.driver, leftId) : undefined;
    if (leftRow !== undefined && leftRow.trash === 0) {
      leftTypeName = (await cardName(deps, leftRow.type_id)) ?? null;
    } else {
      leftTypeName = (await quickTypeName(deps.fetch, parsed.leftName)) ?? null;
    }
  }
  return {
    name: card.name,
    id: null,
    isNew: card.isNew ?? false,
    typeId: card.typeId,
    typeName: card.typeId !== null ? ((await cardName(deps, card.typeId)) ?? null) : null,
    leftTypeName,
    isRule: parsed.isCompound
      ? (await isStandardRuleName(deps, parsed)) || (await isPreferenceName(deps.fetch, parsed))
      : false,
  };
}

async function isStandardRuleName(
  deps: ReadRuleWriteDeps,
  name: DeckoName,
): Promise<boolean> {
  const setTypeId = await typeIdByCodename(deps, SET_TYPE_CODENAME);
  const settingTypeId = await typeIdByCodename(deps, SETTING_TYPE_CODENAME);
  if (setTypeId === undefined || settingTypeId === undefined) return false;
  const leftRow = await partRow(deps, name.leftName);
  const rightRow = await partRow(deps, name.rightName);
  return (
    leftRow !== undefined &&
    rightRow !== undefined &&
    leftRow.type_id === setTypeId &&
    rightRow.type_id === settingTypeId
  );
}

async function allCardIds(
  deps: ReadRuleWriteDeps,
  extraWhere: string,
): Promise<number[]> {
  const r = await deps.driver.query<{ id: number }>(
    `SELECT cards.id FROM cards WHERE cards.trash = 0 ${extraWhere}`,
    [],
  );
  return r.rows.map((row) => row.id);
}

async function junctionsWithPartTypes(
  deps: ReadRuleWriteDeps,
  leftTypeCodename: string,
  rightTypeCodename: string,
): Promise<number[]> {
  const r = await deps.driver.query<{ id: number }>(
    `SELECT cards.id FROM cards
       JOIN cards lefts ON cards.left_id = lefts.id
       JOIN cards rights ON cards.right_id = rights.id
      WHERE cards.trash = 0
        AND lefts.type_id = (SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1)
        AND rights.type_id = (SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1)`,
    [leftTypeCodename, rightTypeCodename],
  );
  return r.rows.map((row) => row.id);
}

export async function fetchCardsRow(
  driver: SQLDatabaseDriver,
  id: number,
): Promise<CardsRow | undefined> {
  const r = await driver.query<CardsRow>(
    CARD_ROW_BY_ID_SQL,
    [id],
  );
  return r.rows[0];
}

async function partRow(
  deps: ReadRuleWriteDeps,
  partName: DeckoName | undefined,
): Promise<CardsRow | undefined> {
  if (partName === undefined) return undefined;
  const id = await deps.fetch.lexicon.id(partName);
  if (id === undefined) return undefined;
  return fetchCardsRow(deps.driver, id);
}

async function rowCardInput(
  deps: ReadRuleWriteDeps,
  row: CardsRow,
): Promise<ReadRuleCardInput> {
  const name = (await composedRowName(deps, row)) ?? "";
  return {
    name,
    typeId: row.type_id,
    leftId: row.left_id,
    rightId: row.right_id,
    isNew: false,
  };
}

async function composedRowName(
  deps: ReadRuleWriteDeps,
  row: CardsRow,
): Promise<string | undefined> {
  if (row.left_id !== null && row.left_id !== undefined && row.right_id !== null) {
    const composed = await deps.fetch.lexicon.composeName(row.left_id, row.right_id);
    if (composed !== undefined) return composed.s;
  }
  return row.name ?? undefined;
}

export async function cardName(deps: ReadRuleWriteDeps, id: number): Promise<string | undefined> {
  const row = await fetchCardsRow(deps.driver, id);
  if (row === undefined) return undefined;
  return composedRowName(deps, row);
}

export async function typeIdByCodename(
  deps: ReadRuleWriteDeps,
  codename: string,
): Promise<number | undefined> {
  const r = await deps.driver.query<{ id: number }>(CARD_ID_BY_CODENAME_SQL, [codename]);
  const id = r.rows[0]?.id;
  return id === undefined ? undefined : Number(id);
}
