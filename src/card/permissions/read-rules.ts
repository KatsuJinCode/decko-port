import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../server/driver.js";
import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import { CARD_ID_BY_JUNCTION_PLUS_SQL } from "../fetch/card-read-shapes.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";

const READ_SETTING_NAME = "*read";

const READ_CODENAME = "read";
const SET_CODENAME = "set";
const ANYONE_CODENAME = "anyone";
const ANYONE_SIGNED_IN_CODENAME = "anyone_signed_in";
const ANONYMOUS_CODENAME = "anonymous";
const ADMINISTRATOR_CODENAME = "administrator";
const DECKOBOT_CODENAME = "decko_bot";
const MEMBERS_CODENAME = "members";
const ROLE_CODENAME = "role";

export interface ReadViewer {
  readonly signedIn: boolean;
  readonly actorId?: number;
  readonly enabledRoleIds?: readonly number[];
}

export const ANONYMOUS_VIEWER: ReadViewer = { signedIn: false };

export interface ReadPermissionState {
  readonly readableRuleIds: Set<number>;
  readonly alwaysOk: boolean;
  readonly hasReadRules: boolean;
  readonly hasCatchAllReadRule: boolean;
  readonly parties: number[];
  readonly grantedRoleIds?: readonly number[];
  readonly signedInActorId?: number;
}

interface PartyRuleRow {
  partyId: number;
  readRuleId: number;
}

export const PERMISSION_GATE_COUNT_STATEMENT_INDEX = 2;

export function permissionGateCountJsonArm(): string {
  const body = readPermissionStatements()[PERMISSION_GATE_COUNT_STATEMENT_INDEX].sql;
  return (
    `(WITH gate AS (${body}) ` +
    `SELECT json_group_array(json_object('c', g.c, 'catchAll', g.catchAll)) FROM gate g)`
  );
}

export function readPermissionStatements(viewer?: ReadViewer): SQLStatement[] {
  const statements: SQLStatement[] = [
    {
      sql:
        `SELECT id, codename, key, left_id FROM cards WHERE codename IN ` +
        `('${ANYONE_CODENAME}', '${ANYONE_SIGNED_IN_CODENAME}', '${ANONYMOUS_CODENAME}', ` +
        `'${ADMINISTRATOR_CODENAME}', '${DECKOBOT_CODENAME}') ` +
        `AND trash = 0 ORDER BY id`,
      params: [],
    },
    {
      sql:
        `SELECT refs.referee_id AS partyId, read_rules.id AS readRuleId ` +
        `FROM cards read_rules ` +
        `JOIN card_references refs ON refs.referer_id = read_rules.id ` +
        `JOIN cards sets ON read_rules.left_id = sets.id ` +
        `WHERE read_rules.right_id = ` +
        `  (SELECT id FROM cards WHERE codename = '${READ_CODENAME}' AND trash = 0 ORDER BY id LIMIT 1) ` +
        `AND sets.type_id = ` +
        `  (SELECT id FROM cards WHERE codename = '${SET_CODENAME}' AND trash = 0 ORDER BY id LIMIT 1) ` +
        `AND read_rules.trash = 0 AND sets.trash = 0`,
      params: [],
    },
    {
      sql:
        `SELECT COUNT(*) AS c, ` +
        `COALESCE(SUM(CASE WHEN cards.left_id = ` +
        `  (SELECT id FROM cards WHERE codename = 'all' AND trash = 0 ORDER BY id LIMIT 1) ` +
        `THEN 1 ELSE 0 END), 0) AS catchAll ` +
        `FROM cards WHERE cards.right_id = ` +
        `(SELECT id FROM cards WHERE codename = '${READ_CODENAME}' AND trash = 0 ORDER BY id LIMIT 1) ` +
        `AND cards.trash = 0`,
      params: [],
    },
  ];
  if (viewer !== undefined && viewer.signedIn && viewer.actorId !== undefined) {
    statements.push(rolePartyStatement(viewer.actorId));
  }
  return statements;
}

