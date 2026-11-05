import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as nodeModules from "node:module";
import { sourceGitEnvironment } from "./source-git-environment.mjs";
import { generatedRuntimeBindingsValid } from "./adapter-generated-runtime-bindings.mjs";

export const SOURCE_FORMAT = "decko-executed-source/1";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const gitObject = (kind, bytes) => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const oid = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, file) => { const rel = path.relative(root, file); return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
const installedDependency = (root, file) => inside(path.join(root, "node_modules"), file);
let observedRuntime;
function runtimeIdentity() {
  const identity = () => {
    const stat = statSync(process.execPath, { bigint: true });
    return { path: realpathSync(process.execPath), dev: String(stat.dev), inode: String(stat.ino),
      bytes: String(stat.size), mtime_ns: String(stat.mtimeNs), ctime_ns: String(stat.ctimeNs) };
  };
  const before = identity();
  if (observedRuntime && JSON.stringify(observedRuntime.file_identity) === JSON.stringify(before)) return {
    ...observedRuntime, hash_observation: "reused within this runner process; runtime file identity unchanged",
  };
  const bytes = readFileSync(process.execPath), after = identity();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Runtime executable changed while its identity was read");
  observedRuntime = { path: process.execPath, sha256: sha256(bytes), version: process.version, file_identity: after,
    hash_observation: "fresh raw executable bytes" };
  return { ...observedRuntime };
}

export function inventoryTree(files) {
  const root = new Map();
  for (const file of files) {
    if (!object(file) || typeof file.path !== "string" || typeof file.mode !== "string" || !/^(100644|100755)$/.test(file.mode) || !oid(file.expected_oid)) throw Error("Invalid committed inventory entry");
    const parts = file.path.split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part.includes("\0") || part.includes("\\"))) throw Error("Invalid committed inventory path");
    let tree = root;
    for (const part of parts.slice(0, -1)) {
      if (!tree.has(part)) tree.set(part, new Map());
      tree = tree.get(part);
      if (!(tree instanceof Map)) throw Error("Conflicting committed inventory paths");
    }
    if (tree.has(parts.at(-1))) throw Error("Duplicate committed inventory path");
    tree.set(parts.at(-1), file);
  }
  const digest = tree => {
    const entries = [...tree].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av instanceof Map ? "/" : "")), Buffer.from(b + (bv instanceof Map ? "/" : ""))));
    return gitObject("tree", Buffer.concat(entries.map(([name, value]) => Buffer.concat([
      Buffer.from(`${value instanceof Map ? "40000" : value.mode} ${name}\0`),
      Buffer.from(value instanceof Map ? digest(value) : value.expected_oid, "hex"),
    ]))));
  };
  return digest(root);
}

export function observeAdapterSource(dir) {
  const observation = { observed: new Date().toISOString(), root: null, commit: null, dirty: null, files: [], problems: [] };
  try {
    let gitDir = dir;
    const git = args => execFileSync("git", ["--no-replace-objects", "-C", gitDir, ...args], { windowsHide: true, env: sourceGitEnvironment(), stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity });
    const root = realpathSync.native(git(["rev-parse", "--show-toplevel"]).toString("utf8").trim());
    gitDir = root;
    const commit = git(["rev-parse", "HEAD"]).toString("utf8").trim();
    observation.root = root;
    observation.commit = commit;
    const rawCommit = git(["cat-file", "commit", commit]);
    observation.commit_object = rawCommit.toString("base64");
    const listed = new Map();
    for (const entry of git(["ls-tree", "-rz", "--full-tree", commit]).toString("utf8").split("\0").filter(Boolean)) {
      const match = /^([0-7]{6}) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
      if (!match) throw Error("Unsupported committed tree entry (including submodules)");
      listed.set(match[3], { path: match[3], mode: match[1], expected_oid: match[2] });
    }
    const visible = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString("utf8").split("\0").filter(Boolean);
    for (const file of new Set([...listed.keys(), ...visible])) {
      const entry = listed.get(file) ?? { path: file, mode: null, expected_oid: null };
      try {
        const target = path.resolve(root, file);
        if (!inside(root, target) || !lstatSync(target).isFile() || !samePath(realpathSync.native(target), target)) throw Error("not an owned regular source file");
        const bytes = readFileSync(target);
        Object.assign(entry, { bytes: bytes.length, sha256: sha256(bytes), actual_oid: gitObject("blob", bytes) });
        if (entry.actual_oid !== entry.expected_oid) observation.problems.push(`Source bytes differ from committed tree: ${file}`);
      } catch (error) { observation.problems.push(`Source unreadable: ${file}: ${error.message}`); }
      observation.files.push(entry);
    }
    observation.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (inventoryTree(observation.files) !== /^tree ([a-f0-9]{40})\n/.exec(rawCommit.toString("utf8"))?.[1]) observation.problems.push("Source inventory does not equal committed tree");
    observation.dirty = observation.problems.length > 0;
  } catch (error) { observation.problems.push(`Source observation failed: ${error.message}`); }
  return observation;
}

