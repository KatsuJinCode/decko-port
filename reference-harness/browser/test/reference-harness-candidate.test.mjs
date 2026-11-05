import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { loadBunnyComparisonInputs, sha256, treeDigest } from "../lib/journey-provenance.mjs";
import { validateJourneyEvidence } from "../lib/journey-evidence-validation.mjs";
const repo = fileURLToPath(new URL("../../..", import.meta.url));
test("--reference-harness-candidate rejects invalid commit shape", () => {
  const baseArgs = {
    "comparison-mode": "bunny-local-hosted",
    candidate: "a".repeat(40),
    "harness-candidate": "b".repeat(40),
    "reference-candidate": "c".repeat(40),
    "reference-harness-candidate": "not-a-valid-commit",
  };
  assert.throws(
    () => loadBunnyComparisonInputs(baseArgs),
    /--reference-harness-candidate must name an exact full source commit/
  );
});
test("--reference-harness-candidate binds expected captures to candidate and actual to harness", () => {
  const candidate = "a".repeat(40);
  const harness = "b".repeat(40);
  const refCandidate = "c".repeat(40);
  const refHarness = "d".repeat(40);
  const fixtureDir = path.join(repo, ".test-results/reference-harness-pin-controls");
  mkdirSync(fixtureDir, { recursive: true });
  const manifest = { commit: candidate, bundleSha256: sha256("bundle"), bundleBytes: 6, treeDirty: false, inputs: [{ path: "src/a.ts", object: "e".repeat(40), sha256: sha256("a") }] };
  const deployment = { scriptId: 1, commit: candidate, bundleSha256: manifest.bundleSha256, uploadedCodeSha256: manifest.bundleSha256, activeRelease: { id: 10, status: 1, codeSha256: manifest.bundleSha256 } };
  const status = { activeRelease: { id: 10, codeSha256: manifest.bundleSha256 }, served: { status: 200, build: { commit: candidate, tree_dirty: false } } };
  const refBuild = { sourceCommit: refCandidate, sourceDiffSha256: sha256(""), distSha256: sha256("dist") };
  const manifestPath = path.join(fixtureDir, "manifest.json");
  const edgePath = path.join(fixtureDir, "edge.mjs");
  const deploymentPath = path.join(fixtureDir, "deployment.json");
  const statusPath = path.join(fixtureDir, "status.json");
  const refBuildPath = path.join(fixtureDir, "ref-build.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(edgePath, "bundle");
  writeFileSync(deploymentPath, JSON.stringify(deployment));
  writeFileSync(statusPath, JSON.stringify(status));
  writeFileSync(refBuildPath, JSON.stringify(refBuild));
  const args = {
    "comparison-mode": "bunny-local-hosted",
    candidate,
    "harness-candidate": harness,
    "reference-candidate": refCandidate,
    "reference-harness-candidate": refHarness,
    "hosted-base-url": "https://example.bunny.run",
    "candidate-manifest": manifestPath,
    "deployment-receipt": deploymentPath,
    "deployment-status-receipt": statusPath,
    "reference-build-receipt": refBuildPath,
    fixture: path.join(repo, "reference-harness/fixtures/synthetic-v1"),
    journeys: path.join(repo, "reference-harness/browser/journeys/synthetic-v1.json"),
    case: "history-view-admin",
  };
  const inputs = loadBunnyComparisonInputs(args);
  assert.equal(inputs.harnessCommit, harness);
  assert.equal(inputs.referenceHarnessCommit, refHarness);
  const expProv = {
    format: "decko-browser-evidence/1",
    runId: "run-ref",
    startedAt: new Date().toISOString(),
    source: { commit: refHarness, dirty: false, diffSha256: sha256(""), statusSha256: sha256("") },
    comparisonMode: "bunny-local-hosted",
    fixtureSha256: treeDigest(args.fixture),
    journeysSha256: sha256(readFileSync(args.journeys)),
    contractsSha256: sha256(readFileSync(path.join(repo, "reference-harness/browser/journeys/product-contracts.json"))),
    engineSha256: sha256(readFileSync(path.join(repo, "reference-harness/browser/engines/bunny-local.json"))),
    engine: "bunny-local",
    artifacts: { distSha256: refBuild.distSha256 },
    buildReceipt: refBuild,
    application: inputs.reference,
  };
  const actProv = {
    format: "decko-browser-evidence/1",
    runId: "run-act",
    startedAt: new Date().toISOString(),
    source: { commit: harness, dirty: false, diffSha256: sha256(""), statusSha256: sha256("") },
    comparisonMode: "bunny-local-hosted",
    fixtureSha256: treeDigest(args.fixture),
    journeysSha256: sha256(readFileSync(args.journeys)),
    contractsSha256: expProv.contractsSha256,
    engineSha256: sha256(readFileSync(path.join(repo, "reference-harness/browser/engines/live.json"))),
    engine: "live-override",
    artifacts: { bundleSha256: manifest.bundleSha256 },
    application: { ...inputs.application, guard: {
      statusUrl: "https://example.bunny.run/_status",
      commit: candidate,
      status: 200,
      body: JSON.stringify({ build: { commit: candidate, tree_dirty: false } }),
      bodySha256: sha256(JSON.stringify({ build: { commit: candidate, tree_dirty: false } })),
      checkedAt: new Date().toISOString(),
    } },
  };
  const prepRef = {
    format: "decko-bunny-startup/1",
    method: "GET",
    url: "http://127.0.0.1:3000/",
    status: 200,
    bodyBytes: 4,
    bodySha256: sha256("home"),
    startedAtMs: 0,
    finishedAtMs: 1,
  };
  const prepAct = {
    format: "decko-bunny-startup/1",
    method: "GET",
    url: "https://example.bunny.run/",
    status: 200,
    bodyBytes: 4,
    bodySha256: sha256("home"),
    startedAtMs: 0,
    finishedAtMs: 1,
  };
  const journeyDef = JSON.parse(readFileSync(args.journeys, "utf8")).journeys.find(j => j.id === "history-view-admin");
  const expResult = {
    id: "history-view-admin",
    completed: true,
    steps: journeyDef.steps.map((s, i) => ({ i, outcome: "ok", step: s, startedAtMs: 5 + i })),
    observations: [{ label: "history", url: "/Note_001?view=history", status: 200, text: "Subtractions #1 Decko Bot about 2 months ago add_circle Decko v0.20.0", structure: [], fields: [] }],
    mail: [], rawMail: [], rows: {}, browserVersion: "test",
    network: [],
    preparation: prepRef,
    beforeSnapshotStartedAtMs: 2,
    runtime: { engine: "bunny-handler-node-local-hrana", node: process.version, productionRuntime: false },
    provenance: expProv,
  };
  const actResult = {
    id: "history-view-admin",
    completed: true,
    steps: journeyDef.steps.map((s, i) => ({ i, outcome: "ok", step: s, startedAtMs: 5 + i })),
    observations: [{ label: "history", url: "/Note_001?view=history", status: 200, text: "Subtractions #1 Decko Bot about 2 months ago add_circle Decko v0.20.0", structure: [], fields: [] }],
    mail: [], rawMail: [], rows: {}, browserVersion: "test",
    network: [],
    preparation: prepAct,
    beforeSnapshotStartedAtMs: 2,
    hostedSnapshot: true,
    fixtureReset: { digestMatch: true, actorsMatch: true },
    mailSource: "owned HTTPS receiver; retained messages read with an authenticated cursor",
    provenance: actProv,
  };
  const validation = validateJourneyEvidence(
    args,
    { results: { "history-view-admin": expResult }, problems: [] },
    { results: { "history-view-admin": actResult }, problems: [] }
  );
  assert.equal(validation.problems.length, 0, "Validation should have zero problems: " + validation.problems.join(", "));
  const check = (options = args) => validateJourneyEvidence(options, {results: {"history-view-admin": expResult}, problems: []}, {results: {"history-view-admin": actResult}, problems: []}).problems;
  actProv.source.commit = refHarness;
  assert.ok(check().some(p => p.includes("actual/history-view-admin") && p.includes("wrong or dirty harness")));
  actProv.source.commit = harness;
  expProv.source.commit = harness;
  assert.ok(check().some(p => p.includes("reference/history-view-admin") && p.includes("wrong or dirty harness")));
  expProv.source.commit = refHarness;
  const legacy = {...args}; delete legacy["reference-harness-candidate"];
  assert.ok(check(legacy).some(p => p.includes("reference/history-view-admin") && p.includes("wrong or dirty harness")));
  expProv.source.diffSha256 = "f".repeat(64);
  assert.ok(check().some(p => p.includes("wrong or dirty harness")));
  expProv.source.diffSha256 = sha256("");
  actProv.fixtureSha256 = "f".repeat(64);
  assert.ok(check().some(p => /fixture/.test(p)));
  actProv.fixtureSha256 = treeDigest(args.fixture);
  rmSync(fixtureDir, { recursive: true, force: true });
});
