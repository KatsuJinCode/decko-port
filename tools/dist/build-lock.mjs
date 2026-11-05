import {randomUUID} from 'node:crypto';
import {closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync,
  rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {hostname} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

const OWNER_FILE = /^owner-([a-f0-9-]{36})\.json$/;
const FORMAT = 'decko-dist-build-lock/2';
const processStartedAt = new Date(Date.now()-process.uptime()*1000).toISOString();

function readRecord(file) {
  const before=lstatSync(file);
  if (!before.isFile()||before.isSymbolicLink()) throw Error('dist build lock: not a regular owner record');
  const fd=openSync(file,'r');
  try {
    const stat=fstatSync(fd);
    if (stat.dev!==before.dev||stat.ino!==before.ino||stat.size>8192) throw Error('dist build lock: unstable or oversized owner record');
    const buffer=Buffer.alloc(stat.size+1);let size=0,count;
    do {count=readSync(fd,buffer,size,buffer.length-size,null);size+=count;} while(count&&size<buffer.length);
    const after=fstatSync(fd);
    if (size!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs) throw Error('dist build lock: owner changed during read');
    return {bytes:buffer.subarray(0,size),stat};
  } finally {closeSync(fd);}
}

function liveness(pid) {
  try {process.kill(pid,0);return {state:'live'};}
  catch (error) {return error.code === 'ESRCH' ? {state:'dead'} : {state:'unknown',error};}
}

function inspect(lockDir, allowedMarker) {
  try {
    const directory=lstatSync(lockDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return {state:'unknown',reason:'not-owned-directory'};
    const entries=readdirSync(lockDir).filter(name=>name!==allowedMarker);
    if (entries.some(name=>name.startsWith('build-active-'))) return {state:'unknown',reason:'unresolved-build-activity'};
    if (entries.length!==1 || !OWNER_FILE.test(entries[0])) return {state:'unknown',reason:'missing-or-ambiguous-owner'};
    const file=path.join(lockDir,entries[0]),{bytes,stat}=readRecord(file),owner=JSON.parse(bytes.toString('utf8'));
    if (!owner || owner.format!==FORMAT || owner.machine!==hostname() || owner.lockPath!==lockDir
      || typeof owner.token!=='string' || entries[0]!==`owner-${owner.token}.json`
      || !Number.isSafeInteger(owner.pid) || owner.pid<=0
      || typeof owner.executable!=='string' || !path.isAbsolute(owner.executable)
      || typeof owner.processStartedAt!=='string' || !Number.isFinite(Date.parse(owner.processStartedAt))) {
      return {state:'unknown',reason:'unverified-owner'};
    }
    return {...liveness(owner.pid),owner,file,bytes,directory,stat};
  } catch (error) {return {state:'unknown',reason:'unreadable-or-unpublished-owner',error};}
}

function sameSnapshot(left,right) {
  return right.bytes && left.file===right.file && left.bytes.equals(right.bytes)
    && left.directory.dev===right.directory.dev && left.directory.ino===right.directory.ino
    && left.stat.dev===right.stat.dev && left.stat.ino===right.stat.ino;
}

function reclaimDeadOwner(lockDir,observed) {
  const markerName=`reclaim-${observed.owner.token}.json`,marker=path.join(lockDir,markerName);
  const recoveryToken=randomUUID(),markerBytes=Buffer.from(JSON.stringify({pid:process.pid,recoveryToken})+'\n');
  try {writeFileSync(marker,markerBytes,{flag:'wx'});}
  catch (error) {if (['EEXIST','ENOENT'].includes(error.code)) return false;throw error;}
  let moved=false;
  try {
    const current=inspect(lockDir,markerName);
    if (current.state!=='dead' || !sameSnapshot(observed,current)) return false;
    const retired=`${lockDir}-retired-${recoveryToken}`;
    renameSync(lockDir,retired);moved=true;
    const oldOwner=path.join(retired,path.basename(observed.file));
    if (!readRecord(oldOwner).bytes.equals(observed.bytes)
      || !readRecord(path.join(retired,markerName)).bytes.equals(markerBytes)) throw Error('dist build lock: retired ownership changed');
    unlinkSync(oldOwner);unlinkSync(path.join(retired,markerName));rmdirSync(retired);
    return true;
  } finally {
    if (!moved) {
      try {if (readRecord(marker).bytes.equals(markerBytes)) unlinkSync(marker);}
      catch (error) {if (error.code!=='ENOENT') throw error;}
    }
  }
}

export async function acquireDistBuildLock({lockDir,waitMs=180_000,pollMs=250}) {
  if (!Number.isFinite(waitMs)||waitMs<0||!Number.isFinite(pollMs)||pollMs<=0) throw Error('dist build lock: invalid wait policy');
  mkdirSync(path.dirname(lockDir),{recursive:true});
  lockDir=path.join(realpathSync(path.dirname(lockDir)),path.basename(lockDir));
  const token=randomUUID(),owner={format:FORMAT,token,pid:process.pid,machine:hostname(),executable:process.execPath,processStartedAt,lockPath:lockDir};
  const ownerFile=path.join(lockDir,`owner-${token}.json`),deadline=performance.now()+waitMs;
  for (;;) {
    try {mkdirSync(lockDir);break;}
    catch (error) {
      if (error.code!=='EEXIST') throw error;
      const observed=inspect(lockDir);
      if (observed.state==='dead' && reclaimDeadOwner(lockDir,observed)) continue;
      if (performance.now()>=deadline) throw new Error(`staging-server dist bootstrap: build lock retained (${observed.state}: ${observed.reason??`owner PID ${observed.owner.pid}`}) at ${lockDir}`,{cause:observed.error});
      await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(0,deadline-performance.now()))));
    }
  }
  const bytes=Buffer.from(JSON.stringify(owner)+'\n');
  try {writeFileSync(ownerFile,bytes,{flag:'wx'});}
  catch (error) {
    try {rmdirSync(lockDir);} catch (cleanup) {throw new AggregateError([error,cleanup],'dist build lock: owner publication failed; directory retained');}
    throw error;
  }
  const acquired=inspect(lockDir);
  if (acquired.state!=='live'||acquired.owner?.token!==token) throw Error('dist build lock: acquired custody changed');
  let released=false,activity;
  function checkOwned() {
    if (activity && !readRecord(activity.file).bytes.equals(activity.bytes)) throw Error('dist build lock: release refused because build activity changed');
    const current=inspect(lockDir,activity?.name);
    if (current.state!=='live'||current.owner?.pid!==process.pid||!sameSnapshot(acquired,current)) throw Error('dist build lock: release refused because owner changed or is ambiguous');
  }
  return {owner,markBuildActive() {
    if (released) throw Error('dist build lock: build after release refused');
    checkOwned();
    if (activity) return;
    const name=`build-active-${token}.json`;
    activity={name,file:path.join(lockDir,name),bytes:Buffer.from(JSON.stringify({ownerToken:token,parentPid:process.pid,activity:'compiler-or-dependent-writes-unsettled'})+'\n')};
    writeFileSync(activity.file,activity.bytes,{flag:'wx'});
    checkOwned();
  },release() {
    if (released) return;
    checkOwned();
    unlinkSync(ownerFile);
    if (activity) unlinkSync(activity.file);
    try {rmdirSync(lockDir);} catch (error) {if (error.code!=='ENOENT') throw error;}
    released=true;
  }};
}
