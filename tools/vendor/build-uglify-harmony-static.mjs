import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vendor = "vendor/uglifier-4.2.1-uglify-harmony/";
const hashes = {
  "es5.js": "2b07ae9bb832c97dd626abf842fa9eb679097d3d89247c14995025eb34edf945",
  "split.js": "a3bf0ca991071d83b773bc084731cc7d1b57c9076696c5236619f6ef61402c8b",
  "source-map.js": "6fe2072f87a800ca765308a4f1a9379276c388ca1ff22ab44e416f1c484763c4",
  "uglify-harmony.js": "f8fe16073c3f2ec536984d18cffade623bc399cfc2997353d6d919df14f8c1d0",
  "uglifier.js": "0a83872140a20fe90b176b6a7119fb36a746cec854421f42e12a3463ae619f1f",
};
const licenses = {
  "source-map-js-LICENSE-NOTICES.txt": "314c9f4df204ee1fd1ff25652c75515ba1cde8637caeb68df1944f5035de1095",
  "split-js-LICENSE-MIT.txt": "56df9591f1d18b7526cf2bcffdb91bd5b1ad398040377469e1b21c0a6f3fe77d",
  "uglifier-gem-LICENSE-MIT.txt": "cbad7cc82846e05b3adb896d6395bdfcae1664c40a605a0f291ada692e38c001",
  "uglify-harmony-js-LICENSE-BSD-2-Clause.txt": "54f55d920ebb1505eaa6f78e3e9278cef07c004bf396c8a0cf21ac9b5e07c4a8",
};
const hash = value => createHash("sha256").update(value).digest("hex");
const outputName = "src/card/assets/uglify-harmony-static.generated.ts";
const manifestName = "src/card/assets/uglify-harmony-static.provenance.json";

export function buildStaticUglifier() {
  const files = Object.keys(hashes);
  const texts = files.map(file => {
    const bytes = readFileSync(resolve(root, vendor, file));
    assert.equal(hash(bytes), hashes[file], `unreviewed vendor source: ${file}`);
    return bytes.toString("utf8");
  });
  for (const [file, digest] of Object.entries(licenses)) assert.equal(hash(readFileSync(resolve(root, vendor, file))), digest, `license changed: ${file}`);
  const captured = new Map();
  let calls = 0;
  const context = vm.createContext({});
  const NativeFunction = vm.runInContext("Function", context);
  function captureFunction(...args) {
    calls++;
    assert.ok(args.every(arg => typeof arg === "string"));
    captured.set(JSON.stringify(args), args);
    return Reflect.construct(NativeFunction, args);
  }
  captureFunction.prototype = NativeFunction.prototype;
  context.Function = captureFunction;
  vm.runInContext(texts.join("\n"), context);
  context.uglifier({ source: "", output: { comments: false }, compress: false, mangle: false, ie8: true });
  captured.set("[]", []);
  assert.equal(calls, 201, "trusted initialization changed");
  assert.equal(captured.size, 201, "trusted factory inventory changed");
  let namedFactories = 0;
  const entries = [...captured].map(([key, args]) => {
    let body = args.at(-1) ?? "";
    const named = /^return\s*\(?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(body);
    if (named) {
      namedFactories++;
      body = `return preserveStaticFunctionName(${body.slice(6).trim()},${JSON.stringify(named[1])});`;
    }
    return `${JSON.stringify(key)}:()=>preserveStaticFunctionName(function anonymous(${args.slice(0,-1).join(",")}){\n${body}\n},"anonymous")`;
  }).join(",\n");
  const sites = [5813, 9870, 342731, 342873, 346400];
  let harmony = texts[3];
  for (const offset of sites.toReversed()) {
    assert.equal(harmony.slice(offset, offset + 12), "new Function");
    harmony = harmony.slice(0,offset) + "new trustedUglifierFunction" + harmony.slice(offset+12);
  }
  const source = `// @ts-nocheck -- generated; edit tools/vendor/build-uglify-harmony-static.mjs.
// Uglifier4.2.1 vendor bytes/attribution: ${vendor}PROVENANCE-AND-LICENSE.md.
// Original BSD/MIT/source-map notices remain in the embedded sources below.
// Five constructor calls redirect to exact, build-time trusted static functions.
// No eval, runtime code generation, host service, or parser replacement.
function preserveStaticFunctionName(fn,name){return Object.defineProperty(fn,"name",{value:name,configurable:true});}
const factories=Object.freeze({${entries}});
/** Internal finite factory lookup. Unknown input is always rejected. */
export function trustedUglifierFunction(...args){
 const key=JSON.stringify(args);
 if(!Object.hasOwn(factories,key))throw new Error('unrecorded trusted Uglifier constructor');
 return factories[key]();
}
let compiler;
function initializedCompiler(){
 if(compiler===undefined)compiler=(function(){var UglifyJS,MOZ_SourceMap,sourceMap,module,exports,define;
${texts[0]}\n${texts[1]}\n${texts[2]}
sourceMap=this.sourceMap;
${harmony}\n${texts[4]}
uglifier.stringLiteralRanges=function(source){
 const ranges=[];
 UglifyJS.parse(source).walk(new UglifyJS.TreeWalker(function(node){
  if(node.TYPE==="String")ranges.push({value:node.value,start:node.start.pos,end:node.end.endpos});
 }));
 return ranges;
};
return uglifier;}).call({});
 return compiler;
}
export function staticUglifier(options){
 return initializedCompiler()(options);
}
export function staticUglifierStringLiteralRanges(source){
 return initializedCompiler().stringLiteralRanges(source);
}
`;
  const manifest = {
    format: 1, generator: "tools/vendor/build-uglify-harmony-static.mjs",
    source: vendor, sources: hashes, licenses,
    executableConstructorOffsets: sites, trustedInitializationCalls: calls,
    trustedFactorySignatures: captured.size,
    preservedNamedFactories: namedFactories, nameMetadata: "Original dynamic anonymous and returned named function names, preserved through bundling",
    factorySignaturesSha256: hash(JSON.stringify([...captured.values()])),
    prewarm: "empty source; fixed OutputStream predicate at offset138968",
    wrapper: "explicit ESM-local UMD namespace; fresh static function per call",
    parserSurface: "Existing pinned parse/TreeWalker; string literal values and exact source ranges only",
    output: outputName, outputBytes: Buffer.byteLength(source), outputSha256: hash(source),
  };
  return { source, manifest };
}

export function assertStaticUglifierCurrent() {
  const { source, manifest } = buildStaticUglifier();
  assert.equal(readFileSync(resolve(root,outputName),"utf8"),source,"generated Uglifier source is stale");
  assert.equal(readFileSync(resolve(root,manifestName),"utf8"),JSON.stringify(manifest,null,2)+"\n","generated provenance is stale");
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { source, manifest } = buildStaticUglifier();
  const json = JSON.stringify(manifest,null,2)+"\n";
  if (process.argv.includes("--check")) {
    assert.equal(readFileSync(resolve(root,outputName),"utf8"),source,"generated Uglifier source is stale");
    assert.equal(readFileSync(resolve(root,manifestName),"utf8"),json,"generated provenance is stale");
  } else {
    writeFileSync(resolve(root,outputName),source);
    writeFileSync(resolve(root,manifestName),json);
  }
  console.log(JSON.stringify({ output: outputName, bytes: manifest.outputBytes, sha256: manifest.outputSha256, factories: manifest.trustedFactorySignatures, check: process.argv.includes("--check") }));
}
