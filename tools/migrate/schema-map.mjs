const TABLE_ALIASES = {
  cards: ["cards"],
  card_acts: ["card_acts"],
  card_actions: ["card_actions"],
  card_changes: ["card_changes"],
  card_references: ["card_references"],
  card_revisions: ["card_revisions"],
  card_virtuals: ["card_virtuals"],
  sessions: ["sessions"],
  schema_migrations: ["schema_migrations"],
  ar_internal_metadata: ["ar_internal_metadata"],
  transform_migrations: ["transform_migrations"],
  delayed_jobs: ["delayed_jobs"],
};

const CARDS_COLUMN_MAP = {
  id: "id",
  name: "name",
  key: "key",
  codename: "codename",
  left_id: "left_id",
  right_id: "right_id",
  current_revision_id: "current_revision_id",
  created_at: "created_at",
  updated_at: "updated_at",
  creator_id: "creator_id",
  updater_id: "updater_id",
  read_rule_class: "read_rule_class",
  read_rule_id: "read_rule_id",
  references_expired: "references_expired",
  trash: "trash",
  type_id: "type_id",
  content: "db_content",
  db_content: "db_content",
  creator: "creator_id",
  updater: "updater_id",
  read_rule: "read_rule_class",
  rule_id: "read_rule_id",
};

const CARD_REFERENCES_COLUMN_MAP = {
  id: "id",
  referer_id: "referer_id",
  referee_key: "referee_key",
  referee_id: "referee_id",
  ref_type: "ref_type",
  is_present: "is_present",
};

const COLUMN_MAPS = {
  cards: CARDS_COLUMN_MAP,
  card_acts: {
    id: "id",
    card_id: "card_id",
    actor_id: "actor_id",
    acted_at: "acted_at",
    ip_address: "ip_address",
  },
  card_actions: {
    id: "id",
    card_id: "card_id",
    card_act_id: "card_act_id",
    super_action_id: "super_action_id",
    action_type: "action_type",
    draft: "draft",
    comment: "comment",
  },
  card_changes: {
    id: "id",
    card_action_id: "card_action_id",
    field: "field",
    value: "value",
  },
  card_references: CARD_REFERENCES_COLUMN_MAP,
  card_revisions: {
    id: "id",
    created_at: "created_at",
    card_id: "card_id",
    creator_id: "creator_id",
    content: "content",
  },
  card_virtuals: {
    id: "id",
    left_id: "left_id",
    right_id: "right_id",
    content: "content",
    left_key: "left_key",
    updated_at: "updated_at",
  },
  sessions: {
    id: "id",
    session_id: "session_id",
    data: "data",
    updated_at: "updated_at",
  },
  schema_migrations: { version: "version" },
  ar_internal_metadata: {
    key: "key",
    value: "value",
    created_at: "created_at",
    updated_at: "updated_at",
  },
  transform_migrations: { version: "version" },
  delayed_jobs: {
    id: "id",
    priority: "priority",
    attempts: "attempts",
    handler: "handler",
    last_error: "last_error",
    run_at: "run_at",
    locked_at: "locked_at",
    failed_at: "failed_at",
    locked_by: "locked_by",
    queue: "queue",
    created_at: "created_at",
    updated_at: "updated_at",
  },
};

export const SETTINGS_TABLE_VARIANTS = ["meta", "settings", "setting", "card_settings"];

export function classifySourceTable(sourceTable, targetTableNames) {
  if (targetTableNames.includes(sourceTable)) {
    if (COLUMN_MAPS[sourceTable] !== undefined) return "core";
    return "core-positional";
  }
  if (SETTINGS_TABLE_VARIANTS.includes(sourceTable)) return "settings";
  return "unknown";
}

export function mapRowToTarget(sourceTable, sourceColumns, sourceValues, targetColumns) {
  const colMap = COLUMN_MAPS[sourceTable];
  const warnings = [];
  if (colMap === undefined) {
    const cols = targetColumns.slice(0, sourceValues.length);
    const vals = sourceValues.slice(0, targetColumns.length);
    const padded = vals.concat(
      new Array(targetColumns.length - vals.length).fill(null),
    );
    return { columns: cols, values: padded, warnings };
  }
  const srcByName = {};
  for (let i = 0; i < sourceColumns.length; i++) srcByName[sourceColumns[i]] = sourceValues[i];
  const outColumns = [];
  const outValues = [];
  const seen = new Set();
  for (const targetCol of targetColumns) {
    let matched = null;
    for (const [srcName, tgtName] of Object.entries(colMap)) {
      if (tgtName === targetCol && srcByName[srcName] !== undefined && !seen.has(srcName)) {
        matched = srcName;
        break;
      }
    }
    if (matched !== null) {
      seen.add(matched);
      outColumns.push(targetCol);
      outValues.push(srcByName[matched]);
    } else {
      outColumns.push(targetCol);
      outValues.push(null);
    }
  }
  const droppedSource = [];
  for (const srcName of sourceColumns) {
    if (!seen.has(srcName) && colMap[srcName] === undefined) {
      droppedSource.push(srcName);
    } else if (!seen.has(srcName) && colMap[srcName] !== undefined) {
      droppedSource.push(srcName);
    }
  }
  if (droppedSource.length > 0) {
    warnings.push(
      `\`${sourceTable}\`: source columns dropped (no target column): ${droppedSource.join(", ")}`,
    );
  }
  const filledNull = [];
  for (let i = 0; i < outValues.length; i++) {
    if (outValues[i] === null) {
      const name = outColumns[i];
      if (srcByName[name] === undefined && srcByName[colMapInverse(colMap, name)] === undefined) {
        filledNull.push(name);
      }
    }
  }
  if (filledNull.length > 0) {
    warnings.push(
      `\`${sourceTable}\`: target columns filled with NULL (no source column): ${filledNull.join(", ")}`,
    );
  }
  return { columns: outColumns, values: outValues, warnings };
}

function colMapInverse(colMap, targetCol) {
  for (const [srcName, tgtName] of Object.entries(colMap)) {
    if (tgtName === targetCol) return srcName;
  }
  return undefined;
}

export function getColumnMap(targetTable) {
  return COLUMN_MAPS[targetTable];
}

export function targetToSourceTableName(targetTable) {
  return TABLE_ALIASES[targetTable]?.[0] ?? targetTable;
}