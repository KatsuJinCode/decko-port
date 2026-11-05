import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LocalSqliteDriver } from '../../dist/src/server/drivers/local-sqlite.js';
import { FetchEngine } from '../../dist/src/card/fetch.js';
import { RenderEngine } from '../../dist/src/card/render.js';
const root=fileURLToPath(new URL('../..',import.meta.url));
const GPL_V3_SHA256='3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986';
assert.equal(createHash('sha256').update(readFileSync(path.join(root,'LICENSE'))).digest('hex'),GPL_V3_SHA256,'LICENSE is not the unmodified GPL v3 text');
assert.ok(existsSync(path.join(root,'dist/vendor/libsass-wasm/libsass-3.6.4-wasm-base64.js')));
import Database from 'better-sqlite3';
const scratch=mkdtempSync(path.join(tmpdir(),'decko-package-smoke-'));
const dbPath=path.join(scratch,'deck.sqlite3');
copyFileSync(path.join(root,'reference-harness/fixtures/synthetic-v1/deck/deck.sqlite3'),dbPath);
const native=new Database(dbPath);
native.exec(readFileSync(path.join(root,'deploy/migrations/0003-deck-data-version-stamp.sql'),'utf8'));
native.close();
const db=new LocalSqliteDriver({path:dbPath});
try {
 const fetch=new FetchEngine(db); const engine=new RenderEngine(fetch);
 const rows=await db.query('SELECT name FROM cards WHERE trash=0 ORDER BY id LIMIT 1',[]);
 assert.ok(rows.rows.length);
 const html=await engine.render(rows.rows[0].name,'title');
 assert.equal(typeof html,'string'); assert.ok(html.length>0);
 console.log('PASS: license, compiled runtime assets, SQLite read and actual card rendering. Full parity and hosted acceptance were not tested.');
}finally{db.close();rmSync(scratch,{recursive:true});}
