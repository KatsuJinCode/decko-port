import { execFileSync } from "node:child_process";
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const STATUS_TIMEOUT_MS = 15_000;
export class HostedBuildRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "HostedBuildRefusal";
  }
}
export function resolveCommitUnderTest(repoRoot, ref = "HEAD") {
  const commit = execFileSync("git", ["-C", repoRoot, "rev-parse", "--verify", `${ref}^{commit}`], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!FULL_COMMIT_SHA.test(commit)) {
    throw new HostedBuildRefusal(`HOSTED RUN REFUSED: git did not resolve "${ref}" to a full commit in ${repoRoot}. No test request was sent.`);
  }
  return commit;
}
export async function checkHostedBuildMatchesCommit({ baseUrl, expectedCommit, fetchImpl = globalThis.fetch }) {
  if (!FULL_COMMIT_SHA.test(expectedCommit ?? "")) {
    throw new HostedBuildRefusal(`HOSTED RUN REFUSED: the commit under test is not a full SHA ("${expectedCommit}"). No test request was sent.`);
  }
  const statusUrl = `${String(baseUrl).replace(/\/+$/, "")}/_status`;
  const claim = `commit under test ${expectedCommit}`;
  const unreadable = (why) =>
    new HostedBuildRefusal(
      `HOSTED RUN REFUSED: the deployed build at ${statusUrl} has no readable build identity (${why}), so it cannot be shown to equal ${claim}. No test request was sent. Redeploy from a bundle that stamps its commit, then re-run.`,
    );
  let response;
  try {
    response = await fetchImpl(statusUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
  } catch (error) {
    throw unreadable(`status request failed: ${error?.message ?? error}`);
  }
  if (!response.ok) throw unreadable(`status returned HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw unreadable("status body is not JSON");
  }
  const build = body?.build;
  if (build === null || typeof build !== "object") throw unreadable("status body has no build field");
  if (typeof build.commit !== "string" || !FULL_COMMIT_SHA.test(build.commit)) {
    throw unreadable("build field has no commit");
  }
  if (build.tree_dirty !== false) {
    throw new HostedBuildRefusal(
      `HOSTED RUN REFUSED: the deployed build at ${statusUrl} is commit ${build.commit} built from a tree with uncommitted changes, so it is not the ${claim}. No test request was sent.`,
    );
  }
  if (build.commit !== expectedCommit) {
    throw new HostedBuildRefusal(
      `HOSTED RUN REFUSED: the deployed build at ${statusUrl} is commit ${build.commit}, but this run claims to test ${claim}. No test request was sent. Deploy the commit under test, then re-run.`,
    );
  }
  return { commit: build.commit, statusUrl };
}
export async function requireHostedBuildMatchesCommit({ baseUrl, repoRoot, expectedCommit }) {
  try {
    const commit = expectedCommit ?? resolveCommitUnderTest(repoRoot);
    const result = await checkHostedBuildMatchesCommit({ baseUrl, expectedCommit: commit });
    console.log(`hosted build verified: ${result.statusUrl} reports commit ${result.commit}`);
    return result;
  } catch (error) {
    console.error(error instanceof HostedBuildRefusal ? error.message : `HOSTED RUN REFUSED: ${error?.message ?? error}. No test request was sent.`);
    process.exit(1);
  }
}
