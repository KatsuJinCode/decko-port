import {formatTagNumber} from './mod-tag-number.js';

export class UnsupportedModTagAttributeError extends Error {
  override name='UnsupportedModTagAttributeError';
}
export function isTagRecord(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
function refuse(name:string):never{throw new UnsupportedModTagAttributeError(`Unsupported tag attribute value: ${name}`);}
export function validateTagOptions(value:unknown):void{
  const active=new Set<object>();
  const visit=(item:unknown,name:string):void=>{
    if(item===null||typeof item==='boolean')return;
    if(typeof item==='number'){if(!Number.isFinite(item))refuse(name);return;}
    if(typeof item==='string'){if(/[\uD800-\uDFFF]/u.test(item))refuse(name);return;}
    if(!Array.isArray(item)&&!isTagRecord(item))refuse(name);
    if(active.has(item))refuse(name);active.add(item);
    for(const key of Reflect.ownKeys(item)){
      if(Array.isArray(item)&&key==='length')continue;
      if(typeof key!=='string')refuse(name);
      if(/[\uD800-\uDFFF]/u.test(key))refuse(name);
      if(Array.isArray(item)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=item.length))refuse(name);
      const descriptor=Object.getOwnPropertyDescriptor(item,key)!;
      if(!('value' in descriptor)||!descriptor.enumerable)refuse(name);
      if(name==='options'&&key==='data'&&isTagRecord(descriptor.value))continue;
      visit(descriptor.value,name==='options'?key:name);
    }
    if(Array.isArray(item)){
      if(Object.keys(item).length!==item.length)refuse(name);
      for(let index=0;index<item.length;index++)if(!Object.hasOwn(item,index))refuse(name);
    }
    active.delete(item);
  };
  if(!isTagRecord(value))refuse('options');visit(value,'options');
}
export function tagTruthy(value:unknown):boolean{return value!==false&&value!==null&&value!==undefined;}
export function tagBlank(value:unknown):boolean{
  if(!tagTruthy(value))return true;
  if(typeof value==='string')return /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(value);
  return Array.isArray(value)?value.length===0:isTagRecord(value)&&Object.keys(value).length===0;
}
function inspectString(value:string,symbol=false):string{
  const short:Record<string,string>={'\n':'n','\r':'r','\t':'t','\f':'f','\v':'v','\b':'b','\x07':'a','\x1b':'e'};
  const asciiSymbol=symbol&&!/[^\x00-\x7f]/.test(value);
  let result='"';
  const characters=Array.from(value);
  for(const [index,ch]of characters.entries()){
    if(ch==='"'||ch==='\\'||(ch==='#'&&/[$@{]/.test(characters[index+1]??'')))result+='\\'+ch;
    else if(Object.hasOwn(short,ch))result+='\\'+short[ch];
    else if(/[\p{Cc}\p{Zl}\p{Zp}]/u.test(ch))result+=(asciiSymbol?'\\x':'\\u')+ch.codePointAt(0)!.toString(16).toUpperCase().padStart(asciiSymbol?2:4,'0');
    else {if(/\p{Cn}/u.test(ch))refuse('unassigned Unicode inspection');result+=ch;}
  }
  return result+'"';
}
const symbolOperators = new Set(['!', '!=', '!~', '<=>', '==', '===', '=~', '<', '<=', '>', '>=', '<<', '>>', '+', '-', '*', '**', '/', '%', '&', '|', '^', '~', '+@', '-@', '[]', '[]=', '`']);
const symbolGlobalPunctuation = new Set(['~', '*', '$', '?', '!', '@', '/', '\\', ';', ',', '.', '=', ':', '<', '>', '"', '&', '`', "'", '+']);
export function inspectTagSymbol(key:string):string{
  const identifier=/^(?:[A-Za-z_]|[^\x00-\x7f\u2028\u2029])(?:[A-Za-z0-9_]|[^\x00-\x7f\u2028\u2029])*$/u;
  const method=identifier.test(key)||(/[!?=]$/.test(key)&&identifier.test(key.slice(0,-1)));
  const variable=/^@@?/.test(key)&&identifier.test(key.replace(/^@@?/,''));
  const global=key.startsWith('$')&&(identifier.test(key.slice(1))||/^\$(?:0|[1-9][0-9]*)$/.test(key)||/^\$-(?:[A-Za-z0-9_]|[^\x00-\x7f\u2028\u2029])$/u.test(key)||(key.length===2&&symbolGlobalPunctuation.has(key[1]!)));
  return ':'+(method||variable||global||symbolOperators.has(key)?key:inspectString(key,true));
}
function inspect(value:unknown):string{
  if(value===null)return 'nil';
  if(typeof value==='string')return inspectString(value);
  if(Array.isArray(value))return '['+value.map(inspect).join(', ')+']';
  if(isTagRecord(value))return '{'+Object.entries(value).map(([key,item])=>`${inspectTagSymbol(key)}=>${inspect(item)}`).join(', ')+'}';
  return tagValueString(value);
}
export function tagValueString(value:unknown):string{
  if(value===null||value===undefined)return '';
  if(typeof value==='number')return formatTagNumber(value);
  if(typeof value==='string'||typeof value==='boolean')return String(value);
  if(Array.isArray(value)||isTagRecord(value))return inspect(value);
  return refuse('nonportable object');
}
export function ordinaryTagValue(value:unknown):string{
  if(isTagRecord(value))return Object.entries(value).flatMap(([key,item])=>[key,tagValueString(item)]).join(' ');
  if(Array.isArray(value))return value.flat(Infinity).map(tagValueString).join(' ');
  return tagValueString(value);
}
export function tagTokens(value:unknown):string[]{
  if(Array.isArray(value))return value.flatMap(tagTokens);
  if(isTagRecord(value))return Object.entries(value).filter(([key,item])=>key.length>0&&tagTruthy(item)).map(([key])=>key);
  return tagBlank(value)?[]:[tagValueString(value)];
}
function equal(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
  if(isTagRecord(a)&&isTagRecord(b))return Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([k,v])=>Object.hasOwn(b,k)&&equal(v,b[k]));
  return false;
}
export function mergedTagClasses(invocation:unknown,defaults:unknown):string{
  const values=[invocation,defaults].flat(Infinity).filter(value=>value!==null&&value!==undefined);
  return values.filter((value,index)=>values.findIndex(other=>equal(value,other))===index).map(tagValueString).join(' ');
}
