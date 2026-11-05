import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, treeDigest, comparisonMode, BUNNY_COMPARISON_MODE, loadBunnyComparisonInputs, validateBunnyGuard } from "./journey-provenance.mjs";
import { validateBunnyPreparation } from "./bunny-journey-preparation.mjs";
import { bunnyMailFields } from "./bunny-mail-comparison.mjs";
import { stable } from "../../runner/normalize.mjs";
export function sameJourneyInventory(one, other) {
  const normalize = definition => {
    if (!definition || !Array.isArray(definition.journeys)) return null;
    const ids = definition.journeys.map(j => j?.id);
    if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) return null;
    return stable({ ...definition, journeys: [...definition.journeys].sort((a, b) => a.id.localeCompare(b.id)) });
  };
  const a = normalize(one), b = normalize(other);
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}
export function loadJourneyResults(dir) {
  const results = {}, problems = [];
  if (!dir || !existsSync(dir)) return { results, problems: [`missing results directory: ${dir}`] };
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("run-meta"))) {
    try {
      const value = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      if (typeof value.id !== "string" || !value.id) { problems.push(`invalid result id: ${file}`); continue; }
      const object = item => item !== null && typeof item === "object" && !Array.isArray(item);
      const invalidArrays = ["steps", "observations", "mail", "network"].filter(key =>
        value[key] != null && !Array.isArray(value[key]));
      const malformed = invalidArrays.length > 0
        || (value.steps ?? []).some(step => !object(step) || !object(step.step))
        || (value.observations ?? []).some(observation => !object(observation)
          || !Array.isArray(observation.structure) || !Array.isArray(observation.fields))
        || (value.mail ?? []).some(mail => !object(mail) || !Array.isArray(mail.to))
        || (value.network ?? []).some(request => !object(request))
        || value.rows != null && (!object(value.rows) || Object.values(value.rows).some(delta =>
          !object(delta) || ["inserted", "updated", "deleted"].some(key => !Array.isArray(delta[key]))));
      if (malformed) { problems.push(`malformed result collection or entry: ${file}`); continue; }
      if (Object.hasOwn(results, value.id)) problems.push(`duplicate result id: ${value.id}`);
      else results[value.id] = value;
    } catch (error) { problems.push(`unreadable result ${file}: ${error.message}`); }
  }
  return { results, problems };
}
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function validateJourneyEvidence(args, expected, actual) {
  const problems = [...expected.problems.map(p => `reference: ${p}`), ...actual.problems.map(p => `actual: ${p}`)];
  let mode, bunnyInputs;
  try {
    mode = comparisonMode(args);
    if (mode === BUNNY_COMPARISON_MODE) bunnyInputs = loadBunnyComparisonInputs(args);
  } catch (error) { problems.push(`comparison admission: ${error.message}`); }
  const bunny = mode === BUNNY_COMPARISON_MODE;
  const strictParityMode = args["strict-parity"] === "1" || process.env.HARNESS_STRICT_PARITY === "1";
  const journeyFile = args.journeys ?? new URL("../journeys/synthetic-v1.json", import.meta.url);
  const fixture = args.fixture ?? new URL("../../fixtures/synthetic-v1", import.meta.url);
  const definitionBytes = readFileSync(journeyFile);
  const definition = JSON.parse(definitionBytes);
  const definitions = definition.journeys;
  if (bunny && (definitions.length !== 52 || !sameJourneyInventory(definition, JSON.parse(readFileSync(new URL("../journeys/synthetic-v1.json", import.meta.url)))))) problems.push("Bunny acceptance requires the complete canonical 52-journey definition");
  const individual = Object.hasOwn(args, "case");
  if (individual && (typeof args.case !== "string" || !args.case)) problems.push("--case requires one exact journey id");
  if (individual && args.filter) problems.push("--case cannot be combined with --filter");
  const filter = args.filter ? new RegExp(args.filter) : null;
  const selected = individual ? definitions.filter(j => j.id === args.case) : definitions.filter(j => !filter || filter.test(j.id));
  const ids = selected.map(j => j.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate journey definition ids");
  if (!ids.length) problems.push("empty journey selection");
  if (individual && ids.length !== 1) problems.push("--case must select exactly one canonical journey");
  if (filter) problems.push("partial selection is diagnostic only");
  const contractsPath = args.contracts ?? new URL("../journeys/product-contracts.json", import.meta.url);
  const contractBytes = readFileSync(contractsPath);
  const productContracts = JSON.parse(contractBytes);
  const contracts = productContracts.journeys;
  const hashes = { contractsSha256: sha256(contractBytes), journeysSha256: sha256(definitionBytes), fixtureSha256: treeDigest(fixture instanceof URL ? fileURLToPath(fixture) : path.resolve(fixture)) };
  let additionalPolicy = null;
  let additionalContracts = {};
  if (args["additional-contracts"]) {
    const bytes = readFileSync(args["additional-contracts"]);
    const policy = JSON.parse(bytes);
    additionalPolicy = { sha256: sha256(bytes), candidateOnly: true, evaluation: "post-capture observations; not executed browser assertions" };
    if (policy.format !== "decko-additional-product-contracts/1" || !policy.journeys || typeof policy.journeys !== "object" || Array.isArray(policy.journeys) || !Object.keys(policy.journeys).length) problems.push("invalid additional product policy");
    else {
      additionalContracts = policy.journeys;
      for (const [id, labels] of Object.entries(additionalContracts)) {
        const definition = definitions.find(j => j.id === id);
        if (!definition) problems.push(`additional product policy: unknown journey ${id}`);
        if (!labels || typeof labels !== "object" || Array.isArray(labels) || !Object.keys(labels).length) { problems.push(`additional product policy: invalid observations ${id}`); continue; }
        for (const [label, expectation] of Object.entries(labels)) {
          if (!definition?.steps.some(s => s.observe === label)) problems.push(`additional product policy: unknown observation ${id}/${label}`);
          if (!expectation || typeof expectation !== "object" || Array.isArray(expectation) || !Object.keys(expectation).length || Object.entries(expectation).some(([key,value]) => key === "status" ? !Number.isInteger(value) || value < 200 || value > 599 : !["textIncludes","textExcludes","structureIncludes"].includes(key) || !Array.isArray(value) || !value.length || value.some(v => typeof v !== "string" || !v.length))) problems.push(`additional product policy: invalid expectation ${id}/${label}`);
        }
      }
    }
  }
  const candidate = args.candidate;
  if (!/^[a-f0-9]{40}$/.test(candidate ?? "")) problems.push("--candidate must name the exact full source commit");
  for (const [side, loaded] of [["reference", expected], ["actual", actual]]) {
    for (const id of Object.keys(loaded.results)) if (!ids.includes(id)) problems.push(`${side}: unexpected journey ${id}`);
    const runs = new Set(), sources = new Set(), artifacts = new Set();
    for (const journey of selected) {
      const result = loaded.results[journey.id];
      if (!result) { problems.push(`${side}: missing journey ${journey.id}`); continue; }
      const prefix = `${side}/${journey.id}`;
      if (result.completed !== true) problems.push(`${prefix}: not completed`);
      const steps = result.steps ?? [];
      if (steps.length !== journey.steps.length || !steps.every((s,i) => s.i === i && s.outcome === "ok" && equal(s.step, journey.steps[i]))) problems.push(`${prefix}: step evidence does not match complete definition`);
      const labels = (result.observations ?? []).map(o => o.label);
      const wanted = journey.steps.flatMap(s => Object.hasOwn(s,"observe") ? [s.observe]
        : Object.hasOwn(s,"download") ? [s.label ?? `download ${s.file ?? s.download.url}`] : []);
      if (new Set(labels).size !== labels.length || !equal(labels,wanted)) problems.push(`${prefix}: missing, duplicate or unexpected observations`);
      if (!Array.isArray(result.mail) || !result.rows || typeof result.rows !== "object") problems.push(`${prefix}: missing mail or row evidence`);
      for (const o of result.observations ?? []) {
        if (typeof o.url !== "string" || typeof o.text !== "string" || !Array.isArray(o.structure) || !Array.isArray(o.fields)) problems.push(`${prefix}/${o.label}: incomplete observation evidence`);
        if (!Number.isInteger(o.status) || o.status >= 500 || o.status < 200) problems.push(`${prefix}/${o.label}: user-visible HTTP ${o.status}`);
      }
      for (const step of journey.steps.filter(s => s.download)) {
        const label = step.label ?? `download ${step.file ?? step.download.url}`;
        const observation = (result.observations ?? []).find(o => o.label === label);
        if (!observation || !Number.isInteger(observation.status) || observation.status < 200 || observation.status >= 300) problems.push(`${prefix}/${label}: download requires observed HTTP success`);
        if (step.file && observation) {
          const bytes = readFileSync(new URL(`../files/${step.file}`, import.meta.url));
          if (observation.text !== `sha256=${sha256(bytes)} bytes=${bytes.length} status=${observation.status}`) problems.push(`${prefix}/${label}: downloaded bytes differ from the source file`);
        }
      }
      if (side === "actual" && result.provenance?.engine === "ts-production" && (result.runtime?.passwordHash !== "pbkdf2" || result.runtime?.assetRefresh !== "cautious" || !result.runtime?.scssCompilerConfigured || !/^[a-f0-9]{64}$/.test(result.runtime?.scssCompilerSha256 ?? ""))) problems.push(`${prefix}: production settings do not match PBKDF2/cautious/verified compiler configuration`);
      if (side === "actual") {
        for (const request of result.network ?? []) {
          if (["script", "stylesheet", "font", "image"].includes(request.resourceType) && (request.failure || request.status >= 400)) problems.push(`${prefix}: required ${request.resourceType} failed ${request.status ?? request.failure} at ${request.path}`);
        }
        if (productContracts.network?.[journey.id]?.successfulWrites) {
          const origin = bunnyInputs ? new URL(bunnyInputs.application.targetOrigin).hostname : "local";
          const writes = (result.network ?? []).filter(r => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method) && r.origin === origin);
          if (!writes.length || writes.some(r => r.failure || !Number.isInteger(r.status) || r.status < 200 || r.status >= 400)) problems.push(`${prefix}: product requires successful recorded write requests`);
        }
        const observations = new Map((result.observations ?? []).map(o => [o.label,o]));
        const required = [contracts[journey.id] ?? {}, Object.fromEntries(journey.steps.filter(s => s.observe && s.expect).map(s => [s.observe,s.expect])), additionalContracts[journey.id] ?? {}];
        for (const [label, expectation] of required.flatMap(policy => Object.entries(policy))) {
          if (!expectation || typeof expectation !== "object") continue;
          const observation = observations.get(label);
          if (!observation) { problems.push(`${prefix}/${label}: product observation missing`); continue; }
          const strictShape = strictParityMode ? expectation.strictParity : undefined;
          const applied = strictShape && typeof strictShape === "object" ? strictShape : expectation;
          if (applied.status !== undefined && applied.status !== observation.status) problems.push(`${prefix}/${label}: product expected HTTP ${applied.status}, got ${observation.status}`);
          for (const text of applied.textIncludes ?? []) if (!observation.text?.includes(text)) problems.push(`${prefix}/${label}: product text missing ${JSON.stringify(text)}`);
          for (const text of Array.isArray(applied.structureIncludes) ? applied.structureIncludes : []) if (!(observation.structure ?? []).join("\n").includes(text)) problems.push(`${prefix}/${label}: product structure missing ${JSON.stringify(text)}`);
          for (const text of applied.textExcludes ?? []) if (observation.text?.includes(text)) problems.push(`${prefix}/${label}: product failure text present ${JSON.stringify(text)}`);
        }
      }
      const p = result.provenance;
      if (!p || p.format !== "decko-browser-evidence/1") { problems.push(`${prefix}: missing provenance`); continue; }
      for (const [key, value] of Object.entries(hashes).filter(([key]) => key !== "contractsSha256")) if (p[key] !== value) problems.push(`${prefix}: ${key} mismatch`);
      if ((bunny || p.contractsSha256) && p.contractsSha256 !== hashes.contractsSha256) problems.push(`${prefix}: captured product contract hash differs from evaluated policy`);
      if (p.source?.dirty !== false) problems.push(`${prefix}: source was dirty`);
      if (!/^[a-f0-9]{40}$/.test(p.source?.commit ?? "")) problems.push(`${prefix}: invalid source commit`);
      if (!bunny && side === "actual" && p.source?.commit !== candidate) problems.push(`${prefix}: wrong candidate commit`);
      if (!p.runId) problems.push(`${prefix}: missing run identity`);
      runs.add(p.runId); sources.add(p.source?.commit); artifacts.add(bunny && side === "actual" ? p.application?.bundleSha256 : p.artifacts?.distSha256);
      if (!result.browserVersion) problems.push(`${prefix}: missing actual browser version`);
      const referenceTarget = p.runner?.referenceTarget ?? "local";
      if (!bunny && side === "reference") {
        if (referenceTarget === "vm") {
          if (!/^\d+\.\d+\.\d+/.test(result.runtime?.ruby ?? "")) problems.push(`${prefix}: reference runtime is not recorded`);
          if (result.runtime?.card !== "1.110.0" || result.runtime?.decko !== "0.20.0") {
            problems.push(`${prefix}: reference identity is not card 1.110.0 / decko 0.20.0 (${result.runtime?.card ?? "?"} / ${result.runtime?.decko ?? "?"})`);
          }
        } else if (!/^3\.3\./.test(result.runtime?.ruby ?? "")) {
          problems.push(`${prefix}: reference runtime is not recorded Ruby3.3`);
        }
      }
      if (!bunny && side === "actual" && (p.buildReceipt?.sourceCommit !== p.source?.commit || p.buildReceipt?.sourceDiffSha256 !== p.source?.diffSha256 || p.buildReceipt?.distSha256 !== p.artifacts?.distSha256)) problems.push(`${prefix}: build receipt does not bind current source and artifact`);
      if (!bunny && side === "actual" && (!/^[a-f0-9]{64}$/.test(p.artifacts?.distSha256 ?? "") || !result.runtime?.node)) problems.push(`${prefix}: missing Node artifact/runtime identity`);
      if (bunny) {
        try { validateBunnyPreparation(result, side, bunnyInputs?.application.targetOrigin); }
        catch (error) { problems.push(`${prefix}: ${error.message}`); }
        try {
          if (!equal(bunnyMailFields(result.rawMail), result.mail)) problems.push(`${prefix}: mail fields differ from retained raw messages`);
        } catch (error) { problems.push(`${prefix}: ${error.message}`); }
        const expectedHarnessCommit = side === "reference"
          ? (args["reference-harness-candidate"] ?? args["harness-candidate"])
          : args["harness-candidate"];
        if (p.comparisonMode !== BUNNY_COMPARISON_MODE || p.source?.commit !== expectedHarnessCommit
            || p.source?.diffSha256 !== sha256("") || p.source?.statusSha256 !== sha256("")) problems.push(`${prefix}: wrong or dirty harness source for Bunny comparison`);
        if (p.selection?.filter) {
          if (!individual) problems.push(`${prefix}: partial capture requires an individual journey verdict`);
          else {
            try { if (!new RegExp(p.selection.filter).test(journey.id)) problems.push(`${prefix}: capture selection excludes the requested journey`); }
            catch { problems.push(`${prefix}: invalid capture selection`); }
          }
        }
        const engineFile = side === "reference" ? "bunny-local.json" : "live.json";
        if (p.engineSha256 !== sha256(readFileSync(new URL(`../engines/${engineFile}`, import.meta.url)))) problems.push(`${prefix}: engine manifest differs from the selected Bunny runtime`);
        if (result.rowsUnavailable || result.mailUnavailable || !Array.isArray(result.network)) problems.push(`${prefix}: unavailable row, mail or network evidence`);
        for (const step of steps.filter(s => s.step.editor)) if (!["tinymce", "ace", "plain"].includes(step.via)) problems.push(`${prefix}: missing editor interaction evidence`);
        const binding = side === "reference" ? bunnyInputs?.reference : bunnyInputs?.application;
        if (!binding || Object.entries(binding).some(([key,value]) => p.application?.[key] !== value)) problems.push(`${prefix}: application source/artifact/deployment binding mismatch`);
        if (side === "reference") {
          if (p.engine !== "bunny-local" || result.runtime?.engine !== "bunny-handler-node-local-hrana" || !result.runtime?.node || result.runtime?.productionRuntime !== false) problems.push(`${prefix}: missing local Bunny-handler Node runtime`);
          if (!equal(p.buildReceipt, bunnyInputs?.referenceBuildReceipt) || p.artifacts?.distSha256 !== binding?.distSha256) problems.push(`${prefix}: local reference build does not bind selected source and artifact`);
        } else {
          if (p.engine !== "live-override") problems.push(`${prefix}: actual capture is not a hosted engine`);
          if (p.artifacts?.bundleSha256 !== binding?.bundleSha256) problems.push(`${prefix}: hosted artifact differs from selected deployed bundle`);
          if (!result.hostedSnapshot || !result.fixtureReset?.digestMatch || !result.fixtureReset?.actorsMatch) problems.push(`${prefix}: hosted row fixture evidence missing`);
          if (result.mailSource !== "owned HTTPS receiver; retained messages read with an authenticated cursor") problems.push(`${prefix}: hosted mail observation source missing`);
          if (binding) try { validateBunnyGuard(p.application?.guard, binding, p.startedAt); }
          catch (error) { problems.push(`${prefix}: ${error.message}`); }
        }
      }
    }
    if (runs.size !== 1 || sources.size !== 1 || ((bunny || side === "actual") && artifacts.size !== 1)) problems.push(`${side}: mixed or missing run/source/artifact identity`);
  }
  return { ids, selection: { scope: individual ? "individual" : "suite", caseId: individual ? args.case : null, required: definitions.length, selected: ids.length }, candidate: candidate ?? null, comparisonMode: mode ?? null, bunnyInputs: bunnyInputs ?? null, hashes, additionalPolicy, problems };
}
