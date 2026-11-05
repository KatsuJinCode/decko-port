import { createHash } from "node:crypto";

const CANONICAL_KEY = "*member";
const TABLES = ["cards", "card_references"];
const EVENTS = [["ins", "insert"], ["upd", "update"], ["del", "delete"]];
const triggerQuery = "SELECT name,sql FROM main.sqlite_master WHERE type='trigger' AND tbl_name IN ('cards','card_references','deck_data_version') ORDER BY name";
const triggerGuardQuery = "SELECT coalesce(group_concat(name||':'||sql,'|'),'') FROM (" + triggerQuery + ")";
const versionQuery = "SELECT version FROM main.deck_data_version WHERE id=1";
const schemaGuardQuery = "SELECT json_group_array(json_array(scope,type,name,tbl_name,rootpage,sql)) FROM (SELECT 'main' AS scope,type,name,tbl_name,rootpage,sql FROM main.sqlite_master UNION ALL SELECT 'temp' AS scope,type,name,tbl_name,rootpage,sql FROM temp.sqlite_master ORDER BY scope,type,name)";
const tableListQuery = "SELECT schema,name,type,ncol,wr,strict FROM pragma_table_list() ORDER BY schema,name,type";
const tableListGuardQuery = "SELECT json_group_array(json_array(schema,name,type,ncol,wr,strict)) FROM (" + tableListQuery + ")";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizeSql = sql => sql.toLowerCase().replace(/[\s"`\[\]]/g, "").replace(/;$/, "");
const positiveId = value => Number.isSafeInteger(value) && value > 0;

export class MembersKeyRecoveryError extends Error {
  constructor(code, details = {}, cause = undefined) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "MembersKeyRecoveryError";
    this.code = code;
    this.details = details;
  }
}

function qualifyTriggers(rows) {
  const expected = new Map(TABLES.flatMap(table => EVENTS.map(([suffix, event]) => {
    const name = `${table}_bump_deck_data_version_${suffix}`;
    return [name, normalizeSql(`CREATE TRIGGER ${name} AFTER ${event} ON ${table} BEGIN UPDATE deck_data_version SET version=version+1 WHERE id=1; END`)];
  })));
  const required = rows.filter(row => expected.has(row.name));
  if (required.length !== expected.size || required.some(row => typeof row.sql !== "string" || normalizeSql(row.sql) !== expected.get(row.name))) {
    throw new MembersKeyRecoveryError("members-recovery-unqualified-write-triggers", { observed: rows.map(row => row.name), required: [...expected.keys()] });
  }
  return rows.filter(row => !expected.has(row.name)).map(row => row.name);
}

async function version(driver) {
  const rows = (await driver.query(versionQuery, [])).rows;
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0].version) || rows[0].version < 0) throw new MembersKeyRecoveryError("members-recovery-invalid-freshness-stamp");
  return rows[0].version;
}

async function foreignKeys(driver) {
  const tables = (await driver.query("SELECT name,sql FROM main.sqlite_master WHERE type='table' ORDER BY name", [])).rows;
  const found = [];
  for (const table of tables.filter(row => typeof row.sql === "string" && /\breferences\b/i.test(row.sql))) {
    const identifier = '"' + table.name.replaceAll('"', '""') + '"';
    const rows = (await driver.query(`PRAGMA main.foreign_key_list(${identifier})`, [])).rows;
    found.push(...rows.map(row => ({ table_name: table.name, id: row.id, target_table: row.table, source_column: row.from, target_column: row.to })));
  }
  return found;
}

function canonicalIds(content) {
  if (typeof content !== "string") return undefined;
  if (content === "") return [];
  const items = content.split("\n");
  if (items.some(item => !/^~[1-9][0-9]*$/.test(item) || !positiveId(Number(item.slice(1))))) return undefined;
  const ids = items.map(item => Number(item.slice(1)));
  return new Set(ids).size === ids.length ? ids : undefined;
}

function reconciliation(sideIds, compounds, collisions, historyCounts, references) {
  return {
    sideIds, compounds, compoundCollisions: collisions, historyCounts, references,
    steps: [
      "Retain a verified database snapshot and exclusive writer custody before any separately approved repair.",
      "Review both side identities and each listed compound pair, authored contents, history and references; neither identity is discarded here.",
      "Specify the exact surviving codename/identity mapping and each compound's content/reference mapping in a separate reviewed forward repair. Conflicting meaningful data requires its owner's decision.",
      "Rehearse that mapping on a copy, verify unchanged history and anonymous permissions, and independently review it before touching the source deck."
    ]
  };
}

