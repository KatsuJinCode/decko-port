import {
  inventorySource,
  openSourceSqlite,
  sourceTableRows,
} from "./source-sqlite.mjs";
import { classifySourceTable, mapRowToTarget } from "./schema-map.mjs";
import { inventorySettings } from "./settings-map.mjs";
import {
  parseTargetSchema,
  Checksum,
  IMPORT_PRAGMAS,
  installFreshnessStamp,
} from "./import.mjs";
import { reconstructCardName } from "./name-reconstruct.mjs";

const DEFAULT_BATCH_SIZE = 1000;

export async function importFromSqlite(opts) {
  const {
    sourcePath,
    driver,
    ddlPath,
    tables,
    batchSize = DEFAULT_BATCH_SIZE,
    maxErrors = 0,
    append = false,
  } = opts;
  const started = Date.now();
  const sourceDb = openSourceSqlite(sourcePath);
  try {
    const inv = inventorySource(sourceDb);
    const settingsInventory = inventorySettings(sourceDb, inv);
    const schema = parseTargetSchema(ddlPath);
    const targetTableSet = tables ? new Set(tables) : new Set(Object.keys(schema.tableColumns));
    const sourceColumnsByTable = {};
    for (const [name, info] of Object.entries(inv)) sourceColumnsByTable[name] = info.columns;

    const stats = {
      counts: {},
      checksums: {},
      warnings: [],
      skippedTables: {},
      keyRepair: { derived: 0, nullSimpleKeys: 0, lexResolved: 0, lexUnresolved: 0 },
      errors: [],
      bytesRead: 0,
      rowsEmitted: 0,
      elapsedMs: 0,
      sourceInventory: inv,
      settingsInventory,
      schemaMappings: {},
      tableElapsedMs: {},
    };

    for (const pragma of IMPORT_PRAGMAS) await driver.query(pragma, []);
    for (const pragma of schema.pragmas) await driver.query(pragma, []);

    if (!append) {
      const existing = await driver.query(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
        [],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) {
        const count = await driver.query("SELECT COUNT(*) AS n FROM cards", []);
        if ((count.rows[0]?.n ?? 0) > 0) {
          throw new Error(
            "target database already contains cards rows; refusing to import over them (pass append:true to override)",
          );
        }
      }
    }
    for (const statement of schema.createTables) await driver.query(statement, []);

    const makeInsert = (table, columns) => {
      const quoted = columns.map((c) => `"${c}"`).join(", ");
      const slots = columns.map(() => "?").join(", ");
      return `INSERT INTO "${table}" (${quoted}) VALUES (${slots})`;
    };

    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      try {
        await driver.batch(batch);
      } catch (err) {
        for (const s of batch) {
          try {
            await driver.query(s.sql, s.params);
          } catch (rowErr) {
            if (stats.errors.length >= maxErrors) {
              rowErr.__failingTable = s.__table;
              throw rowErr;
            }
            stats.errors.push({
              table: s.__table,
              rowId: s.params[s.__idIdx] ?? null,
              message: String(rowErr?.message ?? rowErr).slice(0, 300),
            });
          }
        }
      }
      batch = [];
    };

    for (const sourceName of Object.keys(inv).sort()) {
      const tableStarted = Date.now();
      const role = classifySourceTable(sourceName, [...targetTableSet]);
      stats.schemaMappings[sourceName] = role;
      if (role === "settings") {
        continue;
      }
      if (role === "unknown" || !targetTableSet.has(sourceName)) {
        const dropped = inv[sourceName].rowCount;
        stats.skippedTables[sourceName] = dropped;
        stats.warnings.push(
          `skipped source table \`${sourceName}\`: not part of decko-ts DDL (${dropped} rows dropped; recorded in roundtripReport)`,
        );
        continue;
      }
      const targetColumns = schema.tableColumns[sourceName];
      if (targetColumns === undefined) {
        stats.warnings.push(`no target DDL for \`${sourceName}\`; skipping`);
        continue;
      }
      const sourceColumns = inv[sourceName].columns;
      const mapping = mapRowToTarget(sourceName, sourceColumns, sourceColumns.map((_, index) => index), targetColumns);
      const columns = mapping.columns;
      const insertSql = makeInsert(sourceName, columns);
      const idIndex = columns.indexOf("id");
      const cardIndexes = {
        name: columns.indexOf("name"), key: columns.indexOf("key"),
        leftId: columns.indexOf("left_id"), rightId: columns.indexOf("right_id"),
      };
      for (const warning of mapping.warnings) if (!stats.warnings.includes(warning)) stats.warnings.push(warning);
      let tableRows = 0;
      for await (const row of sourceTableRows(sourceDb, sourceName)) {
        const values = mapping.values.map(index => index === null ? null : row.values[index]);
        if (sourceName === "cards") {
          const idx = cardIndexes;
          if (idx.key >= 0 && idx.name >= 0) {
            const name = values[idx.name];
            const leftId = idx.leftId >= 0 ? values[idx.leftId] : null;
            if (
              values[idx.key] === null &&
              typeof name === "string" &&
              name !== "" &&
              (leftId === null || leftId === undefined)
            ) {
              if (opts.deriveKey !== undefined) {
                const derived = opts.deriveKey(name);
                if (derived !== undefined) {
                  values[idx.key] = derived;
                  stats.keyRepair.derived += 1;
                } else {
                  stats.keyRepair.nullSimpleKeys += 1;
                }
              } else {
                stats.keyRepair.nullSimpleKeys += 1;
              }
            }
          }
          if (idx.name >= 0 && (values[idx.name] === null || values[idx.name] === "")) {
            const leftId = idx.leftId >= 0 ? values[idx.leftId] : null;
            const rightId = idx.rightId >= 0 ? values[idx.rightId] : null;
            if (leftId !== null && leftId !== undefined) {
              const rec = await reconstructCardName({
                sourceName: values[idx.name],
                sourceKey: idx.key >= 0 ? values[idx.key] : null,
                leftId,
                rightId,
                driver,
              });
              if (rec.resolved) {
                if (rec.via === "lexicon") stats.keyRepair.lexResolved += 1;
                values[idx.name] = rec.name;
                if (idx.key >= 0 && rec.key !== null && values[idx.key] === null) {
                  values[idx.key] = rec.key;
                }
              } else {
                stats.keyRepair.lexUnresolved += 1;
              }
            }
          }
        }
        if (stats.checksums[sourceName] === undefined) {
          stats.counts[sourceName] = 0;
          stats.checksums[sourceName] = new Checksum();
        }
        stats.counts[sourceName] += 1;
        stats.checksums[sourceName].addRow(values, idIndex);
        batch.push({
          sql: insertSql,
          params: values,
          __table: sourceName,
          __idIdx: idIndex,
        });
        tableRows += 1;
        if (batch.length >= batchSize) await flush();
      }
      stats.rowsEmitted += tableRows;
      stats.tableElapsedMs[sourceName] = Date.now() - tableStarted;
      opts.onProgress?.(stats.rowsEmitted, stats.rowsEmitted);
    }
    await flush();
    for (const statement of schema.createIndexes) await driver.query(statement, []);
    await installFreshnessStamp(driver, schema);
    await driver.query("ANALYZE", []);
    await driver.query("PRAGMA synchronous = NORMAL", []);
    await driver.query("PRAGMA wal_checkpoint(TRUNCATE)", []);

    stats.elapsedMs = Date.now() - started;
    if (settingsInventory.warning !== undefined && !stats.warnings.includes(settingsInventory.warning)) {
      stats.warnings.push(settingsInventory.warning);
    }
    const checksumsOut = {};
    for (const [t, cs] of Object.entries(stats.checksums)) {
      checksumsOut[t] = { sum: cs.sum, count: cs.count, minId: cs.minId, maxId: cs.maxId };
    }
    stats.checksums = checksumsOut;
    return stats;
  } finally {
    sourceDb.close();
  }
}
