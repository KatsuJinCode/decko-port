import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bindGeneratedRuntime, generatedRuntimeBindingsValid } from "../adapter-generated-runtime-bindings.mjs";

function producer(name, file) {
  const url = new URL(`../../../node_modules/${name}/${file}`, import.meta.url);
  return { metadata: { url: url.href, scriptId: name, hasSourceURL: false }, source: readFileSync(url, "utf8") };
}
function projection(columns) {
  return `(function anonymous(\n) {\nreturn (${columns.map((_, index) => `v${index}`).join(",")}) => ({${columns.map((key, index) => `${JSON.stringify(key)}:v${index}`).join(",")}})\n})`;
}
function generated(p, source, language = "JavaScript") {
  return { metadata: { scriptLanguage: language, hasSourceURL: false, stackTrace: { callFrames: [{ url: p.metadata.url, scriptId: p.metadata.scriptId }] } }, source };
}

test("exact SQLite producer binds only independently reconstructed data projections", () => {
  const p = producer("better-sqlite3", "lib/database.js");
  const columns = ["name", 'a"b', "}; process.exit(99); //", "line\nbreak", "constructor"];
  const record = generated(p, projection(columns));
  const binding = bindGeneratedRuntime(record, p);
  assert.deepEqual(binding.input_columns, columns);
  for (const source of [record.source + ";process.exit(99)", record.source.replace(":v0", ':v0.constructor("return process")()'), projection(["__proto__"]), record.source.replace("(v0,v1", "(v1,v0")]) {
    assert.equal(bindGeneratedRuntime(generated(p, source), p), null);
  }
  assert.equal(bindGeneratedRuntime(record, { ...p, source: p.source + "\n// changed producer" }), null);
  assert.equal(bindGeneratedRuntime({ ...record, metadata: { ...record.metadata, hasSourceURL: true } }, p), null);
});

test("long Wasm binding requires the exact actual binary matching its consumed literal", () => {
  const p = producer("long", "umd/index.js");
  const literal = /new Uint8Array\(\[([\s\S]*?)\]\)/.exec(p.source)[1].replace(/\/\/[^\r\n]*/g, "").trim().replace(/,\s*$/, "");
  const bytes = Buffer.from(JSON.parse(`[${literal}]`));
  assert.equal(bytes.length, 286);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "ed97339a3c2cdcd30fe7903ecad11562b7b9bfcfde24e0e584346f54c9247148", "independently captured V8 binary identity");
  const record = { ...generated(p, "", "WebAssembly"), bytecode: bytes.toString("base64") };
  assert.equal(bindGeneratedRuntime(record, p).literal_bytes, 286);
  bytes[8] ^= 1;
  assert.equal(bindGeneratedRuntime({ ...record, bytecode: bytes.toString("base64") }, p), null);
});

test("a claimed binding needs the actual matching consumed producer and canonical admission", () => {
  const p = producer("better-sqlite3", "lib/database.js"), record = generated(p, projection(["id"]));
  record.binding = bindGeneratedRuntime(record, p);
  const audit = { generated_sources: [record], generated_producers: [p], modules: [{ url: p.metadata.url, loaded_sha256: record.binding.producer_sha256, package: { name: "better-sqlite3", version: "13.0.3" } }] };
  assert.equal(generatedRuntimeBindingsValid(audit, true), true);
  assert.equal(generatedRuntimeBindingsValid(audit, false), false);
  audit.modules[0].loaded_sha256 = "0".repeat(64);
  assert.equal(generatedRuntimeBindingsValid(audit, true), false);
});
