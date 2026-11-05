import type { SQLDatabaseDriver, SQLStatement, SQLQueryResult } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { DeckoName } from "../name.js";
import { permissionGateCountJsonArm } from "../permissions/read-rules.js";
import type { PageBundle, OneTripRuleCandidate } from "./types.js";
import type { RenderPlan, RenderPlanEntry } from "./render-plan.js";
import { isPipelineAbleRenderStatement } from "./render-plan.js";
import { envValue } from "../debug-flags.js";

export const DERIVED_STORE_ATTACH = "one_trip";

export const ONE_TRIP_STORE_INLINE = "inline";

export function isInlineStoreSpec(storeSpec: string): boolean {
  return storeSpec === ONE_TRIP_STORE_INLINE;
}

export function oneTripWantsStoredPlans(): boolean {
  return envValue("DECKO_ONE_TRIP_PLANS") !== "0";
}

function sqlQuotePath(path: string): string {
  if (path.includes("\x00")) throw new Error("one-trip attach: NUL in side-store path");
  return `'${path.replace(/'/g, "''")}'`;
}

export async function attachDerivedStore(
  driver: SQLDatabaseDriver,
  sideStorePath: string,
  attachName: string = DERIVED_STORE_ATTACH,
): Promise<void> {
  await driver.query(`ATTACH DATABASE ${sqlQuotePath(sideStorePath)} AS ${attachName}`, []);
}

export async function detachDerivedStore(
  driver: SQLDatabaseDriver,
  attachName: string = DERIVED_STORE_ATTACH,
): Promise<void> {
  await driver.query(`DETACH DATABASE ${attachName}`, []);
}

export function oneTripFetchSql(attachName: string = DERIVED_STORE_ATTACH): string {
  return `WITH RECURSIVE walk(id) AS (
  SELECT id FROM cards WHERE "key" = ? AND trash = 0
  UNION
  SELECT e.referee_id
    FROM walk
    JOIN ${attachName}.one_trip_edges e ON e.referer_id = walk.id
   WHERE e.referee_id IS NOT NULL
),
members(id) AS (
  SELECT id FROM walk
  UNION
  SELECT pc.card_id FROM ${attachName}.one_trip_page_closure pc
   WHERE pc.page_id = (SELECT id FROM cards WHERE "key" = ? AND trash = 0)
)
SELECT json_object(
  'page_key', ?,
  'cards', (
    SELECT json_group_array(json_object(
      'id', c.id, 'name', c.name, 'key', c."key", 'codename', c.codename,
      'left_id', c.left_id, 'right_id', c.right_id,
      'current_revision_id', c.current_revision_id,
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'creator_id', c.creator_id, 'updater_id', c.updater_id,
      'read_rule_class', c.read_rule_class, 'read_rule_id', c.read_rule_id,
      'references_expired', c.references_expired, 'trash', c.trash,
      'type_id', c.type_id, 'db_content', c.db_content))
    FROM (SELECT DISTINCT co.* FROM cards co JOIN members m ON m.id = co.id) c
  ),
  'rule_candidates', (
    SELECT json_group_array(json_object(
      'card_id', r.card_id, 'setting_code', r.setting_code,
      'candidate_key', r.candidate_key, 'candidate_id', r.candidate_id))
    FROM ${attachName}.one_trip_page_rules r
    WHERE r.page_id = (SELECT id FROM cards WHERE "key" = ? AND trash = 0)
      AND r.card_id = r.page_id
  ),
  'search_results', (
    SELECT json_group_array(json_object(
      'search_card_id', s.search_card_id, 'position', s.position, 'card_id', s.card_id))
    FROM ${attachName}.one_trip_search_results s
    WHERE s.search_card_id IN (
      SELECT m.id FROM members m
      JOIN ${attachName}.one_trip_search_nests n ON n.search_card_id = m.id
    )
  )
) AS bundle`;
}

interface BundleDocument {
  page_key: string;
  cards: (CardsRow & { key: string | null })[];
  rule_candidates: {
    card_id: number;
    setting_code: string;
    candidate_key: string;
    candidate_id: number | null;
  }[];
  search_results: { search_card_id: number; position: number; card_id: number }[];
}

export const ONE_TRIP_INLINE_CARDS_PER_CHUNK = 100;

export function inlineStoreCteSql(): string {
  return `WITH RECURSIVE walk(id) AS (
  SELECT id FROM cards WHERE "key" = ? AND trash = 0
  UNION
  SELECT e.referee_id
    FROM walk
    JOIN one_trip_edges e ON e.referer_id = walk.id
   WHERE e.referee_id IS NOT NULL
),
members(id) AS (
  SELECT id FROM walk
  UNION
  SELECT pc.card_id FROM one_trip_page_closure pc
   WHERE pc.page_id = (SELECT id FROM cards WHERE "key" = ? AND trash = 0)
)`;
}

