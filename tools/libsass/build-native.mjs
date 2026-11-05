import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { join, resolve, dirname, basename, relative, delimiter, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { cachedArtifact, materialize, sha256 } from "./native-cache.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const argv = process.argv.slice(2);
const [srcArg, outArg] = argv;
const adoptIndex = argv.indexOf("--adopt-existing");
const adoptRepo = adoptIndex < 0 ? null : resolve(argv[adoptIndex + 1]);
if (!srcArg) {
  console.error("usage: node tools/libsass/build-native.mjs <libsass source dir> [out dir]");
  process.exit(2);
}
const SRC = resolve(srcArg);
const OUT = resolve(outArg ?? join(here, "build"));
const CXX = process.env.CXX ?? "g++";
const CC = process.env.CC ?? "gcc";
const JOBS = Number(process.env.LIBSASS_JOBS ?? 3);
if (!Number.isInteger(JOBS) || JOBS < 1) throw new Error("LIBSASS_JOBS must be a positive integer");
const version = readFileSync(join(SRC, "VERSION"), "utf8").trim();
const define = `-DLIBSASS_VERSION="${version}"`;
const include = ["-I", join(SRC, "include"), "-I", join(SRC, "src")];
const filename = process.platform === "win32" ? "sassc-stdin.exe" : "sassc-stdin";
const LEGACY_RECIPE = "e575bc682ecd9c7dc1ce9037897632f48ea61c95a5a37158661610f1fc33d350";

function filesUnder(root) {
  return readdirSync(root).sort().flatMap(name => {
    const file = join(root, name);
    return statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
}
function sourceInputs(src, wrapper) {
  return [...filesUnder(join(src, "src")), ...filesUnder(join(src, "include")), join(src, "VERSION")]
    .sort().map(file => [relative(src, file).replaceAll("\\", "/"), sha256(readFileSync(file))])
    .concat([["sassc-stdin.c", sha256(readFileSync(wrapper))]]);
}
function executable(command) {
  const suffixes = process.platform === "win32" && !command.toLowerCase().endsWith(".exe") ? [".exe", ""] : [""];
  const candidates = isAbsolute(command) || command.includes("/") || command.includes("\\")
    ? suffixes.map(suffix => resolve(command + suffix))
    : (process.env.PATH ?? "").split(delimiter).flatMap(dir => suffixes.map(suffix => join(dir, command + suffix)));
  const found = candidates.find(file => existsSync(file) && statSync(file).isFile());
  if (!found) throw new Error(`compiler not found: ${command}`);
  return realpathSync(found);
}
const commandOutput = (command, args) => execFileSync(command, args, { windowsHide: true, encoding: "utf8", input: "" }).trim();
function compilerIdentity(command, language) {
  const program = executable(command);
  const trace = spawnSync(program, ["-E", "-x", language, "-", "-v"], { windowsHide: true, encoding: "utf8", input: "" });
  if (trace.status !== 0) throw new Error(`cannot inspect ${program}: ${trace.stderr}`);
  const includeSection = String(trace.stderr).split("#include <...> search starts here:")[1]?.split("End of search list.")[0];
  if (includeSection === undefined) throw new Error(`compiler did not report header search paths: ${program}`);
  const headers = includeSection.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(dir => [realpathSync(dir), sha256(JSON.stringify(filesUnder(dir).map(file => [relative(dir, file), sha256(readFileSync(file))])))]);
  const parts = ["cc1", "cc1plus", "as", "ld"].map(part => {
    const reported = commandOutput(program, [`-print-prog-name=${part}`]);
    const file = existsSync(reported) ? realpathSync(reported) : executable(reported);
    return [part, sha256(readFileSync(file))];
  });
  const libraries = ["libgcc.a", "libstdc++.a", "libmingw32.a", "libmingwex.a", "libucrt.a", "crt2.o", "crtbegin.o", "crtend.o"].flatMap(part => {
    const file = commandOutput(program, [`-print-file-name=${part}`]);
    return existsSync(file) ? [[part, sha256(readFileSync(file))]] : [];
  });
  return { program, binary: sha256(readFileSync(program)), version: commandOutput(program, ["-dumpfullversion"]), target: commandOutput(program, ["-dumpmachine"]), parts, libraries, headers };
}
function inputs() {
  return {
    sources: sourceInputs(SRC, join(here, "sassc-stdin.c")),
    toolchain: [compilerIdentity(CC, "c"), compilerIdentity(CXX, "c++")],
    recipe: { cpp: ["-std=c++11", "-O2", define], c: ["-O2", define], wrapper: ["-O2"], link: ["-static-libgcc", "-static-libstdc++", ...(process.platform === "win32" ? ["-static"] : ["-lm"])], platform: process.platform, arch: process.arch },
    environment: Object.fromEntries(["CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "LIBRARY_PATH", "GCC_EXEC_PREFIX", "COMPILER_PATH", "SOURCE_DATE_EPOCH"].map(key => [key, process.env[key] ?? null])),
  };
}
const identity = inputs();
const git = spawnSync("git", ["-C", dirname(here), "rev-parse", "--path-format=absolute", "--git-common-dir"], { windowsHide: true, encoding: "utf8" });
const defaultCache = git.status === 0
  ? join(git.stdout.trim(), "native-artifacts", "libsass")
  : join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "decko-ts", "native-artifacts", "libsass");
const cacheRoot = resolve(process.env.LIBSASS_CACHE_DIR ?? defaultCache);
const sourceFiles = ["src", join("src", "memory")].flatMap(dir => readdirSync(join(SRC, dir)).filter(file => /\.(cpp|c)$/.test(file)).sort().map(file => join(SRC, dir, file)));

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stdout.on("data", (d) => { err += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")}\n${err}`))));
  });
}

async function compile(work) {
  const OBJ = join(work, "obj");
  mkdirSync(OBJ, { recursive: true });
  const jobs = sourceFiles.map((file) => {
    const obj = join(OBJ, basename(file).replace(/\.(cpp|c)$/, ".o"));
    const cpp = file.endsWith(".cpp");
    const args = [...(cpp ? ["-std=c++11"] : []), "-O2", define, ...include, "-c", file, "-o", obj];
    return { file, obj, cmd: identity.toolchain[cpp ? 1 : 0].program, args };
  });
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      await run(j.cmd, j.args);
      done++;
      console.log(`compiled ${basename(j.file)} (${done}/${jobs.length})`);
    }
  }
  const results = await Promise.allSettled(Array.from({ length: JOBS }, worker));
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;

  const cliObj = join(OBJ, "sassc-stdin.o");
  await run(identity.toolchain[0].program, ["-O2", ...include, "-c", join(here, "sassc-stdin.c"), "-o", cliObj]);
  const exe = join(work, filename);
  await run(identity.toolchain[1].program, [
    "-o", exe, cliObj, ...jobs.map((j) => j.obj),
    "-static-libgcc", "-static-libstdc++", ...(process.platform === "win32" ? ["-static"] : ["-lm"]),
  ]);
  return exe;
}

function smoke(program) {
  const output = execFileSync(program, ["compressed"], { windowsHide: true, input: "a{b:c}", encoding: "utf8" });
  if (output !== "a{b:c}\n") throw new Error(`native LibSass compile smoke failed: ${program}`);
}
let adopted;
if (adoptRepo) {
  const seedRoot = join(adoptRepo, "tools", "libsass");
  if (sha256(readFileSync(join(seedRoot, "build-native.mjs"))) !== LEGACY_RECIPE ||
      JSON.stringify(sourceInputs(join(seedRoot, "libsass"), join(seedRoot, "sassc-stdin.c"))) !== JSON.stringify(identity.sources)) {
    throw new Error("legacy artifact source or compile recipe does not match");
  }
  adopted = join(seedRoot, "build", filename);
  const bytes = readFileSync(adopted);
  if (!identity.toolchain.every(tool => bytes.includes(Buffer.from(tool.version)))) throw new Error("legacy artifact does not identify the current compiler version");
  smoke(adopted);
}
const artifact = await cachedArtifact({
  root: cacheRoot, inputs: identity, filename, verifyInputs: inputs,
  build: async work => {
    if (!adopted && process.env.LIBSASS_CACHE_ONLY === "1") throw new Error("no verified LibSass artifact for these inputs (cache-only check)");
    const program = adopted ?? await compile(work);
    smoke(program);
    return program;
  },
  provenance: adopted ? { mode: "explicit-legacy-adoption", source: adoptRepo, binary: sha256(readFileSync(adopted)), legacyRecipe: LEGACY_RECIPE, originalToolchainReceipt: "not recorded; current source/recipe, embedded compiler version and executable smoke verified" } : "compiled",
});
materialize(artifact, join(OUT, filename));
console.log(`${artifact.cacheHit ? "verified cache hit" : adopted ? "verified legacy import" : "built"} ${join(OUT, filename)} (LibSass ${version}; ${artifact.manifest.key}; ${Date.now() - started} ms)`);