export function prepareAdapterInvocation(manifest, auditPath, env, observedSource) {
  const requested = [...manifest.command];
  const record = { requested_command: requested, command: requested, cwd: manifest.dir, entry: null, problems: [], audit: null };
  try {
    const executable = requested[0];
    const isNode = executable === "node" || executable === "node.exe" || samePath(realpathSync(executable), realpathSync(process.execPath));
    if (!isNode || typeof requested[1] !== "string" || requested[1].startsWith("-")) throw Error("No source witness for this command; only direct Node file entries are supported");
    if (process.env.NODE_OPTIONS || env.NODE_OPTIONS || manifest.env?.NODE_OPTIONS) throw Error("NODE_OPTIONS changes runtime loading outside the supported direct entry recipe");
    const target = path.resolve(manifest.dir, requested[1]);
    const bytes = readFileSync(target);
    record.entry = { path: target, realpath: realpathSync(target), sha256: sha256(bytes), actual_oid: gitObject("blob", bytes) };
    if (!lstatSync(target).isFile() || !samePath(record.entry.realpath, target)) throw Error("Entry is not an owned regular file");
    record.runtime = runtimeIdentity();
    const witness = new URL("./adapter-source-witness.mjs", import.meta.url);
    record.observer = { url: witness.href, sha256: sha256(readFileSync(witness)) };
    record.command = [process.execPath, "--import", witness.href, ...requested.slice(1)];
    record.audit_path = auditPath;
    const childEnv = { ...env, DECKO_ADAPTER_SOURCE_AUDIT: auditPath,
      DECKO_ADAPTER_CANONICAL_SOURCE: "", DECKO_ADAPTER_TRANSFORM_AUDIT: "" };
    if (typeof nodeModules.registerHooks === "function" && observedSource?.root && path.relative(observedSource.root, target).split(path.sep).join("/") === "reference-harness/adapters/ts/adapter.mjs" &&
        record.entry.sha256 === sha256(readFileSync(new URL("../adapters/ts/adapter.mjs", import.meta.url)))) {
      const loaderPath = path.join(observedSource.root, "tools/oracle/typescript-source-loader.mjs");
      const transformPath = path.join(observedSource.root, "tools/oracle/typescript-transform-witness.mjs");
      const loaderSha = sha256(readFileSync(loaderPath)), transformSha = sha256(readFileSync(transformPath));
      if (loaderSha === sha256(readFileSync(new URL("../../tools/oracle/typescript-source-loader.mjs", import.meta.url))) &&
          transformSha === sha256(readFileSync(new URL("../../tools/oracle/typescript-transform-witness.mjs", import.meta.url)))) {
        const worker = new URL("./adapter-source-worker-witness.mjs", import.meta.url);
        record.canonical = { format: "decko-canonical-typescript/1", root: observedSource.root, entry_url: pathToFileURL(target).href,
          loader_url: pathToFileURL(loaderPath).href, loader_sha256: loaderSha,
          transform_witness_url: pathToFileURL(transformPath).href, transform_witness_sha256: transformSha,
          worker_observer_url: worker.href, worker_observer_sha256: sha256(readFileSync(worker)),
          worker_audit_path: `${auditPath}.worker.jsonl`, transform_audit_path: `${auditPath}.transforms.jsonl` };
        const lock = readFileSync(path.join(observedSource.root, "package-lock.json"));
        record.canonical.dependency_lock_base64 = lock.toString("base64");
        const { dependency_lock_base64, ...configuration } = record.canonical;
        childEnv.DECKO_ADAPTER_CANONICAL_SOURCE = JSON.stringify(configuration);
        childEnv.DECKO_ADAPTER_TRANSFORM_AUDIT = record.canonical.transform_audit_path;
      }
    }
    return { record, manifest: { ...manifest, command: record.command }, env: childEnv };
  } catch (error) {
    record.problems.push(error.message);
    record.command = requested;
    delete record.audit_path;
    return { record, manifest, env };
  }
}

