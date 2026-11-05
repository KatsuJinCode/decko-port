import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function isTestFile(file) {
  return typeof file === "string" && /\.(?:test|spec)\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/.test(file);
}

export function testRunner(root, file) {
  const text = readFileSync(join(root, file), "utf8");
  const usesNode = /^\s*import\b[^;\n]*from\s+["']node:test["']/m.test(text);
  const usesVitest = /^\s*import\b[^;\n]*from\s+["']vitest["']/m.test(text);
  if (usesNode && usesVitest) throw Error("mixed Node/Vitest test framework imports: " + file);
  return usesNode ? "node" : "vitest";
}

const privateInputsUrl = new URL("./test-gate-routing/private-inputs.json", import.meta.url);
const privateInputs = existsSync(privateInputsUrl) ? JSON.parse(readFileSync(privateInputsUrl, "utf8")) : [];
for (const entry of privateInputs) {
  if (typeof entry.file !== "string" || !isTestFile(entry.file) || entry.file.includes("..") || entry.file.includes("\\") || entry.file.startsWith("/") || typeof entry.reason !== "string" || !entry.reason.trim() || (entry.gate !== undefined && !["deploy", "harness"].includes(entry.gate))) {
    throw Error("Invalid private-input test route: " + JSON.stringify(entry));
  }
}
if (new Set(privateInputs.map(entry => entry.file)).size !== privateInputs.length) throw Error("Duplicate private-input test route");
const onDemandPrivateInputs = new Map(privateInputs.filter(entry => entry.gate).map(entry => [entry.file, entry]));

const CORPUS_GATE_FILES = new Set([
  ...privateInputs.filter(entry => !entry.gate).map(entry => entry.file),
]);

export const GATES = [
  {
    id: "corpus",
    label: "Corpus - needs the machine-local rich benchmark corpus on disk",
    when: "On demand, when the rich corpus is present on this machine (npm run test:corpus)",
    why: "They need the private, machine-local benchmark corpus, which is not in the repository. The port must not depend on private data, so this gate is never part of the full gate.",
    excludedFromFull: true,
    match: (p) => CORPUS_GATE_FILES.has(p),
  },
  {
    id: "benchmarks",
    label: "BENCHMARKS - investigation tooling, not tests",
    when: "On demand, when investigating performance",
    why: "They answer 'how fast is it', not 'is it right'. They fail without a live database, so in the constant path they were pure noise.",
    match: (p) => /^benchmarks\//.test(p),
  },
  {
    id: "package",
    label: "Package - needs the proposed handover export on disk",
    when: "At the handover package step, with HANDOVER_EXPORT_ROOT naming the proposed export (npm run test:package)",
    why: "Its refusal is correct without an export. Running it in an ordinary gate turns a missing export into a failure of every change.",
    excludedFromFull: true,
    match: (p) => p === "tests/handover/tinymce-source-supply.attack.test.mjs",
  },
  {
    id: "harness",
    label: "Harness - our own agent tooling, not the product",
    when: "On demand / when the tooling itself changes",
    why: "A change to the wiki cannot break the process-killer or the lane runner. These only need to run when those tools change.",
    match: (p) =>
      /^tools\//.test(p) || /^tests\/(?:handover|release)\//.test(p) ||
      /dual-lane-verifier|lane-verifier|instrument-reliability|test-queue|kill-scoping|lane-job|cf-cost|reclaim|persist-write-probe|reference-harness/i.test(p),
  },
  {
    id: "capacity",
    label: "Capacity - proves scale, not correctness",
    when: "Nightly or on demand",
    why: "A million-row import must be proven, but it does not change when a view is edited. It costs seconds and proves nothing about a typo fix.",
    match: (p) =>
      /streaming-memory|importer-local-d1|d1-trickle|soak|\bsynthetic\b|fixture-sweep|deep-nesting|pair-chunk|\bbench\b|volume|throughput|1m-rows|million/i.test(p),
  },
  {
    id: "deploy",
    label: "Deployment - emulates the production edge runtime",
    when: "At merge",
    why: "These boot a copy of the serving environment. Correct and worth running before a change lands - but a copy of production does not need to boot every time a line is edited.",
    match: (p) =>
      /(^|\/)deploy\//.test(p) ||
      /workerd|miniflare|bunny-edge|cf-edge|edge-compiler|deploy-worker|compiled-script-bundle|cross-adapter-byte-parity|concurrent-saves|atomic-saves/i.test(p),
  },
  {
    id: "parity",
    label: "Parity - compares captured Ruby output byte for byte",
    when: "At merge",
    why: "Parity is the contract with the original. It is fast and it is precious, but it only moves when rendering changes, which is far rarer than any code change.",
    match: (p) =>
      /(^|\/)corpus\/|parity|oracle|capture|golden|replay/i.test(p),
  },
];

export const DEFAULT_GATE = "correctness";
const PRODUCT_TEST_DIRECTORIES = new Set([
  "acceptance", "card", "cql", "exercise", "hosted", "migrate",
  "server", "support", "testing", "tools", "viewkeys-lane-sweep", "withheld",
]);
const PRODUCT_TEST_FILES = new Set([
  "tests/configured-public-page-shell.test.mjs", "tests/smoke.test.ts",
  "tests/worker-url-parser.test.ts", "tests/worker.test.ts",
]);

export function listTestFiles(dir = REPO_ROOT, out = [], root = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error("Cannot inspect test inventory: " + dir, { cause: error });
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "tmp" || entry.name === ".runtime" || entry.name === "vendor" || entry.name === "third-party-source" || entry.name === "fixtures" || entry.name.startsWith(".git")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listTestFiles(full, out, root);
    else if (isTestFile(entry.name)) out.push(relative(root, full).replace(/\\/g, "/"));
  }
  return out;
}

export function classify(relPath) {
  if (!isTestFile(relPath)) return null;
  const privateRoute = onDemandPrivateInputs.get(relPath);
  if (privateRoute) return privateRoute.gate;
  const gate = GATES.find((g) => g.match(relPath));
  if (gate) return gate.id;
  const components = relPath.split("/");
  if (PRODUCT_TEST_FILES.has(relPath) || (components.length > 2 && components[0] === "tests" && PRODUCT_TEST_DIRECTORIES.has(components[1]))) return DEFAULT_GATE;
  return null;
}

export function selectTestFiles(files, gateId) {
  if (gateId === "full") {
    const excluded = new Set(GATES.filter(gate => gate.excludedFromFull).map(gate => gate.id));
    return files.filter(file => !excluded.has(classify(file)) && !onDemandPrivateInputs.has(file));
  }
  return files.filter(file => classify(file) === gateId);
}

export function parseGateArguments(args) {
  const folders = [], extra = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--folder" || arg.startsWith("--folder=")) {
      const value = arg === "--folder" ? args[++index] : arg.slice("--folder=".length);
      if (typeof value !== "string" || !value || value.startsWith("--")) throw Error("--folder requires a named repository folder");
      const folder = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
      if (!folder || folder !== folder.trim() || folder.startsWith("/") || folder.includes(":")
        || folder.split("/").some(part => !part || part === "." || part === "..")) throw Error("Invalid test folder: " + value);
      if (folders.includes(folder)) throw Error("Repeated test folder: " + folder);
      folders.push(folder);
    } else if (arg.startsWith("--folder")) throw Error("Unknown folder selection argument: " + arg);
    else extra.push(arg);
  }
  return { folders, extra };
}