export const ONE_TRIP_RENDER_PLAN_MAX_BYTES = 2_000_000;

function inlineHeadSql(readPlans: boolean): string {
  const planColumn = readPlans
    ? `,
  (
    SELECT json_group_array(json_object('sql', t.sql, 'params', t.params_json))
      FROM (SELECT sql, params_json FROM one_trip_render_plans
             WHERE page_id = (SELECT id FROM cards WHERE "key" = ? AND trash = 0)
             ORDER BY seq) t
  ) AS plan_json`
    : "";
  return `${inlineStoreCteSql()}
SELECT json_quote(?) AS page_key_json,
  (
    SELECT v.version
      FROM deck_data_version v
     WHERE v.id = 1
  ) AS deck_data_version,
  ${permissionGateCountJsonArm()} AS permission_gate_json,
  (
    SELECT json_group_array(json_object(
      'card_id', r.card_id, 'setting_code', r.setting_code,
      'candidate_key', r.candidate_key, 'candidate_id', r.candidate_id))
    FROM one_trip_page_rules r
    WHERE r.page_id = (SELECT id FROM cards WHERE "key" = ? AND trash = 0)
      AND r.card_id = r.page_id
  ) AS rule_candidates_json,
  (
    SELECT json_group_array(json_object(
      'search_card_id', s.search_card_id, 'position', s.position, 'card_id', s.card_id))
    FROM one_trip_search_results s
    WHERE s.search_card_id IN (
      SELECT m.id FROM members m
      JOIN one_trip_search_nests n ON n.search_card_id = m.id
    )
  ) AS search_results_json${planColumn},
  (
    SELECT json_group_array(m2.id)
      FROM (SELECT m.id FROM members m ORDER BY m.id) m2
  ) AS member_ids_json`;
}

function inlineCardsChunkSql(): string {
  return `SELECT json_object(
  'id', c.id, 'name', c.name, 'key', c."key", 'codename', c.codename,
  'left_id', c.left_id, 'right_id', c.right_id,
  'current_revision_id', c.current_revision_id,
  'created_at', c.created_at, 'updated_at', c.updated_at,
  'creator_id', c.creator_id, 'updater_id', c.updater_id,
  'read_rule_class', c.read_rule_class, 'read_rule_id', c.read_rule_id,
  'references_expired', c.references_expired, 'trash', c.trash,
  'type_id', c.type_id, 'db_content', c.db_content) AS card_json
  FROM (SELECT DISTINCT co.* FROM cards co
          JOIN (SELECT value AS id FROM json_each(?)) m ON m.id = co.id) c
 ORDER BY c.id`;
}

interface InlineHeadRow {
  page_key_json: string;
  deck_data_version: number | null;
  permission_gate_json: string | null;
  rule_candidates_json: string | null;
  search_results_json: string | null;
  plan_json?: string | null;
  member_ids_json: string | null;
}

export interface InlineHeadGateMeta {
  deckDataVersion: number | undefined;
  permissionGateRows: SQLQueryResult | undefined;
}

export function renderPlanFromHeadCell(
  planJson: string | null,
  pageKey: string,
): RenderPlan | undefined {
  if (planJson === null || planJson === "") return undefined;
  if (planJson.length > ONE_TRIP_RENDER_PLAN_MAX_BYTES) return undefined;
  let raw: { sql: string; params: string }[];
  try {
    raw = JSON.parse(planJson) as { sql: string; params: string }[];
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw)) return undefined;
  const entries: RenderPlanEntry[] = [];
  for (const item of raw) {
    if (typeof item?.sql !== "string" || typeof item?.params !== "string") continue;
    if (!isPipelineAbleRenderStatement(item.sql)) continue;
    let params: unknown[];
    try {
      const parsed = JSON.parse(item.params) as unknown;
      if (!Array.isArray(parsed)) continue;
      params = parsed;
    } catch {
      continue;
    }
    entries.push({ sql: item.sql, params });
  }
  if (entries.length === 0) return undefined;
  return { pageKey, recordedAt: "", entries };
}

