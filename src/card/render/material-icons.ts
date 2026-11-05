import {ASSET_PREFIX,assets} from '../../../vendor/decko-material-icons/assets.js';

const STOCK_URL='https://fonts.googleapis.com/css2?family=Material+Icons';
export const MATERIAL_ICONS_CSS_URL=ASSET_PREFIX+'material-icons.css';
export function configureMaterialIconsMode(value:string|undefined):'local'|undefined {
  if(value===undefined||value==='stock')return undefined;
  if(value==='local')return 'local';
  throw Error('DECKO_MATERIAL_ICONS must be local or stock');
}
export function materialIconsHeadTag(mode?:'local'):string {
  return `<link href="${mode==='local'?MATERIAL_ICONS_CSS_URL:STOCK_URL}" media="all" rel="stylesheet" type="text/css" />`;
}

export function applyMaterialIconsAssetConfiguration(html:string,mode?:'local'):string {
  if(mode!=='local')return html;
  return html.replace(/<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,tag=>{
    if(!/^<link\b/i.test(tag))return tag;
    const attributes=tag.slice(5,-1);
    const parsed=[...attributes.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)];
    const href=parsed.find(a=>a[1]!.toLowerCase()==='href');
    const value=href&&(href[2]??href[3]??href[4]);
    if(!href||!value||![STOCK_URL,'https://fonts.googleapis.com/icon?family=Material+Icons'].includes(value))return tag;
    const replacements=[{index:5+href.index!,old:href[0],value:href[0].replace(value,MATERIAL_ICONS_CSS_URL)}];
    const integrity=parsed.find(a=>a[1]!.toLowerCase()==='integrity');
    if(integrity){
      const digest=assets['material-icons.css']!.sha256.match(/../g)!.map(byte=>parseInt(byte,16));
      replacements.push({index:5+integrity.index!,old:integrity[0],value:'integrity="sha256-'+btoa(String.fromCharCode(...digest))+'"'});
    }
    for(const change of replacements.sort((a,b)=>b.index-a.index))tag=tag.slice(0,change.index)+change.value+tag.slice(change.index+change.old.length);
    return tag;
  });
}