function rolePartyStatement(actorId: number): SQLStatement {
  return {
    sql:
      `SELECT lists.left_id AS roleId ` +
      `FROM card_references refs ` +
      `JOIN cards lists ON lists.id = refs.referer_id ` +
      `JOIN cards roles ON roles.id = lists.left_id ` +
      `WHERE refs.referee_id = ? AND refs.referee_id IS NOT NULL ` +
      `AND lists.right_id = ` +
      `  (SELECT id FROM cards WHERE codename = '${MEMBERS_CODENAME}' AND trash = 0 ORDER BY id LIMIT 1) ` +
      `AND lists.trash = 0 AND roles.trash = 0 ` +
      `AND roles.type_id = ` +
      `  (SELECT id FROM cards WHERE codename = '${ROLE_CODENAME}' AND trash = 0 ORDER BY id LIMIT 1) ` +
      `ORDER BY lists.left_id`,
    params: [actorId],
  };
}

export function readPermissionStateFromResults(
  results: SQLQueryResult[],
  actorId: number | undefined,
  signedIn: boolean,
): ReadPermissionState {
  return readPermissionStateFromViewerResults(results, { signedIn, actorId });
}

export function readPermissionStateFromViewerResults(
  results: SQLQueryResult[],
  viewer: ReadViewer,
): ReadPermissionState {
  const codenameRows = (results[0]?.rows ?? []) as Array<{ id: number; codename: string | null }>;
  const cacheRows = (results[1]?.rows ?? []) as Array<PartyRuleRow>;
  const ruleCount = (results[2]?.rows ?? []) as Array<{ c: number; catchAll: number }>;
  const actorId = viewer.actorId;
  const signedIn = viewer.signedIn === true && actorId !== undefined;
  const roleRows = signedIn
    ? ((results[3]?.rows ?? []) as Array<{ roleId: number }>)
    : [];

  const byCodename = new Map<string, number>();
  for (const row of codenameRows) {
    if (row.codename !== null && !byCodename.has(row.codename)) byCodename.set(row.codename, row.id);
  }
  const anyone = byCodename.get(ANYONE_CODENAME);
  const anyoneSignedIn = byCodename.get(ANYONE_SIGNED_IN_CODENAME);
  const administratorId = byCodename.get(ADMINISTRATOR_CODENAME);
  const deckobotId = byCodename.get(DECKOBOT_CODENAME);

  let roles: number[] = [];
  for (const row of roleRows) {
    if (!roles.includes(row.roleId)) roles.push(row.roleId);
  }
  const grantedRoleIds = [
    ...(signedIn && anyoneSignedIn !== undefined ? [anyoneSignedIn] : []), ...roles,
  ];
  const selected = signedIn && viewer.enabledRoleIds !== undefined
    ? new Set(viewer.enabledRoleIds) : undefined;
  if (selected !== undefined) roles = roles.filter(id => selected.has(id));

  const alwaysOk =
    signedIn &&
    actorId !== undefined &&
    (actorId === deckobotId ||
      (administratorId !== undefined && roles.includes(administratorId)));

  const parties: number[] = anyone !== undefined ? [anyone] : [];
  if (signedIn && anyoneSignedIn !== undefined && (selected === undefined || selected.has(anyoneSignedIn))) parties.push(anyoneSignedIn);
  parties.push(...roles);
  if (actorId !== undefined) parties.push(actorId);

  const cache = new Map<number, number[]>();
  for (const row of cacheRows) {
    if (row.partyId === null || row.partyId === undefined) continue;
    const list = cache.get(row.partyId);
    if (list === undefined) cache.set(row.partyId, [row.readRuleId]);
    else list.push(row.readRuleId);
  }

  const readableRuleIds = new Set<number>();
  for (const party of parties) {
    for (const ruleId of cache.get(party) ?? []) readableRuleIds.add(ruleId);
  }
  return {
    readableRuleIds,
    alwaysOk,
    hasReadRules: (ruleCount[0]?.c ?? 0) > 0,
    hasCatchAllReadRule: (ruleCount[0]?.catchAll ?? 0) > 0,
    parties,
    signedInActorId: signedIn ? actorId : undefined,
    ...(selected === undefined ? {} : { grantedRoleIds }),
  };
}

