import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { sourceGitEnvironment } from '../../reference-harness/runner/source-git-environment.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceProvenance(repo) {
  if (existsSync(path.join(repo, '.git'))) {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', repo, ...args], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 512 * 1024 * 1024, env: sourceGitEnvironment(),
    }).trim();
    return { sourceCommit: git('rev-parse', 'HEAD'), sourceDiffSha256: sha(git('diff', 'HEAD', '--binary')) };
  }
  const bytes = readFileSync(path.join(repo, 'HANDOVER-MANIFEST.json'));
  const manifest = JSON.parse(bytes);
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !Array.isArray(manifest.files)) throw Error('invalid source snapshot manifest');
  const changes = [];
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.includes('\\') || file.path.split('/').some(p => p === '..' || p === '') || path.isAbsolute(file.path)) throw Error('unsafe snapshot manifest path');
    const current = sha(readFileSync(path.join(repo, file.path)));
    if (current !== file.sha256) changes.push([file.path, current]);
  }
  return { sourceCommit: manifest.sourceCommit, sourceDiffSha256: sha(JSON.stringify(changes)), sourceSnapshotSha256: sha(bytes), changedSnapshotFiles: changes.length };
}