export function selectGateInventory(files, gateId, folders = []) {
  const eligible = selectTestFiles(files, gateId);
  for (const folder of folders) {
    if (!files.some(file => file.startsWith(folder + "/"))) throw Error("Unknown or empty test folder: " + folder);
    if (!eligible.some(file => file.startsWith(folder + "/"))) throw Error(`Test folder ${folder} selects no files in gate ${gateId}`);
  }
  const inFolder = file => !folders.length || folders.some(folder => file.startsWith(folder + "/"));
  const selected = eligible.filter(inFolder);
  const selectedSet = new Set(selected);
  const excluded = files.filter(file => inFolder(file) && !selectedSet.has(file)).map(file => ({
    file, gate: classify(file), reason: onDemandPrivateInputs.get(file)?.reason ?? GATES.find(gate => gate.id === classify(file))?.why ?? "Not in the requested gate",
  }));
  return { selected, excluded };
}

export function testInventoryProblems(files) {
  return files.filter(file => classify(file) === null).map(file => file + ": no declared test gate");
}

function requireClassifiedInventory(files) {
  const problems = testInventoryProblems(files);
  if (problems.length) throw new Error("Test gate inventory refused:\n" + problems.join("\n"));
}

function repoTestFiles() {
  return listTestFiles().sort();
}