export function anonymousIdFromResults(results: SQLQueryResult[]): number | undefined {
  const codenameRows = (results[0]?.rows ?? []) as Array<{ id: number; codename: string | null }>;
  return codenameRows.find((row) => row.codename === ANONYMOUS_CODENAME)?.id;
}

export function actorKeyFromResults(
  results: SQLQueryResult[],
  actorId: number | undefined,
): { key: string | undefined } | undefined {
  if (actorId === undefined) return undefined;
  const codenameRows = (results[0]?.rows ?? []) as Array<{
    id: number;
    key: string | null;
    left_id: number | null;
  }>;
  const row = codenameRows.find((candidate) => candidate.id === actorId);
  if (row === undefined || (row.left_id !== null && row.left_id !== undefined)) return undefined;
  return { key: row.key ?? undefined };
}

export async function resolveAnonymousReadPermission(
  driver: SQLDatabaseDriver,
): Promise<ReadPermissionState> {
  const results = await driver.batch(readPermissionStatements());
  return readPermissionStateFromViewerResults(results, {
    signedIn: false,
    actorId: anonymousIdFromResults(results),
  });
}

export function canReadByStoredRule(
  readRuleId: number,
  state: ReadPermissionState,
): boolean {
  if (state.alwaysOk) return true;
  return state.readableRuleIds.has(readRuleId);
}

const LEFT_DELEGATION_CONTENT = /^\[?\[?_left\]?\]?$/m;

const LEFT_DELEGATION_MAX_DEPTH = 16;

export async function canReadByRuleLookup(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ReadPermissionState,
): Promise<boolean | undefined> {
  return canReadByRuleLookupDepth(fetcher, card, state, 0);
}

async function canReadByRuleLookupDepth(
  fetcher: FetchEngine,
  card: PatternCardInput,
  state: ReadPermissionState,
  depth: number,
): Promise<boolean | undefined> {
  if (state.alwaysOk) return true;
  if (!state.hasReadRules) return false;
  const candidates = ruleNamesForCard(
    card.id === undefined ? { ...card, isNew: true } : card,
    READ_SETTING_NAME,
  );
  const cardName = card.name === undefined ? undefined : DeckoName.parse(card.name);
  const resolved = await resolveRuleRowsByRuleKeys(
    fetcher.driver,
    candidates.map((name) => DeckoName.parse(name).key),
    cardName?.isCompound === true,
  );
  for (const name of candidates) {
    const key = DeckoName.parse(name).key;
    const rule = resolved.get(key);
    if (rule === undefined) continue;
    if (
      depth < LEFT_DELEGATION_MAX_DEPTH &&
      cardName !== undefined &&
      cardName.isCompound &&
      LEFT_DELEGATION_CONTENT.test(rule.content ?? "")
    ) {
      return readThroughLeftCard(fetcher, cardName, state, depth);
    }
    return state.readableRuleIds.has(rule.id);
  }
  return false;
}

async function readThroughLeftCard(
  fetcher: FetchEngine,
  name: DeckoName,
  state: ReadPermissionState,
  depth: number,
): Promise<boolean | undefined> {
  const leftName = name.leftName;
  const leftKey = leftName?.key;
  if (leftName === undefined || leftKey === undefined || leftKey === "") {
    return canReadByRuleLookupDepth(fetcher, { name, id: undefined }, state, depth + 1);
  }
  const left = await fetcher.fetchByKey(leftKey, { skipVirtual: true });
  if (left === undefined) {
    return canReadByRuleLookupDepth(fetcher, { name: leftName, id: undefined }, state, depth + 1);
  }
  const input: PatternCardInput = {
    name: left.name ?? leftName,
    id: left.id,
    ...(left.typeId !== undefined ? { typeId: left.typeId } : {}),
  };
  if (left.typeId !== undefined) {
    const typeCard = await fetcher.fetchById(left.typeId);
    if (typeCard?.name !== undefined && typeCard.name !== null) input.typeName = typeCard.name;
  }
  const leftInputName = DeckoName.parse(input.name);
  if (leftInputName.isCompound) {
    const leftLeftKey = leftInputName.leftName?.key;
    if (leftLeftKey !== undefined && leftLeftKey !== "") {
      const leftLeft = await fetcher.fetchByKey(leftLeftKey, { skipVirtual: true });
      if (leftLeft !== undefined && leftLeft.typeId !== undefined) {
        const leftLeftType = await fetcher.fetchById(leftLeft.typeId);
        if (leftLeftType?.name !== undefined && leftLeftType.name !== null) {
          input.leftTypeName = leftLeftType.name;
        }
      }
    }
  }
  return canReadByRuleLookupDepth(fetcher, input, state, depth + 1);
}

