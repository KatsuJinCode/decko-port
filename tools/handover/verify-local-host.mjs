import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
const child=spawn(process.execPath,['vm-staging-server.mjs',path.join(root,'tmp/demo/deck.sqlite3'),String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DECKO_WRITE_PATH:'0',DECKO_FIRST_RUN:'0'}});
let output='',readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
child.stdout.on('data',data=>{output+=data;if(output.includes('[vm-staging] listening on'))readyResolve();});
child.stderr.on('data',data=>{output+=data;});
child.on('exit',()=>readyReject(Error('host exited before listening: '+output)));
const origin='http://127.0.0.1:'+port;
try{
 await ready;
 const status=await fetch(origin+'/_status',{signal:AbortSignal.timeout(15000)});assert.equal(status.status,200,await status.text());
 const page=await fetch(origin+'/',{signal:AbortSignal.timeout(15000)});const html=await page.text();assert.equal(page.status,200,html);assert.ok(html.includes('<html'),html);
 const shutdown=await fetch(origin+'/_shutdown',{method:'POST',signal:AbortSignal.timeout(15000)});assert.equal(shutdown.status,200,await shutdown.text());
 const result=await exit;assert.equal(result.code,0,output);
 console.log('PASS: documented Node host started, health and Home answered 200, graceful shutdown exited 0.');
}finally{
 if(child.exitCode===null&&child.signalCode===null){
  try{await fetch(origin+'/_shutdown',{method:'POST',signal:AbortSignal.timeout(5000)});}catch(error){console.error('Graceful shutdown unavailable for this owned test host:',error.message);child.kill('SIGTERM');}
  await exit;
 }
}
