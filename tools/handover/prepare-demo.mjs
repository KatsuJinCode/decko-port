import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
const root=fileURLToPath(new URL('../..',import.meta.url));
const output=path.join(root,'tmp/demo');
if(existsSync(output))throw Error('demo directory already exists; choose a new review directory rather than overwrite a deck');
mkdirSync(output,{recursive:true});
const fixture=path.join(root,'reference-harness/fixtures/synthetic-v1/deck');
const dbPath=path.join(output,'deck.sqlite3');copyFileSync(path.join(fixture,'deck.sqlite3'),dbPath);
cpSync(path.join(fixture,'files'),path.join(output,'files'),{recursive:true});
const db=new Database(dbPath);
try{db.exec(readFileSync(path.join(root,'deploy/migrations/0003-deck-data-version-stamp.sql'),'utf8'));}finally{db.close();}
console.log('Disposable synthetic deck prepared at tmp/demo/deck.sqlite3; files are beside it.');
