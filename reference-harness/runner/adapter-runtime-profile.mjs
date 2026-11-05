import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROFILE_EVENT = "decko-adapter-runtime-profile/1";
export const PROFILE_PREFIX = "DECKO_ADAPTER_RUNTIME_PROFILE ";
export const PROFILE_ENV = "DECKO_HARNESS_RUNTIME_PROFILE_CONTEXT";
export const PROFILE_FLAGS = Object.freeze({
  signinDetailedErrors: "DECKO_STRICT_PARITY_SIGNIN_DETAILED_ERRORS",
  revisionRestore500: "DECKO_STRICT_PARITY_REVISION_RESTORE_500",
  skinCreate500: "DECKO_STRICT_PARITY_SKIN_CREATE_500",
  scriptBundleClockNames: "DECKO_STRICT_PARITY_SCRIPT_BUNDLE_CLOCK_NAMES",
  mailUnfollowRefusal: "DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL",
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const repository = fileURLToPath(new URL("../../", import.meta.url));
const sourceUrls = {
  controller: new URL("./run.mjs", import.meta.url),
  adapter: new URL("../adapters/ts/adapter.ts", import.meta.url),
  entry: new URL("../adapters/ts/adapter.mjs", import.meta.url),
  flag_reader: new URL("../../src/card/parity/strict-parity-flags.ts", import.meta.url),
  profile_observer: new URL("./adapter-runtime-profile.mjs", import.meta.url),
};
function sourceFiles() { return Object.fromEntries(Object.entries(sourceUrls).map(([name,url]) => [name, { url: url.href, sha256: sha(readFileSync(url)) }])); }
function controllerFile(url) {
  const file = fileURLToPath(url), relative = path.relative(repository,file);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".."+path.sep) || !/\.[cm]?[jt]s$/.test(file) ||
      !lstatSync(file).isFile() || realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw Error("Controller entry is not an owned source file");
  return { url: pathToFileURL(file).href, sha256: sha(readFileSync(file)) };
}
function identity(context) {
  if (!context || typeof context.run_id !== "string" || !context.run_id || typeof context.invocation_id !== "string" || !context.invocation_id) throw Error("Missing runner/invocation identity");
  return { run_id: context.run_id, invocation_id: context.invocation_id,
    controller: context.controller ? { pid: context.controller.pid, entry: { url: context.controller.entry?.url, sha256: context.controller.entry?.sha256 } } : null,
    declared_source: { commit: context.declared_source?.commit ?? null, dirty: context.declared_source?.dirty ?? null } };
}
export function runtimeProfileContext(runId, invocationId, source) {
  let controller = null;
  try { controller = { pid: process.pid, entry: controllerFile(pathToFileURL(path.resolve(process.argv[1])).href) }; } catch { }
  return { ...identity({ run_id: runId, invocation_id: invocationId, declared_source: source, controller }), source_files: sourceFiles() };
}

export function observeRuntimeProfile(resolveFlags) {
  const problems = [];
  let context = null, files = null, resolved = null, controller = null;
  try { context = identity(JSON.parse(process.env[PROFILE_ENV] ?? "null")); }
  catch { problems.push("Missing or invalid runner/invocation context"); }
  try {
    if (!context?.controller || context.controller.pid !== process.ppid) throw Error("Controller PID is not the observed native parent");
    controller = { pid: process.ppid, entry: controllerFile(context.controller.entry.url) };
    if (controller.entry.sha256 !== context.controller.entry.sha256) throw Error("Controller entry file changed");
  } catch { problems.push("Missing or mismatched native parent/controller entry observation"); }
  try { files = sourceFiles(); } catch (error) { problems.push(`Profile source-file observation failed: ${error.message}`); }
  const raw = Object.fromEntries(Object.values(PROFILE_FLAGS).map(name => [name, process.env[name] ?? null]));
  try {
    const flags = resolveFlags();
    resolved = Object.fromEntries(Object.keys(PROFILE_FLAGS).map(name => [name, flags[name]]));
  } catch { problems.push("Engine flag reader could not resolve the profile"); }
  const values = resolved && Object.values(resolved);
  const profile = !values || !values.every(v => typeof v === "boolean") ? "unresolved" : values.every(Boolean) ? "all-on" : values.every(v => !v) ? "all-off" : "mixed";
  return { event: PROFILE_EVENT, pid: process.pid, context, controller, source_files: files, raw, resolved, profile, problems,
    scope: "Adapter ready boundary; raw process values and current engine resolution. Source-file identities are reads, not consumed-controller proof." };
}

export function assessRuntimeProfile(records, expectedContext, pid) {
  const problems = [];
  const record = records.length === 1 ? records[0] : null;
  if (!record) problems.push(records.length ? "Multiple child profile records" : "Missing child profile record; older/key-only evidence is unqualified");
  if (record) {
    if (record.event !== PROFILE_EVENT || record.pid !== pid || !Number.isSafeInteger(pid) || pid <= 0) problems.push("Profile PID/event does not match the owned adapter");
    if (!expectedContext || JSON.stringify(record.context) !== JSON.stringify(identity(expectedContext))) problems.push("Profile run/invocation/source declaration mismatch");
    if (!expectedContext?.controller || JSON.stringify(record.controller) !== JSON.stringify(expectedContext.controller)) problems.push("Profile native parent/controller entry mismatch");
    if (!expectedContext || JSON.stringify(record.source_files) !== JSON.stringify(expectedContext.source_files)) problems.push("Profile source-file identities mismatch");
    if (!Array.isArray(record.problems) || record.problems.length) problems.push("Child profile observation is incomplete");
    const rawKeys = Object.values(PROFILE_FLAGS), flagKeys = Object.keys(PROFILE_FLAGS);
    if (!record.raw || Object.keys(record.raw).sort().join("\0") !== [...rawKeys].sort().join("\0") ||
        !record.resolved || Object.keys(record.resolved).sort().join("\0") !== [...flagKeys].sort().join("\0")) problems.push("Profile does not contain exactly the five allowlisted fields");
    else {
      const values = [];
      for (const [name,env] of Object.entries(PROFILE_FLAGS)) {
        const raw = record.raw[env], value = raw === null ? "" : typeof raw === "string" ? raw.trim().toLowerCase() : null;
        const expected = value === "on" || (value === "" && name === "mailUnfollowRefusal");
        if (!["", "on", "off"].includes(value) || typeof record.resolved[name] !== "boolean" || record.resolved[name] !== expected) problems.push(`Raw and resolved flag disagree: ${env}`);
        values.push(record.resolved[name]);
      }
      const profile = values.every(Boolean) ? "all-on" : values.every(v => !v) ? "all-off" : "mixed";
      if (record.profile !== profile) problems.push("Resolved profile label disagrees with its values");
    }
  }
  return { format: "decko-adapter-runtime-profile-evidence/1", child_observed: problems.length === 0,
    source_qualified: false, scope: "Child PID/context/file/value correlation only; existing executed-source admission remains separate", records, problems };
}