export async function fetchPageBundleInlineParts(
  driver: SQLDatabaseDriver,
  pageName: string,
): Promise<{ raw: string; plan: RenderPlan | undefined; gateMeta: InlineHeadGateMeta }> {
  const pageKey = DeckoName.parse(pageName).key;
  const readPlans = oneTripWantsStoredPlans();
  const headBinds = readPlans
    ? [pageKey, pageKey, pageKey, pageKey, pageKey]
    : [pageKey, pageKey, pageKey, pageKey];
  const head = await driver.query<InlineHeadRow>(inlineHeadSql(readPlans), headBinds);
  const headRow = head.rows[0];
  if (headRow === undefined) {
    throw new Error(`one-trip inline fetch: no head row for page ${pageName}`);
  }
  const plan = readPlans ? renderPlanFromHeadCell(headRow.plan_json ?? null, pageKey) : undefined;
  const rawVersion = headRow.deck_data_version;
  const gateMeta: InlineHeadGateMeta = {
    deckDataVersion:
      typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : undefined,
    permissionGateRows: parsePermissionGateRows(headRow.permission_gate_json),
  };
  const memberIds: number[] = JSON.parse(headRow.member_ids_json ?? "[]") as number[];
  const sliceStatements: SQLStatement[] = [];
  for (let i = 0; i < memberIds.length; i += ONE_TRIP_INLINE_CARDS_PER_CHUNK) {
    const windowIds = memberIds.slice(i, i + ONE_TRIP_INLINE_CARDS_PER_CHUNK);
    sliceStatements.push({ sql: inlineCardsChunkSql(), params: [JSON.stringify(windowIds)] });
  }
  const cardJsons: string[] = [];
  if (sliceStatements.length > 0) {
    const slices = await driver.batch(sliceStatements);
    for (const chunk of slices) {
      for (const row of chunk.rows as { card_json: string }[]) {
        cardJsons.push(row.card_json);
      }
    }
  }
  const raw = `{"page_key":${headRow.page_key_json},"cards":[${cardJsons.join(",")}],"rule_candidates":${headRow.rule_candidates_json ?? "null"},"search_results":${headRow.search_results_json ?? "null"}}`;
  return { raw, plan, gateMeta };
}

function parsePermissionGateRows(cell: string | null): SQLQueryResult | undefined {
  if (cell === null || cell === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cell) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const rows: Record<string, unknown>[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["c"] !== "number" || typeof rec["catchAll"] !== "number") continue;
    rows.push({ c: rec["c"], catchAll: rec["catchAll"] });
  }
  return { rows, rowsAffected: 0 };
}

export async function fetchPageBundleInlineRaw(
  driver: SQLDatabaseDriver,
  pageName: string,
): Promise<string> {
  return (await fetchPageBundleInlineParts(driver, pageName)).raw;
}

export function inlineBundleFromParts(
  raw: string,
  pageName: string,
  plan: RenderPlan | undefined,
): PageBundle {
  const bundle = pageBundleFromDocument(raw, pageName);
  if (plan !== undefined) {
    plan.pageKey = bundle.pageKey;
    bundle.renderPlan = plan;
  }
  return bundle;
}

export async function fetchPageBundleInline(
  driver: SQLDatabaseDriver,
  pageName: string,
): Promise<PageBundle> {
  const { raw, plan } = await fetchPageBundleInlineParts(driver, pageName);
  return inlineBundleFromParts(raw, pageName, plan);
}

function pageBundleFromDocument(raw: string, pageName: string): PageBundle {
  const doc = JSON.parse(raw) as BundleDocument;
  const pageKey = DeckoName.parse(pageName).key;
  const rows = (doc.cards ?? []).map((card) => card as CardsRow);
  const cardIds = rows.map((r) => r.id);
  const ruleCandidates: OneTripRuleCandidate[] = (doc.rule_candidates ?? []).map((r) => ({
    cardId: r.card_id,
    settingCode: r.setting_code,
    candidateKey: r.candidate_key,
    candidateId: r.candidate_id,
  }));
  return {
    pageKey: doc.page_key,
    pageId: rows.find((r) => r.key === pageKey)?.id ?? -1,
    rows,
    cardIds,
    ruleCandidates,
    searchResults: (doc.search_results ?? []).map((s) => ({
      searchCardId: s.search_card_id,
      position: s.position,
      cardId: s.card_id,
    })),
  };
}

export async function fetchPageBundle(
  driver: SQLDatabaseDriver,
  pageName: string,
  attachName: string = DERIVED_STORE_ATTACH,
): Promise<PageBundle> {
  const pageKey = DeckoName.parse(pageName).key;
  const result = await driver.query<{ bundle: string }>(oneTripFetchSql(attachName), [
    pageKey,
    pageKey,
    pageKey,
    pageKey,
  ]);
  const raw = result.rows[0]?.bundle;
  if (raw === undefined || raw === null) {
    throw new Error(`one-trip fetch: no bundle for page ${pageName} (unknown key?)`);
  }
  return pageBundleFromDocument(raw, pageName);
}
