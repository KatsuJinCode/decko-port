import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceGitEnvironment } from "../../runner/source-git-environment.mjs";
import { checkHostedBuildMatchesCommit } from "../../../tools/hosted-build-guard/assert-hosted-build-matches-commit.mjs";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const BUNNY_COMPARISON_MODE = "bunny-local-hosted";
const fullCommit = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const fullHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function comparisonMode(args) {
  const mode = args["comparison-mode"] ?? "ruby-node";
  if (!["ruby-node", BUNNY_COMPARISON_MODE].includes(mode)) throw Error(`unknown comparison mode: ${mode}`);
  return mode;
}
export function loadBunnyComparisonInputs(args) {
  for (const key of ["candidate", "harness-candidate", "reference-candidate"]) {
    if (!fullCommit(args[key])) throw Error(`--${key} must name an exact full source commit`);
  }
  if (args["reference-harness-candidate"] !== undefined && !fullCommit(args["reference-harness-candidate"])) {
    throw Error("--reference-harness-candidate must name an exact full source commit");
  }
  function read(key) {
    if (!args[key]) throw Error(`--${key} is required for ${BUNNY_COMPARISON_MODE}`);
    const bytes = readFileSync(args[key]);
    return { value: JSON.parse(bytes), sha256: sha256(bytes) };
  }
  const manifest = read("candidate-manifest"), deployment = read("deployment-receipt");
  const status = read("deployment-status-receipt"), reference = read("reference-build-receipt");
  const m = manifest.value, d = deployment.value, s = status.value, r = reference.value;
  if (!args["hosted-base-url"]) throw Error("--hosted-base-url is required");
  const target = new URL(args["hosted-base-url"]);
  if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") throw Error("hosted base must be an HTTPS origin");
  if (m.commit !== args.candidate || m.treeDirty !== false || !fullHash(m.bundleSha256)
      || !Number.isSafeInteger(m.bundleBytes) || m.bundleBytes <= 0 || !Array.isArray(m.inputs) || !m.inputs.length
      || m.inputs.some(i => !i || typeof i.path !== "string" || !fullCommit(i.object) || !fullHash(i.sha256))
      || new Set(m.inputs.map(i => i.path)).size !== m.inputs.length) throw Error("candidate manifest does not bind clean application source and bundle");
  const bundle = readFileSync(path.join(path.dirname(args["candidate-manifest"]), "edge.mjs"));
  if (bundle.length !== m.bundleBytes || sha256(bundle) !== m.bundleSha256) throw Error("candidate bundle bytes differ from manifest");
  if (d.commit !== m.commit || d.bundleSha256 !== m.bundleSha256 || d.uploadedCodeSha256 !== m.bundleSha256
      || d.activeRelease?.codeSha256 !== m.bundleSha256 || d.activeRelease?.status !== 1
      || !Number.isSafeInteger(d.scriptId) || d.scriptId <= 0 || !Number.isSafeInteger(d.activeRelease?.id)
      || d.activeRelease.id <= 0) throw Error("deployment receipt does not bind active application source and artifact");
  if (s.activeRelease?.id !== d.activeRelease.id || s.activeRelease?.codeSha256 !== m.bundleSha256
      || s.served?.status !== 200 || s.served?.build?.commit !== m.commit || s.served?.build?.tree_dirty !== false) throw Error("deployment status is stale, dirty or mismatched");
  if (r.sourceCommit !== args["reference-candidate"] || r.sourceDiffSha256 !== sha256("")
      || !fullHash(r.distSha256)) throw Error("local reference build receipt is missing, dirty or from the wrong source");
  return {
    mode: BUNNY_COMPARISON_MODE, harnessCommit: args["harness-candidate"],
    referenceHarnessCommit: args["reference-harness-candidate"] ?? args["harness-candidate"],
    referenceBuildReceipt: r,
    application: { kind: "bunny-hosted", sourceCommit: m.commit, bundleSha256: m.bundleSha256,
      manifestSha256: manifest.sha256, deploymentReceiptSha256: deployment.sha256,
      deploymentStatusReceiptSha256: status.sha256, targetOrigin: target.origin,
      scriptId: d.scriptId, activeReleaseId: d.activeRelease.id },
    reference: { kind: "bunny-local", sourceCommit: r.sourceCommit, sourceDiffSha256: r.sourceDiffSha256,
      distSha256: r.distSha256, buildReceiptSha256: reference.sha256 },
  };
}
export function validateBunnyGuard(guard, application, startedAt) {
  if (!guard || guard.statusUrl !== `${application.targetOrigin}/_status` || guard.commit !== application.sourceCommit
      || guard.status !== 200 || typeof guard.body !== "string" || sha256(guard.body) !== guard.bodySha256
      || !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(guard.checkedAt))
      || Date.parse(guard.checkedAt) < Date.parse(startedAt)) throw Error("missing, stale or mismatched hosted build guard");
  const build = JSON.parse(guard.body)?.build;
  if (build?.commit !== application.sourceCommit || build?.tree_dirty !== false) throw Error("hosted build guard source is dirty or mismatched");
}
export async function bindHostedJourneyBuild(provenance, baseUrl, fetchImpl = globalThis.fetch) {
  const application = provenance.application;
  if (application?.kind !== "bunny-hosted" || new URL(baseUrl).origin !== application.targetOrigin) throw Error("hosted journey target differs from selected deployment");
  let raw;
  const checked = await checkHostedBuildMatchesCommit({ baseUrl: application.targetOrigin,
    expectedCommit: application.sourceCommit, fetchImpl: async (...args) => {
      const response = await fetchImpl(...args);
      raw = { status: response.status, body: await response.clone().text() };
      return response;
    } });
  const guard = { ...checked, ...raw, bodySha256: sha256(raw.body), checkedAt: new Date().toISOString() };
  validateBunnyGuard(guard, application, provenance.startedAt);
  return { ...provenance, application: { ...application, guard } };
}
export function treeDigest(root) {
  if (!existsSync(root)) return null;
  const hash = createHash("sha256");
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`artifact symlink unsupported: ${file}`);
      if (stat.isDirectory()) visit(file);
      else hash.update(path.relative(root, file).replaceAll("\\", "/") + "\0" + sha256(readFileSync(file)) + "\n");
    }
  }
  visit(root);
  return hash.digest("hex");
}
export function captureFixtureIdentity(fixture, pin) {
  if (pin !== undefined && !/^[0-9a-f]{64}$/.test(pin)) throw new Error("--fixture-sha256 must be exactly 64 lowercase hexadecimal characters");
  const actual = treeDigest(path.resolve(fixture));
  if (pin !== undefined && actual !== pin) throw new Error(`fixture SHA-256 mismatch: expected ${pin}, actual ${actual}`);
  return actual;
}
export function captureProvenance(args, engine) {
  if (Object.hasOwn(args, "fixture-sha256") && args["fixture-sha256"] === undefined) throw new Error("--fixture-sha256 requires a value");
  const fixtureSha256 = captureFixtureIdentity(args.fixture, args["fixture-sha256"]);
  const mode = comparisonMode(args);
  const hosted = mode === BUNNY_COMPARISON_MODE && engine.mode === "host-override";
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const git = (...a) => execFileSync("git", ["--no-replace-objects", "-C", repo, ...a], { windowsHide: true, encoding: "utf8", env: sourceGitEnvironment() }).trim();
  const commit = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain", "--untracked-files=normal");
  const receiptPath = path.join(repo, ".runtime/browser-build.json");
  const buildReceipt = !hosted && existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
  const provenance = {
    buildReceipt,
    format: "decko-browser-evidence/1", runId: args["run-id"] ?? randomUUID(),
    startedAt: new Date().toISOString(),
    source: { commit, dirty: !!dirty, diffSha256: sha256(git("diff", "HEAD", "--binary")), statusSha256: sha256(dirty) },
    artifacts: hosted ? {} : { distSha256: treeDigest(path.join(repo, "dist")) },
    fixtureSha256,
    fixturePinSha256: args["fixture-sha256"] ?? null,
    journeysSha256: sha256(readFileSync(args.journeys)),
    contractsSha256: existsSync(args.contracts ?? new URL("../journeys/product-contracts.json", import.meta.url)) ? sha256(readFileSync(args.contracts ?? new URL("../journeys/product-contracts.json", import.meta.url))) : null,
    engineSha256: sha256(readFileSync(args.engine)), engine: engine.name,
    selection: { filter: args.filter ?? null, shard: args.shard ?? "0/1" },
    runner: {
      node: process.version, platform: process.platform, editorSettle: process.env.HARNESS_EDITOR_SETTLE ?? null, offline: process.env.HARNESS_OFFLINE ?? null,
      referenceTarget: args["reference-target"] ?? "vm",
      strictParityMode: process.env.HARNESS_STRICT_PARITY === "1",
      strictParity: ["SIGNIN_DETAILED_ERRORS", "REVISION_RESTORE_500", "SKIN_CREATE_500", "SCRIPT_BUNDLE_CLOCK_NAMES", "MAIL_UNFOLLOW_REFUSAL"]
        .map((n) => `DECKO_STRICT_PARITY_${n}=${process.env[`DECKO_STRICT_PARITY_${n}`] ?? "unset"}`)
        .join(" "),
    },
  };
  if (mode === BUNNY_COMPARISON_MODE) {
    const inputs = loadBunnyComparisonInputs(args);
    const expectedHarness = (engine.name === "bunny-local" && engine.mode !== "host-override")
      ? inputs.referenceHarnessCommit
      : inputs.harnessCommit;
    if (provenance.source.dirty || commit !== expectedHarness) throw Error("Bunny capture requires the selected clean harness source");
    provenance.comparisonMode = inputs.mode;
    if (engine.name === "bunny-local" && engine.mode !== "host-override") {
      if (!buildReceipt || buildReceipt.sourceCommit !== inputs.reference.sourceCommit
          || buildReceipt.sourceDiffSha256 !== sha256("") || buildReceipt.distSha256 !== inputs.reference.distSha256
          || provenance.artifacts.distSha256 !== inputs.reference.distSha256
          || sha256(readFileSync(receiptPath)) !== inputs.reference.buildReceiptSha256) throw Error("local Bunny reference source/build/artifact mismatch; rebuild from the selected clean reference source");
      provenance.application = inputs.reference;
    } else if (hosted) {
      provenance.application = inputs.application;
      provenance.artifacts = { bundleSha256: inputs.application.bundleSha256 };
    }
    else throw Error("Bunny comparison capture requires bunny-local or the hosted override engine");
  }
  return provenance;
}
