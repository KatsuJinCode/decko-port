import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { AdapterSession } = await import(process.env.ADAPTER_PROFILE_SUBJECT ?? new URL("../adapter-process.mjs", import.meta.url).href);
import { PROFILE_FLAGS, PROFILE_EVENT, PROFILE_PREFIX, assessRuntimeProfile, runtimeProfileContext } from "../adapter-runtime-profile.mjs";
const own = fileURLToPath(new URL("../../../", import.meta.url));
const moduleUrl = new URL("../adapter-runtime-profile.mjs", import.meta.url).href;
const flagsUrl = new URL("../../../src/card/parity/strict-parity-flags.ts", import.meta.url).href;
const flags = await import(flagsUrl);
const retainedRoot = process.env.DECKO_PROFILE_CONTROL_ROOT;
if (retainedRoot) mkdirSync(retainedRoot, { recursive: true });
const keys = Object.values(PROFILE_FLAGS);
const all = value => Object.fromEntries(keys.map(key => [key,value]));

async function control(values, mode = "normal") {
  const root = mkdtempSync(path.join(retainedRoot ?? tmpdir(), "decko-profile-control-"));
  const child = path.join(root,"child.mjs");
  writeFileSync(child, `import {createInterface} from 'node:readline';
import {observeRuntimeProfile} from ${JSON.stringify(moduleUrl)};
import {strictParityFlags} from ${JSON.stringify(flagsUrl)};
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const emitProfile=x=>process.stderr.write(${JSON.stringify(PROFILE_PREFIX)}+JSON.stringify(x)+'\\n');
const record=observeRuntimeProfile(strictParityFlags);
const mode=${JSON.stringify(mode)};
if(mode==='wrong-pid')record.pid+=1;
if(mode==='wrong-context')record.context.invocation_id='another-invocation';
if(mode==='wrong-source')record.source_files.controller.sha256='0'.repeat(64);
if(mode==='wrong-controller')record.controller.entry.sha256='0'.repeat(64);
if(mode==='wrong-parent')record.controller.pid+=1;
if(mode==='contradiction')record.resolved.mailUnfollowRefusal=!record.resolved.mailUnfollowRefusal;
if(mode!=='missing')emitProfile(record);
if(mode==='duplicate')emitProfile(record);
emit({ready:true,protocol:1,engine:'owned-metadata-control',version:'1'});
for await(const line of createInterface({input:process.stdin})){const request=JSON.parse(line);if(request.op==='quit')break;emit({id:request.id,ok:true,result:{pid:process.pid}});}
`);
  const env = { ...all("off"), ...values, PROFILE_UNRELATED_SENTINEL: "not-an-allowlisted-value" };
  const context = runtimeProfileContext("owned-control-run", path.basename(root), { commit: "declared-control-source", dirty: true });
  const session = new AdapterSession({ name:"owned-metadata-control",dir:root,command:[process.execPath,child] },env,
    { diagnosticsRoot:path.join(root,"diagnostics"),source:{commit:"declared-control-source",dirty:true},runtimeProfileContext:context });
  try {
    const hello=await session.start();
    assert.deepEqual(hello,{ready:true,protocol:1,engine:"owned-metadata-control",version:"1"});
    const answer=await session.request({op:"owned-metadata-control"});
    assert.equal(answer.result.pid,session.child.pid);
    await session.close();
    assert.throws(()=>process.kill(session.child.pid,0),error=>error.code==="ESRCH");
    const evidence=session.runtimeProfile, diagnostic=JSON.parse(readFileSync(session.diagnostics.manifest));
    assert.deepEqual(diagnostic.runtime_profile,evidence);
    assert.equal(diagnostic.code,0);
    assert.equal(diagnostic.signal,null);
    assert.equal(diagnostic.streams_complete,true);
    assert.deepEqual(JSON.parse(readFileSync(diagnostic.streams.stdout.path,'utf8').split('\n')[0]),hello);
    assert.equal(JSON.stringify(evidence).includes("not-an-allowlisted-value"),false);
    return evidence;
  } finally {await session.close();if(!retainedRoot)rmSync(root,{recursive:true});}
}

test("allowlist matches the actual engine declaration",()=>assert.deepEqual(PROFILE_FLAGS,flags.STRICT_PARITY_ENV_NAMES));
test("answer-producing native child records its actual values rather than parent's values",async()=>{
  const previous=process.env[keys[0]];
  process.env[keys[0]]="off";
  try {
    const evidence=await control(all("on"));
    assert.equal(evidence.child_observed,true);
    assert.equal(evidence.source_qualified,false);
    assert.deepEqual(evidence.records[0].raw,all("on"));
    assert.equal(evidence.records[0].profile,"all-on");
    assert.equal(evidence.records[0].controller.pid,process.pid);
    assert.equal(evidence.records[0].controller.entry.url,new URL(import.meta.url).href);
    assert.ok(Object.values(evidence.records[0].resolved).every(Boolean));
  } finally {if(previous===undefined)delete process.env[keys[0]];else process.env[keys[0]]=previous;}
});
test("raw empty/off/case whitespace values remain distinct from actual mixed resolution",async()=>{
  const values={...all("off"),[keys[0]]:" On ",[keys[1]]:"",[keys[2]]:"OFF"};
  const evidence=await control(values);
  assert.equal(evidence.child_observed,true);
  assert.deepEqual(evidence.records[0].raw,values);
  assert.equal(evidence.records[0].profile,"mixed");
});
test("unset raw values stay null and resolve to the declared mixed default",async()=>{
  const evidence=await control(all(undefined));
  assert.equal(evidence.child_observed,true);
  assert.deepEqual(evidence.records[0].raw,all(null));
  assert.deepEqual(evidence.records[0].resolved,{
    signinDetailedErrors:false,revisionRestore500:false,skinCreate500:false,
    scriptBundleClockNames:false,mailUnfollowRefusal:true,
  });
  assert.equal(evidence.records[0].profile,"mixed");
});
test("invalid raw flag remains unqualified without telemetry changing engine errors",async()=>{
  const evidence=await control({...all("off"),[keys[0]]:"invalid-control-value"});
  assert.equal(evidence.child_observed,false);
  assert.equal(evidence.records[0].profile,"unresolved");
});
for(const mode of ["missing","duplicate","wrong-pid","wrong-context","wrong-source","wrong-controller","wrong-parent","contradiction"])test(`refuses ${mode} child evidence without rewriting it`,async()=>{
  const evidence=await control(all("off"),mode);
  assert.equal(evidence.child_observed,false);
  assert.equal(evidence.source_qualified,false);
  assert.ok(evidence.problems.length);
});
test("older records with no telemetry explicitly remain unqualified",()=>{
  const result=assessRuntimeProfile([],null,123);
  assert.equal(result.child_observed,false);
  assert.equal(result.source_qualified,false);
  assert.match(result.problems[0],/older\/key-only/);
});