export async function resolveRuleIdsByKeys(
  driver: SQLDatabaseDriver,
  keys: string[],
): Promise<Map<string, number>> {
  const rows = await resolveRuleRowsByKeys(driver, keys, false);
  const out = new Map<string, number>();
  for (const [key, row] of rows) out.set(key, row.id);
  return out;
}

export async function resolveRuleIdsByRuleKeys(
  driver: SQLDatabaseDriver,
  keys: string[],
): Promise<Map<string, number>> {
  const rows = await resolveRuleRowsByRuleKeys(driver, keys, false);
  const out = new Map<string, number>();
  for (const [key, row] of rows) out.set(key, row.id);
  return out;
}

function segmentRuns(key: string): string[] {
  const parts = key.split("+");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j <= parts.length; j += 1) out.push(parts.slice(i, j).join("+"));
  }
  return out.sort((a, b) => a.split("+").length - b.split("+").length || a.length - b.length);
}

const MAX_BOUND_PARAMETERS = 100;

export async function resolveComposedNameIdsByKeys(
  driver: SQLDatabaseDriver,
  keys: string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (keys.length === 0) return out;
  const ordered = [...new Set(keys)].sort();
  let cache = ruleResolutionCaches.get(driver);
  if (cache === undefined) {
    cache = { contentById: new Map() };
    ruleResolutionCaches.set(driver, cache);
  }
  cache.composedNames ??= new Map();
  const memo = cache.composedNames;

  const unresolved = ordered.filter((key) => !memo.has(key));
  if (unresolved.length > 0) {
    const walked = await walkComposedNames(driver, unresolved);
    const live = ruleResolutionCaches.get(driver);
    if (live !== undefined) cache = live;
    else ruleResolutionCaches.set(driver, cache);
    const target = cache.composedNames ?? memo;
    for (const key of unresolved) {
      const ids = walked.get(key);
      if (ids === undefined || ids.length === 0) target.set(key, null);
      else if (ids.length === 1) target.set(key, ids[0] as number);
    }
  }
  for (const key of ordered) {
    const id = memo.get(key);
    if (id !== undefined && id !== null) out.set(key, [id]);
  }
  return out;
}

export async function resolveRuleIdsByComposedKeys(
  driver: SQLDatabaseDriver,
  keys: string[],
): Promise<Map<string, number>> {
  const resolved = await resolveComposedNameIdsByKeys(driver, keys);
  const out = new Map<string, number>();
  for (const key of resolved.keys()) {
    const id = resolved.get(key)?.[0];
    if (id !== undefined) out.set(key, id);
  }
  return out;
}

