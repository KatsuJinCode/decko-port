import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { AdapterDiagnostics } = await import(process.env.DIAGNOSTIC_PUBLICATION_SUBJECT ?? new URL("../adapter-diagnostics.mjs",import.meta.url).href);
import { AdapterSession } from "../adapter-process.mjs";
const retainedRoot = process.env.DECKO_DIAGNOSTIC_CONTROL_ROOT;
if(retainedRoot)fs.mkdirSync(retainedRoot,{recursive:true});
function root(){return fs.mkdtempSync(path.join(retainedRoot??tmpdir(),"diagnostic-publication-control-"));}
function cleanup(){mock.restoreAll();syncBuiltinESMExports();}
function fault(code,syscall,file){const error=Error(`${code}: controlled ${syscall} refusal for ${file}`);Object.assign(error,{code,syscall,path:file});return error;}

test("replacement refusal cannot affect immutable advertised checkpoints",()=>{
 const dir=root(),rename=fs.renameSync;let replacements=0;
 mock.method(fs,"renameSync",(from,to)=>{if(fs.existsSync(to)&&/diagnostics.*\.json$/.test(to)){replacements++;throw fault("EPERM","rename",to);}return rename(from,to);});syncBuiltinESMExports();
 let journal;
 try{
  journal=new AdapterDiagnostics(dir,{adapter:"owned-publication-control"});
  const first=journal.manifestPath,bytes=fs.readFileSync(first);
  journal.update({hello:{ready:true}});
  assert.notEqual(journal.manifestPath,first);
  assert.deepEqual(fs.readFileSync(first),bytes);
  assert.equal(JSON.parse(fs.readFileSync(journal.manifestPath)).previous_manifest,first);
  journal.finish({status:"exited",code:0,signal:null});
  assert.equal(journal.snapshot().streams_complete,true);
  assert.equal(replacements,0);
 } finally {cleanup();}
});

test("partial write remains unadvertised and later writes cannot erase failure",()=>{
 const dir=root(),journal=new AdapterDiagnostics(dir,{adapter:"owned-partial-write-control"}),write=fs.writeFileSync;
 const first=journal.manifestPath,firstBytes=fs.readFileSync(first);let failedPath;
 try{
  mock.method(fs,"writeFileSync",(file,...args)=>{if(String(file).includes("diagnostics-")&&!failedPath){failedPath=String(file);write(file,"{partial",{flag:"wx"});throw fault("EIO","write",file);}return write(file,...args);});syncBuiltinESMExports();
  assert.throws(()=>journal.update({hello:{ready:true}}),error=>error.code==="EIO");
  assert.equal(journal.manifestPath,first);
  assert.deepEqual(fs.readFileSync(first),firstBytes);
  assert.equal(fs.readFileSync(failedPath,"utf8"),"{partial");
  assert.equal(journal.snapshot().status,"capture-failed");
  assert.equal(journal.snapshot().manifest_publication_error.attempted_manifest,failedPath);
  mock.restoreAll();syncBuiltinESMExports();
  journal.update({hello:{ready:true}});
  assert.notEqual(journal.manifestPath,failedPath);
  fs.closeSync(journal.streams.stderr.fd);
  assert.throws(()=>journal.finish({status:"exited",code:0,signal:null}),error=>error.code==="EBADF");
  const final=JSON.parse(fs.readFileSync(journal.manifestPath));
  assert.equal(final.status,"capture-failed");assert.equal(final.streams_complete,false);assert.match(final.capture_error,/EIO/);assert.match(final.capture_error,/EBADF/);
 } finally {mock.restoreAll();syncBuiltinESMExports();if(!journal.state.finished)journal.finish({status:"control-ended",code:0,signal:null});cleanup(dir);}
});

test("publication denial preserves native streams and graceful owned child cleanup",async()=>{
 const dir=root(),here=path.dirname(fileURLToPath(import.meta.url));
 const session=new AdapterSession({name:"owned-publication-control",dir:here,command:[process.execPath,path.join(here,"fake-adapter/diagnostic-adapter.mjs")]},{DIAGNOSTIC_MODE:"success"},{diagnosticsRoot:dir});
 const write=fs.writeFileSync;
 mock.method(fs,"writeFileSync",(file,...args)=>{if(/diagnostics-\d+\.json$/.test(String(file)))throw fault("EACCES","write",file);return write(file,...args);});syncBuiltinESMExports();
 try{
  await session.start();await session.request({op:"diagnose"});
  await assert.rejects(session.close(),error=>error.code==="EACCES");
  const state=session.diagnostics;
  assert.equal(state.status,"capture-failed");assert.equal(state.streams_complete,false);assert.match(state.capture_error,/EACCES/);
  for(const stream of Object.values(state.streams)){assert.ok(stream.retained_bytes>0);assert.equal(fs.readFileSync(stream.path).length,stream.retained_bytes);}
  assert.equal(session.killRequested,undefined);
  assert.equal(session.child.exitCode,0);assert.equal(session.child.signalCode,null);
  assert.throws(()=>process.kill(session.child.pid,0),error=>error.code==="ESRCH");
 } finally {await session.close().catch(error=>assert.equal(error.code,"EACCES"));cleanup(dir);}
});
