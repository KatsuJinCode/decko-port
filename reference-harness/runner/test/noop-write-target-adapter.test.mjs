import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

test('real adapter retains the fetched card on a successful no-op update without inventing card/action changes',()=>{
 const out=mkdtempSync(join(repo,'tmp','adapter-noop-'));
 try{
  const run=spawnSync(process.execPath,['reference-harness/runner/run.mjs','--adapter','reference-harness/adapters/ts/adapter.json','--fixture','reference-harness/fixtures/synthetic-v3-mod-probes-ruby33','--out',out,'--kinds','scenarios','--filter','^probe-e30$'],{cwd:repo,windowsHide:true,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const rows=readFileSync(join(out,'scenarios.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,1);assert.equal(rows[0].steps.length,5);
  const created=rows[0].steps[1],noop=rows[0].steps[2];
  assert.equal(noop.result.saved,true);assert.deepEqual(noop.result.errors,[]);
  assert.deepEqual(noop.result.card,created.result.card);
  assert.deepEqual(noop.result.mail,[]);
  for(const table of ['cards','card_actions','card_changes']){
   const delta=noop.rows[table]??{};
   for(const kind of ['inserted','updated','deleted'])assert.equal((delta[kind]??[]).length,0,table+' '+kind);
  }
  assert.equal(noop.rows.card_acts.inserted.length,1);
 }finally{
  assert.equal(dirname(resolve(out)),resolve(repo,'tmp'));
  rmSync(out,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});
