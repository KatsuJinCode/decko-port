import { DeckoName, type Nameish } from "../name.js";
import type { FetchEngine } from "../fetch.js";
import { composeCardRecord, type CardRecord } from "../fetch/card-record.js";
import type { CardsRow } from "../../server/schema.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { patternsForCard } from "../set-patterns/card-patterns.js";
import type { PatternInstance } from "../set-patterns/instance.js";
import { ruleCacheStatement, buildRuleLookupHash, type RuleCacheRow } from "./rule-cache.js";

export interface RuleLookupResult {
  rule: CardRecord;
  setName: string;
  candidates: string[];
  matchedIndex: number;
}

export async function findRule(
  fetcher: FetchEngine,
  card: PatternCardInput,
  settingName: Nameish,
  requestedSettingCode?: string,
): Promise<RuleLookupResult | undefined> {
  const patternNames = new Map<string, string>();
  const patterns = patternsForCard(card, patternNames);
  await fetcher.codenames.ensureLoaded();
  await Promise.all(patterns.map(async pattern => {
    const name = await fetcher.codenames.name(pattern.patternCode);
    if (name !== undefined) patternNames.set(pattern.patternCode, name.s);
  }));
  const setting = DeckoName.parse(settingName);
  const settingCode = requestedSettingCode ?? (setting.s.startsWith("*")
    ? setting.key.slice(1)
    : (await fetcher.fetchByName(setting))?.codename ?? setting.key);
  const currentSettingName = setting.s.startsWith("*") && setting.key === DeckoName.parse(`*${settingCode.replaceAll("_", " ")}`).key
    ? (await fetcher.codenames.name(settingCode))?.s ?? setting.s
    : setting.s;
  const candidates = ruleNamesForCard(card, currentSettingName, patternNames);
  await declareRuleCandidates(fetcher, candidates);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const record =
      (i === 0 ? await legacySelfRule(fetcher, card, candidate, currentSettingName) : undefined) ??
      (typeof fetcher.fetchWithOptions === "function"
        ? await fetcher.fetchWithOptions([candidate], { skipVirtual: true })
        : await fetcher.fetchByName(candidate));
    const patternKey = record === undefined ? undefined : await requestedPatternKey(fetcher, patterns[i]);
    if (record !== undefined && record.name !== undefined && patternKey !== undefined) {
      const qualified = await qualifiedRule(fetcher, record, `${patternKey}+${settingCode}`);
      if (qualified === undefined) continue;
      return {
        rule: { ...record, dbContent: qualified.content },
        setName: candidate.split("+").slice(0, -1).join("+") || candidate,
        candidates,
        matchedIndex: i,
      };
    }
  }
  return undefined;
}

async function requestedPatternKey(fetcher: FetchEngine, pattern: PatternInstance | undefined): Promise<string | undefined> {
  if (pattern === undefined) return undefined;
  if (pattern.anchorless) return pattern.patternCode;
  const anchorId = pattern.spec.anchorId?.(pattern.cardInput) ||
    (pattern.anchorName === undefined ? undefined : await fetcher.lexicon.id(pattern.anchorName));
  return anchorId ? `${anchorId}+${pattern.patternCode}` : undefined;
}

async function qualifiedRule(fetcher: FetchEngine, record: CardRecord, requestedKey: string): Promise<{ content: string | undefined } | undefined> {
  if (record.id === undefined) return undefined;
  await fetcher.codenames.ensureLoaded();
  const setTypeId = fetcher.codenames.peekId("set");
  const settingTypeId = fetcher.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return undefined;
  const statement = ruleCacheStatement(setTypeId, settingTypeId, { includeContent: true });
  const result = await fetcher.driver.query<RuleCacheRow & { rule_content: string | null }>(
    `${statement.sql} AND rules.id = ?`, [...statement.params, record.id],
  );
  if (buildRuleLookupHash(result.rows, id => fetcher.codenames.peekNameForId(id)).get(requestedKey) !== record.id) return undefined;
  const row = result.rows[0];
  if (row === undefined || !Object.hasOwn(row, "rule_content")) throw new Error("Qualified rule read omitted its current content");
  return { content: row.rule_content ?? undefined };
}

