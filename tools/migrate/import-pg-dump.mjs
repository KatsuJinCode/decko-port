#!/usr/bin/env node

import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "../oracle/typescript-source-loader.mjs")).href, import.meta.url);

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
    console.error(`unexpected argument ${argv[i]}`);
    process.exit(2);
  }
  args[argv[i].slice(2)] = argv[i + 1];
}
if (args.dump === undefined || (args.pglite === undefined) === (args.pg === undefined)) {
  console.error("usage: import-pg-dump.mjs --dump <deck.sql> (--pglite <dataDir> | --pg <connectionString>)");
  process.exit(2);
}

const { PostgresDriver, configurePgTypes } = await import("../../src/server/drivers/postgres.js");
const { importPgDump } = await import("./pg-dump.mjs");

let client;
if (args.pglite !== undefined) {
  const { PGlite } = await import("@electric-sql/pglite");
  client = await PGlite.create(path.resolve(args.pglite));
} else {
  const pg = (await import("pg")).default;
  configurePgTypes(pg.types);
  client = new pg.Client({ connectionString: args.pg });
  await client.connect();
}
const driver = new PostgresDriver({ client });
try {
  const report = await importPgDump({
    dumpPath: path.resolve(args.dump),
    driver,
    schemaPath: path.join(here, "../../db/schema.sqlite.sql"),
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await driver.close();
}