async function walkComposedNames(
  driver: SQLDatabaseDriver,
  keys: string[],
): Promise<Map<string, number[]>> {
  const levels = new Map<number, string[]>();
  for (const key of keys) {
    for (const run of segmentRuns(key)) {
      const n = run.split("+").length;
      const level = levels.get(n);
      if (level === undefined) levels.set(n, [run]);
      else if (!level.includes(run)) level.push(run);
    }
  }
  const resolved = new Map<string, number[]>();
  const storedAny = new Map<string, number[]>();

  const levelOrder = [...levels.keys()].sort((a, b) => a - b);
  const seedSlices: string[][] = [];
  for (const n of levelOrder) {
    const runs = levels.get(n) as string[];
    for (let i = 0; i < runs.length; i += MAX_BOUND_PARAMETERS) {
      seedSlices.push(runs.slice(i, i + MAX_BOUND_PARAMETERS));
    }
  }
  const seedResults = await driver.batch(
    seedSlices.map((slice) => ({
      sql: `SELECT id, "key", trash FROM cards WHERE "key" IN (${slice.map(() => "?").join(", ")})`,
      params: slice,
    })),
  );
  let seedCursor = 0;

  for (const n of levelOrder) {
    const runs = levels.get(n) as string[];
    for (const run of runs) if (!resolved.has(run)) resolved.set(run, []);
    for (let i = 0; i < runs.length; i += MAX_BOUND_PARAMETERS) {
      const result = seedResults[seedCursor];
      seedCursor += 1;
      if (result === undefined) continue;
      for (const row of result.rows as { id: number; key: string; trash: number | null }[]) {
        const any = storedAny.get(row.key);
        if (any === undefined) storedAny.set(row.key, [row.id]);
        else any.push(row.id);
        if (row.trash === 0) {
          const seed = resolved.get(row.key);
          if (seed === undefined) resolved.set(row.key, [row.id]);
          else seed.push(row.id);
        }
      }
    }
    if (n === 1) continue;

    const pairs: Array<{ ckey: string; left: number; right: number }> = [];
    const seen = new Map<string, Set<string>>();
    const add = (ckey: string, left: number, right: number): void => {
      let asked = seen.get(ckey);
      if (asked === undefined) seen.set(ckey, (asked = new Set()));
      const pairKey = `${left}:${right}`;
      if (asked.has(pairKey)) return;
      asked.add(pairKey);
      pairs.push({ ckey, left, right });
    };
    for (const run of runs) {
      const parts = run.split("+");
      for (let cut = 1; cut < parts.length; cut += 1) {
        const leftKey = parts.slice(0, cut).join("+");
        const rightKey = parts.slice(cut).join("+");
        for (const left of resolved.get(leftKey) ?? []) {
          for (const right of storedAny.get(rightKey) ?? []) add(run, left, right);
        }
        for (const left of storedAny.get(leftKey) ?? []) {
          for (const right of resolved.get(rightKey) ?? []) add(run, left, right);
        }
      }
    }
    if (pairs.length === 0) continue;
    const statements: SQLStatement[] = pairs.map((pair) => ({
      sql: CARD_ID_BY_JUNCTION_PLUS_SQL,
      params: [pair.left, pair.right],
    }));
    const results =
      statements.length === 1
        ? [await driver.query(statements[0]?.sql as string, statements[0]?.params ?? [])]
        : await driver.batch(statements);
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i] as { ckey: string; left: number; right: number };
      const ids = resolved.get(pair.ckey);
      if (ids === undefined) continue;
      for (const row of results[i]?.rows ?? []) {
        const id = (row as { id: number }).id;
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }

  const ambiguous = keys.filter((key) => (resolved.get(key)?.length ?? 0) > 1);
  const out = new Map<string, number[]>();
  for (const key of keys) {
    const ids = resolved.get(key);
    if (ids !== undefined && ids.length === 1) out.set(key, ids);
  }
  if (ambiguous.length > 0) {
    const decided = await resolveRowsAgainst(driver, ambiguous, false, "wholeDeck");
    for (const [key, row] of decided) out.set(key, [row.id]);
  }
  return out;
}

export interface ResolvedRuleRow {
  id: number;
  content: string | null;
}

interface RuleResolutionDriverCache {
  universe?: Map<string, number>;
  ruleUniverse?: Map<string, number>;
contentById: Map<number, string | null>;
  composedNames?: Map<string, number | null>;
}

function universeFor(
  cache: RuleResolutionDriverCache,
  scope: RuleResolutionScope,
): Map<string, number> | undefined {
  return scope === "ruleClosure" ? cache.ruleUniverse : cache.universe;
}

function setUniverseFor(
  cache: RuleResolutionDriverCache,
  scope: RuleResolutionScope,
  universe: Map<string, number>,
): void {
  if (scope === "ruleClosure") cache.ruleUniverse = universe;
  else cache.universe = universe;
}

const ruleResolutionCaches = new WeakMap<SQLDatabaseDriver, RuleResolutionDriverCache>();

export function expireRuleResolutionCache(driver: SQLDatabaseDriver): void {
  ruleResolutionCaches.delete(driver);
}

