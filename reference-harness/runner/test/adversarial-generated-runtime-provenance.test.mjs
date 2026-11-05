import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindGeneratedRuntime} from '../adapter-generated-runtime-bindings.mjs';
import {observeGeneratedSources} from '../adapter-generated-source-witness.mjs';

test('compiler observer retains unknown generated code despite claimed producer URLs', async () => {
  const audit={problems:[]};
  const observer=await observeGeneratedSources(audit,{canonical:true});
  const urls=['file:///owned/node_modules/better-sqlite3/lib/database.js',
    'file:///owned/node_modules/long/umd/index.js','node:internal/source-proof'];
  let executed=0;
  for(const url of urls) {
    eval('executed++;\n//# sourceURL='+url);
  }
  new Function('return "unknown-function-marker"')();
  observer.finish();
  assert.equal(executed,3,'direct eval retains its caller scope');
  assert.equal(audit.generated_sources.length,4);
  assert.equal(audit.generated_observer.unbound_events,4);
  for(const url of urls) {
    const record=audit.generated_sources.find(record=>record.metadata.url===url);
    assert.ok(record, url);
    assert.equal(record.metadata.hasSourceURL,true);
    assert.match(record.source,/executed\+\+/);
    assert.equal(record.binding,undefined);
  }
});

test('producer identity and whole-program reconstruction reject independent mutations', () => {
  const url=new URL('../../../node_modules/better-sqlite3/lib/database.js',import.meta.url).href;
  const producer={metadata:{url,scriptId:'native-producer',hasSourceURL:false},source:readFileSync(new URL(url),'utf8')};
  const source='(function anonymous(\n) {\nreturn (v0) => ({"id":v0})\n})';
  const metadata={scriptLanguage:'JavaScript',hasSourceURL:false,stackTrace:{callFrames:[{url,scriptId:'native-producer'}]}};
  const record={source,metadata};
  assert.ok(bindGeneratedRuntime(record,producer));
  const mutations=[
    {source:'process.exit(1);'+source},
    {source:source+';process.exit(1)'},
    {source:source.replace('"id":v0','"id":(process.exit(1),v0)')},
    {source:source.replace('(v0)','(v0=process.exit(1))')},
    {source:source.replace('"id":v0','"id":v1')},
    {source:source.replace('"id":v0','"__proto__":v0')},
    {metadata:{...metadata,hasSourceURL:true}},
    {metadata:{...metadata,stackTrace:{callFrames:[]}}},
    {metadata:{...metadata,stackTrace:{callFrames:[{url,scriptId:'other'}]}}},
    {metadata:{...metadata,scriptLanguage:'WebAssembly'}},
  ];
  for(const mutation of mutations)assert.equal(bindGeneratedRuntime({...record,...mutation},producer),null,JSON.stringify(mutation));
  for(const mutation of [{source:producer.source+'\n'}, {metadata:{...producer.metadata,hasSourceURL:true}},
    {metadata:{...producer.metadata,url:url+'?claimed'}}, {metadata:{...producer.metadata,scriptId:'other'}}]) {
    assert.equal(bindGeneratedRuntime(record,{...producer,...mutation}),null);
  }
});
