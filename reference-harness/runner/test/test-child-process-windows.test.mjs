import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAst} from 'rolldown/parseAst';
import {listTestFiles} from '../../../tools/test-gates.mjs';

const root=fileURLToPath(new URL('../../..',import.meta.url));
const childApis=new Set(['spawn','spawnSync','fork','exec','execSync','execFile','execFileSync']);
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const blocks=new Set(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement']);
const children=(node,visit)=>{for(const [key,value] of Object.entries(node))if(!['comments','tokens','parent'].includes(key)){if(Array.isArray(value))value.forEach(x=>x&&typeof x.type==='string'&&visit(x));else if(value&&typeof value.type==='string')visit(value);}};
const optionName=property=>property.key?.type==='Literal'?property.key.value:!property.computed?property.key?.name:null;

function missingHiddenOptions(source){
  const tree=parseAst(source,{lang:'ts'}),scopes=new WeakMap();
  const make=(parent,kind)=>({parent,kind,bindings:new Map()});
  const top=make(null,'function');
  function declare(pattern,scope,binding=null){
    if(!pattern)return;
    if(pattern.type==='Identifier')scope.bindings.set(pattern.name,binding);
    else if(pattern.type==='RestElement')declare(pattern.argument,scope);
    else if(pattern.type==='AssignmentPattern')declare(pattern.left,scope);
    else if(pattern.type==='ArrayPattern')pattern.elements.forEach(x=>declare(x,scope));
    else if(pattern.type==='ObjectPattern')pattern.properties.forEach(x=>declare(x.type==='RestElement'?x.argument:x.value,scope));
  }
  function bind(node,scope,parent){
    if(['FunctionDeclaration','ClassDeclaration'].includes(node.type)&&node.id)declare(node.id,scope);
    let current=scope;
    if(functions.has(node.type)){
      current=make(scope,'function');
      if(node.type==='FunctionExpression'&&node.id)declare(node.id,current);
      node.params.forEach(x=>declare(x,current));
    }else if(blocks.has(node.type)){
      current=make(scope,'block');
      if(node.type==='CatchClause')declare(node.param,current);
    }
    scopes.set(node,current);
    if(node.type==='VariableDeclarator'){
      let target=current;
      if(parent?.kind==='var')while(target.parent&&target.kind!=='function')target=target.parent;
      declare(node.id,target);
    }
    if(node.type==='ImportDeclaration')for(const specifier of node.specifiers){
      const native=['node:child_process','child_process'].includes(node.source.value);
      declare(specifier.local,current,native?(specifier.type==='ImportSpecifier'?{api:specifier.imported.name??specifier.imported.value}:{namespace:true}):null);
    }
    children(node,child=>bind(child,current,node));
  }
  bind(tree,top,null);
  function binding(node,name){for(let scope=scopes.get(node);scope;scope=scope.parent)if(scope.bindings.has(name))return scope.bindings.get(name);return null;}
  const problems=[];
  function inspect(node){
    if(node.type==='CallExpression'){
      const callee=node.callee;
      const api=callee.type==='Identifier'?binding(node,callee.name)?.api:
        callee.type==='MemberExpression'&&callee.object.type==='Identifier'&&binding(node,callee.object.name)?.namespace?
          (callee.computed?callee.property.value:callee.property.name):null;
      if(childApis.has(api)){
        let index=api==='exec'||api==='execSync'?1:2;
        if(index===2&&node.arguments[1]?.type==='ObjectExpression')index=1;
        const options=node.arguments[index];
        const properties=options?.type==='ObjectExpression'?options.properties:[];
        const selected=properties.findLastIndex(x=>x.type==='Property'&&optionName(x)==='windowsHide');
        const hidden=selected>=0&&properties[selected].value.type==='Literal'&&properties[selected].value.value===true&&
          !properties.slice(selected+1).some(x=>x.type==='SpreadElement'||x.computed);
        if(!hidden)problems.push({api,line:source.slice(0,node.start).split('\n').length});
      }
    }
    children(node,inspect);
  }
  inspect(tree);
  return problems;
}

test('test child process guard rejects omitted, false and overwritten suppression',()=>{
  const source=`import {spawn as launch, execFileSync} from 'node:child_process';
    launch('node', [], {});
    execFileSync('node', [], {windowsHide:false});
    launch('node', [], {windowsHide:true, ...options});`;
  assert.equal(missingHiddenOptions(source).length,3);
});

test('test child process guard accepts hidden named and namespace calls',()=>{
  assert.deepEqual(missingHiddenOptions(`import {spawn as launch} from 'node:child_process';
    import * as child from 'node:child_process';
    launch('node', [], {...options, windowsHide:true});
    child.execFileSync('node', {windowsHide:true});`),[]);
});

test('a computed variable key cannot impersonate the literal window option',()=>{
  assert.equal(missingHiddenOptions(`import {spawn} from 'node:child_process';
    spawn('node', [], {[windowsHide]:true});`).length,1);
});

test('local callback, loop and catch names do not acquire the imported process binding',()=>{
  assert.deepEqual(missingHiddenOptions(`import {spawn} from 'node:child_process';
    function callback(spawn){spawn('local');}
    {const spawn=local;spawn('local');}
    for(const spawn of locals){spawn('local');}
    try{}catch(spawn){spawn('local');}
    spawn('node', [], {windowsHide:true});`),[]);
});

test('statically imported native child calls in the declared test inventory hide their windows',()=>{
  const problems=[];
  const files=listTestFiles(root);
  assert.ok(files.includes('tests/deploy/staging-home-mark-endpoint.test.ts'),'The declared product tests must be in scope');
  for(const file of files){
    const source=readFileSync(path.join(root,file),'utf8');
    for(const problem of missingHiddenOptions(source))problems.push({file,...problem});
  }
  assert.deepEqual(problems,[],'Native test children must explicitly use windowsHide:true; unknown options are not proof');
});
