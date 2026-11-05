import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {AdapterSession} from '../adapter-process.mjs';
import {scratchDir,removeScratchDir} from '../../../tests/support/scratch-dir.mjs';

test('failed final manifest publication never advertises complete diagnostics in run metadata',async()=>{
 const root=scratchDir('diagnostic-final-publication-');
 const session=new AdapterSession({name:'owned-final-publication-probe',dir:import.meta.dirname,
  command:[process.execPath,join(import.meta.dirname,'fake-adapter/diagnostic-adapter.mjs')]},
  {DIAGNOSTIC_MODE:'success'},{diagnosticsRoot:join(root,'evidence')});
 try{
  await session.start();
  await session.request({op:'diagnose',value:'before final publication failure'});
  const before=JSON.parse(readFileSync(session.diagnostics.manifest,'utf8'));
  assert.equal(before.streams_complete,false);
  const finalManifest=join(dirname(before.manifest),`diagnostics-${String(before.publication_generation+1).padStart(8,'0')}.json`);
  writeFileSync(finalManifest,'owned collision',{flag:'wx'});
  await assert.rejects(session.close(),error=>error.code==='EEXIST');
  await session.closed;
  const final=session.diagnostics;
  const persisted=JSON.parse(readFileSync(final.manifest,'utf8'));
  console.log(JSON.stringify({inMemory:final,onDisk:persisted}));
  assert.equal(final.streams_complete,false,'run.mjs copies this getter into persistent run metadata after close fails');
  assert.match(final.capture_error??'',/EEXIST/,'the final publication failure must be retained with its provenance');
 }finally{
  await session.close().catch(()=>{});
  if(session.child)assert.throws(()=>process.kill(session.child.pid,0),error=>error.code==='ESRCH');
  removeScratchDir(root);
 }
});