export async function planMembersKeyRecovery(driver) {
  if (driver.transactionGuarantee?.atomicBatch !== true) throw new MembersKeyRecoveryError("members-recovery-native-atomic-batch-required");
  if (driver.transactionGuarantee.standaloneBatchAdmission !== true) throw new MembersKeyRecoveryError("members-recovery-standalone-admission-required");
  const tempObjects = (await driver.query("SELECT type,name,tbl_name,sql FROM temp.sqlite_master ORDER BY type,name", [])).rows;
  const tableList = (await driver.query(tableListQuery, [])).rows;
  if (!Array.isArray(tempObjects) || !Array.isArray(tableList) || !tableList.some(row => row.schema === "main" && row.name === "sqlite_schema" && row.type === "table") || tableList.some(row => typeof row.schema !== "string" || typeof row.name !== "string" || typeof row.type !== "string" || ![row.ncol, row.wr, row.strict].every(Number.isSafeInteger))) {
    throw new MembersKeyRecoveryError("members-recovery-effective-schema-unreadable");
  }
  const tableListStamp = (await driver.query(`SELECT (${tableListGuardQuery}) AS stamp`, [])).rows[0]?.stamp;
  if (typeof tableListStamp !== "string" || tableListStamp !== JSON.stringify(tableList.map(row => [row.schema, row.name, row.type, row.ncol, row.wr, row.strict]))) throw new MembersKeyRecoveryError("members-recovery-effective-schema-unreadable");
  const attachedSchemas = [...new Set(tableList.map(row => row.schema).filter(name => name !== "main" && name !== "temp"))];
  const beforeVersion = await version(driver);
  const triggers = (await driver.query(triggerQuery, [])).rows;
  const unreviewedTriggers = qualifyTriggers(triggers);
  const schemaStamp = (await driver.query(`SELECT (${schemaGuardQuery}) AS stamp`, [])).rows[0]?.stamp;
  if (typeof schemaStamp !== "string") throw new MembersKeyRecoveryError("members-recovery-schema-unreadable");
  const foreignKeyEffects = await foreignKeys(driver);
  const members = (await driver.query("SELECT * FROM main.cards WHERE codename='members' ORDER BY id", [])).rows;
  const plan = { schema: "decko-members-key-recovery/1", beforeVersion, schemaStamp, tableListStamp, triggerStamp: triggers.map(row => `${row.name}:${row.sql}`).join("|"), members, blockers: [], keyUpdate: null, memberships: [], missingReferences: [] };
  if (tempObjects.length) plan.blockers.push({ code: "unreviewed-temp-schema", objects: tempObjects });
  if (attachedSchemas.length) plan.blockers.push({ code: "unreviewed-attached-schemas", names: attachedSchemas });
  if (unreviewedTriggers.length) plan.blockers.push({ code: "unreviewed-write-triggers", names: unreviewedTriggers });
  if (foreignKeyEffects.length) plan.blockers.push({ code: "unreviewed-foreign-key-effects", foreignKeys: foreignKeyEffects });
  if (members.length === 0) plan.blockers.push({ code: "members-codename-missing" });
  else if (members.length !== 1) plan.blockers.push({ code: "members-codename-not-unique" });
  else {
    const side = members[0];
    if (!positiveId(side.id) || side.name !== "*members" || side.trash !== 0 || side.left_id !== null || side.right_id !== null || !["*members", CANONICAL_KEY].includes(side.key)) {
      plan.blockers.push({ code: "members-side-outside-qualified-repair", cardId: side.id });
    }
    const occupied = (await driver.query("SELECT * FROM main.cards WHERE key=? AND id<>? ORDER BY id", [CANONICAL_KEY, side.id])).rows;
    if (occupied.length) {
      plan.blockers.push({ code: "canonical-key-occupied", cardIds: occupied.map(row => row.id) });
      const sideIds = [side.id, ...occupied.map(row => row.id)];
      const affected = `WITH RECURSIVE affected(id) AS (SELECT value FROM json_each(?) UNION SELECT c.id FROM main.cards c JOIN affected a ON c.left_id=a.id OR c.right_id=a.id)`;
      const compounds = (await driver.query(`${affected} SELECT c.* FROM main.cards c JOIN affected a ON a.id=c.id ORDER BY c.id`, [JSON.stringify(sideIds)])).rows;
      const ids = JSON.stringify(compounds.map(row => row.id));
      const historyCounts = (await driver.query("SELECT card_id,COUNT(*) AS actions FROM main.card_actions WHERE card_id IN (SELECT value FROM json_each(?)) GROUP BY card_id ORDER BY card_id", [ids])).rows;
      const references = (await driver.query("SELECT * FROM main.card_references WHERE referer_id IN (SELECT value FROM json_each(?)) OR referee_id IN (SELECT value FROM json_each(?)) ORDER BY id", [ids, ids])).rows;
      const collisions = (await driver.query("SELECT a.id AS originalCompoundId,b.id AS canonicalCompoundId,a.left_id AS leftId FROM main.cards a JOIN main.cards b ON b.left_id=a.left_id WHERE a.right_id=? AND b.right_id IN (SELECT value FROM json_each(?)) ORDER BY a.id,b.id", [side.id, JSON.stringify(occupied.map(row => row.id))])).rows;
      plan.reconciliation = reconciliation(sideIds, compounds, collisions, historyCounts, references);
    } else {
      if (side.key !== CANONICAL_KEY) plan.keyUpdate = { id: side.id, before: side.key, after: CANONICAL_KEY };
      const roles = (await driver.query("SELECT id FROM main.cards WHERE codename='role' AND trash=0", [])).rows;
      if (roles.length !== 1 || !positiveId(roles[0].id)) plan.blockers.push({ code: "role-type-unqualified" });
      else {
        const lists = (await driver.query("SELECT l.* FROM main.cards l JOIN main.cards r ON r.id=l.left_id WHERE l.right_id=? AND l.trash=0 AND r.trash=0 AND r.type_id=? ORDER BY l.id", [side.id, roles[0].id])).rows;
        const anonymous = (await driver.query("SELECT id FROM main.cards WHERE codename='anonymous'", [])).rows;
        if (anonymous.length !== 1 || !positiveId(anonymous[0].id)) plan.blockers.push({ code: "anonymous-identity-unqualified" });
        for (const list of lists) {
          const ids = canonicalIds(list.db_content);
          const refs = (await driver.query("SELECT * FROM main.card_references WHERE referer_id=? ORDER BY id", [list.id])).rows;
          plan.memberships.push({ card: list, ids, references: refs });
          if (ids === undefined) { plan.blockers.push({ code: "membership-content-needs-native-resolution", cardId: list.id }); continue; }
          const targets = (await driver.query("SELECT id,trash FROM main.cards WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id", [JSON.stringify(ids)])).rows;
          if (targets.length !== ids.length || targets.some(row => row.trash !== 0)) plan.blockers.push({ code: "membership-target-missing-or-trashed", cardId: list.id });
          const actualIds = refs.map(row => row.referee_id);
          if (new Set(actualIds).size !== actualIds.length || refs.some(row => row.ref_type !== "L" || row.referee_key !== null || !ids.includes(row.referee_id))) {
            plan.blockers.push({ code: "membership-references-conflict-with-content", cardId: list.id });
          }
          for (const id of ids.filter(id => !actualIds.includes(id))) {
            if (anonymous.some(row => row.id === id)) plan.blockers.push({ code: "anonymous-membership-needs-separate-review", cardId: list.id });
            else plan.missingReferences.push({ refererId: list.id, refereeId: id });
          }
        }
      }
    }
  }
  if (await version(driver) !== beforeVersion) throw new MembersKeyRecoveryError("members-recovery-state-changed-during-plan");
  plan.status = plan.blockers.length ? "blocked" : plan.keyUpdate || plan.missingReferences.length ? "ready" : "noop";
  if (plan.blockers.length && !plan.reconciliation) plan.reconciliation = { blockers: plan.blockers, steps: ["Retain the current data and history. Resolve each named content/reference/identity ambiguity on an owned copy using native naming and id-list semantics; supply an independently reviewed mapping before any source-deck repair."] };
  return { ...plan, sha256: digest(plan) };
}

