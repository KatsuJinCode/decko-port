import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {makeFixture} from './helpers.mjs';
import {writeExpectedManifest} from '../manifest.mjs';
import {gradeRun} from '../grade-lib.mjs';
import {scratchDir,removeScratchDir} from '../../../tests/support/scratch-dir.mjs';

for(const mode of ['Function','eval'])test(`external generated engine source cannot qualify: ${mode}`,()=>{
 const root=scratchDir('generated-engine-source-'),adapter=join(root,'adapter'),external=join(root,'external-engine.code.js');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('GIT_')));
 const git=args=>execFileSync('git',['-C',adapter,...args],{env,encoding:'utf8',windowsHide:true}).trim();
 const run=(fixture,out)=>{
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'../run.mjs'),'--adapter',join(adapter,'adapter.json'),'--fixture',fixture,'--out',out],{env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
 };
 try{
  mkdirSync(adapter);
  const original=readFileSync(join(import.meta.dirname,'fake-adapter/adapter.mjs'),'utf8');
  const imports=original.match(/^import .*$/gm);
  assert.equal(imports.length,4);
  const source=original.replace(/^import .*$/gm,'');
  assert.doesNotMatch(source,/^import /m);
  const lexical=mode==='eval'?'if(scopeToken!=="preserved-lexical-scope")throw Error("Direct eval lost its caller lexical scope");\n':'';
  writeFileSync(external,'(async()=>{\n'+lexical+source+'\n})().catch(error=>{console.error(error);process.exitCode=1;});\n');
  const wrapper=[
   ...imports,
   'const scopeToken="preserved-lexical-scope";',
   'const dynamicSource=readFileSync('+JSON.stringify(external)+',"utf8");',
   mode==='Function'?'new Function("randomBytes","readFileSync","DatabaseSync","createInterface",dynamicSource)(randomBytes,readFileSync,DatabaseSync,createInterface);':'eval(dynamicSource);',
  ].join('\n');
  writeFileSync(join(adapter,'wrapper.mjs'),wrapper);
  writeFileSync(join(adapter,'adapter.json'),JSON.stringify({name:'owned-generated-engine-wrapper',command:[process.execPath,'wrapper.mjs']}));
  git(['init']);git(['add','--','wrapper.mjs','adapter.json']);
  git(['commit','-m','Create owned generated-execution source fixture','--','wrapper.mjs','adapter.json']);
  const commit=git(['rev-parse','HEAD']),fixture=makeFixture(root),expected=join(fixture,'expected'),actual=join(root,'actual');
  run(fixture,expected);writeExpectedManifest(fixture,expected);
  const marker='EXECUTED_UNBOUND_GENERATED_ENGINE_BYTES_'+mode;
  appendFileSync(external,'\nprocess.stderr.write('+JSON.stringify(marker+'\n')+');\n');
  assert.equal(git(['status','--porcelain']),'','the committed wrapper repository stays genuinely clean');
  run(fixture,actual);
  const meta=JSON.parse(readFileSync(join(actual,'run-meta.json'),'utf8'));
  for(const record of meta.adapter_diagnostics)assert.match(readFileSync(record.streams.stderr.path,'utf8'),new RegExp(marker));
  const grade=gradeRun({fixture,actual,candidateCommit:commit});
  const cli=spawnSync(process.execPath,[resolve(import.meta.dirname,'../grade.mjs'),'--fixture',fixture,'--actual',actual,'--candidate-commit',commit],{env,encoding:'utf8',windowsHide:true});
  console.log(JSON.stringify({mode,commit,verdict:grade.verdict,sourceQualification:grade.source_qualification,cliExit:cli.status,
   invocations:Object.values(meta.runs).flatMap(run=>run.source_binding.invocations.map(i=>({pid:i.pid,auditPid:i.audit?.pid,problems:i.audit?.problems,modules:i.audit?.modules}))),
   cliStdout:cli.stdout,cliStderr:cli.stderr}));
  assert.equal(grade.source_qualification.qualified,false,'committed wrapper bytes do not bind the external generated engine source');
  assert.notEqual(cli.status,0);
 }finally{removeScratchDir(root);}
});