export function finishAdapterInvocation(record) {
  if (record.audit_path) {
    try {
      const bytes = readFileSync(record.audit_path);
      record.audit = JSON.parse(bytes.toString("utf8"));
      record.audit_sha256 = sha256(bytes);
    } catch (error) { record.problems.push(`Executed module witness unavailable: ${error.message}`); }
    try {
      const bytes = readFileSync(`${record.audit_path}.publication-errors.jsonl`);
      record.audit_publication_errors = bytes.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
      record.audit_publication_errors_sha256 = sha256(bytes);
      record.problems.push("Source witness publication failed; actual errors retained in audit_publication_errors");
    } catch (error) { if (error.code !== "ENOENT") record.problems.push(`Source publication errors unreadable: ${error.message}`); }
  }
  if (record.canonical) for (const [key, file] of [["worker", record.canonical.worker_audit_path], ["transforms", record.canonical.transform_audit_path]]) {
    try {
      const bytes = readFileSync(file);
      record.canonical[key] = bytes.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
      record.canonical[`${key}_sha256`] = sha256(bytes);
    } catch (error) { record.problems.push(`Canonical ${key} witness unavailable: ${error.message}`); }
  }
}

function validateObservation(observation, candidate) {
  if (!object(observation) || observation.commit !== candidate || observation.dirty !== false || !Array.isArray(observation.problems) || observation.problems.length || !Array.isArray(observation.files) || !observation.files.length) throw Error("Missing clean raw-byte source observation");
  const commit = Buffer.from(observation.commit_object ?? "", "base64");
  if (gitObject("commit", commit) !== candidate || inventoryTree(observation.files) !== /^tree ([a-f0-9]{40})\n/.exec(commit.toString("utf8"))?.[1]) throw Error("Source inventory is not bound to the pinned committed tree");
  for (const file of observation.files) if (!hash(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.actual_oid !== file.expected_oid) throw Error("Uncommitted or malformed observed source bytes");
}

function canonicalTransforms(invocation, files, root) {
  const canonical = invocation.canonical;
  if (!canonical) return null;
  if (canonical.format !== "decko-canonical-typescript/1" || canonical.root !== root ||
      canonical.entry_url !== pathToFileURL(invocation.entry.path).href ||
      path.relative(root, invocation.entry.path).split(path.sep).join("/") !== "reference-harness/adapters/ts/adapter.mjs") throw Error("Unknown canonical entry recipe");
  for (const [relative, recorded] of [["tools/oracle/typescript-source-loader.mjs", canonical.loader_sha256], ["tools/oracle/typescript-transform-witness.mjs", canonical.transform_witness_sha256]]) {
    if (files.get(relative)?.sha256 !== recorded || recorded !== sha256(readFileSync(new URL(`../../${relative}`, import.meta.url)))) throw Error("Unknown canonical loader or transformation witness bytes");
  }
  if (canonical.worker_observer_sha256 !== sha256(readFileSync(new URL("./adapter-source-worker-witness.mjs", import.meta.url)))) throw Error("Unknown loader-worker observer");
  for (const method of ["node:child_process.spawn", "node:child_process.exec", "node:child_process.ChildProcess.prototype.spawn", "node:worker_threads.Worker", "node:vm.runInContext", "node:vm.Script"]) {
    if (!invocation.audit.execution_observers?.includes(method)) throw Error("Canonical secondary execution observer missing");
  }
  const lockBytes = Buffer.from(canonical.dependency_lock_base64 ?? "", "base64");
  if (gitObject("blob", lockBytes) !== files.get("package-lock.json")?.expected_oid) throw Error("Runtime dependency lock is not committed candidate source");
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const dependencies = new Set(Object.entries(lock.packages ?? {}).filter(([name, value]) => name.includes("node_modules/") && object(value)).map(([name, value]) => `${name.split("node_modules/").at(-1)}@${value.version}`));
  canonicalRuntimeLocks.set(canonical, dependencies);
  if (!Array.isArray(invocation.audit.registrations) || invocation.audit.registrations.length !== 1 ||
      invocation.audit.registrations[0].specifier !== canonical.loader_url || invocation.audit.registrations[0].parent_url !== canonical.entry_url ||
      invocation.audit.registrations[0].has_options !== false) throw Error("Canonical loader registration not witnessed");
  if (!Array.isArray(canonical.worker) || !canonical.worker.some(row => row.event === "initialized" && row.pid === invocation.pid)) throw Error("Loader worker witness missing");
  const capture = invocation.audit.worker_capture;
  if (!object(capture) || capture.errors !== 0 || capture.worker_observed !== canonical.worker.length || capture.worker_retained !== canonical.worker.length ||
      !Array.isArray(canonical.transforms) || capture.transforms_observed !== canonical.transforms.length || capture.transforms_retained !== canonical.transforms.length) throw Error("Loader/transform source evidence capture incomplete");
  const loaded = new Map();
  const deferred = [];
  for (const row of canonical.worker) {
    if (row.pid !== invocation.pid || !Number.isSafeInteger(row.thread_id) || row.thread_id <= 0 || row.event === "error") throw Error("Invalid loader worker consumption evidence");
    if (row.event === "deferred") { deferred.push(row); continue; }
    if (row.event !== "module") continue;
    if (typeof row.url !== "string" || !row.url.startsWith("file:") || !hash(row.raw_sha256) || row.loaded_sha256 !== row.raw_sha256) throw Error("Loader/toolchain module consumption was not witnessed");
    const target = fileURLToPath(row.url);
    if (inside(root, target) && !installedDependency(root, target)) {
      const file = files.get(path.relative(root, target).split(path.sep).join("/"));
      if (!file || row.loaded_oid !== file.expected_oid || row.raw_sha256 !== file.sha256) throw Error("Loader consumed uncommitted source bytes");
    } else validateRuntimePackage(row, dependencies);
    if (loaded.has(row.url) && loaded.get(row.url).loaded_sha256 !== row.loaded_sha256) throw Error("Loader/toolchain source changed during execution");
    loaded.set(row.url, row);
  }
  for (const row of deferred) {
    const workerConsumed = loaded.get(row.url)?.loaded_sha256 === row.raw_sha256;
    const mainConsumed = invocation.audit.modules.some(module => module.url === row.url && module.deferred !== true && module.loaded_sha256 === row.raw_sha256 && module.raw_sha256 === row.raw_sha256);
    if (!workerConsumed && !mainConsumed) throw Error("Deferred loader/toolchain source was never witnessed executing");
  }
  if (loaded.get(canonical.loader_url)?.loaded_sha256 !== canonical.loader_sha256 ||
      loaded.get(canonical.transform_witness_url)?.loaded_sha256 !== canonical.transform_witness_sha256 ||
      ![...loaded.keys()].some(url => url.includes("/node_modules/vite/"))) throw Error("Actual canonical loader/helper/transformer consumption missing");
  if (!Array.isArray(canonical.transforms) || !canonical.transforms.length) throw Error("No consumed TypeScript transformation inputs");
  const transforms = new Map();
  for (const row of canonical.transforms) {
    if (row.format !== "decko-typescript-transform/1" || row.pid !== invocation.pid || row.thread_id <= 0 || !hash(row.transformer_function_sha256) ||
        row.verification_error !== null || !hash(row.input_sha256) || !hash(row.output_sha256) || row.output_sha256 !== row.verified_output_sha256 ||
        typeof row.url !== "string" || !row.url.startsWith("file:")) throw Error("Unverified transformation or cached output");
    const target = fileURLToPath(row.url);
    if (!inside(root, target)) throw Error("Transform consumed source outside candidate");
    const file = files.get(path.relative(root, target).split(path.sep).join("/"));
    if (!file || row.input_oid !== file.expected_oid || row.input_sha256 !== file.sha256 || row.input_bytes !== file.bytes) throw Error("Transform consumed uncommitted input bytes");
    const previous = transforms.get(row.url);
    if (previous && previous.output_sha256 !== row.output_sha256) throw Error("Inconsistent TypeScript transformation outputs");
    transforms.set(row.url, row);
  }
  return transforms;
}

const canonicalRuntimeLocks = new WeakMap();
function validateRuntimePackage(module, dependencies) {
  const metadata = module.package;
  if (!object(metadata) || typeof metadata.root !== "string" || typeof metadata.file !== "string" || typeof metadata.manifest_base64 !== "string") throw Error("Unbound installed runtime dependency");
  const packageJson = JSON.parse(Buffer.from(metadata.manifest_base64, "base64").toString("utf8"));
  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string" || metadata.name !== packageJson.name || metadata.version !== packageJson.version ||
      !dependencies.has(`${packageJson.name}@${packageJson.version}`) || !inside(metadata.root, fileURLToPath(module.url)) ||
      path.join(metadata.root, "package.json") !== metadata.file || !metadata.root.split(path.sep).includes("node_modules")) throw Error("Installed runtime artifact is not declared by the candidate lock");
}

