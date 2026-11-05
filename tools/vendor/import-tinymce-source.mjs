import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceGitEnvironment } from '../../reference-harness/runner/source-git-environment.mjs';

export const TINYMCE_COMMIT='1566b1e71c98bfc0d2c87b84b59c4d55b55b7859';
export const TINYMCE_TREE='f5850b2839cddb35cbce1e2ab1af61e39ed7a1d9';
export const TINYMCE_BUNDLED_BINARY_SHA256='3c6a5feeb3fb4dd9b5ab70f3e13b6cb0715136ddb50344b6d3069e9233dc8a9c';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const binaryPath='fixtures/vendor/mod-script-assets/card-mod-tinymce_editor/assets/script/script_tinymce.js';

export function sourceTreeIdentity(files){
  const root=new Map();
  for(const file of files){
    if(typeof file.path!=='string'||!['100644','100755'].includes(file.mode)||!/^[a-f0-9]{40}$/.test(file.oid)||file.path.includes('\\')||file.path.includes('\0')||/^[a-z]:/i.test(file.path)||path.posix.isAbsolute(file.path)||file.path.split('/').some(x=>!x||x==='..'||x==='.')||!Number.isSafeInteger(file.bytes)||file.bytes<0)throw Error('invalid upstream source entry');
    const parts=file.path.split('/');let directory=root;
    for(const part of parts.slice(0,-1)){if(!directory.has(part))directory.set(part,new Map());directory=directory.get(part);if(!(directory instanceof Map))throw Error('source file/directory collision');}
    if(directory.has(parts.at(-1)))throw Error('duplicate upstream source entry');
    directory.set(parts.at(-1),file);
  }
  const tree=directory=>{
    const entries=[...directory].map(([name,value])=>({name,directory:value instanceof Map,value}));
    entries.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.directory?'/':'')),Buffer.from(b.name+(b.directory?'/':''))));
    const bytes=Buffer.concat(entries.map(entry=>Buffer.concat([
      Buffer.from(`${entry.directory?'40000':entry.value.mode} ${entry.name}\0`),
      Buffer.from(entry.directory?tree(entry.value):entry.value.oid,'hex'),
    ])));
    return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
  };
  return tree(root);
}

export function verifyTinyMceSource(sourceRoot=path.join(repo,'third-party-source/tinymce-5.10.7')){
  sourceRoot=path.resolve(sourceRoot);
  if(lstatSync(sourceRoot).isSymbolicLink()||realpathSync(sourceRoot)!==sourceRoot)throw Error('redirected TinyMCE source root');
  if(readdirSync(sourceRoot).some(name=>!['PROVENANCE.md','SOURCE-MANIFEST.json','upstream'].includes(name)))throw Error('unexpected TinyMCE source custody entry');
  for(const name of ['SOURCE-MANIFEST.json',...(existsSync(path.join(sourceRoot,'PROVENANCE.md'))?['PROVENANCE.md']:[])])if(!lstatSync(path.join(sourceRoot,name)).isFile()||lstatSync(path.join(sourceRoot,name)).isSymbolicLink())throw Error('invalid TinyMCE custody file: '+name);
  const manifest=JSON.parse(readFileSync(path.join(sourceRoot,'SOURCE-MANIFEST.json')));
  if(manifest.format!==1||manifest.repository!=='https://github.com/tinymce/tinymce'||manifest.tag!=='5.10.7'||manifest.commit!==TINYMCE_COMMIT||manifest.tree!==TINYMCE_TREE||!Array.isArray(manifest.files)||sourceTreeIdentity(manifest.files)!==TINYMCE_TREE)throw Error('TinyMCE source tree does not match the verified official tag');
  if(manifest.files.some(file=>!/^[a-f0-9]{64}$/.test(file.sha256)))throw Error('invalid TinyMCE source digest');
  const expectedFiles=new Map(manifest.files.map(file=>[file.path,file])),expectedDirectories=new Set(['']);
  for(const file of manifest.files){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)expectedDirectories.add(parts.slice(0,i).join('/'));}
  const upstream=path.join(sourceRoot,'upstream'),seen=new Set();
  const visit=(directory,relative)=>{
    const stat=lstatSync(directory);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('redirected TinyMCE source directory: '+relative);
    for(const name of readdirSync(directory)){
      const file=path.join(directory,name),entry=relative?relative+'/'+name:name,details=lstatSync(file);
      if(details.isSymbolicLink())throw Error('redirected TinyMCE source entry: '+entry);
      if(details.isDirectory()){if(!expectedDirectories.has(entry))throw Error('unexpected TinyMCE source directory: '+entry);visit(file,entry);}
      else if(details.isFile()){
        const expected=expectedFiles.get(entry);if(!expected)throw Error('unexpected TinyMCE source file: '+entry);
        if(process.platform!=='win32'&&((details.mode&0o111)!==0)!==(expected.mode==='100755'))throw Error('TinyMCE source executable mode differs: '+entry);
        seen.add(entry);
      }else throw Error('unsupported TinyMCE source entry: '+entry);
    }
  };
  visit(upstream,'');
  if(seen.size!==expectedFiles.size)throw Error('TinyMCE source inventory is incomplete');
  for(const file of manifest.files){
    const bytes=readFileSync(path.join(sourceRoot,'upstream',file.path));
    if(bytes.length!==file.bytes||sha(bytes)!==file.sha256||gitBlob(bytes)!==file.oid)throw Error('TinyMCE source bytes differ: '+file.path);
  }
  const version=JSON.parse(readFileSync(path.join(sourceRoot,'upstream/modules/tinymce/package.json'))).version;
  if(version!=='5.10.7')throw Error('TinyMCE source version mismatch');
  for(const name of ['modules/tinymce/src/core/main/ts/api/Editor.ts','modules/tinymce/src/core/main/ts/api/PluginManager.ts','LICENSE.TXT','CONTRIBUTING.md','Gruntfile.js','yarn.lock'])if(!manifest.files.some(file=>file.path===name))throw Error('TinyMCE preferred source/build input missing: '+name);
  const binary=readFileSync(path.join(repo,binaryPath));
  if(manifest.bundledBinary?.path!==binaryPath||manifest.bundledBinary.bytes!==binary.length||manifest.bundledBinary.sha256!==TINYMCE_BUNDLED_BINARY_SHA256||sha(binary)!==TINYMCE_BUNDLED_BINARY_SHA256||!/Version: 5\.10\.7/.test(binary.toString('utf8').slice(0,1000)))throw Error('bundled TinyMCE binary differs from the recorded version');
  return {commit:manifest.commit,tree:manifest.tree,version,files:manifest.files.length,bytes:manifest.files.reduce((n,file)=>n+file.bytes,0),bundledBinarySha256:TINYMCE_BUNDLED_BINARY_SHA256,exactFilesystemInventory:true,executableModeEvidence:process.platform==='win32'?'manifest Git modes; original index/tree must be verified separately':'manifest and filesystem executable bits'};
}