async function declareRuleCandidates(
  fetcher: FetchEngine,
  candidates: readonly string[],
): Promise<void> {
  if (fetcher.lexicon.prefetchIds === undefined) return;
  const names: DeckoName[] = [];
  for (const candidate of candidates) {
    try {
      names.push(DeckoName.parse(candidate));
    } catch {
    }
  }
  if (names.length === 0) return;
  await fetcher.lexicon.prefetchIds(names);
}

async function legacySelfRule(
  fetcher: FetchEngine,
  card: PatternCardInput,
  candidate: string,
  settingCode: Nameish,
): Promise<CardRecord | undefined> {
  const id = card.id;
  if (id === undefined || id === null) return undefined;
  const name = DeckoName.parse(card.name);
  if (!name.isCompound) return undefined;
  const setting = DeckoName.parse(settingCode);
  if (DeckoName.parse(candidate).key !== DeckoName.parse(`${name.s}+*self+${setting.s}`).key) return undefined;
  const row = await fetcher.fetchById(id);
  if (row !== undefined && row.leftId !== undefined && row.leftId !== null && row.rightId !== undefined && row.rightId !== null) {
    return undefined;
  }
  await fetcher.codenames.ensureLoaded();
  const selfId = fetcher.codenames.peekId("self");
  const setTypeId = fetcher.codenames.peekId("set");
  const settingTypeId = fetcher.codenames.peekId("setting");
  const settingCard = await fetcher.fetchByName(setting.s);
  if (selfId === undefined || setTypeId === undefined || settingTypeId === undefined || settingCard?.id === undefined) {
    return undefined;
  }
  if (settingCard.typeId !== settingTypeId) return undefined;
  const result = await fetcher.driver.query<CardsRow>(
    `SELECT r.* FROM cards s JOIN cards r ON r.left_id = s.id
      WHERE s.left_id = ? AND s.right_id = ? AND s.type_id = ? AND s.trash = 0
        AND r.right_id = ? AND r.trash = 0
        AND EXISTS (SELECT 1 FROM cards c WHERE c.id = s.left_id AND c.left_id IS NULL AND c.trash = 0)
        AND (? != 'follow' OR r.db_content != '')
      LIMIT 1`,
    [id, selfId, setTypeId, settingCard.id, settingCard.codename ?? ""],
  );
  const ruleRow = result.rows[0];
  if (ruleRow === undefined) return undefined;
  const rule = await composeCardRecord(ruleRow, fetcher.lexicon);
  if (rule.name !== undefined) return rule;
  const ruleName = DeckoName.parse(candidate);
  return { ...rule, name: ruleName, key: ruleName.key };
}

export async function findRules(
  fetcher: FetchEngine,
  card: PatternCardInput,
  settingCodes: readonly Nameish[],
): Promise<RuleLookupResult[]> {
  const results: RuleLookupResult[] = [];
  for (const code of settingCodes) {
    const found = await findRule(fetcher, card, code);
    if (found !== undefined) results.push(found);
  }
  return results;
}

export function ruleCacheKey(
  anchorId: number | undefined,
  patternCode: string,
  settingCode: string,
): string {
  return [anchorId, patternCode, settingCode].filter((x) => x !== undefined).join("+");
}

export function nameAsPatternCardInput(name: Nameish): PatternCardInput {
  return { name: DeckoName.parse(name).s };
}

export class PreferenceUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferenceUserError";
  }
}

export function preferenceUserId(
  user: number | { id: number } | null | undefined,
  currentId: number | undefined,
): number | undefined {
  if (typeof user === "number") return user;
  if (user !== null && user !== undefined && typeof user === "object") return user.id;
  if (user === null || user === undefined) return currentId;
  throw new PreferenceUserError("invalid preference user");
}
