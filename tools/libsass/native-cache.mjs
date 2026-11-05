import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, watch, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const identityKey = identity => sha256(JSON.stringify(identity));

export function readArtifact(root, key, filename) {
  const dir = join(root, key);
  if (!existsSync(dir)) return null;
  const receipt = join(dir, "manifest.json");
  const artifact = join(dir, filename);
  let manifest;
  try { manifest = JSON.parse(readFileSync(receipt, "utf8")); }
  catch { throw new Error(`native cache manifest missing or invalid: ${receipt}`); }
  if (manifest.format !== 1 || manifest.key !== key || identityKey(manifest.inputs) !== key ||
      !existsSync(artifact) || statSync(artifact).size !== manifest.bytes || sha256(readFileSync(artifact)) !== manifest.sha256) {
    throw new Error(`native cache integrity mismatch: ${dir}`);
  }
  return { artifact, manifest };
}

async function ownKey(root, key, action, waitMs = 600_000) {
  mkdirSync(root, { recursive: true });
  const lock = join(root, `${key}.lock`);
  const token = randomUUID();
  const owner = JSON.stringify({ pid: process.pid, token, started: new Date().toISOString() });
  const acquire = () => {
    try {
      const fd = openSync(lock, "wx");
      try { writeFileSync(fd, owner); } finally { closeSync(fd); }
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try { previous = readFileSync(lock, "utf8"); } catch { return false; }
      let pid;
      try { pid = JSON.parse(previous).pid; } catch { return false; }
      if (!Number.isInteger(pid) || pid < 1) return false;
      try { process.kill(pid, 0); return false; }
      catch (probe) { if (probe.code !== "ESRCH") return false; }
      try { if (readFileSync(lock, "utf8") === previous) unlinkSync(lock); }
      catch (changed) { if (changed.code !== "ENOENT") throw changed; }
      return false;
    }
  };
  let watcher;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      const attempt = () => {
        try { if (acquire()) resolve(); } catch (error) { reject(error); }
      };
      watcher = watch(root, (_event, name) => { if (String(name) === `${key}.lock`) attempt(); });
      watcher.on("error", reject);
      timer = setTimeout(() => reject(new Error(`native build owner has not completed: ${lock}`)), waitMs);
      attempt();
    });
    clearTimeout(timer);
    watcher.close();
    return await action();
  } finally {
    clearTimeout(timer);
    watcher?.close();
    try { if (readFileSync(lock, "utf8") === owner) unlinkSync(lock); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function cachedArtifact({ root, inputs, filename, build, verifyInputs, provenance, lockWaitMs = 600_000 }) {
  const key = identityKey(inputs);
  const hit = readArtifact(root, key, filename);
  if (hit) return { ...hit, cacheHit: true };
  return ownKey(root, key, async () => {
    const completed = readArtifact(root, key, filename);
    if (completed) return { ...completed, cacheHit: true };
    const work = mkdtempSync(join(root, `.${key}-work-`));
    const publish = mkdtempSync(join(root, `.${key}-publish-`));
    try {
      const built = await build(work);
      if (verifyInputs && identityKey(await verifyInputs()) !== key) throw new Error("native build inputs changed during compilation");
      const bytes = readFileSync(built);
      const manifest = { format: 1, key, inputs, sha256: sha256(bytes), bytes: bytes.length, provenance: provenance ?? "compiled", completed: new Date().toISOString() };
      copyFileSync(built, join(publish, filename));
      if (sha256(readFileSync(join(publish, filename))) !== manifest.sha256) throw new Error("native artifact changed while publishing");
      chmodSync(join(publish, filename), 0o755);
      writeFileSync(join(publish, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      renameSync(publish, join(root, key));
      return { ...readArtifact(root, key, filename), cacheHit: false };
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(publish, { recursive: true, force: true });
    }
  }, lockWaitMs);
}

export function materialize({ artifact, manifest }, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination) || sha256(readFileSync(destination)) !== manifest.sha256) {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      copyFileSync(artifact, temporary);
      if (sha256(readFileSync(temporary)) !== manifest.sha256) throw new Error("native artifact changed while materializing");
      chmodSync(temporary, 0o755);
      renameSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  }
  const receipt = `${destination}.manifest.json`;
  const temporary = `${receipt}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n");
    renameSync(temporary, receipt);
  } finally { rmSync(temporary, { force: true }); }
}