async function importSource(checkout){
  const git=(...args)=>execFileSync('git',['--no-replace-objects','-C',checkout,...args],{encoding:'utf8',windowsHide:true,env:sourceGitEnvironment(),maxBuffer:32*1024*1024});
  const head=git('rev-parse','HEAD').trim(),tree=git('rev-parse','HEAD^{tree}').trim();
  if(head!==TINYMCE_COMMIT||tree!==TINYMCE_TREE||git('remote','get-url','origin').trim()!=='https://github.com/tinymce/tinymce.git')throw Error('source checkout is not the verified official TinyMCE tag');
  const files=git('ls-tree','-r','-z','--long','HEAD').split('\0').filter(Boolean).map(record=>{
    const tab=record.indexOf('\t'),[mode,type,oid,size]=record.slice(0,tab).trim().split(/\s+/);
    if(type!=='blob')throw Error('upstream source contains an unsupported object');
    return {path:record.slice(tab+1),mode,oid,bytes:Number(size)};
  });
  if(sourceTreeIdentity(files)!==TINYMCE_TREE)throw Error('upstream inventory is incomplete');
  const output=path.join(repo,'third-party-source/tinymce-5.10.7');
  if(existsSync(output))throw Error('refusing to replace existing TinyMCE source');
  mkdirSync(path.join(output,'upstream'),{recursive:true});
  const child=spawn('git',['--no-replace-objects','-C',checkout,'cat-file','--batch'],{windowsHide:true,env:sourceGitEnvironment(),stdio:['pipe','pipe','pipe']});
  let errorText='';child.stderr.on('data',bytes=>{errorText+=bytes;});
  const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('upstream Git stream failed: '+errorText)));});
  const writing=(async()=>{for(const file of files)if(!child.stdin.write(file.oid+'\n'))await new Promise(resolve=>child.stdin.once('drain',resolve));child.stdin.end();})();
  let buffer=Buffer.alloc(0),frame,index=0;
  for await(const bytes of child.stdout){
    buffer=Buffer.concat([buffer,bytes]);
    while(true){
      if(!frame){const end=buffer.indexOf(10);if(end<0)break;const [oid,type,size]=buffer.subarray(0,end).toString().split(' ');frame=files[index++];if(!frame||oid!==frame.oid||type!=='blob'||Number(size)!==frame.bytes)throw Error('unexpected upstream source frame');buffer=buffer.subarray(end+1);}
      if(buffer.length<frame.bytes+1)break;
      if(buffer[frame.bytes]!==10)throw Error('invalid upstream source frame terminator');
      const content=buffer.subarray(0,frame.bytes),target=path.join(output,'upstream',frame.path);
      if(gitBlob(content)!==frame.oid)throw Error('upstream blob identity mismatch');
      mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,content);frame.sha256=sha(content);
      buffer=buffer.subarray(frame.bytes+1);frame=undefined;
    }
  }
  await writing;await completed;if(frame||buffer.length||index!==files.length)throw Error('incomplete upstream source stream');
  const binary=readFileSync(path.join(repo,binaryPath));
  writeFileSync(path.join(output,'SOURCE-MANIFEST.json'),JSON.stringify({format:1,repository:'https://github.com/tinymce/tinymce',tag:'5.10.7',commit:head,tree,files,bundledBinary:{path:binaryPath,bytes:binary.length,sha256:sha(binary)},verification:'Official remote tag resolved to this commit; complete raw Git tree and every blob retained. No upstream install/build script executed; bundled binary was not rebuilt.'},null,2)+'\n');
  console.log(JSON.stringify(verifyTinyMceSource(output),null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--verify')console.log(JSON.stringify(verifyTinyMceSource(),null,2));
  else if(process.argv[2])await importSource(path.resolve(process.argv[2]));
  else throw Error('supply the verified official source checkout or --verify');
}
