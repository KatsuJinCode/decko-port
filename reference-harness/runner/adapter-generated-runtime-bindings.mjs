import { createHash } from "node:crypto";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const PRODUCERS = [
  { kind: "better-sqlite3-row-projection/1", suffix: "/node_modules/better-sqlite3/lib/database.js", package: "better-sqlite3", version: "13.0.3", sha256: "539315c97591561394d2a0f257632305c3af1e32915a123aa8cc9032056d8ae2" },
  { kind: "long-static-i64-wasm/1", suffix: "/node_modules/long/umd/index.js", package: "long", version: "5.3.2", sha256: "ea6da8d5fff04abc358b94488dbbb7eeb46e5027cc05303b1761cea94bef7821" },
];
export const generatedProducerDefinition = url => typeof url === "string" ? PRODUCERS.find(producer => url.endsWith(producer.suffix)) : undefined;

function projectionColumns(source) {
  const match = /^\(function anonymous\(\n\) \{\nreturn \(([^)]*)\) => \(\{([\s\S]*)\}\)\n\}\)$/.exec(source);
  if (!match) return null;
  const columns = [], body = match[2];
  const pair = /("(?:\\.|[^"\\])*"):v([0-9]+)(,|$)/y;
  while (pair.lastIndex < body.length) {
    const found = pair.exec(body);
    if (!found || Number(found[2]) !== columns.length) return null;
    let name;
    try { name = JSON.parse(found[1]); } catch { return null; }
    if (typeof name !== "string" || name === "__proto__") return null;
    columns.push(name);
    if (found[3] === "") break;
  }
  const parameters = columns.map((_, index) => `v${index}`).join(",");
  const properties = columns.map((key, index) => `${JSON.stringify(key)}:v${index}`).join(",");
  const reconstructed = `(function anonymous(\n) {\nreturn (${parameters}) => ({${properties}})\n})`;
  return reconstructed === source ? columns : null;
}

function staticWasm(source) {
  const match = /new Uint8Array\(\[([\s\S]*?)\]\)/.exec(source);
  if (!match) return null;
  const values = match[1].replace(/\/\/[^\r\n]*/g, "").trim().replace(/,\s*$/, "").split(",").map(value => value.trim());
  if (values.some(value => !/^(?:0|[1-9][0-9]*)$/.test(value) || Number(value) > 255)) return null;
  return Buffer.from(values.map(Number));
}

export function bindGeneratedRuntime(record, producer) {
  const frame = record?.metadata?.stackTrace?.callFrames?.[0];
  const definition = generatedProducerDefinition(frame?.url);
  if (!definition || !producer || producer.metadata?.hasSourceURL || record.metadata?.hasSourceURL ||
      producer.metadata?.scriptId !== frame.scriptId || producer.metadata?.url !== frame.url ||
      typeof producer.source !== "string" || sha(producer.source) !== definition.sha256) return null;
  const identity = { kind: definition.kind, producer_url: frame.url, producer_script_id: frame.scriptId,
    producer_sha256: definition.sha256, package: definition.package, version: definition.version };
  if (definition.kind === "better-sqlite3-row-projection/1") {
    if (record.metadata.scriptLanguage !== "JavaScript" || typeof record.source !== "string") return null;
    const columns = projectionColumns(record.source);
    if (columns === null) return null;
    return { ...identity, input_columns: columns, reconstructed_source_sha256: sha(record.source) };
  }
  if (record.metadata.scriptLanguage !== "WebAssembly" || typeof record.bytecode !== "string") return null;
  const expected = staticWasm(producer.source), actual = Buffer.from(record.bytecode, "base64");
  if (expected === null || !expected.equals(actual)) return null;
  return { ...identity, literal_bytes: expected.length, reconstructed_binary_sha256: sha(expected) };
}

export function generatedRuntimeBindingsValid(audit, canonical) {
  if (!Array.isArray(audit.generated_sources)) return false;
  if (!audit.generated_sources.length) return true;
  if (!canonical || !Array.isArray(audit.generated_producers)) return false;
  return audit.generated_sources.every(record => {
    const producer = audit.generated_producers.find(value => value.metadata?.scriptId === record.metadata?.stackTrace?.callFrames?.[0]?.scriptId);
    const expected = bindGeneratedRuntime(record, producer);
    if (!expected || !record.binding || typeof record.binding !== "object" || Array.isArray(record.binding) ||
        Object.keys(expected).length !== Object.keys(record.binding).length ||
        Object.keys(expected).some(key => JSON.stringify(expected[key]) !== JSON.stringify(record.binding[key]))) return false;
    return audit.modules.some(module => module.url === expected.producer_url && module.loaded_sha256 === expected.producer_sha256 &&
      module.package?.name === expected.package && module.package?.version === expected.version);
  });
}