export function prepareTestEnvironment(root, env = process.env) {
  let parent = realpathSync(root);
  for (const name of [".runtime", "test-gates"]) {
    const directory = join(parent, name);
    try { mkdirSync(directory); }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || relative(directory, realpathSync(directory)) !== "") {
      throw new Error(`Test gate temporary directory is redirected or not a directory: ${directory}`);
    }
    parent = directory;
  }
  const temporaryRoot = mkdtempSync(join(parent, "run-"));
  for (const name of ["TEMP", "TMP", "TMPDIR", "DECKO_TEST_TEMP_ROOT"]) env[name] = temporaryRoot;
  return { temporaryRoot };
}

async function defaultRunNodeTests({ root, files }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("close", (code) => resolve({ pass: code === 0, filesExecuted: files.length, summary: { exitCode: code ?? 1 }, timings: [] }));
    child.once("error", () => resolve({ pass: false, filesExecuted: files.length, summary: { exitCode: 1 }, timings: [] }));
  });
}

export async function runGatePhases({ root, vitestFiles, nodeFiles, generated, extra, report }, {
  spawnVitest = spawn, runNode = defaultRunNodeTests, removeConfig = unlinkSync,
  log = message => console.error(message),
  observeTiming = () => {},
} = {}) {
  const vitest = () => !vitestFiles.length ? Promise.resolve(0) : new Promise((resolve, reject) => {
    const child = spawnVitest(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", generated, ...extra], {
      cwd: root, stdio: "inherit", windowsHide: true,
    });
    let failed = false, failure;
    child.once("error", error => { failed = true; failure = error; });
    child.once("close", (code, signal) => failed ? reject(failure) : resolve(signal ? 1 : code ?? 1));
  });
  const node = async () => {
    if (!nodeFiles.length) return true;
    const result = await runNode({ root, files: nodeFiles, report });
    for (const phase of result.timings ?? []) observeTiming(phase);
    log(JSON.stringify({ runner: "node:test", files: nodeFiles.length, filesExecuted: result.filesExecuted, summary: result.summary, pass: result.pass, report }));
    return result.pass;
  };
  const settle = async (phase, name) => {
    const before = performance.now();
    try { return { status: "fulfilled", value: await phase() }; }
    catch (reason) { return { status: "rejected", reason }; }
    finally { observeTiming({ name, kind: "runner", overlapGroup: "test-runners", wallMs: performance.now() - before }); }
  };
  let outcomes, cleanupPass = true;
  try {
    outcomes = await Promise.all([settle(vitest, "vitest-runner"), settle(node, "node-runner")]);
  } finally {
    try { removeConfig(generated); }
    catch (error) {
      cleanupPass = false;
      log("Test gate config cleanup failed: " + (error?.stack ?? String(error)));
    }
  }
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") log(`${index === 0 ? "Vitest" : "Node"} phase failed: ${outcome.reason?.stack ?? String(outcome.reason)}`);
  }
  return {
    vitestStatus: outcomes[0].status === "fulfilled" ? outcomes[0].value : 1,
    nodePass: outcomes[1].status === "fulfilled" && outcomes[1].value === true,
    cleanupPass,
  };
}

