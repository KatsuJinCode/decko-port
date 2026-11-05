import { Module, registerHooks } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { threadId } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { runtimePackageIdentity } from "./adapter-runtime-dependencies.mjs";
let auditPath;
let counters;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const emit = record => {
  if (!auditPath) return;
  Atomics.add(counters, 0, 1);
  try {
    appendFileSync(auditPath, JSON.stringify({ pid: process.pid, thread_id: threadId, ...record }) + "\n");
    Atomics.add(counters, 1, 1);
  } catch (error) { Atomics.add(counters, 2, 1); process.stderr.write(`Loader source witness could not save: ${error.message}\n`); }
};
export function initialize(data) {
  auditPath = data.auditPath;
  counters = new Int32Array(data.counters);
  globalThis[Symbol.for("decko.adapter.source.worker.capture")] = counters;
  emit({ event: "initialized" });
}
function observe(url, result, hook) {
  if (url.startsWith("file:")) {
    try {
      const bytes = readFileSync(new URL(url));
      const source = typeof result.source === "string" ? Buffer.from(result.source) : result.source == null ? null : Buffer.from(result.source);
      emit({ event: source === null ? "deferred" : "module", hook, url, format: result.format, package: runtimePackageIdentity(url), raw_sha256: digest(bytes), raw_oid: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
        loaded_sha256: source === null ? null : digest(source), loaded_oid: source === null ? null : createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex") });
    } catch (error) { emit({ event: "error", message: error.message }); }
  }
}
const compileCommonJS = Module.prototype._compile;
Module.prototype._compile = function compileObserved(content, filename) {
  try {
    observe(pathToFileURL(filename).href,
      { source: content, format: "commonjs" }, "CommonJS compiler consumed content argument");
  } catch (error) { emit({ event: "error", message: error.message }); }
  return Reflect.apply(compileCommonJS, this, arguments);
};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  observe(url, result, "synchronous worker module load");
  return result;
} });
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  observe(url, result, "asynchronous loader registration/import");
  return result;
}