export async function applyMembersKeyRecovery(driver, expectedPlanSha256) {
  if (typeof expectedPlanSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedPlanSha256)) throw new MembersKeyRecoveryError("members-recovery-reviewed-plan-required");
  const plan = await planMembersKeyRecovery(driver);
  if (plan.sha256 !== expectedPlanSha256) throw new MembersKeyRecoveryError("members-recovery-reviewed-plan-changed", { currentPlan: plan });
  if (plan.status === "blocked") throw new MembersKeyRecoveryError("members-recovery-reconciliation-required", { plan });
  if (plan.status === "noop") return { schema: plan.schema, status: "noop", planSha256: plan.sha256, version: plan.beforeVersion };
  const statements = [{ sql: `SELECT CASE WHEN (${versionQuery})=? AND (${triggerGuardQuery})=? AND (${schemaGuardQuery})=? AND (${tableListGuardQuery})=? AND NOT EXISTS(SELECT 1 FROM temp.sqlite_master) AND NOT EXISTS(SELECT 1 FROM pragma_table_list() WHERE schema NOT IN ('main','temp')) THEN 1 ELSE json_extract('members-recovery-state-changed','$') END AS qualified`, params: [plan.beforeVersion, plan.triggerStamp, plan.schemaStamp, plan.tableListStamp], requireStandaloneTransaction: true }];
  if (plan.keyUpdate) statements.push({ sql: "UPDATE main.cards SET key=? WHERE id=? AND key=? AND codename='members'", params: [plan.keyUpdate.after, plan.keyUpdate.id, plan.keyUpdate.before] });
  if (plan.missingReferences.length) statements.push({ sql: "INSERT INTO main.card_references(referer_id,referee_id,referee_key,ref_type) SELECT json_extract(value,'$.refererId'),json_extract(value,'$.refereeId'),NULL,'L' FROM json_each(?)", params: [JSON.stringify(plan.missingReferences)] });
  const afterVersion = plan.beforeVersion + Number(plan.keyUpdate !== null) + plan.missingReferences.length;
  if (!Number.isSafeInteger(afterVersion)) throw new MembersKeyRecoveryError("members-recovery-stamp-range-unqualified");
  const expectedRefs = plan.memberships.flatMap(row => row.ids.map(id => `${row.card.id}:${id}:L`)).sort((a, b) => {
    const [al, ar] = a.split(":").map(Number), [bl, br] = b.split(":").map(Number);
    return al - bl || ar - br;
  }).join("|");
  const listIds = JSON.stringify(plan.memberships.map(row => row.card.id));
  const refsQuery = "SELECT coalesce(group_concat(referer_id||':'||referee_id||':'||ref_type,'|'),'') FROM (SELECT referer_id,referee_id,ref_type FROM main.card_references WHERE referer_id IN (SELECT value FROM json_each(?)) ORDER BY referer_id,referee_id,id)";
  statements.push({ sql: `SELECT CASE WHEN (${versionQuery})=? AND (SELECT key FROM main.cards WHERE id=?)=? AND (${refsQuery})=? THEN 1 ELSE json_extract('members-recovery-postcondition-failed','$') END AS qualified`, params: [afterVersion, plan.members[0].id, CANONICAL_KEY, listIds, expectedRefs] });
  let results;
  try { results = await driver.batch(statements); }
  catch (cause) { throw new MembersKeyRecoveryError("members-recovery-apply-outcome-unconfirmed", { planSha256: plan.sha256, next: "Inspect current state read-only. Do not replay the apply or undo side effects based on the lost acknowledgement." }, cause); }
  if (!Array.isArray(results) || results.length !== statements.length || results.at(-1)?.rows?.[0]?.qualified !== 1) {
    throw new MembersKeyRecoveryError("members-recovery-apply-receipt-unconfirmed", { planSha256: plan.sha256, next: "Inspect current state read-only; do not replay or undo an unconfirmed apply." });
  }
  return { schema: plan.schema, status: "applied", planSha256: plan.sha256, membersId: plan.members[0].id, keyChanged: !!plan.keyUpdate, referencesAdded: plan.missingReferences.length, beforeVersion: plan.beforeVersion, afterVersion };
}