async function command() {
  const [verb, arg] = process.argv.slice(2);

  if (verb === "list" || !verb) {
    const files = repoTestFiles();
    requireClassifiedInventory(files);
    const counts = new Map();
    for (const f of files) counts.set(classify(f), (counts.get(classify(f)) || 0) + 1);
    console.log(`${files.length} test files\n`);
    for (const g of GATES) {
      console.log(`  ${g.id.padEnd(11)} ${String(counts.get(g.id) || 0).padStart(4)} files   ${g.label}`);
      console.log(`  ${"".padEnd(11)} ${" ".repeat(4)} runs: ${g.when}`);
    }
    const dc = counts.get(DEFAULT_GATE) || 0;
    console.log(`  ${DEFAULT_GATE.padEnd(11)} ${String(dc).padStart(4)} files   declared product behaviour`);
    console.log(`\n  ${((dc / files.length) * 100).toFixed(0)}% of files run on every change`);
    return;
  }

  if (verb === "check") {
    const files = repoTestFiles();
    const problems = testInventoryProblems(files);
    if (problems.length) {
      console.error("test gate check FAILED:");
      for (const p of problems) console.error("  " + p);
      process.exit(1);
    }
    console.log(`test gate check OK - all ${files.length} test files are classified; ${files.filter(f => testRunner(REPO_ROOT, f) === "node").length} use node:test`);
    return;
  }

  if (verb === "run") {
    const gateId = arg;
    const known = new Set([...GATES.map((g) => g.id), DEFAULT_GATE, "full"]);
    if (!gateId || !known.has(gateId)) {
      console.error(`usage: node tools/test-gates.mjs run <gate>   known: ${[...known].join(", ")}`);
      process.exit(1);
    }
    const files = repoTestFiles();
    requireClassifiedInventory(files);
    const { folders, extra } = parseGateArguments(process.argv.slice(4));
    const { selected, excluded: excludedSelection } = selectGateInventory(files, gateId, folders);
    if (selected.length === 0) {
      console.error(`gate "${gateId}" selected 0 files`);
      process.exit(1);
    }

    if (!extra.some(arg => arg.startsWith("--maxWorkers"))) {
      const workers = Number(process.env.DECKO_TEST_MAX_WORKERS ?? 2);
      if (!Number.isInteger(workers) || workers < 1) throw Error("positive DECKO_TEST_MAX_WORKERS required");
      extra.unshift(`--maxWorkers=${workers}`);
    }

    if (gateId === "full") {
      for (const excluded of GATES.filter((g) => g.excludedFromFull)) {
        const excludedFiles = excludedSelection.filter(entry => entry.gate === excluded.id).map(entry => entry.file);
        if (excludedFiles.length) console.error(`gate "full" leaves out ${excludedFiles.length} ${excluded.id} file(s). Reason: ${excluded.why} When to run: ${excluded.when}. Files: ${excludedFiles.join(", ")}`);
      }
      for (const [file, route] of onDemandPrivateInputs) {
        if (excludedSelection.some(entry => entry.file === file)) console.error(`gate "full" leaves out ${file}. Reason: ${route.reason} On demand: node tools/test-gates.mjs run ${route.gate}, with the required private inputs supplied by their owner.`);
      }
    }
    const temporaryState = prepareTestEnvironment(REPO_ROOT);
    const nodeFiles = selected.filter(f => testRunner(REPO_ROOT, f) === "node");
    const vitestFiles = selected.filter(f => !nodeFiles.includes(f));
    const generated = join(REPO_ROOT, `vitest.gate.${process.pid}.${randomUUID()}.generated.ts`);
    const includeList = vitestFiles.map((f) => `  ${JSON.stringify(f)},`).join("\n");
    writeFileSync(
      generated,
      [
        'import { defineConfig, mergeConfig } from "vitest/config";',
        'import base from "./vitest.config";',
        "",
        "export default mergeConfig(base, defineConfig({",
        "  test: {",
        "    include: [",
        includeList,
        "    ],",
        "  },",
        "}));",
        "",
      ].join("\n")
    );
    console.error(`gate "${gateId}": ${vitestFiles.length} Vitest + ${nodeFiles.length} Node files`);
    const report = process.env.NODE_TEST_REPORT ?? join(temporaryState.temporaryRoot, "node-report.json");
    const outcome = await runGatePhases({ root: REPO_ROOT, vitestFiles, nodeFiles, generated, extra, report });
    if (outcome.vitestStatus !== 0 || !outcome.nodePass || !outcome.cleanupPass) process.exitCode = 1;
    return;
  }

  console.error(`unknown command "${verb}". use list | run <gate> | check`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await command();
