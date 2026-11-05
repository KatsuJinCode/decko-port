import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const cssUrl='https://fonts.googleapis.com/css2?family=Material+Icons';
const fontUrl='https://fonts.gstatic.com/s/materialicons/v145/flUhRq6tzZclQEJ-Vdg-IuiaDsNc.woff2';
const licenseUrl='https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE';
const agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const get=async url=>{
  const response=await fetch(url,{headers:{'user-agent':agent},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Static asset HTTP'+response.status);
  return Buffer.from(await response.arrayBuffer());
};
const [css,font,license]=await Promise.all([get(cssUrl),get(fontUrl),get(licenseUrl)]);
if(font.subarray(0,4).toString()!=='wOF2'||font.length>250000)throw Error('Unexpected font format/size');
if(!license.toString().includes('Apache License')||!license.toString().includes('Version 2.0'))throw Error('Unexpected upstream license');
const original=css.toString();
if(original.split(fontUrl).length!==2)throw Error('Stylesheet does not reference the exact observed font; do not infer another version');
const localCss=Buffer.from(original.replace(fontUrl,'./material-icons.woff2'));
const assetSetSha256=hash(Buffer.concat([font,localCss,license]));
const prefix='/mod/bootstrap/material-icons/'+assetSetSha256.slice(0,12)+'/';
const assets=Object.fromEntries([
  ['material-icons.css',localCss,'text/css; charset=utf-8'],
  ['material-icons.woff2',font,'font/woff2'],
  ['LICENSE.txt',license,'text/plain; charset=utf-8'],
].map(([name,bytes,contentType])=>[name,{base64:bytes.toString('base64'),sha256:hash(bytes),contentType}]));
const root=new URL('../../vendor/decko-material-icons/',import.meta.url);
mkdirSync(root,{recursive:true});
writeFileSync(new URL('assets.js',root),'// Existing Google Material Icons bytes; tools/assets/vendor-material-icons.mjs.\nexport const ASSET_PREFIX='+JSON.stringify(prefix)+';\nexport const assets='+JSON.stringify(assets)+';\n');
writeFileSync(new URL('assets.d.ts',root),'export const ASSET_PREFIX: string;\nexport const assets: Readonly<Record<string,{base64:string;sha256:string;contentType:string}>>;\n');
writeFileSync(new URL('LICENSE.txt',root),license);
const provenance={capturedAt:new Date().toISOString(),observedFailure:'Google font ERR_CONNECTION_CLOSED during a full browser-journey run',cssUrl,fontUrl,licenseUrl,userAgent:agent,originalCssSha256:hash(css),fontSha256:hash(font),licenseSha256:hash(license),assetSetSha256,modification:'Only the exact observed font URL in the stylesheet becomes ./material-icons.woff2; font and license bytes unchanged.',prefix,files:Object.entries(assets).map(([path,a])=>({path,sha256:a.sha256,bytes:Buffer.from(a.base64,'base64').length,contentType:a.contentType}))};
writeFileSync(new URL('provenance.json',root),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({prefix,files:provenance.files}));
