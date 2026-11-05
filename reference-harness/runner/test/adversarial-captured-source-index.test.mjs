import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {makeFixture} from './helpers.mjs';
import {writeExpectedManifest} from '../manifest.mjs';
import {gradeRun} from '../grade-lib.mjs';
import {scratchDir,removeScratchDir} from '../../../tests/support/scratch-dir.mjs';

for(const mode of ['default-index','external-entry'])
test('real capture and grader refuse unrelated executed adapter bytes: '+mode,()=>{
 const root=scratchDir('capture-source-index-'),adapter=join(root,'adapter');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('GIT_')));
 const git=args=>execFileSync('git',['-C',adapter,...args],{env,encoding:'utf8',windowsHide:true}).trim();
 const run=(fixture,out)=>{
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'../run.mjs'),'--adapter',join(adapter,'adapter.json'),'--fixture',fixture,'--out',out],{env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
 };
 try{
  mkdirSync(adapter);
  const original=readFileSync(join(import.meta.dirname,'fake-adapter/adapter.mjs'));
  writeFileSync(join(adapter,'adapter.mjs'),original);
  const executed=mode==='external-entry'?join(root,'external-adapter.mjs'):join(adapter,'adapter.mjs');
  if(mode==='external-entry')writeFileSync(executed,original);
  writeFileSync(join(adapter,'adapter.json'),JSON.stringify({name:'owned-source-index-adapter',command:[process.execPath,mode==='external-entry'?executed:'adapter.mjs']}));
  git(['init']);git(['add','--','adapter.mjs','adapter.json']);
  git(['commit','-m','Create owned source identity adapter fixture','--','adapter.mjs','adapter.json']);
  const commit=git(['rev-parse','HEAD']),fixture=makeFixture(root),expected=join(fixture,'expected'),actual=join(root,'actual');
  run(fixture,expected);writeExpectedManifest(fixture,expected);
  const marker='EXECUTED_UNCOMMITTED_ADAPTER_BYTES';
  appendFileSync(executed,'\nprocess.stderr.write('+JSON.stringify(marker+'\n')+');\n');
  if(mode==='default-index'){
   assert.match(git(['status','--porcelain']),/adapter.mjs/);
   git(['update-index','--assume-unchanged','adapter.mjs']);
  }
  assert.equal(git(['status','--porcelain']),'','concealment precondition');
  run(fixture,actual);
  const meta=JSON.parse(readFileSync(join(actual,'run-meta.json'),'utf8'));
  for(const record of meta.adapter_diagnostics)assert.match(readFileSync(record.streams.stderr.path,'utf8'),new RegExp(marker),'changed adapter bytes actually executed');
  const grade=gradeRun({fixture,actual,candidateCommit:commit});
  const cli=spawnSync(process.execPath,[resolve(import.meta.dirname,'../grade.mjs'),'--fixture',fixture,'--actual',actual,'--candidate-commit',commit],{env,encoding:'utf8',windowsHide:true});
  console.log(JSON.stringify({mode,commit,recordedSource:Object.fromEntries(Object.entries(meta.runs).map(([k,v])=>[k,v.adapter_checkout])),verdict:grade.verdict,sourceQualification:grade.source_qualification,cliExit:cli.status,cliStdout:cli.stdout,cliStderr:cli.stderr}));
  assert.equal(grade.source_qualification.qualified,false,'the cwd/index observation must not qualify unrelated executed adapter bytes as the pinned commit');
  assert.notEqual(cli.status,0);
 }finally{removeScratchDir(root);}
});
