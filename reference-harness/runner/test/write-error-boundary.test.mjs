import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

test('actual write adapter separates unexpected exceptions from card validation refusals',()=>{
 const out=mkdtempSync(join(tmpdir(),'write-error-boundary-'));
 try{
  const run=spawnSync(process.execPath,['reference-harness/runner/run.mjs','--adapter','reference-harness/adapters/ts/adapter.json','--fixture','reference-harness/fixtures/synthetic-v3-mod-probes-ruby33','--out',out,'--kinds','scenarios','--filter','^probe-e(4|86)$','--scenario-workers','2'],{cwd:repo,windowsHide:true,encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=512'}});
  assert.equal(run.status,0,run.stderr);
  const rows=readFileSync(join(out,'scenarios.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const unexpected=rows.find(row=>row.id==='probe-e4').steps[2];
  assert.equal(unexpected.error.class,'NoMethodError');
  assert.match(unexpected.error.message,/close_account/);
  assert.equal(unexpected.result,undefined);
  assert.deepEqual(unexpected.rows,{});
  const validation=rows.find(row=>row.id==='probe-e86').steps.find(step=>step.result?.saved===false);
  assert.ok(validation);
  assert.equal(validation.error,undefined);
  assert.ok(validation.result.errors.some(error=>error.field==='content'));
 }finally{assert.equal(dirname(resolve(out)),resolve(tmpdir()));rmSync(out,{recursive:true,maxRetries:3,retryDelay:100})}
});
