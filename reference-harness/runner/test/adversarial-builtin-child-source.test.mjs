import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {makeFixture} from './helpers.mjs';
import {writeExpectedManifest} from '../manifest.mjs';
import {gradeRun} from '../grade-lib.mjs';
import {scratchDir,removeScratchDir} from '../../../tests/support/scratch-dir.mjs';

test('builtin-module child execution cannot qualify an unwitnessed external engine',()=>{
 assert.equal(typeof process.getBuiltinModule,'function','installed runtime exposes the tested Node interface');
 const root=scratchDir('builtin-child-source-'),adapter=join(root,'adapter'),external=join(root,'external-engine.mjs');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('GIT_')));
 const git=args=>execFileSync('git',['-C',adapter,...args],{env,encoding:'utf8',windowsHide:true}).trim();
 const run=(fixture,out)=>{
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'../run.mjs'),'--adapter',join(adapter,'adapter.json'),'--fixture',fixture,'--out',out],{env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
 };
 try{
  mkdirSync(adapter);
  writeFileSync(external,readFileSync(join(import.meta.dirname,'fake-adapter/adapter.mjs')));
  const wrapper=[
   'const cp=process.getBuiltinModule("child_process");',
   'const child=cp.spawn(process.execPath,['+JSON.stringify(external)+'],{stdio:"inherit",windowsHide:true});',
   'child.on("error",error=>{console.error(error);process.exitCode=1;});',
   'child.on("exit",code=>{process.exitCode=code??1;});',
  ].join('\n');
  writeFileSync(join(adapter,'wrapper.mjs'),wrapper);
  writeFileSync(join(adapter,'adapter.json'),JSON.stringify({name:'owned-builtin-child-wrapper',command:[process.execPath,'wrapper.mjs']}));
  git(['init']);git(['add','--','wrapper.mjs','adapter.json']);
  git(['commit','-m','Create owned committed child-wrapper fixture','--','wrapper.mjs','adapter.json']);
  const commit=git(['rev-parse','HEAD']),fixture=makeFixture(root),expected=join(fixture,'expected'),actual=join(root,'actual');
  run(fixture,expected);writeExpectedManifest(fixture,expected);
  const marker='EXECUTED_UNWITNESSED_EXTERNAL_CHILD_BYTES';
  appendFileSync(external,'\nprocess.stderr.write('+JSON.stringify(marker+'\n')+');\n');
  assert.equal(git(['status','--porcelain']),'','wrapper source is genuinely committed and clean');
  run(fixture,actual);
  const meta=JSON.parse(readFileSync(join(actual,'run-meta.json'),'utf8'));
  for(const record of meta.adapter_diagnostics)assert.match(readFileSync(record.streams.stderr.path,'utf8'),new RegExp(marker));
  const grade=gradeRun({fixture,actual,candidateCommit:commit});
  const cli=spawnSync(process.execPath,[resolve(import.meta.dirname,'../grade.mjs'),'--fixture',fixture,'--actual',actual,'--candidate-commit',commit],{env,encoding:'utf8',windowsHide:true});
  console.log(JSON.stringify({commit,verdict:grade.verdict,sourceQualification:grade.source_qualification,cliExit:cli.status,
   invocations:Object.values(meta.runs).flatMap(run=>run.source_binding.invocations.map(i=>({pid:i.pid,auditPid:i.audit?.pid,problems:i.audit?.problems,modules:i.audit?.modules}))),
   cliStdout:cli.stdout,cliStderr:cli.stderr}));
  assert.equal(grade.source_qualification.qualified,false,'a committed wrapper is not source proof for its unwitnessed external child engine');
  assert.notEqual(cli.status,0);
 }finally{removeScratchDir(root);}
});