export const RULE_KEY_UNIVERSE_STATEMENT =
  `WITH RECURSIVE resolved(id, ckey) AS (\n` +
  `  SELECT id, "key" FROM cards WHERE "key" IS NOT NULL AND +trash = 0\n` +
  `  UNION\n` +
  `  SELECT j.id, l.ckey || '+' || r."key" FROM resolved l\n` +
  `    JOIN cards j ON j.left_id = l.id AND +j.trash = 0\n` +
  `    JOIN cards r ON r.id = j.right_id AND r."key" IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT j.id, l."key" || '+' || r.ckey FROM resolved r\n` +
  `    JOIN cards j ON j.right_id = r.id AND +j.trash = 0\n` +
  `    JOIN cards l ON l.id = j.left_id AND l."key" IS NOT NULL\n` +
  `)\n` +
  `SELECT rs.ckey, rs.id FROM resolved rs`;

const TASK_RULE_SETTING_NAMES: readonly string[] = [
  READ_SETTING_NAME,
  "*create",
  "*update",
  "*delete",
];

export const LEGACY_RULE_KEY_RULE_CLOSURE_STATEMENT =
  `WITH RECURSIVE\n` +
  `anc(id) AS (\n` +
  `  SELECT r.left_id FROM cards r\n` +
  `    JOIN cards st ON st.id = r.right_id\n` +
  `    WHERE +r.trash = 0 AND st."key" IN (${TASK_RULE_SETTING_NAMES.map(() => "?").join(", ")})\n` +
  `      AND r.left_id IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT j.left_id FROM anc a\n` +
  `    JOIN cards j ON j.id = a.id\n` +
  `    WHERE j.left_id IS NOT NULL\n` +
  `),\n` +
  `resolved(id, ckey) AS (\n` +
  `  SELECT c.id, c."key" FROM cards c\n` +
  `    WHERE c."key" IS NOT NULL AND +c.trash = 0\n` +
  `      AND (c.id IN (SELECT id FROM anc)\n` +
  `        OR ${TASK_RULE_SETTING_NAMES.map((n) => `c."key" LIKE '%+${n}'`).join("\n        OR ")})\n` +
  `  UNION\n` +
  `  SELECT j.id, l.ckey || '+' || r."key" FROM resolved l\n` +
  `    JOIN cards j ON j.left_id = l.id AND +j.trash = 0\n` +
  `    JOIN cards r ON r.id = j.right_id AND r."key" IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT j.id, l."key" || '+' || r.ckey FROM resolved r\n` +
  `    JOIN cards j ON j.right_id = r.id AND +j.trash = 0\n` +
  `    JOIN cards l ON l.id = j.left_id AND l."key" IS NOT NULL\n` +
  `)\n` +
  `SELECT rs.ckey, rs.id FROM resolved rs\n` +
  `WHERE ${TASK_RULE_SETTING_NAMES.map((n) => `rs.ckey LIKE '%+${n}'`).join(" OR ")}`;

for (const n of TASK_RULE_SETTING_NAMES) {
  if (n.length === 0 || /[+%_]/.test(n) || !/^[\x21-\x7e]+$/.test(n)) {
    throw new Error(`rule-closure walk: setting name ${JSON.stringify(n)} must be printable ASCII without '+', '%' or '_'`);
  }
}

function endsInRuleSuffix(col: string): string {
  return TASK_RULE_SETTING_NAMES.map((n) => `${col} LIKE '%+${n}'`).join(" OR ");
}

const RULE_SUFFIX_LAST_CHARS = [
  ...new Set(TASK_RULE_SETTING_NAMES.flatMap((n) => {
    const c = n.slice(-1);
    return [c.toLowerCase(), c.toUpperCase()];
  })),
];

