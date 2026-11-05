import {ASSET_PREFIX,assets} from '../../vendor/decko-material-icons/assets.js';

export function serveMaterialIconsAsset(request:Request):Response|undefined {
  const path=new URL(request.url).pathname;
  if(!path.startsWith(ASSET_PREFIX))return undefined;
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
  const name=path.slice(ASSET_PREFIX.length);
  if(!Object.hasOwn(assets,name))return new Response('Not found',{status:404});
  const asset=assets[name]!,etag='"'+asset.sha256+'"';
  const headers={'cache-control':'public, max-age=31536000, immutable',etag,'x-content-type-options':'nosniff'};
  if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
  const bytes=Uint8Array.from(atob(asset.base64),char=>char.charCodeAt(0));
  return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'content-type':asset.contentType,'content-length':String(bytes.length)}});
}
