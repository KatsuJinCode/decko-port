import * as modules from "node:module";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { runtimePackageIdentity } from "./adapter-runtime-dependencies.mjs";
import { pathToFileURL } from "node:url";
import { observeGeneratedSources } from "./adapter-generated-source-witness.mjs";
const file = process.env.DECKO_ADAPTER_SOURCE_AUDIT;
const audit = { format: "decko-module-witness/1", pid: process.pid, complete: false, modules: [], problems: [] };
const canonical = process.env.DECKO_ADAPTER_CANONICAL_SOURCE ? JSON.parse(process.env.DECKO_ADAPTER_CANONICAL_SOURCE) : null;
const installModuleHooks = modules.registerHooks;
const registerLoader = modules.register;
const workerCapture = canonical ? new Int32Array(new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT)) : null;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const save = () => {
  try {
    const next = `${file}.next`;
    writeFileSync(next, JSON.stringify(audit) + "\n", { flag: "wx" });
    renameSync(next, file);
  }
  catch (error) {
    process.stderr.write(`Adapter source witness could not save: ${error.message}\n`);
    try { appendFileSync(`${file}.publication-errors.jsonl`, JSON.stringify({ name: error.name, code: error.code ?? null, message: error.message }) + "\n"); }
    catch (publicationError) { process.stderr.write(`Adapter source publication error record could not save: ${publicationError.message}\n`); }
  }
};
const generatedObserver = await observeGeneratedSources(audit, { canonical: Boolean(canonical) });
const compileCommonJS = modules.Module.prototype._compile;
modules.Module.prototype._compile = function compileObserved(content, filename) {
  try {
    const raw = readFileSync(filename), source = Buffer.from(content), url = pathToFileURL(filename).href;
    audit.modules.push({ url, format: "commonjs compiler input", package: canonical ? runtimePackageIdentity(url) : null,
      raw_sha256: digest(raw), loaded_sha256: digest(source),
      loaded_oid: createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex") });
  } catch (error) { audit.problems.push(`CommonJS input observation failed: ${error.message}`); save(); }
  return Reflect.apply(compileCommonJS, this, arguments);
};
const executionInterfaces = new Set(["child_process", "worker_threads", "vm", "module", "inspector", "inspector/promises"]);
if (typeof process.getBuiltinModule === "function") {
  const getBuiltinModule = process.getBuiltinModule;
  process.getBuiltinModule = function getBuiltinModuleObserved(id) {
    const result = Reflect.apply(getBuiltinModule, this, arguments);
    if (result && typeof id === "string" && executionInterfaces.has(id.replace(/^node:/, "")) && (!canonical || id.replace(/^node:/, "").startsWith("inspector"))) {
      audit.problems.push(`Unobserved execution capability obtained through process.getBuiltinModule: ${id}`);
      save();
    }
    return result;
  };
}
if (canonical) {
  registerLoader(canonical.worker_observer_url, import.meta.url, { data: { auditPath: canonical.worker_audit_path, counters: workerCapture.buffer } });
  const api = modules.createRequire(import.meta.url)("node:module");
  audit.registrations = [];
  audit.execution_observers = [];
  for (const [name, methods] of [["node:child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
    ["node:vm", ["runInContext", "runInNewContext", "runInThisContext", "compileFunction"]]]) {
    const target = modules.createRequire(import.meta.url)(name);
    for (const method of methods) if (typeof target[method] === "function") {
      const original = target[method];
      target[method] = function executionObserved() {
        audit.problems.push(`Unwitnessed secondary execution: ${name}.${method}`);
        save();
        return Reflect.apply(original, this, arguments);
      };
      audit.execution_observers.push(`${name}.${method}`);
    }
  }
  for (const [name, constructors] of [["node:worker_threads", ["Worker"]], ["node:vm", ["Script", "SourceTextModule", "SyntheticModule"]]]) {
    const target = modules.createRequire(import.meta.url)(name);
    for (const method of constructors) if (typeof target[method] === "function") {
      target[method] = new Proxy(target[method], { construct(original, args, newTarget) {
        audit.problems.push(`Unwitnessed secondary execution: ${name}.${method}`);
        save();
        return Reflect.construct(original, args, newTarget);
      } });
      audit.execution_observers.push(`${name}.${method}`);
    }
  }
  const childPrototype = modules.createRequire(import.meta.url)("node:child_process").ChildProcess.prototype;
  const childSpawn = childPrototype.spawn;
  childPrototype.spawn = function childSpawnObserved() {
    audit.problems.push("Unwitnessed secondary execution: node:child_process.ChildProcess.prototype.spawn");
    save();
    return Reflect.apply(childSpawn, this, arguments);
  };
  audit.execution_observers.push("node:child_process.ChildProcess.prototype.spawn");
  api.register = function registerObserved(specifier, parentURL, options) {
    audit.registrations.push({ specifier: String(specifier), parent_url: String(parentURL), has_options: options !== undefined });
    if (String(specifier) !== canonical.loader_url || String(parentURL) !== canonical.entry_url || options !== undefined) audit.problems.push("Unknown asynchronous loader registration");
    save();
    return Reflect.apply(registerLoader, this, arguments);
  };
  api.registerHooks = function registerHooksObserved() {
    audit.problems.push("Unknown synchronous module hooks registered by the adapter");
    save();
    return Reflect.apply(installModuleHooks, this, arguments);
  };
  modules.syncBuiltinESMExports();
}
if (typeof installModuleHooks !== "function") audit.problems.push("Node synchronous module hooks unavailable");
else installModuleHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if ((["node:child_process", "node:worker_threads", "node:vm", "node:module"].includes(result.url) && !canonical) || result.url === "node:inspector" || result.url === "node:inspector/promises") {
    audit.problems.push(`Unobserved execution capability loaded: ${result.url}`);
    save();
  }
  return result;
}, load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  try {
    if (url.startsWith("node:")) {
      if ((["node:child_process", "node:worker_threads", "node:vm", "node:module"].includes(url) && !canonical) || url === "node:inspector" || url === "node:inspector/promises") audit.problems.push(`Unobserved execution capability loaded: ${url}`);
    } else if (url.startsWith("file:")) {
      const raw = readFileSync(new URL(url));
      const source = typeof result.source === "string" ? Buffer.from(result.source) : result.source == null ? null : Buffer.from(result.source);
      audit.modules.push({ url, format: result.format, deferred: source === null, package: canonical ? runtimePackageIdentity(url) : null, raw_sha256: digest(raw),
        loaded_sha256: source === null ? null : digest(source),
        loaded_oid: source === null ? null : createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex") });
    } else audit.problems.push(`Unbound loaded source: ${url}`);
  } catch (error) { audit.problems.push(`Module observation failed: ${error.message}`); }
  return result;
} });
save();
process.on("exit", () => {
  generatedObserver.finish();
  if (workerCapture) audit.worker_capture = {
    window: "through main adapter exit", worker_observed: Atomics.load(workerCapture, 0), worker_retained: Atomics.load(workerCapture, 1),
    errors: Atomics.load(workerCapture, 2), transforms_observed: Atomics.load(workerCapture, 3), transforms_retained: Atomics.load(workerCapture, 4),
  };
  audit.complete = true;
  save();
});