export const RULE_KEY_RULE_CLOSURE_STATEMENT =
  `WITH RECURSIVE\n` +
  `anc(id) AS (\n` +
  `  SELECT r.left_id FROM cards r\n` +
  `    JOIN cards st ON st.id = r.right_id\n` +
  `    WHERE +r.trash = 0 AND st."key" IN (${TASK_RULE_SETTING_NAMES.map(() => "?").join(", ")})\n` +
  `      AND r.left_id IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT j.left_id FROM anc a\n` +
  `    JOIN cards j ON j.id = a.id\n` +
  `    WHERE j.left_id IS NOT NULL\n` +
  `),\n` +
  `tc(id) AS MATERIALIZED (\n` +
  `  SELECT c.id FROM cards c\n` +
  `    WHERE substr(c."key", -1) IN (${RULE_SUFFIX_LAST_CHARS.map((c) => `'${c}'`).join(", ")})\n` +
  `      AND (${TASK_RULE_SETTING_NAMES.map((n) => `c."key" LIKE '%+${n}' OR c."key" LIKE '${n}'`).join("\n        OR ")})\n` +
  `),\n` +
  `tl(parent, child) AS MATERIALIZED (\n` +
  `  SELECT j.id, j.left_id FROM tc CROSS JOIN cards j ON j.right_id = tc.id\n` +
  `    WHERE j.left_id IS NOT NULL\n` +
  `),\n` +
  `d(id) AS (\n` +
  `  SELECT child FROM tl\n` +
  `  UNION\n` +
  `  SELECT c.left_id FROM d CROSS JOIN cards c ON c.id = d.id WHERE c.left_id IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT c.right_id FROM d CROSS JOIN cards c ON c.id = d.id WHERE c.right_id IS NOT NULL\n` +
  `),\n` +
  `dl(parent, child) AS MATERIALIZED (\n` +
  `  SELECT c.id, c.left_id FROM d CROSS JOIN cards c ON c.id = d.id WHERE c.left_id IS NOT NULL\n` +
  `),\n` +
  `dr(parent, child) AS MATERIALIZED (\n` +
  `  SELECT c.id, c.right_id FROM d CROSS JOIN cards c ON c.id = d.id WHERE c.right_id IS NOT NULL\n` +
  `),\n` +
  `dtl(parent, child) AS MATERIALIZED (\n` +
  `  SELECT parent, child FROM dl\n` +
  `  UNION\n` +
  `  SELECT parent, child FROM tl\n` +
  `),\n` +
  `resolved(id, ckey, content) AS (\n` +
  `  SELECT c.id, c."key", c.db_content FROM anc CROSS JOIN cards c ON c.id = anc.id\n` +
  `    WHERE c."key" IS NOT NULL AND +c.trash = 0\n` +
  `  UNION\n` +
  `  SELECT c.id, c."key", c.db_content FROM tc CROSS JOIN cards c ON c.id = tc.id\n` +
  `    WHERE c."key" IS NOT NULL AND +c.trash = 0\n` +
  `      AND (${endsInRuleSuffix(`c."key"`)})\n` +
  `  UNION\n` +
  `  SELECT j.id, l.ckey || '+' || r."key", j.db_content FROM resolved l\n` +
  `    JOIN dtl ON dtl.child = l.id\n` +
  `    JOIN cards j ON j.id = dtl.parent AND +j.trash = 0\n` +
  `    JOIN cards r ON r.id = j.right_id AND r."key" IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT j.id, l."key" || '+' || r.ckey, j.db_content FROM resolved r\n` +
  `    JOIN dr ON dr.child = r.id\n` +
  `    JOIN cards j ON j.id = dr.parent AND +j.trash = 0\n` +
  `    JOIN cards l ON l.id = j.left_id AND l."key" IS NOT NULL\n` +
  `  UNION\n` +
  `  SELECT j.id, l."key" || '+' || r.ckey, j.db_content FROM resolved r\n` +
  `    JOIN cards j ON j.right_id = r.id AND +j.trash = 0\n` +
  `    JOIN cards l ON l.id = j.left_id AND l."key" IS NOT NULL\n` +
  `    WHERE ${endsInRuleSuffix(`('+' || r.ckey)`)}\n` +
  `)\n` +
  `SELECT rs.ckey, rs.id, rs.content FROM resolved rs\n` +
  `WHERE ${endsInRuleSuffix("rs.ckey")}`;

function ruleClosureStatement(): string {
  if (typeof process !== "undefined" && process.env?.DECKO_LEGACY_RULE_CLOSURE === "1") {
    return LEGACY_RULE_KEY_RULE_CLOSURE_STATEMENT;
  }
  return RULE_KEY_RULE_CLOSURE_STATEMENT;
}

export const RULE_CLOSURE_PARAMS: readonly string[] = TASK_RULE_SETTING_NAMES;