export function sourceBindingProblems(binding, candidate) {
  try {
    if (!object(binding) || binding.format !== SOURCE_FORMAT) throw Error("Missing executed-source binding");
    validateObservation(binding.before, candidate);
    validateObservation(binding.after, candidate);
    if (binding.before.root !== binding.after.root || JSON.stringify(binding.before.files) !== JSON.stringify(binding.after.files)) throw Error("Source inventory or bytes changed during capture");
    if (!Array.isArray(binding.invocations) || !binding.invocations.length) throw Error("Missing adapter invocation evidence");
    const files = new Map(binding.before.files.map(file => [file.path, file]));
    for (const invocation of binding.invocations) {
      if (!object(invocation) || !Array.isArray(invocation.problems) || invocation.problems.length || !object(invocation.entry) || !hash(invocation.runtime?.sha256)) throw Error("Unbound adapter invocation");
      const entry = invocation.entry;
      if (typeof invocation.cwd !== "string" || !Array.isArray(invocation.command) || !Array.isArray(invocation.requested_command) ||
          invocation.command[0] !== invocation.runtime.path || invocation.command[1] !== "--import" ||
          invocation.command[2] !== invocation.observer?.url || !hash(invocation.observer?.sha256) ||
          invocation.command[3] !== invocation.requested_command[1] || invocation.command.slice(3).join("\0") !== invocation.requested_command.slice(1).join("\0") ||
          !samePath(path.resolve(invocation.cwd, invocation.command[3]), entry.path)) throw Error("Executed command is not the witnessed direct file entry");
      if (!inside(binding.before.root, entry.path) || !samePath(entry.path, entry.realpath)) throw Error("Executed entry is outside recorded source");
      const relative = path.relative(binding.before.root, entry.path).split(path.sep).join("/");
      if (files.get(relative)?.actual_oid !== entry.actual_oid || files.get(relative)?.sha256 !== entry.sha256) throw Error("Executed entry differs from committed source");
      const audit = invocation.audit;
      if (!object(audit) || audit.format !== "decko-module-witness/1" || audit.complete !== true || !Array.isArray(audit.problems) || !audit.problems.every(problem => typeof problem === "string") || !Array.isArray(audit.modules) || !audit.modules.length) throw Error("Executed module witness incomplete");
      if (audit.problems.length) throw Error(`Executed-source witness refused: ${audit.problems.join("; ")}`);
      const generated = audit.generated_observer;
      if (!object(generated) || generated.format !== "decko-v8-source-observer/1" || generated.active !== true || generated.closed !== true || generated.pending !== 0 ||
          !Array.isArray(generated.errors) || generated.errors.length || !Array.isArray(audit.generated_sources) || generated.events_observed !== audit.generated_sources.length ||
          generated.unbound_events !== 0 || generated.bound_events !== audit.generated_sources.length || !generatedRuntimeBindingsValid(audit, Boolean(invocation.canonical))) throw Error("Generated-source observation incomplete or unbound");
      if (!Number.isSafeInteger(invocation.pid) || invocation.pid <= 0 || audit.pid !== invocation.pid) throw Error("Module witness is not correlated with the owned adapter process");
      if (!audit.modules.some(module => module.url === pathToFileURL(entry.realpath).href)) throw Error("Entry was not witnessed loading");
      const transforms = canonicalTransforms(invocation, files, binding.before.root);
      for (const module of audit.modules) {
        if (typeof module.url !== "string" || !module.url.startsWith("file:")) throw Error("Unbound non-file source module");
        if (module.deferred === true) {
          if (!audit.modules.some(consumed => consumed.url === module.url && consumed.loaded_sha256 === module.raw_sha256 && consumed.deferred !== true)) throw Error("Deferred adapter module consumption missing");
          continue;
        }
        const target = fileURLToPath(module.url);
        if (!inside(binding.before.root, target) || installedDependency(binding.before.root, target)) {
          if (!transforms) throw Error("Loaded dependency is outside recorded source");
          validateRuntimePackage(module, canonicalRuntimeLocks.get(invocation.canonical));
          if (module.loaded_sha256 !== module.raw_sha256 || !hash(module.loaded_sha256)) throw Error("Runtime dependency consumption was not witnessed");
          continue;
        }
        const file = files.get(path.relative(binding.before.root, target).split(path.sep).join("/"));
        if (!file || module.raw_sha256 !== file.sha256) throw Error("Loaded module bytes differ from committed source");
        if (transforms && target.endsWith(".ts")) {
          if (transforms.get(module.url)?.output_sha256 !== module.loaded_sha256) throw Error("Executed TypeScript output differs from witnessed transformation");
        } else if (module.loaded_oid !== file.expected_oid || module.loaded_sha256 !== file.sha256) throw Error("Loaded module bytes differ from committed source");
      }
    }
    return [];
  } catch (error) { return [error.message]; }
}