export async function resolveRuleRowsByKeys(
  driver: SQLDatabaseDriver,
  keys: string[],
  withContent: boolean,
): Promise<Map<string, ResolvedRuleRow>> {
  return resolveRowsAgainst(driver, keys, withContent, "wholeDeck");
}

export async function resolveRuleRowsByRuleKeys(
  driver: SQLDatabaseDriver,
  keys: string[],
  withContent: boolean,
): Promise<Map<string, ResolvedRuleRow>> {
  return resolveRowsAgainst(driver, keys, withContent, "ruleClosure");
}

export function ruleClosureWalkStatement(driver: SQLDatabaseDriver): SQLStatement | undefined {
  const cache = ruleResolutionCaches.get(driver);
  if (cache !== undefined && universeFor(cache, "ruleClosure") !== undefined) return undefined;
  return { sql: ruleClosureStatement(), params: [...TASK_RULE_SETTING_NAMES] };
}

export function primeRuleClosureUniverse(driver: SQLDatabaseDriver, result: SQLQueryResult): void {
  let cache = ruleResolutionCaches.get(driver);
  if (cache === undefined) {
    cache = { contentById: new Map() };
    ruleResolutionCaches.set(driver, cache);
  }
  if (universeFor(cache, "ruleClosure") !== undefined) return;
  const universe = new Map<string, number>();
  for (const row of (result.rows ?? []) as Array<{
    ckey: string;
    id: number;
    content?: string | null;
  }>) {
    universe.set(row.ckey, row.id);
    if (row.content !== undefined) cache.contentById.set(row.id, row.content);
  }
  setUniverseFor(cache, "ruleClosure", universe);
}

type RuleResolutionScope = "wholeDeck" | "ruleClosure";

async function resolveRowsAgainst(
  driver: SQLDatabaseDriver,
  keys: string[],
  withContent: boolean,
  scope: RuleResolutionScope,
): Promise<Map<string, ResolvedRuleRow>> {
  if (keys.length === 0) return new Map();
  let cache = ruleResolutionCaches.get(driver);
  if (cache === undefined) {
    cache = { contentById: new Map() };
    ruleResolutionCaches.set(driver, cache);
  }
  if (universeFor(cache, scope) === undefined) {
    const result = await driver.query<{ ckey: string; id: number }>(
      scope === "ruleClosure" ? ruleClosureStatement() : RULE_KEY_UNIVERSE_STATEMENT,
      scope === "ruleClosure" ? [...TASK_RULE_SETTING_NAMES] : [],
    );
    cache = ruleResolutionCaches.get(driver) ?? { contentById: new Map() };
    ruleResolutionCaches.set(driver, cache);
    if (universeFor(cache, scope) === undefined) {
      const universe = new Map<string, number>();
      for (const row of result.rows) universe.set(row.ckey, row.id);
      setUniverseFor(cache, scope, universe);
    }
  }
  const universe = universeFor(cache, scope);
  if (universe === undefined) throw new Error("rule resolution universe missing after build");
  const ordered = [...keys].sort();
  const out = new Map<string, ResolvedRuleRow>();
  if (!withContent) {
    for (const key of ordered) {
      const id = universe.get(key);
      if (id !== undefined) out.set(key, { id, content: null });
    }
    return out;
  }
  const missing = new Set<number>();
  for (const key of ordered) {
    const id = universe.get(key);
    if (id === undefined) continue;
    out.set(key, { id, content: null });
    if (!cache.contentById.has(id)) missing.add(id);
  }
  if (missing.size > 0) {
    const ids = [...missing];
    const result = await driver.query<{ id: number; db_content: string | null }>(
      `SELECT id, db_content FROM cards WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    const fetched = new Map<number, string | null>();
    for (const row of result.rows) fetched.set(row.id, row.db_content);
    cache = ruleResolutionCaches.get(driver) ?? cache;
    for (const [id, content] of fetched) cache.contentById.set(id, content);
    for (const row of out.values()) {
      const fresh = fetched.get(row.id);
      row.content = fresh !== undefined ? fresh : (cache.contentById.get(row.id) ?? null);
    }
    return out;
  }
  for (const row of out.values()) row.content = cache.contentById.get(row.id) ?? null;
  return out;
}
